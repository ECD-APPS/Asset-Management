SHELL := /bin/bash

PROJECT_NAME ?= expo
ENV_FILE ?= .env.docker
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE := docker compose

.PHONY: help server-env-dev validate-prod build-prod up-prod down-prod restart-prod logs-prod ps-prod pull-prod deploy-prod safe-release-prod verify-prod verify-resilience-prod rollback-help-prod

SERVER_ENV ?= server/.env

help:
	@echo "Available targets:"
	@echo "  make validate-prod  - Validate env + compose config"
	@echo "  make build-prod     - Build production images"
	@echo "  make up-prod        - Start production stack"
	@echo "  make down-prod      - Stop production stack"
	@echo "  make restart-prod   - Restart production stack"
	@echo "  make logs-prod      - Stream production logs"
	@echo "  make ps-prod        - Show production containers"
	@echo "  make pull-prod      - Pull base images"
	@echo "  make deploy-prod    - Validate, build, and start"
	@echo "  make safe-release-prod - Precheck, PBM pre-snapshot (if app up), deploy, verify"
	@echo "  make verify-prod    - Verify API/Web health endpoints"
	@echo "  make verify-resilience-prod - Alias: health verify (legacy resilience checks removed)"
	@echo "  make rollback-help-prod - Show rollback helper commands"
	@echo "  make server-env-dev - Create server/.env from server/.env.example if missing (local dev bootstrap)"

# One-time local API env file (does not overwrite an existing server/.env).
server-env-dev:
	@if [ -f "$(SERVER_ENV)" ]; then \
		echo "$(SERVER_ENV) already exists (left unchanged)."; \
	else \
		cp server/.env.example "$(SERVER_ENV)"; \
		echo "Created $(SERVER_ENV) from server/.env.example — edit MONGO_URI, COOKIE_SECRET, and other values."; \
	fi
	@echo "USB-style backups: install MongoDB Database Tools (mongodump). See HOW_TO_BACKUP_DATABASE.md"

validate-prod:
	@test -f "$(ENV_FILE)" || (echo "Missing $(ENV_FILE). Copy .env.docker.example to $(ENV_FILE) and update secrets."; exit 1)
	@if grep -Ei "replace_with_secure_random_value|replace_with_64_hex_chars_or_base64_32_bytes|change_this_to_a_secure_random_string|change_me_to_random_32_bytes|emergency_unlock" "$(ENV_FILE)" >/dev/null 2>&1; then \
		echo "$(ENV_FILE) still contains placeholder/insecure secret values. Update COOKIE_SECRET, EMERGENCY_RESET_SECRET, EMAIL_CONFIG_ENCRYPTION_KEY, etc."; exit 1; \
	fi
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) config > /dev/null
	@echo "Production compose config is valid."

build-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) build --pull

up-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) up -d --build --remove-orphans

down-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) down

restart-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) restart

logs-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) logs -f --tail=200

ps-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) ps

pull-prod:
	@$(COMPOSE) --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) pull

deploy-prod: validate-prod up-prod
	@echo "Production deploy complete."

safe-release-prod:
	@./deploy.sh safe-release

verify-prod:
	@./deploy.sh verify

verify-resilience-prod:
	@echo "verify-resilience-prod: shadow/PITR verification was removed; running ./deploy.sh verify"
	@./deploy.sh verify

rollback-help-prod:
	@./deploy.sh rollback-help
