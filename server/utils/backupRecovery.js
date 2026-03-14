const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const mongoose = require('mongoose');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const BackupArtifact = require('../models/BackupArtifact');
const BackupLog = require('../models/BackupLog');
const Setting = require('../models/Setting');
const {
  createImmutableManifestForArtifact,
  appendJournalEntry,
  withJournalCaptureSuspended
} = require('./resilienceManager');

const appPackage = require('../../package.json');

const BACKUP_ROOT = path.join(__dirname, '../storage/backups');
const TMP_ROOT = path.join(__dirname, '../storage/tmp');
const UPLOADS_ROOT = path.join(__dirname, '../uploads');

const ALLOWED_ENV_EXPORT = [
  'NODE_ENV',
  'PORT',
  'ENABLE_CSRF',
  'COOKIE_SECURE',
  'SESSION_MAX_AGE_MS',
  'TRUST_PROXY_HOPS',
  'MAX_BACKUP_UPLOAD_MB',
  'CORS_ORIGIN'
];

const OBJECT_ID_FIELD_NAMES = new Set([
  '_id',
  'store',
  'assignedStore',
  'parentStore',
  'createdBy',
  'updatedBy',
  'performedBy',
  'approvedBy',
  'rejectedBy',
  'user',
  'vendor',
  'product',
  'category',
  'request',
  'pass',
  'permit',
  'asset'
]);

const OBJECT_ID_EXCLUDE_NAMES = new Set([
  'uniqueId',
  'asset_id',
  'serial_number',
  'asset_tag',
  'rfid',
  'qr_code'
]);
const NUMERIC_FIELD_NAMES = new Set([
  '__v',
  'quantity',
  'price',
  'amount',
  'cost',
  'unitPrice',
  'unit_price',
  'total'
]);

const shouldCoerceToObjectId = (key = '', parentKey = '') => {
  if (!key && !parentKey) return false;
  if (OBJECT_ID_EXCLUDE_NAMES.has(key)) return false;
  if (OBJECT_ID_FIELD_NAMES.has(key)) return true;
  if (/_id$/i.test(key)) return true;
  if (/Id$/.test(key) && !/uniqueId$/i.test(key)) return true;
  if (/Ids$/.test(parentKey) && !/uniqueIds$/i.test(parentKey)) return true;
  return false;
};

const coerceDocObjectIds = (value, key = '', parentKey = '') => {
  if (Array.isArray(value)) {
    return value.map((item) => coerceDocObjectIds(item, '', key || parentKey));
  }
  if (value && typeof value === 'object') {
    // Canonical EJSON wrappers from legacy/new backup files.
    if (Object.prototype.hasOwnProperty.call(value, '$oid')) {
      const oid = String(value.$oid || '');
      if (mongoose.Types.ObjectId.isValid(oid)) return new mongoose.Types.ObjectId(oid);
    }
    if (Object.prototype.hasOwnProperty.call(value, '$date')) {
      const d = value.$date;
      if (typeof d === 'string' || typeof d === 'number') return new Date(d);
      if (d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, '$numberLong')) {
        return new Date(Number(d.$numberLong));
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, '$numberInt')) return Number(value.$numberInt);
    if (Object.prototype.hasOwnProperty.call(value, '$numberLong')) return Number(value.$numberLong);
    if (Object.prototype.hasOwnProperty.call(value, '$numberDouble')) return Number(value.$numberDouble);
    if (Object.prototype.hasOwnProperty.call(value, '$numberDecimal')) return Number(value.$numberDecimal);
    // Legacy wrapper seen in historical backups: { value: 1 } for numeric fields.
    if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'value') && NUMERIC_FIELD_NAMES.has(key)) {
      const n = Number(value.value);
      return Number.isFinite(n) ? n : value.value;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = coerceDocObjectIds(v, k, key || parentKey);
    }
    return out;
  }
  if (typeof value === 'string' && shouldCoerceToObjectId(key, parentKey) && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
};

const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const formatBackupFileName = (version = 'unknown') => {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  const ts = `${d.getUTCFullYear()}_${p(d.getUTCMonth() + 1)}_${p(d.getUTCDate())}_${p(d.getUTCHours())}_${p(d.getUTCMinutes())}`;
  const safeVersion = String(version || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `backup_${ts}_${safeVersion}.zip`;
};

const createZipFromDirectory = async (sourceDir, outputZipPath) => {
  await ensureDir(path.dirname(outputZipPath));
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
};

const copyDirectory = async (src, dest) => {
  await ensureDir(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
};

const removeDirectorySafe = async (dirPath) => {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // best effort
  }
};

const exportCollectionsNdjson = async ({ outputFilePath, incrementalSince }) => {
  await ensureDir(path.dirname(outputFilePath));
  const stream = fs.createWriteStream(outputFilePath, { flags: 'w' });
  const collections = await mongoose.connection.db.listCollections().toArray();
  const summary = {};
  for (const c of collections) {
    const collectionName = c.name;
    const collection = mongoose.connection.db.collection(collectionName);
    const filter = incrementalSince
      ? { $or: [{ updatedAt: { $gte: incrementalSince } }, { createdAt: { $gte: incrementalSince } }] }
      : {};
    const cursor = collection.find(filter);
    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      // Preserve BSON types (ObjectId/Date) for accurate restore.
      stream.write(`${JSON.stringify({ collection: collectionName, doc: JSON.parse(mongoose.mongo.BSON.EJSON.stringify(doc, { relaxed: false })) })}\n`);
      count += 1;
    }
    summary[collectionName] = count;
  }
  await new Promise((resolve) => stream.end(resolve));
  return summary;
};

