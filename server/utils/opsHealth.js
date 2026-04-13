const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
const serverPackageJson = require('../package.json');
const { isPbmConfigured } = require('./backupRecovery');

const asBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const metricsEnabledForProcess = () => {
  const raw = String(process.env.ENABLE_METRICS ?? '').trim();
  if (raw) return asBool(raw, false);
  return process.env.NODE_ENV === 'production';
};

async function measureMongoPingMs() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('no_db');
  const started = Date.now();
  await db.admin().command({ ping: 1 });
  return Date.now() - started;
}

async function isDirWritable(dirPath) {
  try {
    await fsp.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.write-probe-${process.pid}-${Date.now()}`);
    await fsp.writeFile(probe, '1', 'utf8');
    await fsp.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runtime checks for operators (Super Admin UI + health extensions).
 * @param {{
 *   getResilienceStatus?: () => Promise<unknown>,
 *   resilienceSnapshot?: unknown
 * }} [options]
 */
const gatherRuntimeHealth = async (options = {}) => {
  const serverRoot = path.join(__dirname, '..');
  const uploadsDir = path.join(serverRoot, 'uploads');
  const storageDir = path.join(serverRoot, 'storage');
  const backupsDir = path.join(serverRoot, 'backups');

  const dbState = mongoose.connection.readyState;
  let mongoPingMs = null;
  if (dbState === 1) {
    try {
      mongoPingMs = await measureMongoPingMs();
    } catch {
      mongoPingMs = -1;
    }
  }

  const [uploadsOk, storageOk, backupsOk] = await Promise.all([
    isDirWritable(uploadsDir),
    isDirWritable(storageDir),
    isDirWritable(backupsDir)
  ]);

  let resilience = options.resilienceSnapshot ?? null;
  if (resilience == null && typeof options.getResilienceStatus === 'function') {
    try {
      resilience = await options.getResilienceStatus();
    } catch {
      resilience = null;
    }
  }

  const mem = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    app: {
      name: serverPackageJson.name || 'server',
      version: serverPackageJson.version || 'unknown',
      node: process.version,
      uptime_s: Math.round(process.uptime()),
      env: process.env.NODE_ENV || 'development'
    },
    host: {
      loadavg: os.loadavg(),
      freemem_mb: Math.round(os.freemem() / 1024 / 1024),
      totalmem_mb: Math.round(os.totalmem() / 1024 / 1024)
    },
    process: {
      pid: process.pid,
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024)
    },
    mongo: {
      ready_state: dbState,
      ready: dbState === 1,
      ping_ms: mongoPingMs
    },
    pbm: {
      configured: isPbmConfigured()
    },
    prometheus: {
      enabled: metricsEnabledForProcess(),
      path: '/metrics',
      auth: Boolean(String(process.env.METRICS_SCRAPE_TOKEN || '').trim())
    },
    filesystem: {
      uploads_writable: uploadsOk,
      storage_writable: storageOk,
      backups_writable: backupsOk
    },
    resilience: resilience || undefined
  };
};

module.exports = {
  gatherRuntimeHealth,
  measureMongoPingMs,
  metricsEnabledForProcess
};
