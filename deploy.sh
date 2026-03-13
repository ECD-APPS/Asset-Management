#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-expo}"
ENV_FILE="${ENV_FILE:-.env.docker}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
ACTION="${1:-up}"
PRE_DEPLOY_BACKUP="${PRE_DEPLOY_BACKUP:-true}"

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

create_pre_deploy_backup_if_possible() {
  if [[ "${PRE_DEPLOY_BACKUP,,}" != "true" ]]; then
    return 0
  fi
  if compose ps --services --filter "status=running" | grep -q "^app$"; then
    echo "Creating pre-deploy full backup from running app container..."
    compose exec -T app node -e "const mongoose=require('mongoose'); const {createBackupArtifact}=require('./utils/backupRecovery'); (async()=>{await mongoose.connect(process.env.MONGO_URI); await createBackupArtifact({backupType:'Full', trigger:'pre-update', user:null}); await mongoose.disconnect();})();" || {
      echo "Warning: pre-deploy backup failed. Deployment will continue." >&2
    }
  else
    echo "No running app container detected. Skipping pre-deploy backup."
  fi
}

case "$ACTION" in
  up)
    create_pre_deploy_backup_if_possible
    echo "Deploying production stack..."
    compose up -d --build --remove-orphans
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
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Usage: ./deploy.sh [up|build|pull|down|restart|logs|ps]" >&2
    exit 1
    ;;
esac

if [[ "$ACTION" == "up" ]]; then
  echo "Deployment complete. Current status:"
  compose ps
fi
