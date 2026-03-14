#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://localhost:5000/api}"
LOGIN_IDENTIFIER="${SMOKE_USER_EMAIL:-}"
LOGIN_PASSWORD="${SMOKE_USER_PASSWORD:-123456}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

json_get() {
  local key="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const v=j['$key'];process.stdout.write(v==null?'':String(v));}catch{process.stdout.write('')}})"
}

json_get_nested() {
  local path="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const parts='$path'.split('.');let cur=j;for(const p of parts){if(cur==null){cur='';break;}cur=cur[p];}process.stdout.write(cur==null?'':String(cur));}catch{process.stdout.write('')}})"
}

http_code() {
  local method="$1"
  local url="$2"
  shift 2
  curl -sS -o /dev/null -w "%{http_code}" -X "$method" "$url" "$@"
}

print_step() {
  echo
  echo "---- $1"
}

echo "==> API smoke test started"
echo "Base URL: $BASE_URL"
if [[ -n "$LOGIN_IDENTIFIER" ]]; then
  echo "Login user: $LOGIN_IDENTIFIER"
else
  echo "Login user: auto-detect seeded admin"
fi

print_step "Health check"
HEALTH_CODE="$(http_code GET "$BASE_URL/healthz")"
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "FAIL: health check returned HTTP $HEALTH_CODE"
  exit 1
fi
echo "OK: health check"

csrf_token() {
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/auth/csrf-token" | json_get "csrfToken"
}

print_step "Fetch CSRF token"
XSRF_TOKEN="$(csrf_token)"
if [[ -z "$XSRF_TOKEN" ]]; then
  echo "FAIL: could not fetch csrf token"
  exit 1
fi
echo "OK: csrf token acquired"

print_step "Login"
LOGIN_ROLE=""
LOGIN_RESPONSE=""
LOGIN_USER_USED=""
if [[ -n "$LOGIN_IDENTIFIER" ]]; then
  CANDIDATE_USERS=("$LOGIN_IDENTIFIER")
else
  CANDIDATE_USERS=("superadmin@expo.com" "admin@example.com" "scy@expo.com" "it@expo.com" "noc@expo.com")
fi

for candidate in "${CANDIDATE_USERS[@]}"; do
  LOGIN_PAYLOAD="$(printf '{"email":"%s","password":"%s"}' "$candidate" "$LOGIN_PASSWORD")"
  LOGIN_RESPONSE="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    -H "X-XSRF-TOKEN: $XSRF_TOKEN" \
    -X POST "$BASE_URL/auth/login" \
    -d "$LOGIN_PAYLOAD")"
  LOGIN_ROLE="$(printf '%s' "$LOGIN_RESPONSE" | json_get "role")"
  if [[ -n "$LOGIN_ROLE" ]]; then
    LOGIN_USER_USED="$candidate"
    break
  fi
done

if [[ -z "$LOGIN_ROLE" ]]; then
  echo "FAIL: login failed for all candidates."
  echo "Set SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD explicitly, then rerun."
  echo "Last response: $LOGIN_RESPONSE"
  exit 1
fi
echo "OK: logged in as $LOGIN_USER_USED (role=$LOGIN_ROLE)"

print_step "Resolve store context"
STORES_RESPONSE="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/stores")"
STORE_ID="$(printf '%s' "$STORES_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const arr=Array.isArray(j)?j:(j.items||[]);const id=arr[0]?._id||'';process.stdout.write(String(id));}catch{process.stdout.write('')}})")"
if [[ -z "$STORE_ID" ]]; then
  echo "FAIL: unable to resolve store id from /stores"
  exit 1
fi
echo "OK: using store=$STORE_ID"

XSRF_TOKEN="$(csrf_token)"

TS="$(date +%s)"
REQ_ITEM="SMOKE-REQ-$TS"

