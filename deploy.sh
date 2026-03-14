#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-expo}"
ENV_FILE="${ENV_FILE:-.env.docker}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
ACTION="${1:-up}"
PRE_DEPLOY_BACKUP="${PRE_DEPLOY_BACKUP:-true}"
HEALTH_API_URL="${HEALTH_API_URL:-http://localhost:5000/api/healthz}"
HEALTH_WEB_URL="${HEALTH_WEB_URL:-http://localhost:3000/}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-180}"
VERIFY_INTERVAL_SECONDS="${VERIFY_INTERVAL_SECONDS:-5}"
RELEASE_META_DIR="${RELEASE_META_DIR:-.deploy-meta}"
RELEASE_META_FILE="${RELEASE_META_FILE:-${RELEASE_META_DIR}/last-safe-release.env}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose not found. Install Docker with Compose plugin." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE." >&2
  echo "Create it from .env.docker.example and set real secrets." >&2
  exit 1
fi

if grep -q "replace_with_secure_random_value" "$ENV_FILE"; then
  echo "$ENV_FILE still contains placeholder secret values." >&2
  echo "Update JWT_SECRET, COOKIE_SECRET, and EMERGENCY_RESET_SECRET." >&2
  exit 1
fi

compose() {
  "${COMPOSE_CMD[@]}" --env-file "$ENV_FILE" -p "$PROJECT_NAME" "${COMPOSE_FILES[@]}" "$@"
}

echo "Validating production compose config..."
compose config >/dev/null

ensure_release_meta_dir() {
  mkdir -p "$RELEASE_META_DIR"
}

record_release_metadata() {
  ensure_release_meta_dir
  local current_commit="unknown"
  local previous_commit="unknown"
  if command -v git >/dev/null 2>&1; then
    current_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    previous_commit="$(git rev-parse HEAD~1 2>/dev/null || echo unknown)"
  fi
  cat > "$RELEASE_META_FILE" <<EOF
CURRENT_COMMIT="$current_commit"
PREVIOUS_COMMIT="$previous_commit"
HEALTH_API_URL="$HEALTH_API_URL"
HEALTH_WEB_URL="$HEALTH_WEB_URL"
PROJECT_NAME="$PROJECT_NAME"
ENV_FILE="$ENV_FILE"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EOF
}

run_in_app_container_node() {
  local script="$1"
  compose exec -T app node -e "$script"
}

create_pre_deploy_backup_if_possible() {
  if [[ "${PRE_DEPLOY_BACKUP,,}" != "true" ]]; then
    return 0
  fi
  if compose ps --services --filter "status=running" | grep -q "^app$"; then
    echo "Creating pre-deploy full backup from running app container..."
    run_in_app_container_node "const mongoose=require('mongoose'); const {createBackupArtifact}=require('./utils/backupRecovery'); (async()=>{await mongoose.connect(process.env.MONGO_URI); await createBackupArtifact({backupType:'Full', trigger:'pre-update', user:null}); await mongoose.disconnect();})();" || {
      echo "Warning: pre-deploy backup failed. Deployment will continue." >&2
    }
  else
    echo "No running app container detected. Skipping pre-deploy backup."
  fi
}

create_pre_deploy_journal_marker() {
  if compose ps --services --filter "status=running" | grep -q "^app$"; then
    echo "Creating pre-deploy journal marker..."
    run_in_app_container_node "const mongoose=require('mongoose'); const {appendJournalEntry}=require('./utils/resilienceManager'); (async()=>{await mongoose.connect(process.env.MONGO_URI); await appendJournalEntry({opType:'marker', collectionName:'system', metadata:{label:'pre-deploy', ts:new Date().toISOString()}}); await mongoose.disconnect();})();" || {
      echo "Warning: pre-deploy journal marker failed. Deployment will continue." >&2
    }
  fi
}

post_deploy_resilience_checks() {
  echo "Running post-deploy resilience checks..."
  run_in_app_container_node "const mongoose=require('mongoose'); const {syncShadowDatabase,verifyLatestBackupRestore,getResilienceStatus}=require('./utils/resilienceManager'); (async()=>{await mongoose.connect(process.env.MONGO_URI); await syncShadowDatabase({fullResync:false,actor:null}); await verifyLatestBackupRestore(); const s=await getResilienceStatus(); if((s?.verification?.status||'unknown')==='failed'){ throw new Error('Latest backup verification failed'); } await mongoose.disconnect();})();"
}

verify_health() {
  local deadline=$(( $(date +%s) + VERIFY_TIMEOUT_SECONDS ))
  echo "Verifying health (timeout: ${VERIFY_TIMEOUT_SECONDS}s)..."
  while [[ $(date +%s) -le $deadline ]]; do
    if curl -fsS "$HEALTH_API_URL" >/dev/null && curl -fsS "$HEALTH_WEB_URL" >/dev/null; then
      echo "Health verification passed."
      return 0
    fi
    sleep "$VERIFY_INTERVAL_SECONDS"
  done
  echo "Health verification failed." >&2
  return 1
}

print_rollback_help() {
  local previous_commit="unknown"
  if [[ -f "$RELEASE_META_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$RELEASE_META_FILE"
    previous_commit="${PREVIOUS_COMMIT:-unknown}"
  fi
  echo "Rollback helper:"
  echo "  1) Check recent commits: git log --oneline -n 5"
  if [[ "$previous_commit" != "unknown" ]]; then
    echo "  2) Roll back to previous commit: git checkout $previous_commit"
  else
    echo "  2) Roll back to previous known-good commit: git checkout <commit>"
  fi
  echo "  3) Re-deploy: ./deploy.sh safe-release"
}

case "$ACTION" in
  up)
    create_pre_deploy_backup_if_possible
    echo "Deploying production stack..."
    compose up -d --build --remove-orphans
    ;;
  safe-release)
    create_pre_deploy_backup_if_possible
    create_pre_deploy_journal_marker
    record_release_metadata
    echo "Starting safe release deployment..."
    compose up -d --build --remove-orphans
    post_deploy_resilience_checks
    if ! verify_health; then
      echo "Safe release verification failed. Use rollback helper below." >&2
      print_rollback_help
      exit 1
    fi
    echo "Safe release completed successfully."
    ;;
  build)
    echo "Building production images..."
    compose build --pull
    ;;
  pull)
    echo "Pulling images..."
    compose pull
    ;;
  down)
    echo "Stopping production stack..."
    compose down
    ;;
  restart)
    echo "Restarting production stack..."
    compose restart
    ;;
  logs)
    compose logs -f --tail=200
    ;;
  ps)
    compose ps
    ;;
  verify)
    verify_health
    ;;
  rollback-help)
    print_rollback_help
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Usage: ./deploy.sh [safe-release|up|build|pull|down|restart|logs|ps|verify|rollback-help]" >&2
    exit 1
    ;;
esac

if [[ "$ACTION" == "up" || "$ACTION" == "safe-release" ]]; then
  echo "Deployment complete. Current status:"
  compose ps
fi