const createSettingsSnapshot = async () => {
  const settings = await Setting.find({}).lean();
  const safeEnv = {};
  for (const key of ALLOWED_ENV_EXPORT) {
    safeEnv[key] = process.env[key] || null;
  }
  return {
    settings,
    env: safeEnv
  };
};

const readCloudConfig = async () => {
  const doc = await Setting.findOne({ key: 'backupCloudConfig' }).lean();
  return doc?.value || {};
};

const syncToCloud = async ({ filePath, backupFileName, backupId }) => {
  const cfg = await readCloudConfig();
  if (!cfg || cfg.enabled !== true) {
    return { synced: false, provider: '', objectKey: '', error: '' };
  }

  const provider = String(cfg.provider || '').toLowerCase();
  const objectKey = `backups/${backupFileName}`;

  if (provider === 's3' || provider === 'r2') {
    const endpoint = cfg.endpoint ? String(cfg.endpoint) : undefined;
    const s3Client = new S3Client({
      region: cfg.region || 'auto',
      endpoint,
      forcePathStyle: Boolean(cfg.forcePathStyle),
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      } : undefined
    });
    const stat = await fsp.stat(filePath);
    const body = fs.createReadStream(filePath);
    if (stat.size > 50 * 1024 * 1024) {
      const uploader = new Upload({
        client: s3Client,
        params: { Bucket: cfg.bucket, Key: objectKey, Body: body, ContentType: 'application/zip' }
      });
      await uploader.done();
    } else {
      await s3Client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
        Body: body,
        ContentType: 'application/zip'
      }));
    }
    await BackupArtifact.updateOne({ _id: backupId }, {
      $set: {
        'cloud.synced': true,
        'cloud.provider': provider,
        'cloud.objectKey': objectKey,
        'cloud.syncedAt': new Date(),
        'cloud.error': ''
      }
    });
    return { synced: true, provider, objectKey, error: '' };
  }

  if (provider === 'supabase') {
    const supabase = createSupabaseClient(cfg.url, cfg.serviceRoleKey);
    const bucket = cfg.bucket || 'backups';
    const fileBuffer = await fsp.readFile(filePath);
    const { error } = await supabase.storage.from(bucket).upload(objectKey, fileBuffer, {
      contentType: 'application/zip',
      upsert: true
    });
    if (error) throw error;
    await BackupArtifact.updateOne({ _id: backupId }, {
      $set: {
        'cloud.synced': true,
        'cloud.provider': provider,
        'cloud.objectKey': objectKey,
        'cloud.syncedAt': new Date(),
        'cloud.error': ''
      }
    });
    return { synced: true, provider, objectKey, error: '' };
  }

  return { synced: false, provider: '', objectKey: '', error: 'Unsupported provider' };
};

const createBackupLog = async ({ action, backupId, backupName, user, details }) => {
  await BackupLog.create({
    action,
    backupId: backupId || null,
    backupName: backupName || '',
    performedBy: user?._id || null,
    performedByEmail: user?.email || '',
    details: details || ''
  });
};

