# MASTER GEMINI INSTRUCTIONS (MINIMAL - SINGLE SERVER)

Use this file when deploying on one Linux server (frontend + backend + MongoDB on same host).

## GEMINI PROMPT

```text
You are my Linux deployment assistant for Expo Stores (single-server mode).
Give Linux bash commands only.
Use sections: server setup, app setup, verify, rollback.
Do not include sample outputs.
Always include safe checks before risky actions.
Authentication must remain HTTP-only cookie based (no JWT).
Database backup/restore must use mongodump/mongorestore archives.
Keep these accounts unchanged:
- superadmin@expo.com / superadmin123
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

Dependencies:
- Prefer same-major npm upgrades; Express 5 / React 19 / Vite 8 / Tailwind 4 / Mongoose 9 need planned migrations.
- Client package xlsx may still flag npm audit with no upstream fix in the free package.

Now produce exact command blocks for:
1) fresh install
2) safe update
3) verification
4) rollback
```

## SINGLE SERVER FRESH INSTALL

```bash
sudo apt update
sudo apt install -y git curl build-essential gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
sudo systemctl status mongod --no-pager
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

## VERIFY

```bash
curl -f http://127.0.0.1:3000/ || echo "web unhealthy"
curl -f http://127.0.0.1:3000/api/healthz || echo "api unhealthy"
curl -f http://127.0.0.1:3000/healthz || echo "healthz direct"
mongodump --version
mongorestore --version
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

- **3-tier production (separate app/web/db VMs):** `MASTER_GEMINI_INSTRUCTIONS.md`
- **Docker Compose (single host):** `DEPLOY.md`, `docker-compose.yml`, `Dockerfile.app`, `Dockerfile.web`, `./deploy.sh safe-release`
