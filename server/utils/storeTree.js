const mongoose = require('mongoose');
const Store = require('../models/Store');

/**
 * Active store plus every descendant Locations row (any depth under parentStore).
 * Used for RBAC so assets/spares under nested sites (e.g. Main › … › Mobility cabin) match the main store context.
 */
async function getStoreTreeIds(rootStoreId) {
  if (!rootStoreId || !mongoose.Types.ObjectId.isValid(String(rootStoreId))) return [];
  const root = new mongoose.Types.ObjectId(String(rootStoreId));
  const seen = new Set([String(root)]);
  let frontier = [root];
  while (frontier.length > 0) {
    const children = await Store.find({ parentStore: { $in: frontier } }).select('_id').lean();
    frontier = [];
    for (const c of children) {
      const sid = String(c._id);
      if (!seen.has(sid)) {
        seen.add(sid);
        frontier.push(c._id);
      }
    }
  }
  return Array.from(seen).map((id) => new mongoose.Types.ObjectId(id));
}

/** Self + every parentStore walking up (for RBAC: two stores “same branch” iff these sets intersect). */
async function collectAncestorStoreIds(storeId) {
  const ids = new Set();
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) return ids;
  let walk = new mongoose.Types.ObjectId(String(storeId));
  for (let d = 0; d < 50; d++) {
    ids.add(String(walk));
    const doc = await Store.findById(walk).select('parentStore').lean();
    if (!doc?.parentStore) break;
    walk = doc.parentStore;
  }
  return ids;
}

/**
 * True when the active store and the asset’s store sit on the same Locations tree
 * (parent/child, or siblings under the same main inventory). Covers:
 * - asset on a child site, header on main (descendants-only check alone is enough)
 * - asset on main, header on a child site (needs ancestor walk from active)
 * - sibling sites under the same parent
 */
async function storeInventoryBranchesOverlap(activeStoreId, assetStoreId) {
  if (!activeStoreId || !assetStoreId) return false;
  if (String(activeStoreId) === String(assetStoreId)) return true;
  const [activeLine, assetLine] = await Promise.all([
    collectAncestorStoreIds(activeStoreId),
    collectAncestorStoreIds(assetStoreId)
  ]);
  for (const id of activeLine) {
    if (assetLine.has(id)) return true;
  }
  return false;
}

module.exports = { getStoreTreeIds, collectAncestorStoreIds, storeInventoryBranchesOverlap };