print_step "Create request"
CREATE_REQ_PAYLOAD="$(printf '{"item_name":"%s","quantity":1,"description":"smoke request %s","store":"%s"}' "$REQ_ITEM" "$TS" "$STORE_ID")"
CREATE_REQ_RESPONSE="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN" \
  -X POST "$BASE_URL/requests" \
  -d "$CREATE_REQ_PAYLOAD")"
REQUEST_ID="$(printf '%s' "$CREATE_REQ_RESPONSE" | json_get "_id")"
if [[ -z "$REQUEST_ID" ]]; then
  echo "FAIL: request creation failed. Response: $CREATE_REQ_RESPONSE"
  exit 1
fi
echo "OK: request created id=$REQUEST_ID"

XSRF_TOKEN="$(csrf_token)"

print_step "Update request status"
UPDATE_REQ_CODE="$(http_code PUT "$BASE_URL/requests/$REQUEST_ID" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN" \
  -d '{"status":"Approved"}')"
if [[ "$UPDATE_REQ_CODE" != "200" ]]; then
  echo "FAIL: request status update returned HTTP $UPDATE_REQ_CODE"
  exit 1
fi
echo "OK: request status updated"

XSRF_TOKEN="$(csrf_token)"

PASS_NAME="SMOKE-ASSET-$TS"
print_step "Create pass"
CREATE_PASS_PAYLOAD="$(cat <<EOF
{
  "type":"Security Handover",
  "store":"$STORE_ID",
  "issued_to":{"name":"Smoke Receiver","company":"QA","contact":"0000","id_number":"SMOKE"},
  "destination":"Smoke Destination",
  "origin":"Smoke Origin",
  "requested_by":"Smoke Requester",
  "provided_by":"Smoke Provider",
  "collected_by":"Smoke Collector",
  "approved_by":"Smoke Approver",
  "justification":"Automated smoke test",
  "assets":[{"name":"$PASS_NAME","model":"SMK-1","serial_number":"SMK-$TS","brand":"QA","status":"Good","remarks":"smoke","quantity":1}]
}
EOF
)"
CREATE_PASS_RESPONSE="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN" \
  -X POST "$BASE_URL/passes" \
  -d "$CREATE_PASS_PAYLOAD")"
PASS_ID="$(printf '%s' "$CREATE_PASS_RESPONSE" | json_get "_id")"
if [[ -z "$PASS_ID" ]]; then
  echo "FAIL: pass creation failed. Response: $CREATE_PASS_RESPONSE"
  exit 1
fi
echo "OK: pass created id=$PASS_ID"

XSRF_TOKEN="$(csrf_token)"

print_step "Update pass status"
UPDATE_PASS_RESPONSE="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN" \
  -X PUT "$BASE_URL/passes/$PASS_ID/status" \
  -d '{"status":"Completed"}')"
PASS_STATUS="$(printf '%s' "$UPDATE_PASS_RESPONSE" | json_get "status")"
if [[ "$PASS_STATUS" != "Completed" ]]; then
  echo "FAIL: pass status update failed. Response: $UPDATE_PASS_RESPONSE"
  exit 1
fi
echo "OK: pass status updated to Completed"

XSRF_TOKEN="$(csrf_token)"

print_step "Cleanup created pass"
DELETE_PASS_CODE="$(http_code DELETE "$BASE_URL/passes/$PASS_ID" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN")"
if [[ "$DELETE_PASS_CODE" != "200" ]]; then
  echo "WARN: cleanup failed for pass id=$PASS_ID (HTTP $DELETE_PASS_CODE)"
else
  echo "OK: cleanup removed pass id=$PASS_ID"
fi

print_step "Logout"
XSRF_TOKEN="$(csrf_token)"
LOGOUT_CODE="$(http_code POST "$BASE_URL/auth/logout" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "X-XSRF-TOKEN: $XSRF_TOKEN")"
if [[ "$LOGOUT_CODE" != "200" ]]; then
  echo "WARN: logout returned HTTP $LOGOUT_CODE"
else
  echo "OK: logout completed"
fi

echo
echo "==> API smoke test passed"
