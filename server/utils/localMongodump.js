const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const auditLogger = require('./logger');

const EXPORT_ROOT = path.join(__dirname, '../storage/local-mongodumps');

/**
 * Local logical backup (single .gz archive) — no cloud; copy file to USB manually.
 * Defaults: enabled unless explicitly disabled; override with ENABLE_LOCAL_MONGODUMP.
 */
const isLocalMongodumpEnabled = () => {
  const raw = String(process.env.ENABLE_LOCAL_MONGODUMP || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return true;
};

const getMongoUri = () =>
  String(process.env.MONGO_URI || process.env.LOCAL_FALLBACK_MONGO_URI || '').trim();

const getMongodumpBin = () => {
  const b = String(process.env.MONGODUMP_PATH || 'mongodump').trim();
  return b || 'mongodump';
};

const mongodumpCliAvailable = () =>
  new Promise((resolve) => {
    execFile(getMongodumpBin(), ['--version'], { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });

/**
 * @returns {{ filePath: string, fileName: string, sizeBytes: number }}
 */
const createLocalGzipArchive = async () => {
  if (!isLocalMongodumpEnabled()) {
    throw new Error(
      'Local mongodump export is disabled. Set ENABLE_LOCAL_MONGODUMP=true in server/.env (required in production), install MongoDB Database Tools (mongodump), then restart.'
    );
  }
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MONGO_URI is not set; cannot run mongodump.');
  }
  const cliOk = await mongodumpCliAvailable();
  if (!cliOk) {
    throw new Error(
      `mongodump not found (${getMongodumpBin()}). Install MongoDB Database Tools and/or set MONGODUMP_PATH.`
    );
  }

  await fsp.mkdir(EXPORT_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `expo-local-full-${stamp}.archive.gz`;
  const filePath = path.join(EXPORT_ROOT, fileName);

  const rawTimeout = Number.parseInt(String(process.env.LOCAL_MONGODUMP_TIMEOUT_MS || '').trim(), 10);
  const maxMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(rawTimeout, 60_000), 4 * 60 * 60 * 1000)
    : 2 * 60 * 60 * 1000;

  auditLogger.info({
    msg: 'local_mongodump_start',
    fileName,
    max_ms: maxMs
  });

  await new Promise((resolve, reject) => {
    execFile(
      getMongodumpBin(),
      ['--uri', uri, '--gzip', `--archive=${filePath}`],
      { maxBuffer: 64 * 1024 * 1024, timeout: maxMs },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || '').trim();
          auditLogger.error({
            msg: 'local_mongodump_failed',
            fileName,
            detail: detail.slice(0, 4000)
          });
          reject(new Error(detail || 'mongodump failed'));
          return;
        }
        resolve();
      }
    );
  });

  const stat = await fsp.stat(filePath);
  const sizeBytes = Number(stat.size) || 0;
  if (sizeBytes < 64) {
    throw new Error('mongodump produced an unexpectedly small archive; aborting.');
  }

  auditLogger.info({
    msg: 'local_mongodump_ok',
    fileName,
    sizeBytes
  });

  return { filePath, fileName, sizeBytes };
};

module.exports = {
  EXPORT_ROOT,
  isLocalMongodumpEnabled,
  getMongoUri,
  createLocalGzipArchive,
  mongodumpCliAvailable
};
