const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
// Removed built-in categories seeder
const seedStoresAndUsers = require('./utils/seedStoresAndUsers');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const auditLogger = require('./utils/logger');
const { createBackupArtifact } = require('./utils/backupRecovery');
const { migrateStoreEmailPasswords } = require('./utils/migrateEmailSecrets');
const {
  startCommandJournaling,
  syncShadowDatabase,
  verifyLatestBackupRestore,
  getResilienceStatus,
  auditBackupChain,
  archiveOplogWindow,
  markCrashDetected
} = require('./utils/resilienceManager');
const serverPackage = require('./package.json');

// Routes
const authRoutes = require('./routes/auth');
const storeRoutes = require('./routes/stores');
const userRoutes = require('./routes/users');
const assetRoutes = require('./routes/assets');
const noSerialAssetsRoutes = require('./routes/noSerialAssets');
const requestRoutes = require('./routes/requests');
const passRoutes = require('./routes/passes');
const vendorRoutes = require('./routes/vendors');
const poRoutes = require('./routes/purchaseOrders');
const productRoutes = require('./routes/products');
const permitRoutes = require('./routes/permits');
const systemRoutes = require('./routes/system');
const toolRoutes = require('./routes/tools');
const consumableRoutes = require('./routes/consumables');
const { backupDatabase } = require('./backup_db');
const { protect } = require('./middleware/authMiddleware');

// Models for seeding
const Store = require('./models/Store');

const Asset = require('./models/Asset');
const Request = require('./models/Request');
// Removed AssetCategory usage

dotenv.config({ path: path.join(__dirname, '.env') });


const app = express();

// Ensure runtime directories exist on Linux containers and k3s volumes
try {
  const uploadsDir = path.join(__dirname, 'uploads');
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
} catch {}

// Security & hardening
app.disable('x-powered-by');
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 1);
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// Rate limit (general)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 5000 : 20000,
  standardHeaders: true,
  legacyHeaders: false,
  // In 3-tier deployments, multiple users can share same source IP.
  // Never block auth endpoints with global API limiter.
  skip: (req) => {
    // Note: limiter is mounted on /api, so req.path values do NOT include /api prefix.
    if (req.path === '/healthz' || req.path === '/readyz') return true;
    if (req.path.startsWith('/auth/')) return true;
    // Public branding/config endpoint should never block app bootstrap.
    if (req.path === '/system/public-config') return true;
    return false;
  },
  message: { message: 'Too many API requests, please try again later.' }
});
// Apply limiter only on API routes in production; in dev this can mask
// real issues and cause local app bootstrap to appear hung.
if (isProd) {
  app.use('/api', limiter);
}
// Prevent NoSQL injection
app.use(mongoSanitize());

// Cookies and CSRF
const cookieSecureMode = String(process.env.COOKIE_SECURE || 'auto').toLowerCase();
const shouldUseSecureCookie = (req) => {
  if (cookieSecureMode === 'true' || cookieSecureMode === '1') return true;
  if (cookieSecureMode === 'false' || cookieSecureMode === '0') return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || forwardedProto === 'https');
};
const resolveSameSite = () => {
  const raw = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  if (raw === 'none') return 'none';
  if (raw === 'strict') return 'strict';
  return 'lax';
};
const cookieSecret = String(process.env.COOKIE_SECRET || '');
if (isProd && !cookieSecret) {
  throw new Error('COOKIE_SECRET is required in production.');
}
app.use(cookieParser(cookieSecret || 'dev-cookie-secret'));

