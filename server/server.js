const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const seedCategories = require('./utils/seedCategories'); // Import seeder
const seedStoresAndUsers = require('./utils/seedStoresAndUsers');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const auditLogger = require('./utils/logger');

// Routes
const authRoutes = require('./routes/auth');
const storeRoutes = require('./routes/stores');
const userRoutes = require('./routes/users');
const assetRoutes = require('./routes/assets');
const requestRoutes = require('./routes/requests');
const passRoutes = require('./routes/passes');
const vendorRoutes = require('./routes/vendors');
const poRoutes = require('./routes/purchaseOrders');
const assetCategoryRoutes = require('./routes/assetCategories');
const permitRoutes = require('./routes/permits');
const systemRoutes = require('./routes/system');

// Models for seeding
const Store = require('./models/Store');

const Asset = require('./models/Asset');
const Request = require('./models/Request');
const AssetCategory = require('./models/AssetCategory');

dotenv.config();

const app = express();

// Security & hardening
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// Rate limit (general)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
// Prevent NoSQL injection
app.use(mongoSanitize());

// Cookies and CSRF
const isProd = process.env.NODE_ENV === 'production';
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));

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
// CORS restricted to frontend origin when provided
const allowedOrigin = process.env.CORS_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin, credentials: true } : {}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health endpoints
app.get('/healthz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  const ok = state === 1;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db_connected: ok,
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.get('/readyz', async (req, res) => {
  const state = mongoose.connection.readyState; // 1=connected
  res.status(state === 1 ? 200 : 503).json({ ready: state === 1 });
});

// CSRF protection (cookie-based, token sent via cookie and header)
const csrfProtection = csrf({
  cookie: {
    key: 'XSRF-TOKEN',
    httpOnly: false,
    sameSite: 'strict',
    secure: isProd,
    path: '/',
  }
});
app.use(csrfProtection);
app.use((req, res, next) => {
  try {
    const token = req.csrfToken();
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: isProd,
      path: '/',
    });
  } catch (e) {}
  next();
});

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
app.use('/api/assets', assetRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/passes', passRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchase-orders', poRoutes);
app.use('/api/asset-categories', assetCategoryRoutes);
app.use('/api/permits', permitRoutes);
app.use('/api/system', systemRoutes);

const User = require('./models/User');
const bcrypt = require('bcryptjs');
const ActivityLog = require('./models/ActivityLog');
const { protect, admin } = require('./middleware/authMiddleware');

// Serve built client in production
const fs = require('fs');
const clientDist = path.resolve(__dirname, '../client/dist');
const indexHtml = path.join(clientDist, 'index.html');

// 1. Debug Route (Always available)
app.get('/debug-fs', (req, res) => {
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

// 2. Version Route (Always available)
app.get('/version', (req, res) => {
  res.send('v1.0.2 - Unconditional Routing Fix');
});

// 3. Static Files (Try to serve if they exist)
if (fs.existsSync(clientDist)) {
  console.log('Serving static files from:', clientDist);
  app.use(express.static(clientDist));
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
  res.status(200).send(`
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

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });
    console.log('MongoDB Connected');
    
    // Run seeders after successful connection
    await seedCategories();
    await seedStoresAndUsers();
    dropSerialUniqueIndex();
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    // Retry connection after 5 seconds
    setTimeout(connectDB, 5000);
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

connectDB();

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

// Seed Default Asset Categories
const seedAssetCategories = async () => {
  const categories = [
    'Access Control Systems',
    'Surveillance System',
    'Networking',
    'Telephony',
    'Structured Cabling',
    'Tools',
    'Wireless',
    'Audio Visual'
  ];

  try {
    const count = await AssetCategory.countDocuments();
    if (count === 0) {
      await AssetCategory.insertMany(categories.map(name => ({ name })));
      console.log('Default asset categories seeded');
    }
  } catch (error) {
    console.error('Error seeding asset categories:', error);
  }
};

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

// 404 Handler (Last Route)
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
