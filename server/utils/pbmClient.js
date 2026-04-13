const { execFile } = require('child_process');
const auditLogger = require('./logger');

const getPbmMongoUri = () => String(process.env.PBM_MONGODB_URI || '').trim();

const getPbmBin = () => String(process.env.PBM_CLI_PATH || 'pbm').trim() || 'pbm';

const getPbmWaitTime = () => String(process.env.PBM_BACKUP_WAIT_TIME || process.env.PBM_RESTORE_WAIT_TIME || '4h').trim() || '4h';

const logPbmEvent = (level, payload) => {
  const fn = auditLogger[level] || auditLogger.info;
  fn.call(auditLogger, { component: 'pbm', ...payload });
};

const execPbmAsync = (args, { maxBuffer = 64 * 1024 * 1024 } = {}) => new Promise((resolve, reject) => {
  const uri = getPbmMongoUri();
  if (!uri) {
    reject(new Error(
      'PBM_MONGODB_URI is not set. Configure a PBM user connection string (see Percona Backup for MongoDB initial setup).'
    ));
    return;
  }
  const env = { ...process.env, PBM_MONGODB_URI: uri };
  const safeArgs = args.join(' ');
  execFile(getPbmBin(), args, { env, maxBuffer }, (error, stdout, stderr) => {
    if (error) {
      const detail = String(stderr || stdout || error.message || '').trim();
      logPbmEvent('error', {
        msg: 'pbm_exec_failed',
        args: safeArgs,
        exitCode: error.code,
        detail: detail.slice(0, 8000)
      });
      reject(new Error(detail || 'pbm command failed'));
      return;
    }
    resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

const parseJsonStdout = (stdout, context) => {
  const raw = String(stdout || '').trim();
  if (!raw) {
    throw new Error(`${context}: empty output from pbm`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    logPbmEvent('error', { msg: 'pbm_invalid_json', context, preview: raw.slice(0, 500) });
    throw new Error(`${context}: invalid JSON from pbm — ${e.message}`);
  }
};

const isPbmConfigured = () => Boolean(getPbmMongoUri());

/** Lightweight check that the CLI can talk to the cluster (optional skip via PBM_SKIP_READINESS_CHECK=true). */
const assertPbmConnectivity = async () => {
  if (String(process.env.PBM_SKIP_READINESS_CHECK || '').toLowerCase() === 'true') {
    logPbmEvent('info', { msg: 'pbm_readiness_skipped', reason: 'PBM_SKIP_READINESS_CHECK' });
    return;
  }
  const { stdout } = await execPbmAsync(['status', '-o', 'json']);
  const doc = parseJsonStdout(stdout, 'pbm status');
  logPbmEvent('info', { msg: 'pbm_readiness_ok', clusters: Array.isArray(doc?.clusters) ? doc.clusters.length : 0 });
};

const runPbmBackup = async ({ backupType = 'Full' } = {}) => {
  const wt = getPbmWaitTime();
  const args = ['backup'];
  if (String(backupType) === 'Incremental') {
    args.push('-t', 'incremental');
  }
  args.push('--wait', `--wait-time=${wt}`, '-o', 'json');
  logPbmEvent('info', { msg: 'pbm_backup_start', backupType: String(backupType) });
  const { stdout } = await execPbmAsync(args);
  const doc = parseJsonStdout(stdout, 'pbm backup');
  const name = String(doc.name || '').trim();
  if (!name) {
    logPbmEvent('error', { msg: 'pbm_backup_no_name', raw: doc });
    throw new Error('pbm backup did not return a snapshot name.');
  }
  logPbmEvent('info', { msg: 'pbm_backup_complete', snapshot: name, backupType: String(backupType) });
  return { name, raw: doc };
};

const describeBackupJson = async (backupName) => {
  const name = String(backupName || '').trim();
  if (!name) throw new Error('Backup name is required.');
  const { stdout } = await execPbmAsync(['describe-backup', name, '-o', 'json']);
  return parseJsonStdout(stdout, 'pbm describe-backup');
};

/** Poll describe-backup until status is done (PBM can lag briefly after --wait returns). */
const waitForSnapshotDescribedDone = async (backupName, {
  maxWaitMs = Number.parseInt(process.env.PBM_DESCRIBE_WAIT_MS || '120000', 10),
  intervalMs = 2000
} = {}) => {
  const deadline = Date.now() + maxWaitMs;
  let last = {};
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      last = await describeBackupJson(backupName);
      lastErr = '';
      const st = String(last?.status || '').toLowerCase();
      if (st === 'done') return last;
      if (st === 'error' || st === 'canceled') {
        throw new Error(`PBM snapshot ${backupName} is ${last.status}: ${last.error || 'no detail'}`);
      }
    } catch (e) {
      lastErr = e.message || String(e);
      logPbmEvent('warn', { msg: 'pbm_describe_retry', snapshot: backupName, error: lastErr });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `PBM snapshot ${backupName} did not reach status "done" within ${maxWaitMs}ms (last status: ${last?.status || 'unknown'}). ${lastErr ? `Last error: ${lastErr}` : ''}`
  );
};

const restoreSnapshot = async (backupName) => {
  const name = String(backupName || '').trim();
  if (!name) throw new Error('Backup name is required for restore.');
  const wt = getPbmWaitTime();
  logPbmEvent('info', { msg: 'pbm_restore_start', snapshot: name });
  const { stdout } = await execPbmAsync(['restore', name, '--wait', `--wait-time=${wt}`, '-o', 'json']);
  const parsed = parseJsonStdout(stdout, 'pbm restore');
  logPbmEvent('info', { msg: 'pbm_restore_complete', snapshot: name });
  return parsed;
};

const deleteSnapshot = async (backupName) => {
  const name = String(backupName || '').trim();
  if (!name) throw new Error('Backup name is required for delete.');
  logPbmEvent('info', { msg: 'pbm_delete_backup_start', snapshot: name });
  await execPbmAsync(['delete-backup', '--yes', name]);
  logPbmEvent('info', { msg: 'pbm_delete_backup_complete', snapshot: name });
};

const listSnapshotsJson = async () => {
  const { stdout } = await execPbmAsync(['list', '-o', 'json']);
  return parseJsonStdout(stdout, 'pbm list');
};

const snapshotExistsAndDone = async (backupName) => {
  const data = await listSnapshotsJson();
  const snaps = Array.isArray(data.snapshots) ? data.snapshots : [];
  const hit = snaps.find((s) => String(s?.name || '') === String(backupName));
  if (!hit) return false;
  const st = String(hit.status || 'done').toLowerCase();
  return st === 'done' || st === '';
};

module.exports = {
  isPbmConfigured,
  getPbmMongoUri,
  assertPbmConnectivity,
  runPbmBackup,
  describeBackupJson,
  waitForSnapshotDescribedDone,
  restoreSnapshot,
  deleteSnapshot,
  listSnapshotsJson,
  snapshotExistsAndDone
};
