#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ROLE=app ./scripts/check-deploy-readiness.sh
#   ROLE=web APP_IP=10.96.133.197 APP_PORT=5000 ./scripts/check-deploy-readiness.sh
#   ROLE=db APP_IP=10.96.133.197 ./scripts/check-deploy-readiness.sh
#
# Optional:
#   DB_IP=10.96.133.213
#   DB_PORT=27017
#   WEB_IP=10.96.133.181
#   APP_IP=10.96.133.197
#   APP_PORT=5000

ROLE="${ROLE:-}"
DB_IP="${DB_IP:-10.96.133.213}"
DB_PORT="${DB_PORT:-27017}"
WEB_IP="${WEB_IP:-10.96.133.181}"
APP_IP="${APP_IP:-10.96.133.197}"
APP_PORT="${APP_PORT:-5000}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${APP_PORT}}"

if [[ -z "$ROLE" ]]; then
  echo "ERROR: ROLE is required (app|web|db)."
  exit 1
fi

print_header() {
  echo
  echo "=================================================="
  echo "$1"
  echo "=================================================="
}

ok() {
  echo "[OK] $1"
}

warn() {
  echo "[WARN] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

check_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing command: $cmd"
  ok "Found command: $cmd"
}

check_tcp() {
  local host="$1"
  local port="$2"
  if timeout 3 bash -c "cat < /dev/null > /dev/tcp/${host}/${port}" 2>/dev/null; then
    ok "TCP reachable: ${host}:${port}"
  else
    fail "TCP NOT reachable: ${host}:${port}"
  fi
}

print_header "System Info"
uname -a || true
ok "Hostname: $(hostname)"
ok "IP(s): $(hostname -I 2>/dev/null || echo unknown)"

print_header "Base Dependencies"
check_cmd node
check_cmd npm
check_cmd curl

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js 20+ is required. Current: $(node -v)"
else
  ok "Node.js version is compatible: $(node -v)"
fi

if [[ "$ROLE" == "app" ]]; then
  print_header "App VM Readiness"
  check_cmd pm2
  if [[ -f "server/.env" ]]; then
    ok "Found server/.env"
  else
    fail "server/.env not found"
  fi
  if [[ -f "server/package.json" ]]; then
    ok "Found server/package.json"
  else
    fail "server/package.json not found"
  fi
  check_tcp "$DB_IP" "$DB_PORT"
  if curl -sS "http://127.0.0.1:${APP_PORT}/api/healthz" >/dev/null 2>&1; then
    ok "Local health endpoint responds at :${APP_PORT}/api/healthz"
  else
    warn "Local health endpoint not reachable yet. Start app with PM2 and re-run."
  fi
  if curl -sS "${API_BASE_URL}/api/readyz" >/dev/null 2>&1; then
    ok "API readiness endpoint responds at ${API_BASE_URL}/api/readyz"
  else
    warn "API readiness endpoint not reachable yet."
  fi
  if command -v pbm >/dev/null 2>&1; then
    ok "pbm CLI available (Percona Backup for MongoDB; set PBM_MONGODB_URI on the app)."
  else
    warn "pbm not on PATH. Install percona-backup-mongodb if this host triggers PBM backups from the app."
  fi
elif [[ "$ROLE" == "web" ]]; then
  print_header "Web VM Readiness"
  check_cmd nginx
  if [[ -f "client/package.json" ]]; then
    ok "Found client/package.json"
  else
    fail "client/package.json not found"
  fi
  check_tcp "$APP_IP" "$APP_PORT"
  if curl -sS "http://127.0.0.1/" >/dev/null 2>&1; then
    ok "Local Nginx HTTP responds on :80"
  else
    warn "Nginx :80 not responding yet. Reload nginx after deploy."
  fi
  if curl -sS "http://127.0.0.1/healthz" >/dev/null 2>&1; then
    ok "Nginx /healthz proxies to API (matches repo nginx.conf)"
  else
    warn "Nginx /healthz not OK yet. Ensure site uses repo nginx.conf with /healthz location."
  fi
  if curl -sS "http://127.0.0.1/api/healthz" >/dev/null 2>&1; then
    ok "Nginx /api/healthz reaches API"
  else
    warn "Nginx /api/healthz not OK yet. Check upstream APP_IP:APP_PORT and nginx config."
  fi
  if curl -sS "http://127.0.0.1/healthz" >/dev/null 2>&1; then
    ok "Nginx proxies /healthz to API (repo nginx.conf)"
  else
    warn "GET /healthz not OK. Ensure sites-enabled uses repo nginx.conf (includes /healthz → backend)."
  fi
  if curl -sS "http://127.0.0.1/api/healthz" >/dev/null 2>&1; then
    ok "Nginx proxies /api/healthz to API"
  else
    warn "GET /api/healthz not OK yet (backend down or nginx config not deployed)."
  fi
elif [[ "$ROLE" == "db" ]]; then
  print_header "DB VM Readiness"
  if command -v mongod >/dev/null 2>&1; then
    ok "Found mongod binary"
  else
    fail "mongod not found"
  fi
  if systemctl is-active --quiet mongod; then
    ok "mongod service is active"
  else
    warn "mongod service is not active. Start with: sudo systemctl enable --now mongod"
  fi
  if ss -lnt | rg ":${DB_PORT}\\b" >/dev/null 2>&1; then
    ok "MongoDB listens on :${DB_PORT}"
  else
    warn "MongoDB is not listening on :${DB_PORT}. Check mongod.conf bindIp."
  fi
else
  fail "Invalid ROLE='$ROLE' (expected app|web|db)"
fi

print_header "Readiness Result"
ok "Basic checks completed for ROLE=${ROLE}"
echo "If warnings appeared, fix them before deployment."

