const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const User = require('../models/User');
const Pass = require('../models/Pass');
const PpmTask = require('../models/PpmTask');
const PpmWorkflowTask = require('../models/PpmWorkflowTask');
const PpmHistoryLog = require('../models/PpmHistoryLog');
const PpmAssetTemp = require('../models/PpmAssetTemp');

let ioInstance = null;
const changeStreams = [];
let debounceTimer = null;

function parseSidFromCookieHeader(raw) {
  if (!raw) return null;
  const parts = String(raw).split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (name === 'sid') {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

async function loadUserFromHandshake(handshake) {
  const sid = parseSidFromCookieHeader(handshake.headers?.cookie || '');
  if (!sid) return null;
  const now = new Date();
  const session = await Session.findOne({ sid, expiresAt: { $gt: now } }).lean();
  if (!session) return null;
  const user = await User.findById(session.user).select('_id role').lean();
  return user || null;
}

function scheduleDashboardRefresh() {
  if (!ioInstance) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      ioInstance.to('dashboard-live').emit('dashboard:refresh', { at: Date.now() });
    } catch {
      /* ignore */
    }
  }, 700);
}

function startChangeStreamWatchers() {
  if (mongoose.connection.readyState !== 1) return;
  const db = mongoose.connection.db;
  if (!db) return;

  const watchCollection = (collectionName) => {
    try {
      const coll = db.collection(collectionName);
      const stream = coll.watch([], { fullDocument: 'updateLookup' });
      changeStreams.push(stream);
      stream.on('change', () => scheduleDashboardRefresh());
      stream.on('error', (err) => {
        console.warn(`[dashboard-socket] change stream error (${collectionName}):`, err?.message || err);
      });
    } catch (e) {
      console.warn(
        `[dashboard-socket] change stream unavailable for "${collectionName}" (replica set required for MongoDB change streams):`,
        e?.message || e
      );
    }
  };

  const watched = new Set([
    'assets',
    'consumables',
    'tools',
    Pass.collection.collectionName,
    PpmTask.collection.collectionName,
    PpmWorkflowTask.collection.collectionName,
    PpmHistoryLog.collection.collectionName,
    PpmAssetTemp.collection.collectionName
  ]);
  watched.forEach((name) => {
    if (name) watchCollection(name);
  });
}

/**
 * Real-time dashboard hints: authenticated clients join `dashboard-live` and receive
 * `dashboard:refresh` after debounced DB writes (Mongo change streams on assets, consumables,
 * tools, gate passes, and PPM collections).
 */
function initDashboardSocket(httpServer, { allowedOrigins } = {}) {
  const disabled = String(process.env.ENABLE_DASHBOARD_SOCKET || '').trim().toLowerCase() === 'false';
  if (disabled) {
    console.log('[dashboard-socket] disabled (ENABLE_DASHBOARD_SOCKET=false)');
    return null;
  }

  const corsOrigin =
    Array.isArray(allowedOrigins) && allowedOrigins.length > 0 ? allowedOrigins : true;

  ioInstance = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: corsOrigin,
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  ioInstance.use(async (socket, next) => {
    try {
      const user = await loadUserFromHandshake(socket.handshake);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      socket.data.userRole = user.role;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  ioInstance.on('connection', (socket) => {
    socket.join('dashboard-live');
  });

  startChangeStreamWatchers();
  console.log('[dashboard-socket] Socket.IO on /socket.io (dashboard-live room)');
  return ioInstance;
}

function closeDashboardSocket() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  while (changeStreams.length) {
    const s = changeStreams.pop();
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  if (ioInstance) {
    try {
      ioInstance.close();
    } catch {
      /* ignore */
    }
    ioInstance = null;
  }
}

module.exports = { initDashboardSocket, closeDashboardSocket };
