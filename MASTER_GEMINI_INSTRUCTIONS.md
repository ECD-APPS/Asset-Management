# Expo Master Deployment Instructions (3-Tier: app-vm/web-vm/db-vm)

Use this file for 3-tier deployment as your single source of truth.  
You can paste the **Gemini prompt section** directly into Gemini to get clean, step-by-step commands.

---

## 1) Gemini Master Prompt (Copy/Paste)

Paste everything below into Gemini:

```text
You are my Linux deployment assistant for Expo Stores.

Environment:
- Linux desktop for admin/SSH
- app-vm (Node/Express API) = 10.96.133.197
- web-vm (Nginx + React build) = 10.96.133.181
- db-vm (MongoDB) = 10.96.133.213
- Repo path on servers: /opt/Expo
- Repo URL: https://github.com/tariq5024-blip/Expo.git
- Branch: main
- Node version required: 20.x (engines: >=20 <21)
- Stack: monorepo — server/ (Express + Mongoose), client/ (Vite + React 18)
- Local development (developer laptop): from repo root run `npm run dev` (API + Vite; client often http://localhost:5173, API often :5000 per .env)
- Production dependency install: prefer root `npm ci`, then `npm ci --omit=dev --prefix server`, then `cd client && npm ci && npm run build` (or `npm run build:prod` from root per package.json)
- MongoDB tools required on DB VM: mongodump and mongorestore

Rules you MUST follow:
1) Give commands only for Linux bash.
2) Use short sections: desktop, db-vm, app-vm, web-vm.
3) Never include placeholder output unless I ask.
4) Always show safe checks before destructive actions.
5) Keep existing user accounts unchanged:
   - superadmin@expo.com / superadmin123
   - it@expo.com / admin123
   - noc@expo.com / admin123
6) Prefer project scripts when available:
   - scripts/check-deploy-readiness.sh
   - scripts/deploy-app-safe.sh
   - scripts/deploy-web-safe.sh
7) If a command needs sudo, include sudo explicitly.
8) At the end, provide a verification checklist with curl commands.
9) Authentication is cookie-based only (httpOnly session cookie), not JWT.
10) Backup/restore workflow must use mongodump/mongorestore archive files.
11) Keep existing endpoints for compatibility unless migration is complete.
12) Health checks: `/healthz`, `/readyz`, and aliases `/api/healthz`, `/api/readyz` on the app.

Dashboard / stats (if troubleshooting SCY asset analytics):
- GET /api/assets/stats returns overview (total = active asset rows excluding disposed; totalQuantity = sum of quantity in that scope) plus maintenanceVendors (per-vendor quantity sums) and maintenanceVendorAssets (per-vendor document counts).
- Server aggregates for maintenance vendors must use $addFields (not $project) before $group when summing quantityExpr, or $quantity is dropped and qty incorrectly equals row count.
- Client: client/src/pages/Dashboard.jsx (fetch + normalizeStats), client/src/components/DashboardCharts.jsx (vendor pies use asset rows vs overview.total; quantity subtitle from maintenanceVendors).

Dependency policy:
- Prefer semver-safe bumps (same major). Full jumps to Express 5, React 19, Vite 8, Tailwind 4, Mongoose 9 require explicit migration work.
- Client `xlsx` may still show npm audit advisories with no patched community release; replacing the library is a separate task.

Now generate a clean deployment runbook with exact commands for:
- Fresh install
- Safe update
- Rollback checks
```

---

## 2) Network + Role Map

- **Web VM**: `10.96.133.181` (public entry)
- **App VM**: `10.96.133.197` (private API)
- **DB VM**: `10.96.133.213` (private MongoDB)
- **Traffic flow**: `User -> Web -> App -> DB`

Required ports:
- Internet -> Web: `80/443`
- Web -> App: `5000`
- App -> DB: `27017`
- Admin desktop -> all VMs: `22`

---

## 3) One-Time Fresh Setup Commands

Run these in order.

### 3.1 DB VM (`10.96.133.213`)

```bash
sudo apt update
sudo apt install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
sudo systemctl status mongod --no-pager
```

Set Mongo bind IP:

```bash
sudo sed -i 's/^  bindIp: .*/  bindIp: 127.0.0.1,10.96.133.213/' /etc/mongod.conf
sudo systemctl restart mongod
```

