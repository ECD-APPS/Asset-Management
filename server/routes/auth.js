const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const path = require('path');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Generate JWT (with dev fallback secret)
const generateToken = (id) => {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign({ id }, secret, {
    expiresIn: '30d',
  });
};

// Login rate limiter (stricter)
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
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

  try {
    // Check for email OR username
    const user = await User.findOne({ 
      $or: [
        { email: email }, 
        { username: email }
      ] 
    }).populate('assignedStore');

    if (user && (await bcrypt.compare(password, user.password))) {
      const token = generateToken(user._id);
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('jwt', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000
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
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('jwt', { path: '/', secure: isProd, sameSite: 'strict' });
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

module.exports = router;
