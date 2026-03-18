const express = require('express');
const router = express.Router();
const Permit = require('../models/Permit');
const { protect, admin } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer Config
const uploadRoot = path.join(__dirname, '../uploads');
const sanitizeUploadName = (name) => String(name || 'file')
  .split(path.sep).pop()
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .slice(0, 120);
const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }
    cb(null, uploadRoot);
  },
  filename(req, file, cb) {
    cb(null, `permit-${Date.now()}-${sanitizeUploadName(file.originalname)}`);
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Images (jpeg, jpg, png) and PDFs only!'));
    }
  }
});

// @desc    Get all permits
// @route   GET /api/permits
// @access  Private
router.get('/', protect, admin, async (req, res) => {
  try {
    const { type } = req.query;
    const filter = {};
    if (req.activeStore) filter.store = req.activeStore;
    if (type) filter.type = type;

    const permits = await Permit.find(filter)
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();
    res.json(permits);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @desc    Create a permit
// @route   POST /api/permits
// @access  Private
router.post('/', protect, admin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a file' });
    }

    const { title, type, description } = req.body;

    const permit = await Permit.create({
      title,
      type,
      description,
      filePath: `/uploads/${req.file.filename}`,
      fileType: path.extname(req.file.filename).toLowerCase(),
      createdBy: req.user._id,
      store: req.activeStore
    });

    res.status(201).json(permit);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// @desc    Delete a permit
// @route   DELETE /api/permits/:id
// @access  Private
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const permit = await Permit.findById(req.params.id);

    if (permit) {
      if (req.activeStore && permit.store && permit.store.toString() !== req.activeStore.toString()) {
        return res.status(404).json({ message: 'Permit not found' });
      }

      // Try to delete the file from filesystem
      const relativePermitPath = String(permit.filePath || '').replace(/^\/+/, '');
      const filePath = path.join(__dirname, '..', relativePermitPath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await permit.deleteOne();
      res.json({ message: 'Permit removed' });
    } else {
      res.status(404).json({ message: 'Permit not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
