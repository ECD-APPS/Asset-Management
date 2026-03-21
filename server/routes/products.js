const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { protect, admin } = require('../middleware/authMiddleware');
const mongoose = require('mongoose');
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
  if (id == null || id === '' || String(id) === 'undefined') return null;
  const sid = String(id);
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (node._id != null && String(node._id) === sid) {
      return { node, parentList: list, index: i };
    }
    if (node.children && node.children.length > 0) {
      const found = findInTree(node.children, sid);
      if (found) return found;
    }
  }
  return null;
}

/** Same path format as client flatten(): "Root / Child / Leaf" */
function pathSegments(fullPath) {
  return String(fullPath || '')
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findNestedByHierarchyPath(rootDoc, fullPath) {
  const segs = pathSegments(fullPath);
  if (segs.length < 2 || !rootDoc) return null;
  const rootRx = new RegExp(`^${escapeRegex(segs[0])}$`, 'i');
  if (!rootRx.test(String(rootDoc.name || ''))) return null;
  let list = rootDoc.children || [];
  const rest = segs.slice(1);
  let parentList = null;
  let index = -1;
  let node = null;
  for (let d = 0; d < rest.length; d++) {
    const seg = rest[d];
    const rx = new RegExp(`^${escapeRegex(seg)}$`, 'i');
    const idx = list.findIndex((c) => rx.test(String(c.name || '')));
    if (idx === -1) return null;
    node = list[idx];
    if (d === rest.length - 1) {
      parentList = list;
      index = idx;
      break;
    }
    list = node.children || [];
  }
  if (!node || parentList === null) return null;
  return { node, parentList, index };
}

function findNodeAcrossRoots(roots, fullPath, preferredRootId) {
  if (!fullPath || !Array.isArray(roots)) return null;
  if (preferredRootId) {
    const pr = roots.find((r) => String(r._id) === String(preferredRootId));
    if (pr) {
      const hit = findNestedByHierarchyPath(pr, fullPath);
      if (hit) return { rootDoc: pr, ...hit };
    }
  }
  for (const r of roots) {
    if (preferredRootId && String(r._id) === String(preferredRootId)) continue;
    const hit = findNestedByHierarchyPath(r, fullPath);
    if (hit) return { rootDoc: r, ...hit };
  }
  return null;
}

/**
 * Restores valid Date values when DB/import left createdAt/updatedAt as {} (Mongoose cast error on save).
 */
function ensureValidRootTimestamps(doc) {
  if (!doc || typeof doc.set !== 'function') return;
  const isBad = (v) => {
    if (v == null || v === '') return true;
    if (v instanceof Date) return Number.isNaN(v.getTime());
    if (typeof v === 'object') return true; // e.g. {} from bad JSON import
    return false;
  };
  if (isBad(doc.get('createdAt'))) {
    const fallback =
      doc._id && typeof doc._id.getTimestamp === 'function'
        ? doc._id.getTimestamp()
        : new Date();
    doc.set('createdAt', fallback);
  }
  if (isBad(doc.get('updatedAt'))) {
    doc.set('updatedAt', new Date());
  }
}

/** Remove corrupted timestamp objects from embedded children (same import/restore issue as root). */
function stripInvalidNestedTimestamps(nodes) {
  if (!Array.isArray(nodes)) return false;
  let changed = false;
  for (const node of nodes) {
    if (!node) continue;
    for (const key of ['createdAt', 'updatedAt']) {
      let v;
      try {
        v = typeof node.get === 'function' ? node.get(key) : node[key];
      } catch {
        v = node[key];
      }
      if (v === undefined) continue;
      const bad =
        v === null ||
        (typeof v === 'object' && !(v instanceof Date)) ||
        (v instanceof Date && Number.isNaN(v.getTime()));
      if (bad) {
        if (typeof node.set === 'function') {
          node.set(key, undefined, { strict: false });
        }
        try {
          delete node[key];
        } catch {
          // ignore
        }
        changed = true;
      }
    }
    if (node.children && node.children.length > 0 && stripInvalidNestedTimestamps(node.children)) {
      changed = true;
    }
  }
  return changed;
}

function prepareProductDocForSave(doc) {
  if (!doc) return;
  if (stripInvalidNestedTimestamps(doc.children || [])) {
    doc.markModified('children');
  }
  ensureValidRootTimestamps(doc);
}

/** Legacy / deep-nested rows may lack subdocument _id; assign so edits work consistently */
function assignMissingChildIds(nodes) {
  if (!Array.isArray(nodes)) return false;
  let changed = false;
  for (const node of nodes) {
    if (node && node._id == null) {
      node._id = new mongoose.Types.ObjectId();
      changed = true;
    }
    if (node?.children && node.children.length > 0) {
      if (assignMissingChildIds(node.children)) changed = true;
    }
  }
  return changed;
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
    prepareProductDocForSave(product);
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

    // First try root-level product document (skip invalid ids to avoid CastError)
    let product = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      product = await Product.findById(req.params.id);
    }
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
      prepareProductDocForSave(product);
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
    const hierarchyPath = String(req.body?.hierarchyPath || req.body?.hierarchy_path || '').trim();
    const scopedRootId = String(req.body?.scopedRootId || req.body?.scoped_root_id || '').trim();
    if ((!rootDoc || !found) && hierarchyPath) {
      const pathHit = findNodeAcrossRoots(
        roots,
        hierarchyPath,
        scopedRootId && mongoose.isValidObjectId(scopedRootId) ? scopedRootId : ''
      );
      if (pathHit && pathHit.node) {
        rootDoc = pathHit.rootDoc;
        found = { node: pathHit.node, parentList: pathHit.parentList, index: pathHit.index };
      }
    }
    if (!rootDoc || !found) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (assignMissingChildIds(rootDoc.children || [])) {
      rootDoc.markModified('children');
    }

    const node = found.node;
    const oldName = node.name;
    if (imagePath && node.image) await safeDeleteLocalUpload(node.image);
    node.name = cleanName;
    if (imagePath) node.image = imagePath;

    rootDoc.markModified('children');
    prepareProductDocForSave(rootDoc);
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
      prepareProductDocForSave(rootDoc);
      await rootDoc.save();
      return res.json({ message: 'Bulk children created', parent: rootDoc });
    }
    res.json({ message: `Created ${created.length} root products`, items: created });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
