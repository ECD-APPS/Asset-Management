const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const unzipper = require('unzipper');

const ChangeJournal = require('../models/ChangeJournal');
const ResilienceJob = require('../models/ResilienceJob');
const ResilienceVerification = require('../models/ResilienceVerification');
const BackupArtifact = require('../models/BackupArtifact');
const Setting = require('../models/Setting');

const IMMUTABLE_ROOT = path.join(__dirname, '../storage/immutable-backups');
const OPLOG_ARCHIVE_ROOT = path.join(__dirname, '../storage/oplog-archive');
const CRITICAL_COLLECTIONS = [
  'users',
  'stores',
  'assets',
  'requests',
  'activitylogs',
  'purchaseorders',
  'vendors',
  'passes',
  'permits',
  'assetcategories',
  'products'
];

const STATE_KEYS = {
  shadow: 'resilienceShadowState',
  upload: 'resilienceUploadState',
  verify: 'resilienceLastVerification',
  pitr: 'resiliencePitrState',
  backupAudit: 'resilienceBackupAuditState',
  crash: 'resilienceCrashState'
};

let JOURNAL_LISTENER_ATTACHED = false;
let JOURNAL_CAPTURE_SUSPENDED = false;
const commandMap = new Map();

const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');
const normalizeObj = (value) => {
  try {
    return JSON.parse(JSON.stringify(value || null));
  } catch {
    return null;
  }
};
const computeChecksum = async (filePath) => {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
};
const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};
const getDbName = () => mongoose.connection?.name || 'expo';
const getShadowDbName = () => process.env.SHADOW_DB_NAME || `${getDbName()}_shadow`;
const getState = async (key, fallback = {}) => {
  const doc = await Setting.findOne({ key }).lean();
  return doc?.value || fallback;
};
const setState = async (key, value) => {
  await Setting.updateOne(
    { key },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true }
  );
};

const appendJournalEntry = async ({
  opType,
  collectionName = '',
  documentId = '',
  before = null,
  after = null,
  actor = null,
  metadata = {}
}) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const last = await ChangeJournal.findOne({}).sort({ seq: -1 }).lean();
    const prevHash = String(last?.entryHash || 'GENESIS');
    const seq = Number(last?.seq || 0) + 1;
    const payload = {
      seq,
      opType,
      collectionName,
      documentId,
      before: normalizeObj(before),
      after: normalizeObj(after),
      actorId: String(actor?._id || ''),
      actorEmail: String(actor?.email || ''),
      metadata: normalizeObj(metadata),
      prevHash
    };
    const entryHash = sha256(JSON.stringify(payload));
    try {
      return await ChangeJournal.create({
        ...payload,
        entryHash,
        createdAt: new Date()
      });
    } catch (error) {
      if (String(error?.code) === '11000') continue;
      throw error;
    }
  }
  throw new Error('Failed to append journal entry due to high write contention.');
};

const withJournalCaptureSuspended = async (fn) => {
  JOURNAL_CAPTURE_SUSPENDED = true;
  try {
    return await fn();
  } finally {
    JOURNAL_CAPTURE_SUSPENDED = false;
  }
};

const getCollectionFromCommand = (event) => {
  const cmd = event?.command || {};
  if (cmd.insert) return String(cmd.insert);
  if (cmd.update) return String(cmd.update);
  if (cmd.delete) return String(cmd.delete);
  if (cmd.findAndModify) return String(cmd.findAndModify);
  if (cmd.findandmodify) return String(cmd.findandmodify);
  return '';
};

const sanitizeCommand = (cmd) => {
  const json = JSON.stringify(cmd || {});
  if (json.length <= 20000) return cmd;
  return { truncated: true, payloadHead: json.slice(0, 20000) };
};

