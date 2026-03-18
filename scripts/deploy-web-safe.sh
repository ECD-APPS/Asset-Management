#!/usr/bin/env bash
set -euo pipefail

# Rollback-safe deployment for Web VM (Vite build + Nginx)
# Default assumptions:
# - Repo lives at /opt/Expo
# - Built site is copied to /var/www/expo/client/dist
# - Nginx site file is /etc/nginx/sites-available/expo

APP_DIR="${APP_DIR:-/opt/Expo}"
WEB_ROOT="${WEB_ROOT:-/var/www/expo/client}"
DIST_DIR="${WEB_ROOT}/dist"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/expo}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/expo-backups/web}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="${BACKUP_ROOT}/backup-${TIMESTAMP}"
DIST_BACKUP="${BACKUP_PATH}/dist"
NGINX_BACKUP="${BACKUP_PATH}/nginx-expo.conf"

if [[ "$(node -p "process.versions.node.split('.')[0]")" -lt 20 ]]; then
  echo "[ERROR] Node.js 20+ is required. Current: $(node -v)"
  exit 1
fi

rollback() {
  echo "[ROLLBACK] Web deployment failed. Restoring previous web state..."
  if [[ -d "${DIST_BACKUP}" ]]; then
    rm -rf "${DIST_DIR}"
    mkdir -p "${WEB_ROOT}"
    cp -a "${DIST_BACKUP}" "${DIST_DIR}"
  fi
  if [[ -f "${NGINX_BACKUP}" ]]; then
    cp -a "${NGINX_BACKUP}" "${NGINX_SITE}"
    nginx -t && systemctl reload nginx || true
  fi
  echo "[ROLLBACK] Completed."
}

trap rollback ERR

echo "[INFO] Creating backups in ${BACKUP_PATH}"
mkdir -p "${BACKUP_PATH}"
if [[ -d "${DIST_DIR}" ]]; then
  cp -a "${DIST_DIR}" "${DIST_BACKUP}"
fi
if [[ -f "${NGINX_SITE}" ]]; then
  cp -a "${NGINX_SITE}" "${NGINX_BACKUP}"
fi

echo "[INFO] Updating repository (${BRANCH})"
cd "${APP_DIR}"
git fetch origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "[INFO] Building frontend"
cd "${APP_DIR}/client"
npm ci --no-audit --no-fund
npm run build

echo "[INFO] Deploying built files to ${DIST_DIR}"
mkdir -p "${WEB_ROOT}"
rm -rf "${DIST_DIR}.new"
cp -a "${APP_DIR}/client/dist" "${DIST_DIR}.new"
rm -rf "${DIST_DIR}"
mv "${DIST_DIR}.new" "${DIST_DIR}"

echo "[INFO] Updating Nginx config"
APP_UPSTREAM="${APP_UPSTREAM:-127.0.0.1:5000}"
sed "s#http://127.0.0.1:5000#http://${APP_UPSTREAM}#g" "${APP_DIR}/nginx.conf" > "${NGINX_SITE}"
ln -sf "${NGINX_SITE}" /etc/nginx/sites-enabled/expo
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "[INFO] Health check: ${HEALTH_URL}"
sleep 2
curl -fsS "${HEALTH_URL}" >/dev/null

trap - ERR
echo "[SUCCESS] Web deployment completed safely."
