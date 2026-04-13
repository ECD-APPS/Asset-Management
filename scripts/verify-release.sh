#!/usr/bin/env bash
# Pre-deploy verification from repo root.
#
# Default: npm install (all packages) + production Vite build + client lint + quick server route load.
#   Fast and avoids npm ci rmdir races on some laptops / editors.
#
# Strict (CI-equivalent): VERIFY_RELEASE_STRICT=1 npm run verify:release
#   Runs root `npm run build` (npm ci in server/ and client/, then vite build).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> verify-release: $ROOT_DIR"
echo "==> Node $(node -v 2>/dev/null || echo unknown), npm $(npm -v 2>/dev/null || echo unknown)"
echo

if [[ "${VERIFY_RELEASE_STRICT:-}" == "1" ]]; then
  echo "==> STRICT mode: npm run build (lockfile-clean ci + client production build)"
  npm run build
  echo "==> STRICT mode: client ESLint"
  npm run lint --prefix client
  echo "==> STRICT mode: server ESLint"
  npm run lint --prefix server
  echo "==> STRICT mode: server route sanity"
  node scripts/load-server-routes.js
else
  echo "==> default mode: server + client npm install, client build + lint + server route sanity"
  echo "    (If server install fails with ENOTEMPTY/EBUSY, remove server/node_modules and retry.)"
  npm install --prefix server --no-audit --no-fund
  npm install --prefix client --no-audit --no-fund
  npm run build --prefix client
  npm run lint --prefix client
  echo "==> default mode: server ESLint"
  npm run lint --prefix server
  node scripts/load-server-routes.js
fi

echo
echo "OK: verify-release finished."
echo "Tip: on production CI use VERIFY_RELEASE_STRICT=1 for a full lockfile-clean build."
echo "Configure server/.env from server/.env.example; see DEPLOY_CHECKLIST.md."
