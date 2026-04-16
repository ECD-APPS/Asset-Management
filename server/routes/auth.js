const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const Session = require('../models/Session');
const { sidSetOptions, sidClearOptions } = require('../utils/sessionCookie');
const { sendPasswordResetEmail } = require('../utils/storeEmail');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isProd = process.env.NODE_ENV === 'production';

const hashResetToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

const resolvePublicAppUrl = () => {
  const explicit = String(process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const corsFirst = String(process.env.CORS_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');
  if (corsFirst) return corsFirst;
  return 'http://localhost:5173';
};

const parseOriginToBase = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`.replace(/\/$/, '');
  } catch {
    return null;
  }
};

const isPrivateOrLocalHost = (hostname) => {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
};

/** True when the origin host is only loopback (reset emails must not use this for links opened on phones). */
const isLoopbackOriginBase = (base) => {
  if (!base) return false;
  try {
    const h = new URL(base).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
};

/**
 * Prefer the browser origin sent by the client so reset links work when the app is opened via LAN IP
 * (e.g. http://192.168.1.10:5173). Validates against CORS_ORIGIN / PUBLIC_APP_URL, or private LAN in non-production.
 */
const pickPasswordResetAppBase = (req) => {
  const requested = parseOriginToBase(req.body?.publicAppOrigin);
  const fromEnv = resolvePublicAppUrl();
  const resetPublicBridge = parseOriginToBase(String(process.env.PASSWORD_RESET_PUBLIC_URL || '').trim());

  // Reset links in email cannot use localhost — other devices (e.g. phones) cannot open them.
  if (requested && isLoopbackOriginBase(requested)) {
    if (resetPublicBridge && !isLoopbackOriginBase(resetPublicBridge)) return resetPublicBridge;
    if (fromEnv && !isLoopbackOriginBase(fromEnv)) return fromEnv;
  }

  if (!requested) return fromEnv;

  if (requested === fromEnv) return requested;

  const corsBases = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((x) => parseOriginToBase(String(x || '').trim()))
    .filter(Boolean);
  if (corsBases.includes(requested)) return requested;

  if (!isProd) {
    try {
      const u = new URL(requested);
      if (isPrivateOrLocalHost(u.hostname)) return requested;
    } catch {
      /* ignore */
    }
  }

  return fromEnv;
};

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number.isFinite(Number.parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX || '', 10))
    && Number.parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX || '', 10) > 0
    ? Number.parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX || '', 10)
    : (isProd ? 8 : 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.ip}::${email || 'unknown'}`;
  },
  message: { message: 'Too many reset requests, please try again later.' }
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 30 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}::reset`
});

const loginMaxRaw = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '', 10);
const loginMax = Number.isFinite(loginMaxRaw) && loginMaxRaw > 0 ? loginMaxRaw : (isProd ? 60 : 200);

// Login rate limiter (tighter in production; override with LOGIN_RATE_LIMIT_MAX)
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5 minutes window
  max: loginMax,
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
      const prevSid = req.cookies?.sid;
      if (prevSid) {
        await Session.deleteOne({ sid: prevSid }).catch(() => {});
        res.clearCookie('sid', sidClearOptions(req));
      }
      const sid = crypto.randomBytes(32).toString('hex');
      const maxAgeMs = parseInt(process.env.SESSION_MAX_AGE_MS || `${30 * 24 * 60 * 60 * 1000}`, 10);
      const expires = new Date(Date.now() + maxAgeMs);
      await Session.create({ sid, user: user._id, expiresAt: expires });
      res.cookie('sid', sid, sidSetOptions(req, maxAgeMs));
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

/** Same-origin path only (used by GET logout redirect; blocks protocol-relative and off-site URLs). */
const isSafeLogoutRedirectPath = (raw) => {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return false;
  return /^\/[\w\-./?#=&%]*$/.test(s);
};

const clearSessionAndRespond = (req, res, { redirect } = {}) => {
  const sid = req.cookies?.sid;
  if (sid) {
    Session.deleteOne({ sid }).catch(() => {});
  }
  res.clearCookie('sid', sidClearOptions(req));
  if (redirect && isSafeLogoutRedirectPath(redirect)) {
    return res.redirect(302, redirect);
  }
  return res.status(200).json({ message: 'Logged out' });
};

// @desc    Logout user (POST — for API clients)
// @route   POST /api/auth/logout
// @access  Public
router.post('/logout', (req, res) => {
  return clearSessionAndRespond(req, res, {});
});

// @desc    Logout user (GET — full browser navigation; avoids CSRF on POST and proxy quirks in split-tier setups)
// @route   GET /api/auth/logout?redirect=/login
// @access  Public
router.get('/logout', (req, res) => {
  const redirect = String(req.query.redirect || '').trim();
  return clearSessionAndRespond(req, res, redirect ? { redirect } : {});
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
  try {
    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }
    const user = await User.findById(req.user.id);
    if (user && (await bcrypt.compare(password, user.password))) {
      return res.json({ success: true });
    }
    res.status(401).json({ message: 'Invalid password' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const forgotPasswordOkMessage =
  'If an account exists for that email, you will receive password reset instructions shortly.';

// @desc    Request password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  [body('email').trim().isEmail().withMessage('A valid email is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    try {
      const user = await User.findOne({
        $or: [{ email }, { email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') } }],
      }).select('+passwordResetTokenHash +passwordResetExpires');

      if (!user) {
        return res.status(200).json({ message: forgotPasswordOkMessage });
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const ttlMsRaw = parseInt(process.env.PASSWORD_RESET_EXPIRES_MS || `${60 * 60 * 1000}`, 10);
      const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? ttlMsRaw : 60 * 60 * 1000;
      const expires = new Date(Date.now() + ttlMs);

      user.passwordResetTokenHash = tokenHash;
      user.passwordResetExpires = expires;
      await user.save({ validateBeforeSave: false });

      const base = pickPasswordResetAppBase(req);
      const resetUrl = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const ttlMinutes = Math.max(1, Math.round(ttlMs / 60000));
      const safeName = String(user.name || 'there')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const textBody = `Reset your password (link valid about ${ttlMinutes} minutes): ${resetUrl}`;
      const htmlBody = `
          <div style="font-family: system-ui, Arial, sans-serif; line-height: 1.5">
            <p>Hello ${safeName},</p>
            <p>You requested a password reset for your Expo Stores account.</p>
            <p><a href="${resetUrl}">Choose a new password</a></p>
            <p>This link expires in about ${ttlMinutes} minutes.</p>
            <p>If you did not request this, you can ignore this email.</p>
          </div>
        `;

      try {
        await sendPasswordResetEmail({
          user,
          to: user.email,
          subject: 'Reset your Expo Stores password',
          text: textBody,
          html: htmlBody
        });
      } catch (sendErr) {
        if (sendErr?.code === 'NO_SMTP' && !isProd) {
          console.warn('[forgot-password] No SMTP (env or Portal). Dev fallback: returning reset link in API response.');
          return res.status(200).json({
            message: `${forgotPasswordOkMessage} (Development: email is not configured; use the reset link below.)`,
            dev_reset_link: resetUrl
          });
        }
        throw sendErr;
      }

      return res.status(200).json({ message: forgotPasswordOkMessage });
    } catch (error) {
      console.error('Forgot password error:', error);
      if (error?.code === 'NO_SMTP') {
        return res.status(503).json({
          message:
            'Password reset by email is not available. Configure SMTP in the server environment or enable email on a store in Portal, then try again.',
        });
      }
      return res.status(500).json({
        message: 'Could not send reset email. Please try again later.',
      });
    }
  }
);

// @desc    Set new password using email reset token
// @route   POST /api/auth/reset-password
// @access  Public
router.post(
  '/reset-password',
  resetPasswordLimiter,
  [
    body('token').trim().notEmpty().withMessage('Reset token is required'),
    body('password').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    const tokenHash = hashResetToken(token);

    try {
      const user = await User.findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      }).select('+passwordResetTokenHash +passwordResetExpires');

      if (!user) {
        return res.status(400).json({
          message: 'Invalid or expired reset link. Please request a new password reset.',
        });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
      user.passwordResetTokenHash = null;
      user.passwordResetExpires = null;
      await user.save();

      await Session.deleteMany({ user: user._id }).catch(() => {});

      return res.json({ message: 'Your password has been reset. You can sign in now.' });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

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
  const param = req.get('x-emergency-reset-secret') || req.query?.secret;
  const secret = process.env.EMERGENCY_RESET_SECRET;
  const emergencyResetEnabled = String(process.env.ENABLE_EMERGENCY_RESET || 'false').toLowerCase() === 'true';
  const rawIp = String(req.ip || '').replace('::ffff:', '');
  const isLocalRequest = ['127.0.0.1', '::1'].includes(rawIp);
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Forbidden in production.' });
  }
  if (!emergencyResetEnabled) {
    return res.status(403).json({ message: 'Forbidden: emergency reset is disabled.' });
  }
  if (!isLocalRequest) {
    return res.status(403).json({ message: 'Forbidden: local access only.' });
  }
  if (!secret || param !== secret) {
    return res.status(403).json({ message: 'Forbidden: Invalid secret key.' });
  }

  try {
    const email = 'superadmin@expo.com';
    const password = 'superadmin123';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let user = await User.findOne({ email });

    if (user) {
      user.password = hashedPassword;
      user.role = 'Super Admin';
      await user.save();
      return res.send('<h1>Success</h1><p>Super Admin account reset completed.</p><p><a href="/">Go to Login</a></p>');
    } else {
      await User.create({
        name: 'Super Admin',
        email,
        password: hashedPassword,
        role: 'Super Admin',
        assignedStore: null
      });
      return res.send('<h1>Success</h1><p>Super Admin account was created.</p><p><a href="/">Go to Login</a></p>');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error resetting password: ' + error.message);
  }
});

module.exports = router;
