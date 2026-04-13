# Expo Asset Management - Single Linux Installation Guide

Before packaging or copying this folder to another PC, run **`npm run verify:release`** from the repo root and read **`DEPLOY_CHECKLIST.md`**.

**No public internet on the server?** Use **`OFFLINE_AIRGAP_DEPLOYMENT.md`** for a phased copy/build procedure and env checks.

For **copy-paste Linux deploy commands in Google Gemini**, use **`MASTER_GEMINI_INSTRUCTIONS_MINIMAL.md`** (this topology) or **`MASTER_GEMINI_INSTRUCTIONS.md`** for separate app/web/db VMs.

Use this guide when running the full stack on one Linux machine (no k3s).

App baseline for local/single-server:
- Auth is HTTP-only cookie based (no JWT token auth).
- Backups/restores use **Percona Backup for MongoDB (PBM)**. Configure `pbm-agent` + storage on MongoDB hosts and set **`PBM_MONGODB_URI`** on the Node app (see `server/.env.vm.example`, `MASTER_GEMINI_INSTRUCTIONS_MINIMAL.md`).

## Prerequisites

- Ubuntu/Linux machine
- **Node.js 20.x** (matches repo `engines`: `>=20.0.0 <21`)
- npm
- MongoDB installed locally and running

## 1) Install dependencies

From project root (recommended one-shot):

```bash
npm run install:all
```

Or manually:

```bash
npm install
cd server && npm install
cd ../client && npm install
cd ..
```

## 2) Configure backend environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at minimum:

```env
MONGO_URI=mongodb://127.0.0.1:27017/expo
LOCAL_FALLBACK_MONGO_URI=mongodb://127.0.0.1:27017/expo
ALLOW_INMEMORY_FALLBACK=false
SHADOW_DB_NAME=expo_shadow
ENABLE_BACKUP_SCHEDULER=true
PORT=5000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:5000
CORS_ORIGIN=http://localhost:5173
COOKIE_SECRET=change_to_random_secret
COOKIE_SECURE=auto
COOKIE_SAMESITE=lax
EMAIL_CONFIG_ENCRYPTION_KEY=replace_with_64_hex_chars_or_base64_32_bytes
EMERGENCY_RESET_SECRET=replace_with_secure_random_value
ENABLE_CSRF=true
TRUST_PROXY_HOPS=1
MAX_BACKUP_UPLOAD_MB=1024
SEED_DEFAULTS=false
```

## Default login accounts

With `SEED_DEFAULTS=true`, startup ensures these accounts exist with these passwords:

- `superadmin@expo.com` / `superadmin123`
- `scy@expo.com` / `admin123`
- `it@expo.com` / `admin123`
- `noc@expo.com` / `admin123`

## 3) Start MongoDB

If installed as a service:

```bash
sudo systemctl start mongod || sudo systemctl start mongodb
```

## 4) Run backend and frontend

Fastest way after every laptop restart (recommended):

```bash
cd /path/to/Expo
npm run dev:local
```

What `dev:local` does:
- creates `server/.env` from `server/.env.example` if missing
- auto-fills required local secrets if they are empty/placeholders
- verifies MongoDB reachability and tries to start local MongoDB service
- starts frontend + backend together (`npm run dev` waits until `http://127.0.0.1:PORT/api/healthz` responds before launching Vite, so you should not see brief `ECONNREFUSED` proxy errors on startup)

Manual way (two terminals):

Open terminal 1:

```bash
cd server
npm run dev
```

Open terminal 2:

```bash
cd client
# Optional: if backend runs on a non-default port, set Vite proxy env:
# cp .env.example .env
# edit VITE_API_PORT to match backend PORT
npm run dev -- --host --port 5173
```

## 5) Access application

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`

If your backend is configured to another port, use that port.

## 6) Run as one service on `localhost:3000` (production-style)

Build once (from your clone path, e.g. `/opt/Expo`):

```bash
cd /path/to/Expo
npm run build:prod
```

Start app (serves frontend + API from one process):

```bash
cd /path/to/Expo
npm run start:prod:3000
```

Open:

- `http://localhost:3000`

If login fails after environment edits, verify in `server/.env`:

```env
SEED_DEFAULTS=true
MONGO_URI=mongodb://127.0.0.1:27017/expo
COOKIE_SECURE=false
```

## Common fixes

- Port already in use:
  - change `PORT` in `server/.env`
  - or stop old process using that port
- Login fails:
  - verify MongoDB is running
  - verify `MONGO_URI` database exists and is reachable
- Frontend not opening:
  - ensure `npm run dev -- --host --port 5173` is running in `client/`

## 7) Docker Compose (optional)

To run Mongo + API + Nginx web on one host with containers, use **`DEPLOY.md`**, copy **`.env.docker.example`** → **`.env.docker`**, then **`./deploy.sh safe-release`** (or **`make safe-release-prod`**). Typical URLs: web **`http://localhost:3000`**, API **`http://localhost:5000`**.