Enable replica set (required for enterprise backup + PITR):

```bash
sudo python3 - <<'PY'
from pathlib import Path
p = Path('/etc/mongod.conf')
s = p.read_text()
if 'replSetName:' not in s:
    if '#replication:' in s:
        s = s.replace('#replication:\n', 'replication:\n  replSetName: expo-rs0\n', 1)
    elif 'replication:' not in s:
        s = s.rstrip() + '\n\nreplication:\n  replSetName: expo-rs0\n'
p.write_text(s)
print('replication configured')
PY
sudo systemctl restart mongod
mongosh --eval 'rs.initiate({_id:"expo-rs0",members:[{_id:0,host:"10.96.133.213:27017"}]})'
mongosh --eval 'rs.status().ok'
```

Create DB user:

```bash
mongosh <<'EOF'
use expo-stores
db.createUser({
  user: "expo_user",
  pwd: "CHANGE_ME_STRONG_PASSWORD",
  roles: [{ role: "readWrite", db: "expo-stores" }]
})
EOF
```

---

### 3.2 App VM (`10.96.133.197`)

Install base packages + Node 20 + PM2:

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
node -v
npm -v
```

Clone repo:

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R "$USER:$USER" /opt/Expo
```

Create app env:

```bash
cd /opt/Expo/server
cp .env.vm.example .env
```

Edit `/opt/Expo/server/.env` and set:

```env
MONGO_URI=mongodb://expo_user:CHANGE_ME_STRONG_PASSWORD@10.96.133.213:27017/expo-stores
PORT=5000
COOKIE_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
COOKIE_SECURE=auto
ENABLE_CSRF=true
CORS_ORIGIN=http://10.96.133.181
SEED_DEFAULTS=false
```

Install + start backend:

```bash
cd /opt/Expo
npm ci
cd /opt/Expo/server
npm ci --omit=dev
pm2 start server.js --name expo-app --cwd /opt/Expo/server
pm2 save
pm2 startup
curl -sS http://127.0.0.1:5000/api/healthz
```

---

### 3.3 Web VM (`10.96.133.181`)

Install base packages + Node 20 + Nginx:

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Clone repo + build client:

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R "$USER:$USER" /opt/Expo
cd /opt/Expo/client
npm ci
npm run build
```

Deploy static build + Nginx config:

```bash
sudo mkdir -p /var/www/expo/client
sudo rsync -a --delete /opt/Expo/client/dist/ /var/www/expo/client/dist/
sudo cp /opt/Expo/nginx.conf /etc/nginx/sites-available/expo
sudo sed -i 's#http://127.0.0.1:5000#http://10.96.133.197:5000#g' /etc/nginx/sites-available/expo
sudo ln -sf /etc/nginx/sites-available/expo /etc/nginx/sites-enabled/expo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz >/dev/null && echo "OK: nginx /healthz -> API"
curl -fsS http://127.0.0.1/api/healthz >/dev/null && echo "OK: nginx /api/healthz"
```

---

## 4) Preflight Checks Before Every Deployment

On each VM from `/opt/Expo`:

```bash
chmod +x scripts/check-deploy-readiness.sh
```

App VM:

```bash
cd /opt/Expo
ROLE=app ./scripts/check-deploy-readiness.sh
```

Web VM:

```bash
cd /opt/Expo
ROLE=web APP_IP=10.96.133.197 APP_PORT=5000 ./scripts/check-deploy-readiness.sh
```

DB VM:

```bash
cd /opt/Expo
ROLE=db ./scripts/check-deploy-readiness.sh
```

---

## 5) Safe Update Commands (Production)

### 5.1 App VM Safe Update

```bash
cd /opt/Expo
git fetch origin
git checkout main
git pull --ff-only origin main
APP_DIR=/opt/Expo SERVICE_NAME=expo-app HEALTH_URL=http://127.0.0.1:5000/api/healthz ./scripts/deploy-app-safe.sh
pm2 status
curl -sS http://127.0.0.1:5000/api/healthz
```

### 5.2 Web VM Safe Update

```bash
cd /opt/Expo
git fetch origin
git checkout main
git pull --ff-only origin main
APP_DIR=/opt/Expo WEB_ROOT=/var/www/expo/client NGINX_SITE=/etc/nginx/sites-available/expo APP_UPSTREAM=10.96.133.197:5000 HEALTH_URL=http://127.0.0.1/healthz ./scripts/deploy-web-safe.sh
sudo nginx -t
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz >/dev/null && echo "OK: web tier healthz"
```

---

## 6) Verification Checklist (After Deploy)

From **Web VM**:

```bash
curl -I http://10.96.133.197:5000/api/healthz
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz >/dev/null && echo "OK: nginx proxies /healthz to app"
curl -fsS http://127.0.0.1/api/healthz >/dev/null && echo "OK: nginx /api/"
```

From **App VM**:

```bash
nc -zv 10.96.133.213 27017
curl -sS http://127.0.0.1:5000/api/healthz
curl -sS http://127.0.0.1:5000/api/readyz
```

From browser:

```text
http://10.96.133.181
```

Login check:
- `superadmin@expo.com / superadmin123`
- `it@expo.com / admin123`
- `noc@expo.com / admin123`

Backup check (Super Admin session required):

```bash
# 1) create full backup artifact
curl -sS -X POST http://127.0.0.1:5000/api/system/backups/create \
  -H "Content-Type: application/json" \
  -b "<cookie_file_or_sid>" \
  --data '{"backupType":"Full","trigger":"manual"}'

