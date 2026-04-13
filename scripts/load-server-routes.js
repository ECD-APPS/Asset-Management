#!/usr/bin/env node
/**
 * Load all Express route modules to catch require-time / syntax errors (no DB).
 * Used by scripts/verify-release.sh — run from repository root.
 * Resolves dependencies from server/package.json (same as production).
 */
'use strict';

const path = require('path');
const { createRequire } = require('module');

const serverDir = path.join(__dirname, '..', 'server');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));

const routes = [
  './routes/auth.js',
  './routes/stores.js',
  './routes/users.js',
  './routes/assets.js',
  './routes/noSerialAssets.js',
  './routes/requests.js',
  './routes/passes.js',
  './routes/vendors.js',
  './routes/purchaseOrders.js',
  './routes/products.js',
  './routes/assetCategories.js',
  './routes/permits.js',
  './routes/system.js',
  './routes/tools.js',
  './routes/consumables.js',
  './routes/spareParts.js',
  './routes/ppm.js'
];

for (const r of routes) {
  serverRequire(r);
}
console.log('server routes ok (' + routes.length + ' modules)');