app.use(compression({
  level: 6,
  threshold: 0,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
// CORS: require explicit allowlist in production when credentials are enabled.
const allowedOrigin = String(process.env.CORS_ORIGIN || '').trim();
if (isProd && !allowedOrigin) {
  throw new Error('CORS_ORIGIN is required in production.');
}
const allowedOrigins = allowedOrigin
  ? allowedOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
const uploadsPublic = String(process.env.UPLOADS_PUBLIC || (isProd ? 'false' : 'true')).toLowerCase() === 'true';
const uploadsStatic = express.static(path.join(__dirname, 'uploads'));
if (uploadsPublic) {
  app.use('/uploads', uploadsStatic);
} else {
  app.use('/uploads', protect, uploadsStatic);
}

// Health endpoints
app.get('/healthz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  const ok = state === 1;
  const resilience = await getResilienceStatus().catch(() => ({
    shadow: { lag: null },
    verification: { status: 'unknown' }
  }));
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db_connected: ok,
    db_mode: runtimeDbMode,
    resilience: {
      shadow_lag: resilience?.shadow?.lag ?? null,
      verification_status: resilience?.verification?.status || 'unknown'
    },
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.get('/readyz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  res.status(state === 1 ? 200 : 503).json({ ready: state === 1 });
});
// API-prefixed aliases to support reverse proxies that only forward /api/*
app.get('/api/healthz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  const ok = state === 1;
  const resilience = await getResilienceStatus().catch(() => ({
    shadow: { lag: null },
    verification: { status: 'unknown' }
  }));
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db_connected: ok,
    db_mode: runtimeDbMode,
    resilience: {
      shadow_lag: resilience?.shadow?.lag ?? null,
      verification_status: resilience?.verification?.status || 'unknown'
    },
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.get('/api/readyz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  res.status(state === 1 ? 200 : 503).json({ ready: state === 1 });
});

// CSRF protection
const enableCsrf = String(process.env.ENABLE_CSRF || (isProd ? 'true' : 'false')).toLowerCase() === 'true';
if (enableCsrf) {
  const sameSite = resolveSameSite();
  const csrfSecret = String(process.env.CSRF_SIGNING_SECRET || cookieSecret || 'dev-csrf-signing-secret');
  const isUnsafeMethod = (method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
  const toB64Url = (buffer) => Buffer.from(buffer).toString('base64url');
  const signNonce = (nonce) => toB64Url(
    crypto.createHmac('sha256', csrfSecret).update(String(nonce || '')).digest()
  );
  const createCsrfToken = () => {
    const nonce = toB64Url(crypto.randomBytes(32));
    const sig = signNonce(nonce);
    return `${nonce}.${sig}`;
  };
  const safeEqual = (a, b) => {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  };
  const verifyCsrfToken = (token) => {
    const raw = String(token || '');
    const [nonce, sig] = raw.split('.');
    if (!nonce || !sig) return false;
    return safeEqual(sig, signNonce(nonce));
  };
  app.use((req, res, next) => {
    const secureCookie = shouldUseSecureCookie(req);
    const cookieTokenRaw = String(req.cookies?.['XSRF-TOKEN'] || '');
    const cookieToken = verifyCsrfToken(cookieTokenRaw) ? cookieTokenRaw : createCsrfToken();
    req.csrfToken = () => cookieToken;
    res.cookie('XSRF-TOKEN', cookieToken, {
      httpOnly: false,
      sameSite,
      secure: secureCookie,
      path: '/',
    });

    if (!isUnsafeMethod(req.method)) {
      return next();
    }
    const submittedToken = String(
      req.get('x-xsrf-token')
      || req.get('x-csrf-token')
      || req.body?._csrf
      || req.query?._csrf
      || ''
    );
    if (!verifyCsrfToken(cookieToken) || !verifyCsrfToken(submittedToken) || !safeEqual(cookieToken, submittedToken)) {
      return res.status(403).json({ message: 'Invalid CSRF token' });
    }
    return next();
  });
} else {
  // Dev bypass (no CSRF checks)
  app.use((req, res, next) => {
    const sameSite = resolveSameSite();
    req.csrfToken = () => 'dev-token-bypass';
    res.cookie('XSRF-TOKEN', 'dev-token-bypass', {
      httpOnly: false,
      sameSite,
      secure: false,
      path: '/',
    });
    next();
  });
}

// Audit logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    auditLogger.info({
      msg: 'request',
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: durationMs,
      user_id: req.user?._id || null,
      ip: req.ip
    });
  });
  next();
});

// Routes Middleware
app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/assets/no-serial', noSerialAssetsRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/passes', passRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchase-orders', poRoutes);
app.use('/api/products', productRoutes);
app.use('/api/permits', permitRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/consumables', consumableRoutes);

const User = require('./models/User');
const bcrypt = require('bcryptjs');
const ActivityLog = require('./models/ActivityLog');
// auth middleware imported above (protect used for secured uploads)

// Serve built client in production
const clientDist = path.resolve(__dirname, '../client/dist');
const indexHtml = path.join(clientDist, 'index.html');

if (String(process.env.ENABLE_DEBUG_ROUTES || '').toLowerCase() === 'true') {
  app.get('/debug-fs', (req, res) => {
    if (isProd) {
      return res.status(403).json({ message: 'Debug routes are disabled in production.' });
    }
    const debugInfo = {
      cwd: process.cwd(),
      __dirname: __dirname,
      clientDistPath: clientDist,
      clientDistExists: fs.existsSync(clientDist),
      indexHtmlExists: fs.existsSync(indexHtml),
      rootDirContents: [],
      clientDirContents: [],
      distDirContents: []
    };
    try {
      const rootDir = path.resolve(__dirname, '..');
      if (fs.existsSync(rootDir)) debugInfo.rootDirContents = fs.readdirSync(rootDir);
      const clientDir = path.resolve(rootDir, 'client');
      if (fs.existsSync(clientDir)) debugInfo.clientDirContents = fs.readdirSync(clientDir);
      if (fs.existsSync(clientDist)) debugInfo.distDirContents = fs.readdirSync(clientDist);
    } catch (error) {
      debugInfo.error = error.message;
    }
    res.json(debugInfo);
  });
}

// 2. Version Route (Always available)
app.get('/version', (req, res) => {
  res.send(`v${serverPackage.version || 'unknown'}`);
});

// 3. Static Files (Try to serve if they exist)
if (fs.existsSync(clientDist)) {
  console.log('Serving static files from:', clientDist);
  app.use(express.static(clientDist, {
    etag: true,
    lastModified: true,
    maxAge: isProd ? '7d' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }
      if (isProd && filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    }
  }));
} else {
  console.log('Client dist folder NOT found at:', clientDist);
}

