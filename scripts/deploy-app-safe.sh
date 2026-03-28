#!/usr/bin/env bash
set -euo pipefail

# Rollback-safe deployment for App VM (Node/Express + PM2)
# Default assumptions:
# - Repo lives at /opt/Expo
# - Service name in PM2 is expo-app
# - Health endpoint is http://127.0.0.1:5000/api/healthz

APP_DIR="${APP_DIR:-/opt/Expo}"
SERVICE_NAME="${SERVICE_NAME:-expo-app}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/api/healthz}"
READY_URL="${READY_URL:-http://127.0.0.1:5000/api/readyz}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/expo-backups/app}"
BRANCH="${BRANCH:-main}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="${BACKUP_ROOT}/backup-${TIMESTAMP}"

if [[ "$(node -p "process.versions.node.split('.')[0]")" -lt 20 ]]; then
  echo "[ERROR] Node.js 20+ is required. Current: $(node -v)"
  exit 1
fi

rollback() {
  echo "[ROLLBACK] Deployment failed. Restoring previous app state..."
  if [[ -d "${BACKUP_PATH}" ]]; then
    rm -rf "${APP_DIR}"
    cp -a "${BACKUP_PATH}" "${APP_DIR}"
    if pm2 describe "${SERVICE_NAME}" >/dev/null 2>&1; then
      pm2 restart "${SERVICE_NAME}" --update-env || true
    else
      pm2 start "${APP_DIR}/server/server.js" --name "${SERVICE_NAME}" --cwd "${APP_DIR}/server" --update-env || true
    fi
  fi
  echo "[ROLLBACK] Completed."
}

trap rollback ERR

echo "[INFO] Creating backup at ${BACKUP_PATH}"
mkdir -p "${BACKUP_ROOT}"
cp -a "${APP_DIR}" "${BACKUP_PATH}"

echo "[INFO] Updating repository (${BRANCH})"
cd "${APP_DIR}"
git fetch origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "[INFO] Installing dependencies"
npm ci --no-audit --no-fund
cd "${APP_DIR}/server"
npm ci --omit=dev --no-audit --no-fund

if [[ ! -f "${APP_DIR}/server/.env" ]]; then
  echo "[ERROR] Missing ${APP_DIR}/server/.env"
  exit 1
fi

echo "[INFO] Restarting service via PM2"
if pm2 describe "${SERVICE_NAME}" >/dev/null 2>&1; then
  pm2 restart "${SERVICE_NAME}" --update-env
else
  pm2 start "${APP_DIR}/server/server.js" --name "${SERVICE_NAME}" --cwd "${APP_DIR}/server" --update-env
fi
pm2 save

echo "[INFO] Health check: ${HEALTH_URL}"
sleep 3
curl -fsS "${HEALTH_URL}" >/dev/null
curl -fsS "${READY_URL}" >/dev/null

trap - ERR
echo "[SUCCESS] App deployment completed safely."
echo "[RUNBOOK] If startup fails after deployment:"
echo "  1) pm2 logs ${SERVICE_NAME} --lines 200"
echo "  2) curl -sS ${HEALTH_URL}"
echo "  3) Trigger emergency restore from Portal or:"
echo "     curl -X POST http://127.0.0.1:5000/api/system/backups/emergency-restore -H 'Content-Type: application/json' -b '<auth-cookie>'"
