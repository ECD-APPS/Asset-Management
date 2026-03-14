#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Regression checklist started"
echo "Project: $ROOT_DIR"
echo

run_step() {
  local label="$1"
  shift
  echo "---- $label"
  "$@"
  echo "OK: $label"
  echo
}

run_step "Frontend lint" npm --prefix client run lint
run_step "Frontend build" npm --prefix client run build
run_step "Backend route load sanity" node -e "require('./server/routes/auth'); require('./server/routes/assets'); require('./server/routes/passes'); require('./server/routes/requests'); console.log('route-load-ok')"

echo "---- Backend health probe"
if curl -fsS "http://localhost:5000/api/healthz" >/tmp/expo_healthz.json 2>/dev/null; then
  echo "OK: backend health endpoint reachable"
  echo "Health payload:"
  cat /tmp/expo_healthz.json
  echo
else
  echo "WARN: backend health check failed. Is the server running on port 5000?"
  echo
fi

echo "---- Auth/session probe (expected 401 without session)"
AUTH_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5000/api/auth/me" || true)"
if [[ "$AUTH_CODE" == "401" || "$AUTH_CODE" == "200" ]]; then
  echo "OK: auth endpoint reachable (HTTP $AUTH_CODE)"
else
  echo "WARN: unexpected auth endpoint status (HTTP $AUTH_CODE)"
fi
echo

echo "==> Regression checklist completed"