// 4. Catch-All Handler (Handles SPA and Fallback)
app.get('*', (req, res) => {
  // A. Skip API routes (redundant but safe)
  if (req.path.startsWith('/api')) {
     return res.status(404).json({ message: 'API endpoint not found' });
  }
  
  // B. Serve index.html if it exists
  if (fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml);
  } 
  
  // C. Fallback Warning Page (If build is missing)
  res.status(503).send(`
    <div style="font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto;">
      <h1>API is running successfully (v1.0.2)</h1>
      <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <strong>Warning:</strong> Frontend client is not served because the build folder was not found.
      </div>
      <p>This likely means the build command on Render is incorrect or failed.</p>
      
      <h3>Required Render Settings:</h3>
      <ul>
        <li><strong>Root Directory:</strong> <code>.</code> (Leave empty)</li>
        <li><strong>Build Command:</strong> <code>npm run build</code></li>
        <li><strong>Start Command:</strong> <code>npm start</code></li>
      </ul>
      
      <p>Debug info available at <a href="/debug-fs">/debug-fs</a></p>
      <p>Current Path: ${req.url}</p>
    </div>
  `);
});

let backupJobStarted = false;
let mongod = null;
let backupSchedulerStarted = false;
let runtimeDbMode = 'unknown';
const runtimeStateDir = path.join(__dirname, 'storage/runtime');
const runtimeStateFile = path.join(runtimeStateDir, 'boot-state.json');
let heartbeatTimer = null;

