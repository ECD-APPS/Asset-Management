SHELL := /bin/bash

PROJECT_NAME ?= expo
ENV_FILE ?= .env.docker
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE := docker compose

.PHONY: help validate-prod build-prod up-prod down-prod restart-prod logs-prod ps-prod pull-prod deploy-prod safe-release-prod verify-prod verify-resilience-prod rollback-help-prod

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
	@echo "  make safe-release-prod - Precheck, backup, deploy, verify"
	@echo "  make verify-prod    - Verify API/Web health endpoints"
	@echo "  make verify-resilience-prod - Run shadow sync + backup verification checks"
	@echo "  make rollback-help-prod - Show rollback helper commands"

validate-prod:
	@test -f "$(ENV_FILE)" || (echo "Missing $(ENV_FILE). Copy .env.docker.example to $(ENV_FILE) and update secrets."; exit 1)
	@grep -q "replace_with_secure_random_value" "$(ENV_FILE)" && (echo "$(ENV_FILE) still contains placeholder secrets. Update it before deploy."; exit 1) || true
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
	@docker compose --env-file "$(ENV_FILE)" -p "$(PROJECT_NAME)" $(COMPOSE_FILES) exec -T app node -e "const mongoose=require('mongoose'); const {syncShadowDatabase,verifyLatestBackupRestore}=require('./utils/resilienceManager'); (async()=>{await mongoose.connect(process.env.MONGO_URI); await syncShadowDatabase({fullResync:false,actor:null}); await verifyLatestBackupRestore(); await mongoose.disconnect();})();"

rollback-help-prod:
	@./deploy.sh rollback-help
