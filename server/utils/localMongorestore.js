const { execFile } = require('child_process');
const auditLogger = require('./logger');
const { isLocalMongodumpEnabled, getMongoUri } = require('./localMongodump');

const getMongorestoreBin = () => {
  const b = String(process.env.MONGORESTORE_PATH || 'mongorestore').trim();
  return b || 'mongorestore';
};

const mongorestoreCliAvailable = () =>
  new Promise((resolve) => {
    execFile(getMongorestoreBin(), ['--version'], { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });

/**
 * Restore from a mongodump gzip archive (same format as local USB backups).
 * @param {string} archivePath absolute path on disk
 * @param {{ drop?: boolean }} [options] pass drop:true only when LOCAL_MONGORESTORE_DROP is enabled server-side
 */
const runMongorestoreFromArchive = async (archivePath, options = {}) => {
  if (!isLocalMongodumpEnabled()) {
    throw new Error(
      'Local mongorestore is disabled. Set ENABLE_LOCAL_MONGODUMP=true on the server and restart.'
    );
  }
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MONGO_URI is not set; cannot run mongorestore.');
  }
  const cliOk = await mongorestoreCliAvailable();
  if (!cliOk) {
    throw new Error(
      `mongorestore not found (${getMongorestoreBin()}). Install MongoDB Database Tools and/or set MONGORESTORE_PATH.`
    );
  }

  const rawTimeout = Number.parseInt(String(process.env.LOCAL_MONGORESTORE_TIMEOUT_MS || '').trim(), 10);
  const maxMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(rawTimeout, 60_000), 4 * 60 * 60 * 1000)
    : 2 * 60 * 60 * 1000;

  const args = ['--uri', uri, '--gzip', `--archive=${archivePath}`];
  if (options.drop) {
    args.push('--drop');
  }

  auditLogger.info({
    msg: 'local_mongorestore_start',
    archivePath,
    drop: Boolean(options.drop)
  });

  await new Promise((resolve, reject) => {
    execFile(
      getMongorestoreBin(),
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: maxMs },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message || '').trim();
          auditLogger.error({
            msg: 'local_mongorestore_failed',
            detail: detail.slice(0, 4000)
          });
          reject(new Error(detail || 'mongorestore failed'));
          return;
        }
        resolve();
      }
    );
  });

  auditLogger.info({ msg: 'local_mongorestore_ok', archivePath });

  return {
    drop: Boolean(options.drop),
    note: 'Restart the Node API process if the application shows stale data or connection errors.'
  };
};

module.exports = {
  runMongorestoreFromArchive,
  mongorestoreCliAvailable
};