const writeRuntimeState = async (patch = {}) => {
  try {
    if (!fs.existsSync(runtimeStateDir)) fs.mkdirSync(runtimeStateDir, { recursive: true });
    let current = {};
    if (fs.existsSync(runtimeStateFile)) {
      try {
        current = JSON.parse(String(fs.readFileSync(runtimeStateFile, 'utf8') || '{}'));
      } catch {
        current = {};
      }
    }
    const next = { ...current, ...patch };
    fs.writeFileSync(runtimeStateFile, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // best-effort runtime marker
  }
};

const evaluateUncleanShutdown = async () => {
  if (!fs.existsSync(runtimeStateFile)) return;
  try {
    const parsed = JSON.parse(String(fs.readFileSync(runtimeStateFile, 'utf8') || '{}'));
    if (parsed.cleanShutdown === false) {
      await markCrashDetected({ reason: 'unclean_shutdown_detected_on_boot' }).catch(() => {});
    }
  } catch {
    // ignore parse failures
  }
};

// Connect to MongoDB
const connectDB = async () => {
  let mongoUri = process.env.MONGO_URI;
  const timeout = isProd ? 30000 : 5000;
  const allowInMemoryFallback = String(process.env.ALLOW_INMEMORY_FALLBACK || 'false').toLowerCase() === 'true';
  const connectWithUri = async (uri) => {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: timeout,
      socketTimeoutMS: 45000,
    });
  };

  // Dev fallback for local reliability when no external DB is configured.
  if (!mongoUri && !isProd) {
    const localFallbackUri = process.env.LOCAL_FALLBACK_MONGO_URI || 'mongodb://127.0.0.1:27017/expo';
    try {
      await connectWithUri(localFallbackUri);
      mongoUri = localFallbackUri;
      runtimeDbMode = 'persistent';
      process.env.MONGO_URI = mongoUri;
      console.log(`MONGO_URI missing. Connected to local MongoDB fallback: ${localFallbackUri}`);
    } catch (localError) {
      if (!allowInMemoryFallback) {
        throw new Error(
          `MONGO_URI is not configured and local MongoDB fallback is unreachable (${localFallbackUri}). ` +
          'Refusing to start with ephemeral in-memory DB. Set MONGO_URI or ALLOW_INMEMORY_FALLBACK=true explicitly.'
        );
      }
      if (!mongod) {
        console.log('MONGO_URI missing, local MongoDB unavailable, and ALLOW_INMEMORY_FALLBACK=true. Starting in-memory MongoDB...');
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
      }
      mongoUri = mongod.getUri();
      runtimeDbMode = 'in-memory';
      process.env.MONGO_URI = mongoUri;
      await connectWithUri(mongoUri);
    }
  } else {
    if (!mongoUri) {
      throw new Error('MONGO_URI is required in production.');
    }
    runtimeDbMode = 'persistent';
    await connectWithUri(mongoUri);
  }
  console.log('MongoDB Connected to:', mongoUri);
  startCommandJournaling();
  await evaluateUncleanShutdown();
  await writeRuntimeState({
    cleanShutdown: false,
    bootedAt: new Date().toISOString(),
    pid: process.pid
  });
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    writeRuntimeState({ lastHeartbeatAt: new Date().toISOString(), cleanShutdown: false });
  }, 15000);
  heartbeatTimer.unref();
  try {
    const migration = await migrateStoreEmailPasswords();
    if (!migration.skipped) {
      console.log(`Email secret migration complete. migrated=${migration.migrated}, unreadable=${migration.unreadable || 0}`);
    } else {
      console.log(`Email secret migration skipped: ${migration.reason}`);
    }
  } catch (migrationError) {
    console.error('Email secret migration failed:', migrationError.message || migrationError);
  }

  // Ensure required operational accounts exist on startup without resetting
  // credentials for existing users.
  const defaultSeedToggle = isProd ? 'false' : 'true';
  const shouldSeedDefaults = String(process.env.SEED_DEFAULTS || defaultSeedToggle).toLowerCase() === 'true';
  if (shouldSeedDefaults) {
    await seedStoresAndUsers();
  } else {
    console.log('Default account seeding skipped (SEED_DEFAULTS=false).');
  }
  dropSerialUniqueIndex();
  dropStoreNameGlobalUniqueIndex();

  if (!backupJobStarted) {
    backupJobStarted = true;
    const oneDayMs = 24 * 60 * 60 * 1000;
    let backupRunning = false;

    const runBackup = async () => {
      if (backupRunning) return;
      backupRunning = true;
      try {
        const dir = await backupDatabase();
        console.log('Automatic daily backup completed:', dir);
      } catch (err) {
        console.error('Automatic daily backup failed:', err.message || err);
      } finally {
        backupRunning = false;
      }
    };

    setTimeout(() => {
      runBackup();
      setInterval(runBackup, oneDayMs);
    }, 5 * 60 * 1000);
  }

  if (!backupSchedulerStarted) {
    backupSchedulerStarted = true;
    const enableScheduler = String(process.env.ENABLE_BACKUP_SCHEDULER || 'true').toLowerCase() === 'true';
    if (enableScheduler) {
      // Every 6 hours incremental backup
      cron.schedule('0 */6 * * *', async () => {
        try {
          await createBackupArtifact({ backupType: 'Incremental', trigger: 'scheduled', user: null });
        } catch (err) {
          console.error('Scheduled incremental backup failed:', err.message || err);
        }
      });
      // Daily backup at 02:00
      cron.schedule('0 2 * * *', async () => {
        try {
          await createBackupArtifact({ backupType: 'Auto', trigger: 'scheduled', user: null });
        } catch (err) {
          console.error('Scheduled daily backup failed:', err.message || err);
        }
      });
      // Weekly full backup (Sunday 03:00)
      cron.schedule('0 3 * * 0', async () => {
        try {
          await createBackupArtifact({ backupType: 'Full', trigger: 'scheduled', user: null });
        } catch (err) {
          console.error('Scheduled weekly full backup failed:', err.message || err);
        }
      });
      // Monthly archive full backup (day 1 at 04:00)
      cron.schedule('0 4 1 * *', async () => {
        try {
          await createBackupArtifact({ backupType: 'Full', trigger: 'scheduled', user: null });
        } catch (err) {
          console.error('Scheduled monthly archive backup failed:', err.message || err);
        }
      });
      // Shadow sync every 5 minutes
      cron.schedule('*/5 * * * *', async () => {
        try {
          await syncShadowDatabase({ fullResync: false, actor: null });
        } catch (err) {
          console.error('Scheduled shadow sync failed:', err.message || err);
        }
      });
      // Daily automated restore verification
      cron.schedule('30 2 * * *', async () => {
        try {
          await verifyLatestBackupRestore();
        } catch (err) {
          console.error('Scheduled backup verification failed:', err.message || err);
        }
      });
      // Daily backup checksum + chain audit
      cron.schedule('45 2 * * *', async () => {
        try {
          await auditBackupChain();
        } catch (err) {
          console.error('Scheduled backup chain audit failed:', err.message || err);
        }
      });
      // Frequent PITR oplog archive (every 10 minutes)
      cron.schedule('*/10 * * * *', async () => {
        try {
          await archiveOplogWindow({ actor: null, retentionDays: Number(process.env.PITR_RETENTION_DAYS || 14) });
        } catch (err) {
          console.error('Scheduled PITR archive failed:', err.message || err);
        }
      });
      console.log('Backup scheduler started (6h, daily, weekly, monthly).');
    }
  }
};

