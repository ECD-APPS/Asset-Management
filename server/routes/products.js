const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { protect, admin } = require('../middleware/authMiddleware');
const Product = require('../models/Product');
const Asset = require('../models/Asset');

// Ensure uploads are placed under server/uploads relative to this file
const uploadRoot = path.join(__dirname, '../uploads');
const productUploadDir = path.join(uploadRoot, 'products');
if (!fs.existsSync(productUploadDir)) fs.mkdirSync(productUploadDir, { recursive: true });

const MAX_PRODUCT_IMAGE_BYTES = Number.parseInt(process.env.MAX_PRODUCT_IMAGE_MB || '10', 10) * 1024 * 1024;
const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/bmp',
  'image/tiff'
]);
const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLocalUploadPath = (imagePath) => String(imagePath || '').startsWith('/uploads/');
const safeDeleteLocalUpload = async (imagePath) => {
  if (!isLocalUploadPath(imagePath)) return;
  const absolute = path.join(__dirname, '..', imagePath.replace(/^\/+/, ''));
  try {
    await fs.promises.unlink(absolute);
  } catch {
    // Ignore missing files; cleanup should be non-blocking.
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, productUploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(String(file.originalname || '')).toLowerCase() || '.img';
    cb(null, `${unique}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: Math.max(MAX_PRODUCT_IMAGE_BYTES, 1024 * 1024)
  },
  fileFilter: (req, file, cb) => {
    if (allowedImageMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      return cb(null, true);
    }
    cb(new Error('Invalid image format. Allowed: JPG, PNG, WEBP, GIF, SVG, BMP, TIFF.'));
  }
});

const uploadImage = (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: `Product image is too large. Maximum size is ${Math.floor(MAX_PRODUCT_IMAGE_BYTES / (1024 * 1024))} MB.`
      });
    }
    return res.status(400).json({ message: error.message || 'Image upload failed.' });
  });
};

async function processProductImage(filePath) {
  const parsed = path.parse(filePath);
  const outputAbsolute = path.join(parsed.dir, `${parsed.name}.webp`);
  try {
    await sharp(filePath)
      .rotate()
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toFile(outputAbsolute);
    if (outputAbsolute !== filePath) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
    return `/uploads/products/${path.basename(outputAbsolute)}`;
  } catch (error) {
    throw new Error(`Image processing failed: ${error.message}`);
  }
}

function findInTree(list, id) {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (node._id.toString() === id) {
      return { node, parentList: list, index: i };
    }
    if (node.children && node.children.length > 0) {
      const found = findInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function collectImagesFromTree(nodes = [], out = []) {
  for (const node of nodes) {
    if (node?.image) out.push(node.image);
    if (Array.isArray(node?.children) && node.children.length > 0) {
      collectImagesFromTree(node.children, out);
    }
  }
  return out;
}

router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.activeStore) {
      filter.$or = [
        { store: req.activeStore },
        { store: null },
        { store: { $exists: false } }
      ];
    }
    const products = await Product.find(filter).sort({ name: 1 }).lean();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', protect, admin, uploadImage, async (req, res) => {
  const cleanName = normalizeName(req.body?.name);
  if (!cleanName) return res.status(400).json({ message: 'Name is required' });
  if (cleanName.length > 120) return res.status(400).json({ message: 'Product name is too long (max 120 characters).' });
  try {
    const image = req.file ? await processProductImage(req.file.path) : '';
    const query = { name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') };
    if (req.activeStore) query.store = req.activeStore;
    const exists = await Product.findOne(query);
    if (exists) return res.status(400).json({ message: 'Product already exists' });
    const doc = await Product.create({ name: cleanName, image, children: [], store: req.activeStore });
    res.status(201).json(doc);
  } catch (err) {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/children', protect, admin, uploadImage, async (req, res) => {
  const cleanName = normalizeName(req.body?.name);
  if (!cleanName) return res.status(400).json({ message: 'Name is required' });
  if (cleanName.length > 120) return res.status(400).json({ message: 'Product name is too long (max 120 characters).' });
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Parent product not found' });
    const image = req.file ? await processProductImage(req.file.path) : '';
    if (!product.children) product.children = [];
    if (product.children.some(c => String(c.name).toLowerCase() === String(cleanName).toLowerCase())) {
      return res.status(400).json({ message: 'Child already exists' });
    }
    product.children.push({ name: cleanName, image, children: [] });
    await product.save();
    res.json(product);
  } catch (err) {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', protect, admin, uploadImage, async (req, res) => {
  try {
    const cleanName = normalizeName(req.body?.name);
    if (!cleanName) return res.status(400).json({ message: 'Name is required' });
    if (cleanName.length > 120) return res.status(400).json({ message: 'Product name is too long (max 120 characters).' });
    const imagePath = req.file ? await processProductImage(req.file.path) : null;

    // First try root-level product document
    let product = await Product.findById(req.params.id);
    if (product) {
      const oldName = product.name;
      const duplicate = await Product.findOne({
        _id: { $ne: product._id },
        name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') },
        store: product.store || null
      }).lean();
      if (duplicate) return res.status(400).json({ message: 'Product already exists' });
      if (imagePath && product.image) await safeDeleteLocalUpload(product.image);
      product.name = cleanName;
      if (imagePath) product.image = imagePath;
      const updated = await product.save();
      if (cleanName !== oldName) {
        const query = { product_name: oldName };
        if (product.store) query.store = product.store;
        await Asset.updateMany(query, { $set: { product_name: cleanName } });
      }
      return res.json(updated);
    }

    // If not found as root, search nested children
    const filter = {};
    if (req.activeStore) {
      filter.$or = [
        { store: req.activeStore },
        { store: null },
        { store: { $exists: false } }
      ];
    }
    const roots = await Product.find(filter);
    let rootDoc = null;
    let found = null;
    for (const r of roots) {
      const f = findInTree(r.children || [], String(req.params.id));
      if (f && f.node) {
        rootDoc = r;
        found = f;
        break;
      }
    }
    if (!rootDoc || !found) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const node = found.node;
    const oldName = node.name;
    if (imagePath && node.image) await safeDeleteLocalUpload(node.image);
    node.name = cleanName;
    if (imagePath) node.image = imagePath;

    rootDoc.markModified('children');
    await rootDoc.save();

    if (oldName && cleanName !== oldName) {
      const query = { product_name: oldName };
      if (rootDoc.store) query.store = rootDoc.store;
      await Asset.updateMany(query, { $set: { product_name: cleanName } });
    }

    res.json(rootDoc);
  } catch (err) {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const assetCount = await Asset.countDocuments({ product_name: product.name });
    if (assetCount > 0) {
      return res.status(400).json({ message: `Cannot delete. Used by ${assetCount} assets.` });
    }
    const imagePaths = [];
    if (product.image) imagePaths.push(product.image);
    collectImagesFromTree(product.children || [], imagePaths);
    await product.deleteOne();
    await Promise.all(imagePaths.map((img) => safeDeleteLocalUpload(img)));
    res.json({ message: 'Product removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/bulk-create', protect, admin, async (req, res) => {
  const { parentId, names } = req.body;
  if (!Array.isArray(names) || names.length === 0) return res.status(400).json({ message: 'No product names provided' });
  try {
    let targetDoc;
    let rootDoc;
    if (parentId) {
      rootDoc = await Product.findById(parentId);
      if (!rootDoc) {
        const filter = {};
        if (req.activeStore) {
          filter.$or = [
            { store: req.activeStore },
            { store: null },
            { store: { $exists: false } }
          ];
        }
        const roots = await Product.find(filter);
        for (const r of roots) {
          const found = findInTree(r.children || [], String(parentId));
          if (found && found.node) {
            rootDoc = r;
            targetDoc = found.node;
            break;
          }
        }
      }
      if (!rootDoc) return res.status(404).json({ message: 'Parent product not found' });
      if (!targetDoc) targetDoc = rootDoc;

      if (!targetDoc.children) targetDoc.children = [];
    }
    const created = [];
    for (const n of names) {
      const name = String(n || '').trim();
      if (!name) continue;
      if (!parentId) {
        const exists = await Product.findOne({ name, store: req.activeStore });
        if (!exists) {
          const doc = await Product.create({ name, image: '', children: [], store: req.activeStore });
          created.push(doc);
        }
      } else if (targetDoc) {
        if (!targetDoc.children.some(c => String(c.name).toLowerCase() === name.toLowerCase())) {
          targetDoc.children.push({ name, image: '', children: [] });
        }
      }
    }
    if (parentId && rootDoc) {
      rootDoc.markModified('children');
      await rootDoc.save();
      return res.json({ message: 'Bulk children created', parent: rootDoc });
    }
    res.json({ message: `Created ${created.length} root products`, items: created });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
