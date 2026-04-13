const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const BackupArtifact = require('../models/BackupArtifact');
const BackupLog = require('../models/BackupLog');
const Setting = require('../models/Setting');
const appPackage = require('../package.json');
const auditLogger = require('./logger');
const {
  isPbmConfigured,
  assertPbmConnectivity,
  runPbmBackup,
  describeBackupJson,
  waitForSnapshotDescribedDone,
  restoreSnapshot,
  deleteSnapshot
} = require('./pbmClient');

const BACKUP_ROOT = path.join(__dirname, '../storage/backups');
const PBM_MARKER_ROOT = path.join(BACKUP_ROOT, 'pbm');
const CURRENT_BACKUP_FORMAT_VERSION = 3;
const CURRENT_MANIFEST_VERSION = 3;
const MAINTENANCE_LOCK_KEY = 'systemMaintenanceLock';
const getResilienceHelpers = () => require(path.join(__dirname, 'resilienceManager'));

const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const assertMongoConnected = () => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB is not connected; refusing backup/restore operation.');
  }
};

const assertDiskHeadroomForMarkers = async () => {
  const minMb = Number.parseInt(process.env.PBM_MIN_FREE_DISK_MB || '50', 10);
  if (!Number.isFinite(minMb) || minMb <= 0) return;
  try {
    await ensureDir(PBM_MARKER_ROOT);
    const s = await fsp.statfs(PBM_MARKER_ROOT);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!Number.isFinite(free) || free < minMb * 1024 * 1024) {
      throw new Error(
        `Insufficient disk space for backup markers at ${PBM_MARKER_ROOT}: ${Math.round(free / 1024 / 1024)} MB free (need >= ${minMb} MB). Set PBM_MIN_FREE_DISK_MB to adjust.`
      );
    }
  } catch (e) {
    if (e?.code === 'ENOENT') return;
    if (e?.message && String(e.message).includes('Insufficient disk')) throw e;
    auditLogger.warn({ component: 'backup', msg: 'disk_headroom_check_skipped', error: e?.message || String(e) });
  }
};

const sha256File = async (filePath) => {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
};

const writePbmMarkerFile = async ({ pbmBackupName, appVersion, describe }) => {
  await ensureDir(PBM_MARKER_ROOT);
  const safeBase = String(pbmBackupName || 'unknown').replace(/[^\w.-]+/g, '_');
  const fileName = `${safeBase}.pbm.json`;
  const filePath = path.join(PBM_MARKER_ROOT, fileName);
  const payload = JSON.stringify({
    pbmBackupName,
    appVersion,
    describe: describe ? {
      status: describe.status,
      type: describe.type,
      size: describe.size,
      pbm_version: describe.pbm_version,
      mongodb_version: describe.mongodb_version
    } : {},
    writtenAt: new Date().toISOString()
  }, null, 2);
  await fsp.writeFile(filePath, payload, 'utf8');
  return { fileName, filePath };
};

const readPbmBackupNameFromArtifact = (backupArtifact) => {
  const fromMeta = String(backupArtifact?.metadata?.pbmBackupName || '').trim();
  if (fromMeta) return fromMeta;
  try {
    const raw = fs.readFileSync(String(backupArtifact?.filePath || ''), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.pbmBackupName || '').trim();
  } catch {
    return '';
  }
};

const readCloudConfig = async () => {
  const doc = await Setting.findOne({ key: 'backupCloudConfig' }).lean();
  return doc?.value || {};
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
        params: { Bucket: cfg.bucket, Key: objectKey, Body: body, ContentType: 'application/json' }
      });
      await uploader.done();
    } else {
      await s3Client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
        Body: body,
        ContentType: 'application/json'
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
      contentType: 'application/json',
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

const acquireMaintenanceLock = async ({ reason = 'restore', actor = null } = {}) => {
  const existing = await Setting.findOne({ key: MAINTENANCE_LOCK_KEY }).lean();
  if (existing?.value?.active) {
    throw new Error(`Maintenance lock is already active (${existing.value.reason || 'unknown reason'}).`);
  }
  const value = {
    active: true,
    reason,
    actorEmail: String(actor?.email || ''),
    actorId: String(actor?._id || ''),
    startedAt: new Date().toISOString()
  };
  await Setting.updateOne(
    { key: MAINTENANCE_LOCK_KEY },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true }
  );
};