# 2) check readiness endpoint
curl -sS http://127.0.0.1:5000/api/system/resilience/readiness \
  -b "<cookie_file_or_sid>"
```

---

## 7) Rollback-First Emergency Commands

If app update fails:

```bash
pm2 logs expo-app --lines 200
pm2 restart expo-app --update-env
curl -sS http://127.0.0.1:5000/api/healthz
```

If web update fails:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz || true
```

Git rollback (both app-vm and web-vm if needed):

```bash
cd /opt/Expo
git log --oneline -n 5
git checkout <previous_stable_commit>
```

Then re-run safe deploy scripts.

---

## 8) Optional: Docker Safe-Release Mode

Use only if deploying container stack on a single host (see also `DEPLOY.md`).

Stack files:
- `docker-compose.yml` + `docker-compose.prod.yml` (merged by `deploy.sh`)
- `Dockerfile.app` — Node **20-bookworm-slim**, production server deps, MongoDB **database tools** for backups
- `Dockerfile.web` — multi-stage Vite build + **nginx stable-alpine**
- `nginx.docker.conf` — SPA + `/api/` proxy to app; **`/healthz`** and **`/readyz`** forwarded to the API

Build expects **Docker BuildKit** (default in modern Docker) for `RUN --mount=type=cache` npm layers.

```bash
cd /opt/Expo
cp .env.docker.example .env.docker
# edit .env.docker and set real secrets
./deploy.sh safe-release
./deploy.sh ps
```

Health:

```bash
./deploy.sh verify
curl -fsS http://localhost:5000/api/healthz    # API (direct)
curl -fsS http://localhost:3000/api/healthz  # via nginx
curl -fsS http://localhost:3000/healthz        # via nginx → app /healthz
```

---

## 9) Desktop Operator Notes

- Keep one SSH terminal per VM to avoid command confusion.
- Always run `git pull --ff-only` before deploy scripts.
- Never expose DB VM or App VM publicly.
- Keep Node at 20.x on app/web VMs.
- Keep this file updated if IPs/repo path/branch changes.

---

## 10) Codebase map (for AI / troubleshooting)

| Area | Path |
|------|------|
| API entry | `server/server.js` |
| Asset routes + `/stats` | `server/routes/assets.js` |
| React app | `client/src/` |
| Dashboard page | `client/src/pages/Dashboard.jsx` |
| Charts + key metrics | `client/src/components/DashboardCharts.jsx` |
| API client | `client/src/api/axios.js` |
| Deploy helpers | `scripts/*.sh`, root `package.json` scripts |

**Local dev:** repo root `npm run install:all` (first time), then `npm run dev`.

**Production build (reference):** root `npm run build:prod` or manual `npm ci` in server + client with `npm run build` in client.

**SCY dashboard vendor filter:** URL query `?maintenance_vendor=Siemens|G42` passes through to `/api/assets/stats` when SCY-scoped user; stats and charts stay consistent with that filter.