const createBackupArtifact = async ({
  backupType = 'Full',
  trigger = 'manual',
  user = null,
  sourceBackupId = null
}) => {
  await ensureDir(BACKUP_ROOT);
  await ensureDir(TMP_ROOT);

  const now = new Date();
  const appVersion = appPackage.version || 'unknown';
  const fileName = formatBackupFileName(appVersion);
  const workDir = path.join(TMP_ROOT, `backup-work-${Date.now()}-${Math.round(Math.random() * 100000)}`);
  const backupDir = path.join(workDir, 'backup');
  const filesDir = path.join(backupDir, 'files');
  const dbFile = path.join(backupDir, 'database.ndjson');
  const settingsFile = path.join(backupDir, 'settings.json');
  const metaFile = path.join(backupDir, 'meta.json');
  const zipPath = path.join(BACKUP_ROOT, fileName);

  let artifact = null;
  try {
    await ensureDir(filesDir);
    const lastArtifact = backupType === 'Incremental'
      ? await BackupArtifact.findOne({ status: 'ready' }).sort({ createdAt: -1 }).lean()
      : null;
    const incrementalSince = backupType === 'Incremental' && lastArtifact?.createdAt ? new Date(lastArtifact.createdAt) : null;

    const collectionSummary = await exportCollectionsNdjson({ outputFilePath: dbFile, incrementalSince });
    if (fs.existsSync(UPLOADS_ROOT)) {
      await copyDirectory(UPLOADS_ROOT, filesDir);
    }
    const settingsSnapshot = await createSettingsSnapshot();
    await fsp.writeFile(settingsFile, JSON.stringify(settingsSnapshot, null, 2), 'utf8');
    const meta = {
      backup_date: now.toISOString(),
      app_version: appVersion,
      database_version: 'mongodb',
      backup_type: backupType,
      trigger,
      from_backup_id: sourceBackupId || null
    };
    await fsp.writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf8');
    await createZipFromDirectory(backupDir, zipPath);
    const stat = await fsp.stat(zipPath);

    artifact = await BackupArtifact.create({
      name: path.basename(fileName, '.zip'),
      fileName,
      filePath: zipPath,
      sizeBytes: stat.size,
      backupType,
      appVersion,
      databaseVersion: 'mongodb',
      status: 'ready',
      trigger,
      metadata: {
        collections: collectionSummary,
        includesFiles: true,
        fromBackupId: sourceBackupId || null
      },
      createdBy: user?._id || null
    });

    await createBackupLog({
      action: 'backup_created',
      backupId: artifact._id,
      backupName: artifact.name,
      user,
      details: `Backup ${backupType} created (${Math.round(stat.size / 1024)} KB)`
    });
    await createImmutableManifestForArtifact(artifact).catch(() => {});

    try {
      await syncToCloud({ filePath: zipPath, backupFileName: fileName, backupId: artifact._id });
    } catch (cloudError) {
      await BackupArtifact.updateOne({ _id: artifact._id }, { $set: { 'cloud.error': cloudError.message || String(cloudError) } });
      await createBackupLog({
        action: 'cloud_sync_failed',
        backupId: artifact._id,
        backupName: artifact.name,
        user,
        details: cloudError.message || String(cloudError)
      });
    }

    return artifact;
  } catch (error) {
    if (artifact?._id) {
      await BackupArtifact.updateOne({ _id: artifact._id }, { $set: { status: 'failed' } });
    }
    await createBackupLog({
      action: 'backup_failed',
      backupId: artifact?._id || null,
      backupName: artifact?.name || '',
      user,
      details: error.message || String(error)
    });
    throw error;
  } finally {
    await removeDirectorySafe(workDir);
  }
};

const parseNdjsonDatabase = async (filePath) => {
  const content = await fsp.readFile(filePath, 'utf8');
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const grouped = new Map();
  for (const line of lines) {
    const entry = mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false });
    const col = String(entry.collection || '').trim();
    if (!col) continue;
    if (!grouped.has(col)) grouped.set(col, []);
    grouped.get(col).push(coerceDocObjectIds(entry.doc));
  }
  return grouped;
};

const parseJsonDatabase = async (filePath) => {
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = mongoose.mongo.BSON.EJSON.parse(String(raw || '').replace(/^\uFEFF/, '') || '{}', { relaxed: false });
  const grouped = new Map();

  // Newer compatibility format: [{ collection, doc }, ...]
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const col = String(entry?.collection || '').trim();
      if (!col || !entry?.doc || typeof entry.doc !== 'object') continue;
      if (!grouped.has(col)) grouped.set(col, []);
      grouped.get(col).push(coerceDocObjectIds(entry.doc));
    }
    return grouped;
  }

  // Common backup JSON shapes:
  // 1) { collections: { users: [...], assets: [...] } }
  // 2) { users: [...], assets: [...], ... }
  const collections = (parsed && typeof parsed.collections === 'object' && parsed.collections)
    ? parsed.collections
    : parsed;

  if (collections && typeof collections === 'object') {
    for (const [collectionName, docs] of Object.entries(collections)) {
      if (!Array.isArray(docs)) continue;
      grouped.set(collectionName, docs.filter((doc) => doc && typeof doc === 'object').map((doc) => coerceDocObjectIds(doc)));
    }
  }

  return grouped;
};