const releaseMaintenanceLock = async ({ note = '' } = {}) => {
  await Setting.updateOne(
    { key: MAINTENANCE_LOCK_KEY },
    {
      $set: {
        value: {
          active: false,
          reason: '',
          note: String(note || ''),
          releasedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
};

const validateBackupZipForRestore = async (markerPath, expectedChecksum = '') => {
  if (!isPbmConfigured()) {
    throw new Error('PBM is not configured (PBM_MONGODB_URI).');
  }
  if (!markerPath || !fs.existsSync(markerPath)) {
    throw new Error('Backup marker file does not exist on server.');
  }
  let pbmBackupName = '';
  try {
    const parsed = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    pbmBackupName = String(parsed?.pbmBackupName || '').trim();
  } catch {
    throw new Error('Invalid PBM backup marker file.');
  }
  if (!pbmBackupName) {
    throw new Error('PBM snapshot name missing from marker file.');
  }
  const desc = await describeBackupJson(pbmBackupName);
  const st = String(desc?.status || '').toLowerCase();
  if (st !== 'done') {
    throw new Error(`PBM snapshot ${pbmBackupName} is not restorable (status: ${desc?.status || 'unknown'}).`);
  }
  if (expectedChecksum) {
    const actual = await sha256File(markerPath);
    if (String(actual).toLowerCase() !== String(expectedChecksum).toLowerCase()) {
      throw new Error('Backup checksum validation failed. Marker may be corrupted or tampered.');
    }
  }
  return {
    ok: true,
    status: 'safe',
    format: 'pbm-snapshot',
    pbmBackupName,
    pbmDescribe: {
      type: desc?.type,
      size: desc?.size,
      status: desc?.status
    }
  };
};

const pbmBackupTypeForScheduler = (backupType) => {
  if (backupType === 'Incremental') return 'Incremental';
  return 'Full';
};

const createBackupArtifact = async ({
  backupType = 'Full',
  trigger = 'manual',
  user = null,
  sourceBackupId = null
}) => {
  if (!isPbmConfigured()) {
    throw new Error('PBM_MONGODB_URI must be set. Install Percona Backup for MongoDB agents and wire this URI per Percona documentation.');
  }

  assertMongoConnected();
  await ensureDir(BACKUP_ROOT);
  await assertDiskHeadroomForMarkers();
  const appVersion = appPackage.version || 'unknown';
  let artifact = null;
  try {
    auditLogger.info({
      component: 'backup',
      msg: 'backup_artifact_start',
      backupType,
      trigger,
      actor: user?.email || null
    });
    await assertPbmConnectivity();
    const previousReadyArtifact = await BackupArtifact.findOne({ status: 'ready' }).sort({ createdAt: -1 }).lean();
    const pbmType = pbmBackupTypeForScheduler(backupType);
    let pbmBackupName = '';
    let pbmFallbackToFull = false;
    try {
      ({ name: pbmBackupName } = await runPbmBackup({ backupType: pbmType }));
    } catch (e) {
      if (pbmType === 'Incremental') {
        pbmFallbackToFull = true;
        auditLogger.warn({
          component: 'backup',
          msg: 'pbm_incremental_failed_running_full',
          error: e.message || String(e)
        });
        ({ name: pbmBackupName } = await runPbmBackup({ backupType: 'Full' }));
      } else {
        throw e;
      }
    }
    const describe = await waitForSnapshotDescribedDone(pbmBackupName);
    const { fileName, filePath } = await writePbmMarkerFile({
      pbmBackupName,
      appVersion,
      describe
    });
    const stat = await fsp.stat(filePath);
    const checksumSha256 = await sha256File(filePath);
    const previousChecksumSha256 = String(previousReadyArtifact?.metadata?.checksumSha256 || '');
    const sizeBytes = Number(describe?.size || stat.size) || stat.size;

    artifact = await BackupArtifact.create({
      name: pbmBackupName,
      fileName,
      filePath,
      sizeBytes,
      backupType,
      appVersion,
      databaseVersion: 'mongodb',
      status: 'ready',
      trigger,
      metadata: {
        backupTool: 'pbm',
        pbmBackupName,
        includesFiles: false,
        fromBackupId: sourceBackupId || null,
        manifestVersion: CURRENT_MANIFEST_VERSION,
        checksumSha256,
        pbmDescribe: {
          type: describe?.type,
          status: describe?.status,
          mongodb_version: describe?.mongodb_version,
          pbm_version: describe?.pbm_version
        },
        chain: {
          previousBackupId: previousReadyArtifact?._id || null,
          previousChecksumSha256,
          chainValid: previousReadyArtifact ? Boolean(previousChecksumSha256) : true
        },
        pbmFallbackToFull: pbmFallbackToFull || undefined
      },
      createdBy: user?._id || null
    });

    await createBackupLog({
      action: 'backup_created',
      backupId: artifact._id,
      backupName: artifact.name,
      user,
      details: `PBM ${backupType} snapshot ${pbmBackupName} (${Math.round(sizeBytes / 1024)} KB logical size)${pbmFallbackToFull ? ' [incremental failed; full snapshot taken instead]' : ''}`
    });

    auditLogger.info({
      component: 'backup',
      msg: 'backup_artifact_ready',
      backupId: String(artifact._id),
      snapshot: pbmBackupName,
      backupType,
      pbmFallbackToFull
    });

    const { createImmutableManifestForArtifact } = getResilienceHelpers();
    await createImmutableManifestForArtifact(artifact).catch(() => {});

    try {
      await syncToCloud({ filePath, backupFileName: fileName, backupId: artifact._id });
    } catch (cloudError) {
      await BackupArtifact.updateOne({ _id: artifact._id }, {
        $set: { 'cloud.error': cloudError.message || String(cloudError) }
      });
    }

    return artifact;
  } catch (error) {
    auditLogger.error({
      component: 'backup',
      msg: 'backup_artifact_failed',
      error: error.message || String(error),
      stack: String(error?.stack || '').slice(0, 4000)
    });
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
  }
};

const restoreBackupArtifact = async ({
  backupArtifact,
  user,
  createSafetyBackup = true,
  useMaintenanceLock = true
}) => {
  let safetyBackup = null;
  let lockAcquired = false;
  let restoreError = null;
  try {
    assertMongoConnected();
    if (!isPbmConfigured()) {
      throw new Error('PBM_MONGODB_URI must be set to restore.');
    }
    auditLogger.info({
      component: 'backup',
      msg: 'restore_start',
      backupId: String(backupArtifact?._id || ''),
      actor: user?.email || null
    });
    if (useMaintenanceLock) {
      await acquireMaintenanceLock({ reason: 'restore', actor: user });
      lockAcquired = true;
    }
    const expectedChecksum = String(backupArtifact?.metadata?.checksumSha256 || '');
    await validateBackupZipForRestore(backupArtifact.filePath, expectedChecksum);
    const pbmBackupName = readPbmBackupNameFromArtifact(backupArtifact);
    if (!pbmBackupName) {
      throw new Error('Could not resolve PBM snapshot name for this artifact.');
    }

    if (createSafetyBackup) {
      auditLogger.info({ component: 'backup', msg: 'restore_safety_snapshot_start', targetSnapshot: pbmBackupName });
      safetyBackup = await createBackupArtifact({
        backupType: 'Full',
        trigger: 'rollback',
        user,
        sourceBackupId: backupArtifact?._id || null
      });
      auditLogger.info({
        component: 'backup',
        msg: 'restore_safety_snapshot_ready',
        safetySnapshot: safetyBackup?.metadata?.pbmBackupName || safetyBackup?.name
      });
    }

    const { withJournalCaptureSuspended, appendJournalEntry } = getResilienceHelpers();
    await assertPbmConnectivity();
    await withJournalCaptureSuspended(async () => {
      await restoreSnapshot(pbmBackupName);
    });
    await appendJournalEntry({
      opType: 'restore',
      collectionName: 'system',
      actor: user,
      metadata: {
        mode: 'artifact-restore',
        backupId: String(backupArtifact?._id || ''),
        backupName: backupArtifact?.fileName || backupArtifact?.name || '',
        pbmBackupName
      }
    }).catch(() => {});

    await createBackupLog({
      action: 'backup_restored',
      backupId: backupArtifact._id,
      backupName: backupArtifact.name,
      user,
      details: `PBM restore completed for ${pbmBackupName}${safetyBackup ? ` (safety snapshot ${safetyBackup.metadata?.pbmBackupName || safetyBackup.name})` : ''}`
    });
    auditLogger.info({
      component: 'backup',
      msg: 'restore_complete',
      backupId: String(backupArtifact._id),
      snapshot: pbmBackupName
    });
    return {
      ok: true,
      safetyBackupId: safetyBackup?._id || null,
      restoreReport: {
        restoredWith: 'pbm',
        pbmBackupName,
        note: 'Cluster data was restored by PBM. Reconnect clients if the app restarted.'
      }
    };
  } catch (error) {
    restoreError = error;
    auditLogger.error({
      component: 'backup',
      msg: 'restore_failed',
      backupId: String(backupArtifact?._id || ''),
      error: error.message || String(error),
      stack: String(error?.stack || '').slice(0, 4000)
    });
    await createBackupLog({
      action: 'restore_failed',
      backupId: backupArtifact?._id || null,
      backupName: backupArtifact?.name || '',
      user,
      details: error.message || String(error)
    });
    if (safetyBackup) {
      try {
        await restoreBackupArtifact({
          backupArtifact: safetyBackup,
          user,
          createSafetyBackup: false,
          useMaintenanceLock: false
        });
      } catch {
        // Preserve original error from initial restore attempt.
      }
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseMaintenanceLock({
        note: restoreError ? `restore_failed: ${restoreError.message || String(restoreError)}` : 'restore_completed'
      }).catch(() => {});
    }
  }
};

const restoreFromUploadedZip = async () => {
  throw new Error('Upload restore is not supported with Percona Backup for MongoDB. Register snapshots via scheduled or manual PBM backups, then restore from the list.');
};

const restoreFromJsonPayload = async () => {
  throw new Error('Legacy JSON restore is removed. Use PBM snapshot restore from the backup list.');
};

module.exports = {
  BACKUP_ROOT,
  CURRENT_BACKUP_FORMAT_VERSION,
  CURRENT_MANIFEST_VERSION,
  isPbmConfigured,
  createBackupArtifact,
  restoreBackupArtifact,
  restoreFromUploadedZip,
  restoreFromJsonPayload,
  createBackupLog,
  validateBackupZipForRestore,
  acquireMaintenanceLock,
  releaseMaintenanceLock,
  readPbmBackupNameFromArtifact,
  deleteSnapshot
};