// MongoDB Event Listeners for "Always Connected" reliability
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected! Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected!');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err);
});

let serverInstance = null;

const connectDBWithRetry = async () => {
  const parsedRetries = Number.parseInt(process.env.DB_CONNECT_MAX_RETRIES || (isProd ? '10' : '20'), 10);
  const maxRetries = Number.isFinite(parsedRetries) && parsedRetries > 0 ? parsedRetries : 20;
  let attempt = 0;
  let delayMs = 2000;

  while (attempt < maxRetries) {
    try {
      await connectDB();
      return;
    } catch (err) {
      attempt += 1;
      console.error(`MongoDB Connection Error (attempt ${attempt}):`, err);
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
};

// Seed Default Stores
const seedStores = async () => {
  const stores = [
    "Mobility Car Park Store-10",
    "Mobility Car Park Store-8",
    "Sustainability Basement Store",
    "Terra Basement Store",
    "Al Wasl 3 Level 2 Store"
  ];

  try {
    const count = await Store.countDocuments();
    if (count === 0) {
      const storeDocs = stores.map(name => ({ name }));
      await Store.insertMany(storeDocs);
      console.log('Default stores seeded');
    }
  } catch (error) {
    console.error('Error seeding stores:', error);
  }
};

// Removed default Asset Categories

const dropSerialUniqueIndex = async () => {
  try {
    const collection = mongoose.connection.collection('assets');
    const indexes = await collection.indexes();
    const serialIndex = indexes.find(idx => idx.name === 'serialNumber_1');
    
    if (serialIndex) {
      await collection.dropIndex('serialNumber_1');
      console.log('Dropped unique index on serialNumber');
    }
  } catch (error) {
    // Index might not exist, ignore error
  }
};

const dropStoreNameGlobalUniqueIndex = async () => {
  try {
    const collection = mongoose.connection.collection('stores');
    const indexes = await collection.indexes();
    const globalNameIndex = indexes.find((idx) => idx.name === 'name_1' && idx.unique);
    if (globalNameIndex) {
      await collection.dropIndex('name_1');
      console.log('Dropped global unique index on stores.name');
    }
  } catch (error) {
    // Index might not exist, ignore error
  }
};

const seedAdmin = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('123456', salt);
      
      await User.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'Admin',
        employeeId: 'ADMIN001'
      });
      console.log('Admin user seeded');
    }
  } catch (error) {
    console.error('Error seeding admin:', error);
  }
};

app.use((err, req, res, next) => {
  if (!err) return next();
  const isMulterLimit = err?.code === 'LIMIT_FILE_SIZE';
  const statusCode = Number(err.status || err.statusCode || (isMulterLimit ? 413 : 500));
  const message = err?.code === 'LIMIT_FILE_SIZE'
    ? 'Uploaded file is too large.'
    : (err?.message || 'Internal server error');
  if (statusCode >= 500) {
    console.error('Unhandled API error:', err);
  }
  if (req.path.startsWith('/api/')) {
    return res.status(statusCode).json({ message });
  }
  return res.status(statusCode).send(message);
});

// 404 Handler (Last Route)
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const shutdown = async () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await writeRuntimeState({ cleanShutdown: true, shutdownAt: new Date().toISOString() });
  try {
    await mongoose.connection.close();
  } catch {}
  try {
    if (serverInstance) {
      serverInstance.close(() => {
        process.exit(0);
      });
      return;
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const startServer = async () => {
  await connectDBWithRetry();
  const PORT = process.env.PORT || 5000;
  serverInstance = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  serverInstance.keepAliveTimeout = 65000;
  serverInstance.headersTimeout = 66000;
  serverInstance.requestTimeout = 60000;
  serverInstance.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop previous server instance before restarting.`);
    } else {
      console.error('HTTP server error:', error);
    }
    process.exit(1);
  });
};

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