const restoreFromExtractedBackup = async (extractedDir) => {
  const backupDirCandidate = path.join(extractedDir, 'backup');
  const rootCandidate = extractedDir;
  const backupDir = fs.existsSync(path.join(backupDirCandidate, 'database.ndjson'))
    || fs.existsSync(path.join(backupDirCandidate, 'database.json'))
    ? backupDirCandidate
    : rootCandidate;
  const databaseNdjsonFile = path.join(backupDir, 'database.ndjson');
  const databaseJsonFile = path.join(backupDir, 'database.json');
  const filesSource = path.join(backupDir, 'files');
  const settingsFile = path.join(backupDir, 'settings.json');

  if (!fs.existsSync(databaseNdjsonFile) && !fs.existsSync(databaseJsonFile)) {
    throw new Error('Backup file is invalid: database export is missing (database.ndjson or database.json)');
  }

  const grouped = fs.existsSync(databaseNdjsonFile)
    ? await parseNdjsonDatabase(databaseNdjsonFile)
    : await parseJsonDatabase(databaseJsonFile);
  const applyRestoreWithoutTransaction = async () => {
    for (const [collectionName] of grouped.entries()) {
      await mongoose.connection.db.collection(collectionName).deleteMany({});
    }
    for (const [collectionName, docs] of grouped.entries()) {
      if (!docs.length) continue;
      await mongoose.connection.db.collection(collectionName).insertMany(docs, { ordered: false });
    }
  };

  const isTransactionNotSupported = (error) => {
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('transaction numbers are only allowed on a replica set member or mongos')
      || msg.includes('replica set');
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const [collectionName] of grouped.entries()) {
        await mongoose.connection.db.collection(collectionName).deleteMany({}, { session });
      }
      for (const [collectionName, docs] of grouped.entries()) {
        if (!docs.length) continue;
        await mongoose.connection.db.collection(collectionName).insertMany(docs, { session, ordered: false });
      }
    });
  } catch (error) {
    if (!isTransactionNotSupported(error)) throw error;
    await applyRestoreWithoutTransaction();
  } finally {
    await session.endSession();
  }

  if (fs.existsSync(filesSource)) {
    await removeDirectorySafe(UPLOADS_ROOT);
    await ensureDir(UPLOADS_ROOT);
    await copyDirectory(filesSource, UPLOADS_ROOT);
  }

  if (fs.existsSync(settingsFile)) {
    const raw = await fsp.readFile(settingsFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (Array.isArray(parsed.settings)) {
      for (const s of parsed.settings) {
        if (!s?.key) continue;
        await Setting.updateOne(
          { key: s.key },
          { $set: { value: s.value, updatedAt: new Date() } },
          { upsert: true }
        );
      }
    }
  }
};

const extractBackupZip = async (zipPath) => {
  const extractDir = path.join(TMP_ROOT, `restore-${Date.now()}-${Math.round(Math.random() * 100000)}`);
  await ensureDir(extractDir);
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: extractDir })).promise();
  return extractDir;
};

const restoreBackupArtifact = async ({ backupArtifact, user, createSafetyBackup = true }) => {
  let safetyBackup = null;
  let extractDir = null;
  try {
    if (createSafetyBackup) {
      safetyBackup = await createBackupArtifact({
        backupType: 'Full',
        trigger: 'rollback',
        user,
        sourceBackupId: backupArtifact?._id || null
      });
    }

    extractDir = await extractBackupZip(backupArtifact.filePath);
    await withJournalCaptureSuspended(async () => {
      await restoreFromExtractedBackup(extractDir);
    });
    await createBackupLog({
      action: 'backup_restored',
      backupId: backupArtifact._id,
      backupName: backupArtifact.name,
      user,
      details: `Restore completed${safetyBackup ? ` with safety backup ${safetyBackup.fileName}` : ''}`
    });
    await appendJournalEntry({
      opType: 'restore',
      collectionName: 'system',
      actor: user,
      metadata: {
        mode: 'artifact-restore',
        backupId: String(backupArtifact?._id || ''),
        backupName: backupArtifact?.fileName || backupArtifact?.name || ''
      }
    }).catch(() => {});
    return { ok: true, safetyBackupId: safetyBackup?._id || null };
  } catch (error) {
    await createBackupLog({
      action: 'restore_failed',
      backupId: backupArtifact?._id || null,
      backupName: backupArtifact?.name || '',
      user,
      details: error.message || String(error)
    });
    if (safetyBackup) {
      try {
        await restoreBackupArtifact({ backupArtifact: safetyBackup, user, createSafetyBackup: false });
      } catch {
        // If rollback also fails, original error is still surfaced.
      }
    }
    throw error;
  } finally {
    if (extractDir) await removeDirectorySafe(extractDir);
  }
};

const restoreFromUploadedZip = async ({ zipPath, user }) => {
  const pseudoArtifact = {
    _id: null,
    name: path.basename(zipPath),
    fileName: path.basename(zipPath),
    filePath: zipPath
  };
  return restoreBackupArtifact({ backupArtifact: pseudoArtifact, user, createSafetyBackup: true });
};

module.exports = {
  BACKUP_ROOT,
  createBackupArtifact,
  restoreBackupArtifact,
  restoreFromUploadedZip,
  createBackupLog
};
