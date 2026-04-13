# MASTER GEMINI INSTRUCTIONS (MINIMAL - SINGLE SERVER)

Use this file when deploying on one Linux server (frontend + backend + MongoDB on same host).

**Application status:** Production-ready. Before packaging or cloning to a new machine, run **`npm run verify:release`** from the repo root and read **`DEPLOY_CHECKLIST.md`**. Use **`VERIFY_RELEASE_STRICT=1 npm run verify:release`** for a strict lockfile-clean build.

**3-tier VM deploy (separate app/web/db):** use **`MASTER_GEMINI_INSTRUCTIONS.md`**.

## GEMINI PROMPT

```text
You are my Linux deployment assistant for Expo Stores (single-server mode).
Give Linux bash commands only.
Use sections: server setup, app setup, verify, rollback.
Do not include sample outputs.
Always include safe checks before risky actions.
Authentication must remain HTTP-only cookie based (no JWT).
Database backup/restore must use **Percona Backup for MongoDB (PBM)** from the app (`pbm` CLI + `PBM_MONGODB_URI`); agents and storage on MongoDB hosts per https://docs.percona.com/percona-backup-mongodb/install/initial-setup.html — no `mongodump`/`mongorestore` upload path.
Keep these accounts unchanged:
- superadmin@expo.com / superadmin123
- scy@expo.com / admin123
- it@expo.com / admin123
- noc@expo.com / admin123

Environment:
- single host: localhost
- repo: /opt/Expo
- repo URL: https://github.com/tariq5024-blip/Expo.git
- branch: main
- node: 20.x (engines: >=20 <21)
- monorepo: server/ = Express + Mongoose API, client/ = Vite + React 18
- local dev (optional): from repo root `npm run dev` (Vite + API; ports per .env)
- health: app exposes /healthz, /readyz and /api/healthz, /api/readyz

Code reference (troubleshooting):
- Asset stats API: GET /api/assets/stats — overview.total = active rows (excl. disposed), overview.totalQuantity = qty sum; maintenanceVendors = per-vendor qty sums; maintenanceVendorAssets = per-vendor row counts. Vendor Mongo pipelines must use $addFields before $group when summing quantity (not $project-only stages that drop quantity).
- Dashboard UI: client/src/pages/Dashboard.jsx, client/src/components/DashboardCharts.jsx
- Release check: from repo root run npm run verify:release; VERIFY_RELEASE_STRICT=1 for full npm ci + build. Human checklist: DEPLOY_CHECKLIST.md (CORS_ORIGIN, cookies, Mongo, proxy).
- Tools: POST /api/tools/:id/assign (admin/manager assign to technician or external holder), POST /api/tools/:id/issue and /return; bulk Excel export/import under /api/tools.
- Spare parts: POST /api/spare-parts/:id/issue with body fromAssignModal for full assign audit on history; bulk import/export under /api/spare-parts.
- Tool/spare assign flows record gate-pass intent in history only; formal PDF passes use the Gate Passes module.

Dependencies:
- Prefer same-major npm upgrades; Express 5 / React 19 / Vite 8 / Tailwind 4 / Mongoose 9 need planned migrations.
- Client uses **exceljs** for spreadsheet downloads; keep `npm audit` clean in `client/` when updating dependencies.

Now produce exact command blocks for:
1) fresh install
2) safe update
3) verification
4) rollback
```

## SINGLE SERVER FRESH INSTALL (NON-DOCKER)

```bash
sudo apt update
sudo apt install -y git curl build-essential gnupg make
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
sudo systemctl status mongod --no-pager
```