const startCommandJournaling = () => {
  if (JOURNAL_LISTENER_ATTACHED) return;
  const client = mongoose.connection?.getClient?.();
  if (!client) return;

  JOURNAL_LISTENER_ATTACHED = true;
  client.on('commandStarted', (event) => {
    const commandName = String(event?.commandName || '').toLowerCase();
    if (!['insert', 'update', 'delete', 'findandmodify'].includes(commandName)) return;
    const collectionName = getCollectionFromCommand(event).toLowerCase();
    if (!collectionName || !CRITICAL_COLLECTIONS.includes(collectionName)) return;
    commandMap.set(event.requestId, {
      commandName,
      collectionName,
      command: sanitizeCommand(event.command),
      db: event.databaseName,
      startedAt: new Date().toISOString()
    });
  });

  client.on('commandSucceeded', async (event) => {
    if (JOURNAL_CAPTURE_SUSPENDED) return;
    const started = commandMap.get(event.requestId);
    if (!started) return;
    commandMap.delete(event.requestId);
    try {
      await appendJournalEntry({
        opType: started.commandName === 'findandmodify' ? 'update' : started.commandName,
        collectionName: started.collectionName,
        metadata: {
          source: 'mongo-command-monitor',
          db: started.db,
          command: started.command,
          durationMs: Number(event.duration || 0)
        }
      });
    } catch {
      // Non-blocking journal capture.
    }
  });

  client.on('commandFailed', (event) => {
    commandMap.delete(event.requestId);
  });
};

