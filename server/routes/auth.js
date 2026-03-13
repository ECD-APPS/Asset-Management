const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const path = require('path');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const Session = require('../models/Session');
const cookieSecureMode = String(process.env.COOKIE_SECURE || 'auto').toLowerCase();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shouldUseSecureCookie = (req) => {
  if (cookieSecureMode === 'true' || cookieSecureMode === '1') return true;
  if (cookieSecureMode === 'false' || cookieSecureMode === '0') return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || forwardedProto === 'https');
};

// Login rate limiter (relaxed for internal use)
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5 minutes window
  max: 200,                  // Internal deployments can have many concurrent users behind one IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.ip}::${email || 'unknown'}`;
  },
  message: { message: 'Too many login attempts, please try again later.' }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login',
  loginLimiter,
  [
    body('email').trim().notEmpty().withMessage('Email or username is required'),
    body('password').isString().isLength({ min: 6 }).withMessage('Password is required'),
  ],
  async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  const { email, password } = req.body;
  const identifier = String(email || '').trim();
  const identifierLower = identifier.toLowerCase();

  try {
    // Check for email OR username
    const user = await User.findOne({
      $or: [
        { email: identifierLower },
        { email: { $regex: new RegExp(`^${escapeRegex(identifierLower)}$`, 'i') } },
        { username: identifier },
        { username: identifierLower }
      ] 
    }).populate('assignedStore');

    if (user && (await bcrypt.compare(password, user.password))) {
      const sid = crypto.randomBytes(32).toString('hex');
      const maxAgeMs = parseInt(process.env.SESSION_MAX_AGE_MS || `${30 * 24 * 60 * 60 * 1000}`, 10);
      const expires = new Date(Date.now() + maxAgeMs);
      await Session.create({ sid, user: user._id, expiresAt: expires });
      const cookieSecure = shouldUseSecureCookie(req);
      res.cookie('sid', sid, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeMs
      });
      res.json({
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        assignedStore: user.assignedStore
      });
    } else {
      res.status(400).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public
router.post('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) {
    Session.deleteOne({ sid }).catch(() => {});
  }
  const cookieSecure = shouldUseSecureCookie(req);
  res.clearCookie('sid', { path: '/', secure: cookieSecure, sameSite: 'lax' });
  res.status(200).json({ message: 'Logged out' });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  res.status(200).json(req.user);
});

// @desc    Verify password
// @route   POST /api/auth/verify-password
// @access  Private
router.post('/verify-password', protect, async (req, res) => {
  const { password } = req.body;
  const user = await User.findById(req.user.id);

  if (user && (await bcrypt.compare(password, user.password))) {
    res.json({ success: true });
  } else {
    res.status(401).json({ message: 'Invalid password' });
  }
});

// @desc    CSRF token helper (optional)
// @route   GET /api/auth/csrf-token
// @access  Public
router.get('/csrf-token', (req, res) => {
  // Token is already set into cookie by global middleware; respond also with JSON for clients that prefer it
  res.json({ csrfToken: req.csrfToken() });
});

// @desc    Emergency Super Admin Reset (Dev Only)
// @route   GET /api/auth/emergency-reset-superadmin
// @access  Restricted by env and secret
router.get('/emergency-reset-superadmin', async (req, res) => {
  const param = req.query?.secret;
  const secret = process.env.EMERGENCY_RESET_SECRET;
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Forbidden in production.' });
  }
  if (!secret || param !== secret) {
    return res.status(403).json({ message: 'Forbidden: Invalid secret key.' });
  }

  try {
    const email = 'superadmin@expo.com';
    const password = '123456';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let user = await User.findOne({ email });

    if (user) {
      user.password = hashedPassword;
      user.role = 'Super Admin';
      await user.save();
      return res.send(`
        <h1>Success</h1>
        <p>Super Admin password reset to: <strong>123456</strong></p>
        <p><a href="/">Go to Login</a></p>
      `);
    } else {
      await User.create({
        name: 'Super Admin',
        email,
        password: hashedPassword,
        role: 'Super Admin',
        assignedStore: null
      });
      return res.send(`
        <h1>Success</h1>
        <p>Super Admin account CREATED with password: <strong>123456</strong></p>
        <p><a href="/">Go to Login</a></p>
      `);
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error resetting password: ' + error.message);
  }
});

module.exports = router;