If this host runs **both** MongoDB and the Node API, install the **`pbm` CLI** for in-app backups (configure `pbm-agent` + storage on MongoDB per [PBM initial setup](https://docs.percona.com/percona-backup-mongodb/install/initial-setup.html), then set `PBM_MONGODB_URI` in `server/.env`):

```bash
wget -qO /tmp/percona-release.deb https://repo.percona.com/apt/percona-release_latest.generic_all.deb
sudo dpkg -i /tmp/percona-release.deb && rm -f /tmp/percona-release.deb
sudo percona-release enable pbm release
sudo apt update && sudo apt install -y percona-backup-mongodb
```

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R "$USER:$USER" /opt/Expo
cd /opt/Expo
npm ci
cd /opt/Expo/server
npm ci
cd /opt/Expo/client
npm ci
```

```bash
cd /opt/Expo/server
cp .env.example .env
```

Generate secure secrets (recommended on each new laptop/server):

```bash
COOKIE_SECRET="$(openssl rand -hex 32)"
EMAIL_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32)"
EMERGENCY_RESET_SECRET="$(openssl rand -hex 32)"
printf '%s\n' \
"COOKIE_SECRET=$COOKIE_SECRET" \
"EMAIL_CONFIG_ENCRYPTION_KEY=$EMAIL_CONFIG_ENCRYPTION_KEY" \
"EMERGENCY_RESET_SECRET=$EMERGENCY_RESET_SECRET"
```

```env
MONGO_URI=mongodb://127.0.0.1:27017/expo
LOCAL_FALLBACK_MONGO_URI=mongodb://127.0.0.1:27017/expo
ALLOW_INMEMORY_FALLBACK=false
SHADOW_DB_NAME=expo_shadow
ENABLE_BACKUP_SCHEDULER=true
PORT=5000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
COOKIE_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
COOKIE_SECURE=auto
COOKIE_SAMESITE=lax
EMAIL_CONFIG_ENCRYPTION_KEY=replace_with_64_hex_chars_or_base64_32_bytes
EMERGENCY_RESET_SECRET=replace_with_secure_random_value
ENABLE_CSRF=true
TRUST_PROXY_HOPS=1
MAX_BACKUP_UPLOAD_MB=1024
SEED_DEFAULTS=false
# Percona Backup for MongoDB (required for API / scheduled backups):
# PBM_MONGODB_URI=mongodb://pbm:CHANGE_ME@127.0.0.1:27017/?authSource=admin
# PBM_BACKUP_WAIT_TIME=4h
```

```bash
cd /opt/Expo
npm run build:prod
npm run start:prod:3000
```

## SAFE UPDATE

```bash
cd /opt/Expo
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
cd /opt/Expo/server && npm ci
cd /opt/Expo/client && npm ci
cd /opt/Expo
npm run build:prod
pkill -f "node.*server" || true
npm run start:prod:3000
```

## SINGLE-COMMAND LAPTOP PRECHECK

Run this on any new laptop/host clone before deploy:

```bash
cd /opt/Expo
npm run verify:release
```

Optional stack / endpoint probe:

```bash
cd /opt/Expo
chmod +x scripts/preflight.sh
./scripts/preflight.sh
```

If containers are already running and you want live endpoint checks too:

```bash
./scripts/preflight.sh --with-verify
```

## DOCKER SAFE-RELEASE (SINGLE HOST)

```bash
cd /opt/Expo
cp .env.docker.example .env.docker
```

Set real secrets in `.env.docker` (do not keep placeholders):
- `COOKIE_SECRET`
- `EMAIL_CONFIG_ENCRYPTION_KEY`
- `EMERGENCY_RESET_SECRET`

Validate + deploy:

```bash
cd /opt/Expo
make validate-prod
./deploy.sh safe-release
./deploy.sh verify
```

## VERIFY

```bash
curl -f http://127.0.0.1:3000/ || echo "web unhealthy"
curl -f http://127.0.0.1:3000/api/healthz || echo "api unhealthy"
curl -f http://127.0.0.1:3000/healthz || echo "healthz direct"
command -v pbm && pbm version
```

Open browser:

```text
http://<server-ip>:3000
```

## ROLLBACK QUICK

```bash
cd /opt/Expo
git log --oneline -n 5
git checkout <previous_stable_commit>
npm ci
cd /opt/Expo/server && npm ci
cd /opt/Expo/client && npm ci
cd /opt/Expo
npm run build:prod
pkill -f "node.*server" || true
npm run start:prod:3000
```

## See also

- **Env + smoke tests:** `DEPLOY_CHECKLIST.md`
- **3-tier production (separate app/web/db VMs):** `MASTER_GEMINI_INSTRUCTIONS.md`
- **Docker Compose (single host):** `DEPLOY.md`, `docker-compose.yml`, `Dockerfile.app`, `Dockerfile.web`, `./deploy.sh safe-release`
- **IP-only production layout:** `README.md`