const createImmutableManifestForArtifact = async (artifact) => {
  if (!artifact?.filePath || !fs.existsSync(artifact.filePath)) return null;
  const created = artifact.createdAt ? new Date(artifact.createdAt) : new Date();
  const y = String(created.getUTCFullYear());
  const m = String(created.getUTCMonth() + 1).padStart(2, '0');
  const immutableDir = path.join(IMMUTABLE_ROOT, y, m);
  await ensureDir(immutableDir);
  const checksum = await computeChecksum(artifact.filePath);
  const immutableFileName = `${path.basename(artifact.fileName, '.zip')}-${checksum.slice(0, 12)}.zip`;
  const immutablePath = path.join(immutableDir, immutableFileName);
  if (!fs.existsSync(immutablePath)) {
    await fs.promises.copyFile(artifact.filePath, immutablePath);
  }
  const previousBackupId = String(artifact?.metadata?.chain?.previousBackupId || '');
  const previousChecksumSha256 = String(artifact?.metadata?.chain?.previousChecksumSha256 || '');
  const manifest = {
    manifestVersion: Number(artifact?.metadata?.manifestVersion || 1),
    backupId: String(artifact._id || ''),
    fileName: artifact.fileName,
    checksum,
    chain: {
      previousBackupId: previousBackupId || null,
      previousChecksumSha256: previousChecksumSha256 || null
    },
    compatibility: artifact?.metadata?.compatibility || {},
    immutablePath,
    createdAt: new Date().toISOString()
  };
  await fs.promises.writeFile(`${immutablePath}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
  await BackupArtifact.updateOne(
    { _id: artifact._id },
    { $set: { 'metadata.immutable': manifest } }
  );
  await appendJournalEntry({
    opType: 'snapshot',
    collectionName: 'backupartifacts',
    documentId: String(artifact._id || ''),
    metadata: manifest
  });
  return manifest;
};

const getRecoveryPointBefore = async (targetDate) => {
  return BackupArtifact.findOne({
    status: 'ready',
    createdAt: { $lte: targetDate }
  }).sort({ createdAt: -1 }).lean();
};

const previewRestoreToTime = async (targetDate) => {
  const snapshot = await getRecoveryPointBefore(targetDate);
  if (!snapshot) {
    throw new Error('No snapshot found before target timestamp.');
  }
  const journalCount = await ChangeJournal.countDocuments({
    createdAt: { $gt: snapshot.createdAt, $lte: targetDate }
  });
  return {
    targetTimestamp: targetDate.toISOString(),
    snapshot: {
      id: String(snapshot._id),
      fileName: snapshot.fileName,
      createdAt: snapshot.createdAt
    },
    replayEntries: journalCount
  };
};

const archiveOplogWindow = async ({ actor = null, retentionDays = 14 } = {}) => {
  const pitrEnabled = String(process.env.PITR_ENABLED || 'true').toLowerCase() === 'true';
  if (!pitrEnabled) {
    throw new Error('PITR is disabled (PITR_ENABLED=false).');
  }
  const adminDb = mongoose.connection.db.admin();
  const hello = await adminDb.command({ hello: 1 });
  if (!hello?.setName) {
    throw new Error('PITR requires replica set mode. MongoDB is not running as a replica set.');
  }

  await ensureDir(OPLOG_ARCHIVE_ROOT);
  const pitrState = await getState(STATE_KEYS.pitr, {});
  const localDb = mongoose.connection.client.db('local');
  const oplog = localDb.collection('oplog.rs');
  const filter = pitrState.lastTs ? { ts: { $gt: pitrState.lastTs } } : {};
  const docs = await oplog.find(filter).sort({ ts: 1 }).limit(20000).toArray();

  const createdAt = new Date();
  const archiveName = `oplog_${createdAt.toISOString().replace(/[:.]/g, '-')}.ndjson`;
  const archivePath = path.join(OPLOG_ARCHIVE_ROOT, archiveName);
  let firstTs = null;
  let lastTs = null;
  if (docs.length > 0) {
    const lines = docs.map((doc) => mongoose.mongo.BSON.EJSON.stringify(doc, { relaxed: false }));
    await fs.promises.writeFile(archivePath, `${lines.join('\n')}\n`, 'utf8');
    firstTs = docs[0].ts;
    lastTs = docs[docs.length - 1].ts;
  } else {
    await fs.promises.writeFile(archivePath, '', 'utf8');
  }
  const checksum = await computeChecksum(archivePath);
  const retentionCutoff = new Date(Date.now() - Math.max(1, Number(retentionDays || 14)) * 24 * 60 * 60 * 1000);

  const files = await fs.promises.readdir(OPLOG_ARCHIVE_ROOT);
  for (const file of files) {
    if (!file.endsWith('.ndjson')) continue;
    const full = path.join(OPLOG_ARCHIVE_ROOT, file);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) continue;
    if (stat.mtime >= retentionCutoff) continue;
    await fs.promises.unlink(full).catch(() => {});
  }

  const nextState = {
    enabled: true,
    lastArchivedAt: createdAt.toISOString(),
    lastArchiveFile: archiveName,
    lastArchiveChecksum: checksum,
    lastTs: lastTs || pitrState.lastTs || null,
    firstTs: firstTs || pitrState.firstTs || null,
    retainedDays: Math.max(1, Number(retentionDays || 14)),
    archivedOps: docs.length
  };
  await setState(STATE_KEYS.pitr, nextState);
  await appendJournalEntry({
    opType: 'archive',
    collectionName: 'system',
    actor,
    metadata: {
      mode: 'oplog-archive',
      archiveName,
      checksum,
      count: docs.length
    }
  });
  return nextState;
};

const readArchivedOplogEntriesUntil = async (targetDate) => {
  if (!fs.existsSync(OPLOG_ARCHIVE_ROOT)) return [];
  const names = (await fs.promises.readdir(OPLOG_ARCHIVE_ROOT))
    .filter((n) => n.endsWith('.ndjson'))
    .sort();
  const entries = [];
  for (const name of names) {
    const full = path.join(OPLOG_ARCHIVE_ROOT, name);
    const content = await fs.promises.readFile(full, 'utf8').catch(() => '');
    const lines = String(content || '').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      let parsed = null;
      try {
        parsed = mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false });
      } catch {
        parsed = null;
      }
      if (!parsed?.ts) continue;
      const opDate = parsed.ts?.getHighBits ? new Date(parsed.ts.getHighBits() * 1000) : null;
      if (opDate && opDate <= targetDate) {
        entries.push(parsed);
      }
    }
  }
  return entries;
};

const applyJournalCommand = async (db, entry) => {
  const cmd = entry?.metadata?.command || {};
  const collectionName = String(entry.collectionName || '').toLowerCase();
  if (!collectionName || !CRITICAL_COLLECTIONS.includes(collectionName)) return;
  const collection = db.collection(collectionName);
  if (entry.opType === 'insert') {
    const docs = Array.isArray(cmd.documents) ? cmd.documents : [];
    if (docs.length > 0) await collection.insertMany(docs, { ordered: false });
    return;
  }
  if (entry.opType === 'update') {
    const updates = Array.isArray(cmd.updates) ? cmd.updates : [];
    for (const u of updates) {
      const q = u?.q || {};
      const upd = u?.u || {};
      if (!q || !upd) continue;
      if (u?.multi) await collection.updateMany(q, upd, { upsert: Boolean(u?.upsert) });
      else await collection.updateOne(q, upd, { upsert: Boolean(u?.upsert) });
    }
    return;
  }
  if (entry.opType === 'delete') {
    const deletes = Array.isArray(cmd.deletes) ? cmd.deletes : [];
    for (const d of deletes) {
      const q = d?.q || {};
      if (d?.limit === 1) await collection.deleteOne(q);
      else await collection.deleteMany(q);
    }
  }
};

const replayJournalEntriesToTime = async (targetDate, afterDate) => {
  const db = mongoose.connection.db;
  const entries = await ChangeJournal.find({
    createdAt: { $gt: afterDate, $lte: targetDate },
    opType: { $in: ['insert', 'update', 'delete'] }
  }).sort({ seq: 1 }).lean();
  for (const entry of entries) {
    await applyJournalCommand(db, entry);
  }
  return entries.length;
};

const applyOplogEntries = async (entries = []) => {
  const db = mongoose.connection.db;
  const dbName = String(db.databaseName || '');
  let applied = 0;
  for (const entry of entries) {
    const ns = String(entry?.ns || '');
    if (!ns.startsWith(`${dbName}.`)) continue;
    const collectionName = ns.split('.').slice(1).join('.');
    if (!CRITICAL_COLLECTIONS.includes(collectionName.toLowerCase())) continue;
    const c = db.collection(collectionName);
    if (entry.op === 'i') {
      const doc = entry.o;
      if (doc && typeof doc === 'object') {
        // eslint-disable-next-line no-await-in-loop
        await c.replaceOne({ _id: doc._id }, doc, { upsert: true });
        applied += 1;
      }
      continue;
    }
    if (entry.op === 'u') {
      const q = entry.o2 || {};
      const u = entry.o || {};
      // eslint-disable-next-line no-await-in-loop
      await c.updateOne(q, u, { upsert: false });
      applied += 1;
      continue;
    }
    if (entry.op === 'd') {
      const q = entry.o || {};
      // eslint-disable-next-line no-await-in-loop
      await c.deleteOne(q);
      applied += 1;
    }
  }
  return applied;
};

const restoreToTimestamp = async ({ targetDate, user }) => {
  const preview = await previewRestoreToTime(targetDate);
  const snapshot = await BackupArtifact.findById(preview.snapshot.id);
  if (!snapshot) throw new Error('Snapshot not found for restore.');
  const { restoreBackupArtifact } = require('./backupRecovery');
  await withJournalCaptureSuspended(async () => {
    await restoreBackupArtifact({
      backupArtifact: snapshot,
      user,
      createSafetyBackup: true,
      useMaintenanceLock: true
    });
  });
  const oplogEntries = await readArchivedOplogEntriesUntil(targetDate);
  let replayed = 0;
  if (oplogEntries.length > 0) {
    replayed = await applyOplogEntries(oplogEntries);
  } else {
    replayed = await replayJournalEntriesToTime(targetDate, new Date(preview.snapshot.createdAt));
  }
  await appendJournalEntry({
    opType: 'restore',
    collectionName: 'system',
    actor: user,
    metadata: {
      mode: 'restore-to-time',
      targetTimestamp: targetDate.toISOString(),
      snapshotId: preview.snapshot.id,
      replayed
    }
  });
  return { ...preview, replayed };
};

const dbCollectionDigest = async (db, collectionName) => {
  const collection = db.collection(collectionName);
  const count = await collection.countDocuments({});
  const sample = await collection.find({}, { projection: { _id: 1 } }).limit(200).toArray();
  const sampleHash = sha256(JSON.stringify(sample.map((r) => String(r._id))));
  return { count, sampleHash };
};

const syncShadowDatabase = async ({ fullResync = false, actor = null } = {}) => {
  const primary = mongoose.connection.db;
  const shadow = mongoose.connection.client.db(getShadowDbName());
  const shadowState = await getState(STATE_KEYS.shadow, { lastSeq: 0 });
  let applied = 0;
  if (fullResync) {
    await withJournalCaptureSuspended(async () => {
      for (const name of CRITICAL_COLLECTIONS) {
        const source = primary.collection(name);
        const target = shadow.collection(name);
        await target.deleteMany({});
        const docs = await source.find({}).toArray();
        if (docs.length > 0) await target.insertMany(docs, { ordered: false });
      }
    });
    const maxSeqEntry = await ChangeJournal.findOne({}).sort({ seq: -1 }).lean();
    shadowState.lastSeq = Number(maxSeqEntry?.seq || 0);
    applied = -1;
  } else {
    const entries = await ChangeJournal.find({
      seq: { $gt: Number(shadowState.lastSeq || 0) },
      opType: { $in: ['insert', 'update', 'delete'] }
    }).sort({ seq: 1 }).lean();
    for (const entry of entries) {
      await applyJournalCommand(shadow, entry);
      shadowState.lastSeq = entry.seq;
      applied += 1;
    }
  }

  const divergence = {};
  for (const name of ['stores', 'assets', 'users', 'requests']) {
    const a = await dbCollectionDigest(primary, name);
    const b = await dbCollectionDigest(shadow, name);
    divergence[name] = {
      primary: a,
      shadow: b,
      inSync: a.count === b.count && a.sampleHash === b.sampleHash
    };
  }
  const maxSeqEntry = await ChangeJournal.findOne({}).sort({ seq: -1 }).lean();
  shadowState.maxSeq = Number(maxSeqEntry?.seq || 0);
  shadowState.lag = Math.max(0, Number(shadowState.maxSeq || 0) - Number(shadowState.lastSeq || 0));
  shadowState.lastSyncAt = new Date().toISOString();
  shadowState.divergence = divergence;
  await setState(STATE_KEYS.shadow, shadowState);
  await appendJournalEntry({
    opType: 'shadow_sync',
    collectionName: 'system',
    actor,
    metadata: { fullResync, applied, lag: shadowState.lag }
  });
  return shadowState;
};

const promoteShadowToPrimary = async ({ actor }) => {
  const primary = mongoose.connection.db;
  const shadow = mongoose.connection.client.db(getShadowDbName());
  await withJournalCaptureSuspended(async () => {
    for (const name of CRITICAL_COLLECTIONS) {
      const source = shadow.collection(name);
      const target = primary.collection(name);
      const docs = await source.find({}).toArray();
      await target.deleteMany({});
      if (docs.length > 0) await target.insertMany(docs, { ordered: false });
    }
  });
  await appendJournalEntry({
    opType: 'promotion',
    collectionName: 'system',
    actor,
    metadata: { action: 'shadow-promote' }
  });
};

const failbackFromBackup = async ({ backupId, actor }) => {
  const target = backupId
    ? await BackupArtifact.findById(backupId)
    : await BackupArtifact.findOne({ status: 'ready' }).sort({ createdAt: -1 });
  if (!target) throw new Error('No backup found for failback.');
  const { restoreBackupArtifact } = require('./backupRecovery');
  await withJournalCaptureSuspended(async () => {
    await restoreBackupArtifact({ backupArtifact: target, user: actor, createSafetyBackup: true });
  });
  await appendJournalEntry({
    opType: 'restore',
    collectionName: 'system',
    actor,
    metadata: { action: 'shadow-failback', backupId: String(target._id) }
  });
  return target;
};

const loadCollectionsFromZip = async (zipPath) => {
  const zip = await unzipper.Open.file(zipPath);
  const byPath = (p) => zip.files.find((f) => f.path === p);
  const ndjsonEntry = byPath('backup/database.ndjson') || byPath('database.ndjson');
  const jsonEntry = byPath('backup/database.json') || byPath('database.json');
  const grouped = new Map();
  if (ndjsonEntry) {
    const content = (await ndjsonEntry.buffer()).toString('utf8');
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const entry = mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false });
      const col = String(entry.collection || '').toLowerCase();
      if (!grouped.has(col)) grouped.set(col, []);
      grouped.get(col).push(entry.doc);
    }
    return grouped;
  }
  if (jsonEntry) {
    const parsed = mongoose.mongo.BSON.EJSON.parse((await jsonEntry.buffer()).toString('utf8'), { relaxed: false });
    const collections = parsed?.collections && typeof parsed.collections === 'object' ? parsed.collections : parsed;
    for (const [name, docs] of Object.entries(collections || {})) {
      if (!Array.isArray(docs)) continue;
      grouped.set(String(name).toLowerCase(), docs);
    }
    return grouped;
  }
  throw new Error('Backup ZIP is missing database export.');
};

const verifyLatestBackupRestore = async () => {
  const latest = await BackupArtifact.findOne({ status: 'ready' }).sort({ createdAt: -1 }).lean();
  if (!latest) throw new Error('No backup available for verification.');
  const grouped = await loadCollectionsFromZip(latest.filePath);
  const tmpDbName = `${getDbName()}_verify_${Date.now()}`;
  const tempDb = mongoose.connection.client.db(tmpDbName);
  let status = 'passed';
  let details = 'Verification passed.';
  const summary = {};
  try {
    for (const [name, docs] of grouped.entries()) {
      const c = tempDb.collection(name);
      if (docs.length > 0) await c.insertMany(docs, { ordered: false });
      summary[name] = docs.length;
    }
    const storeCount = await tempDb.collection('stores').countDocuments({});
    const assetCount = await tempDb.collection('assets').countDocuments({});
    const invalidAssetStoreRefs = await tempDb.collection('assets').countDocuments({
      store: { $exists: true, $ne: null, $nin: await tempDb.collection('stores').distinct('_id') }
    });
    summary.storeCount = storeCount;
    summary.assetCount = assetCount;
    summary.invalidAssetStoreRefs = invalidAssetStoreRefs;
    if (invalidAssetStoreRefs > 0) {
      status = 'failed';
      details = `Found ${invalidAssetStoreRefs} assets with invalid store references in verification run.`;
    }
  } catch (error) {
    status = 'failed';
    details = error.message || String(error);
  } finally {
    await mongoose.connection.client.db(tmpDbName).dropDatabase().catch(() => {});
  }
  const record = await ResilienceVerification.create({
    backupId: latest._id,
    backupName: latest.fileName,
    status,
    summary,
    details
  });
  await setState(STATE_KEYS.verify, {
    status,
    details,
    backupId: String(latest._id),
    checkedAt: new Date().toISOString(),
    verificationId: String(record._id)
  });
  await appendJournalEntry({
    opType: 'verify',
    collectionName: 'system',
    metadata: {
      status,
      backupId: String(latest._id),
      details
    }
  });
  return record;
};

const auditBackupChain = async () => {
  const backups = await BackupArtifact.find({ status: 'ready' }).sort({ createdAt: 1 }).lean();
  let ok = true;
  const issues = [];
  for (let i = 0; i < backups.length; i += 1) {
    const current = backups[i];
    if (!current?.filePath || !fs.existsSync(current.filePath)) {
      ok = false;
      issues.push(`Missing backup file for ${current?.fileName || current?._id}`);
      continue;
    }
    const expectedChecksum = String(current?.metadata?.checksumSha256 || '');
    if (expectedChecksum) {
      // eslint-disable-next-line no-await-in-loop
      const computed = await computeChecksum(current.filePath);
      if (computed !== expectedChecksum) {
        ok = false;
        issues.push(`Checksum mismatch for ${current.fileName}`);
      }
    }
    if (i > 0) {
      const prev = backups[i - 1];
      const linkedPrev = String(current?.metadata?.chain?.previousBackupId || '');
      if (linkedPrev && linkedPrev !== String(prev._id)) {
        ok = false;
        issues.push(`Chain break for ${current.fileName}: previousBackupId does not match.`);
      }
    }
  }
  const state = {
    ok,
    checkedAt: new Date().toISOString(),
    totalBackups: backups.length,
    issues
  };
  await setState(STATE_KEYS.backupAudit, state);
  return state;
};

const getBackupReadiness = async () => {
  const [verifyState, backupAudit, pitrState, latestBackup] = await Promise.all([
    getState(STATE_KEYS.verify, { status: 'unknown' }),
    getState(STATE_KEYS.backupAudit, { ok: false, issues: ['No backup audit has run yet.'] }),
    getState(STATE_KEYS.pitr, { enabled: false }),
    BackupArtifact.findOne({ status: 'ready' }).sort({ createdAt: -1 }).lean()
  ]);
  const ready = Boolean(
    latestBackup
    && verifyState?.status === 'passed'
    && backupAudit?.ok === true
  );
  return {
    ready,
    latestBackup: latestBackup ? {
      id: String(latestBackup._id),
      fileName: latestBackup.fileName,
      createdAt: latestBackup.createdAt,
      checksumSha256: latestBackup?.metadata?.checksumSha256 || ''
    } : null,
    verification: verifyState,
    backupAudit,
    pitr: pitrState
  };
};

const markCrashDetected = async ({ reason = '' } = {}) => {
  await setState(STATE_KEYS.crash, {
    detected: true,
    reason: String(reason || 'unclean_shutdown'),
    detectedAt: new Date().toISOString()
  });
};

const createResilienceJob = async ({ jobType, actor = null, metadata = {} }) => {
  return ResilienceJob.create({
    jobType,
    status: 'running',
    phase: 'queued',
    actorId: String(actor?._id || ''),
    actorEmail: String(actor?.email || ''),
    metadata
  });
};

const updateResilienceJob = async (jobId, patch) => {
  if (!jobId) return null;
  await ResilienceJob.updateOne({ _id: jobId }, { $set: patch });
  return ResilienceJob.findById(jobId).lean();
};

const getResilienceStatus = async () => {
  const latestJournal = await ChangeJournal.findOne({}).sort({ seq: -1 }).lean();
  const shadow = await getState(STATE_KEYS.shadow, { lag: 0 });
  const verify = await getState(STATE_KEYS.verify, { status: 'unknown' });
  const backupAudit = await getState(STATE_KEYS.backupAudit, { ok: false, issues: [] });
  const pitr = await getState(STATE_KEYS.pitr, { enabled: false });
  const crash = await getState(STATE_KEYS.crash, { detected: false });
  const activeJob = await ResilienceJob.findOne({ status: 'running' }).sort({ startedAt: -1 }).lean();
  const recentVerifications = await ResilienceVerification.find({}).sort({ createdAt: -1 }).limit(5).lean();
  return {
    journal: {
      latestSeq: Number(latestJournal?.seq || 0),
      latestAt: latestJournal?.createdAt || null
    },
    shadow,
    verification: verify,
    backupAudit,
    pitr,
    crash,
    activeJob,
    recentVerifications
  };
};

const writeUploadChecksum = async ({ checksum, fileName, sizeBytes }) => {
  await setState(STATE_KEYS.upload, {
    checksum,
    fileName,
    sizeBytes,
    checkedAt: new Date().toISOString()
  });
};

module.exports = {
  CRITICAL_COLLECTIONS,
  appendJournalEntry,
  withJournalCaptureSuspended,
  startCommandJournaling,
  createImmutableManifestForArtifact,
  previewRestoreToTime,
  restoreToTimestamp,
  syncShadowDatabase,
  promoteShadowToPrimary,
  failbackFromBackup,
  verifyLatestBackupRestore,
  createResilienceJob,
  updateResilienceJob,
  getResilienceStatus,
  getBackupReadiness,
  auditBackupChain,
  archiveOplogWindow,
  markCrashDetected,
  computeChecksum,
  writeUploadChecksum
};
