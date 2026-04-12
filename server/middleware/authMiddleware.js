const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const Store = require('../models/Store');
const { getStoreTreeIds } = require('../utils/storeTree');

function parseActiveStoreHeader(raw) {
  if (!raw || raw === 'undefined' || raw === 'null' || raw === 'all') return null;
  const s = String(raw).trim();
  return mongoose.Types.ObjectId.isValid(s) ? s : null;
}

/** Safe string id from User.assignedStore (ObjectId, populated doc, or legacy string). */
function resolveAssignedStoreId(user) {
  const raw = user?.assignedStore;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw._id != null) {
    const inner = String(raw._id);
    return mongoose.Types.ObjectId.isValid(inner) ? inner : null;
  }
  const s = String(raw);
  return mongoose.Types.ObjectId.isValid(s) ? s : null;
}
const { sidSetOptions } = require('../utils/sessionCookie');
const sessionMaxAgeMs = parseInt(process.env.SESSION_MAX_AGE_MS || `${30 * 24 * 60 * 60 * 1000}`, 10);
const renewThresholdMs = parseInt(process.env.SESSION_RENEW_THRESHOLD_MS || `${24 * 60 * 60 * 1000}`, 10);

const protect = async (req, res, next) => {
  try {
    const sid = req.cookies?.sid;

    if (!sid) {
      return res.status(401).json({ message: 'Not authorized, no session' });
    }

    const now = new Date();
    const session = await Session.findOne({ sid, expiresAt: { $gt: now } }).lean();
    if (!session) {
      return res.status(401).json({ message: 'Session expired or invalid' });
    }
    const millisToExpire = new Date(session.expiresAt).getTime() - now.getTime();
    const shouldRenew = Number.isFinite(millisToExpire) && millisToExpire <= renewThresholdMs;
    const updates = { lastAccessedAt: now };
    if (shouldRenew) {
      updates.expiresAt = new Date(now.getTime() + sessionMaxAgeMs);
    }
    Session.updateOne({ _id: session._id }, { $set: updates }).catch(() => {});
    if (shouldRenew) {
      res.cookie('sid', sid, sidSetOptions(req, sessionMaxAgeMs));
    }
    req.user = await User.findById(session.user).select('-password');
    if (!req.user) {
      // Backup compatibility fallback:
      // some legacy restores can persist _id as string while sessions keep ObjectId.
      const legacyUser = await User.collection.findOne({ _id: String(session.user) });
      if (legacyUser) {
        delete legacyUser.password;
        req.user = legacyUser;
      }
    }
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (req.user.role === 'Super Admin' || req.user.role === 'Viewer') {
      const headerId = parseActiveStoreHeader(req.headers['x-active-store']);
      if (headerId) req.activeStore = headerId;
    } else {
      // Admin / Technician / Manager: UI sends x-active-store from the header picker.
      // If we always prefer assignedStore, the picker is ignored and harvest/RBAC break for
      // assets under a different (but valid) site in the same inventory tree.
      const resolvedStore = resolveAssignedStoreId(req.user);
      const headerId = parseActiveStoreHeader(req.headers['x-active-store']);

      if (headerId) {
        if (!resolvedStore || String(headerId) === String(resolvedStore)) {
          req.activeStore = headerId;
        } else {
          try {
            const idsFromAssigned = await getStoreTreeIds(resolvedStore);
            const idsFromHeader = await getStoreTreeIds(headerId);
            const sameInventoryTree =
              idsFromAssigned.some((id) => String(id) === String(headerId)) ||
              idsFromHeader.some((id) => String(id) === String(resolvedStore));
            req.activeStore = sameInventoryTree ? headerId : resolvedStore;
          } catch {
            req.activeStore = resolvedStore;
          }
        }
      } else if (resolvedStore) {
        req.activeStore = resolvedStore;
      }
    }

    if (req.user.role === 'Viewer' && req.activeStore) {
      const scope = req.user.accessScope || 'All';
      if (scope !== 'All') {
        const selected = await Store.findById(req.activeStore).select('name isMainStore parentStore').lean();
        if (!selected) {
          return res.status(400).json({ message: 'Invalid active store' });
        }
        if (selected.isMainStore) {
          if (!String(selected.name || '').toUpperCase().includes(String(scope).toUpperCase())) {
            return res.status(403).json({ message: 'Store out of scope' });
          }
        } else if (selected.parentStore) {
          const parent = await Store.findById(selected.parentStore).select('name').lean();
          if (!String(parent?.name || '').toUpperCase().includes(String(scope).toUpperCase())) {
            return res.status(403).json({ message: 'Store out of scope' });
          }
        } else if (!String(selected.name || '').toUpperCase().includes(String(scope).toUpperCase())) {
          return res.status(403).json({ message: 'Store out of scope' });
        }
      }
    }
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Not authorized' });
  }
};

const isManagerLikeRole = (role) => String(role || '').toLowerCase().includes('manager');

const admin = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || isManagerLikeRole(req.user.role) || req.user.role === 'Super Admin')) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as an admin' });
  }
};

const adminOrViewer = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || isManagerLikeRole(req.user.role) || req.user.role === 'Super Admin' || req.user.role === 'Viewer')) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized' });
  }
};

const superAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'Super Admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as a super admin' });
  }
};

const restrictViewer = (req, res, next) => {
  if (req.user && req.user.role === 'Viewer') {
    return res.status(403).json({ message: 'Viewer account is read-only' });
  }
  next();
};

module.exports = {
  protect,
  admin,
  adminOrViewer,
  superAdmin,
  restrictViewer,
  resolveAssignedStoreId,
  parseActiveStoreHeader
};
