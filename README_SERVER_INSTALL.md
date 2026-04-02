# Expo Asset Management - Server Installation Guide (Production)

This guide is focused on **server-side installation** for your 3-tier deployment:

- Web VM: `10.96.133.181` (VLAN 1747)
- App VM: `10.96.133.197` (VLAN 1748)
- DB VM: `10.96.133.213` (VLAN 1749)

Management network (`10.96.133.160/28`, VLAN 1746) remains isolated for admin access only.

Auth/backup baseline for this guide:
- Auth is HTTP-only cookie based (no JWT token flow).
- Backup/restore uses MongoDB tools (`mongodump` and `mongorestore`).

## IP-Only Access Rule

- Public entry point is Web VM IP only: `http://10.96.133.181`
- No DNS/domain is required for this deployment.
- Keep App VM (`10.96.133.197`) and DB VM (`10.96.133.213`) internal-only.
- `CORS_ORIGIN` on App VM must be set to the same user-facing URL:
  - `http://10.96.133.181` (HTTP)
  - `https://10.96.133.181` (if TLS is enabled on Nginx)

## 1) Network and Security Baseline (Must Match)

- **Web VM** accepts client traffic on `80/443`.
- **Web VM -> App VM** only `5000`.
- **App VM -> DB VM** only `27017`.
- **Mgmt VLAN -> all servers** only `22` (SSH).
- Deny all other east-west traffic.
- No direct Internet access to App or DB tiers.

## 2) OS Dependencies Per VM

### App VM (`10.96.133.197`)

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

### Web VM (`10.96.133.181`)

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### DB VM (`10.96.133.213`) - MongoDB

```bash
sudo apt update
sudo apt install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
sudo systemctl status mongod --no-pager
```

## 3) MongoDB Secure Config (DB VM)

Edit `/etc/mongod.conf`:

- Set bind IP to DB private IP and localhost:
  - `bindIp: 127.0.0.1,10.96.133.213`
- Keep port `27017`.

Restart:

```bash
sudo systemctl restart mongod
```

Create application DB user:

```bash
mongosh
use expo-stores
db.createUser({
  user: "expo_user",
  pwd: "CHANGE_ME_STRONG_PASSWORD",
  roles: [{ role: "readWrite", db: "expo-stores" }]
})
```

## 4) App VM Deployment

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R $USER:$USER /opt/Expo
cd /opt/Expo/server
cp .env.vm.example .env
```

Set `server/.env`:

```env
MONGO_URI=mongodb://expo_user:CHANGE_ME_STRONG_PASSWORD@10.96.133.213:27017/expo-stores
PORT=5000
COOKIE_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
COOKIE_SECURE=auto
ENABLE_CSRF=true
CORS_ORIGIN=http://10.96.133.181
SEED_DEFAULTS=false
```

Install + start:

```bash
cd /opt/Expo/server
npm ci
pm2 start server.js --name expo-app
pm2 save
pm2 startup
curl -sS http://127.0.0.1:5000/api/healthz
```

## 5) Web VM Deployment

```bash
cd /opt
sudo git clone https://github.com/tariq5024-blip/Expo.git
sudo chown -R $USER:$USER /opt/Expo
cd /opt/Expo/client
npm ci
npm run build
```

Deploy static build:

```bash
sudo mkdir -p /var/www/expo/client
sudo rsync -a --delete /opt/Expo/client/dist/ /var/www/expo/client/dist/
```

Install Nginx site:

```bash
sudo cp /opt/Expo/nginx.conf /etc/nginx/sites-available/expo
sudo ln -sf /etc/nginx/sites-available/expo /etc/nginx/sites-enabled/expo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz >/dev/null && echo "OK: /healthz"
curl -fsS http://127.0.0.1/api/healthz >/dev/null && echo "OK: /api/healthz"
```

## 6) Readiness Preflight (All VMs)

Use the provided checker from repo root:

```bash
chmod +x scripts/check-deploy-readiness.sh
ROLE=app ./scripts/check-deploy-readiness.sh
ROLE=web APP_IP=10.96.133.197 APP_PORT=5000 ./scripts/check-deploy-readiness.sh
ROLE=db ./scripts/check-deploy-readiness.sh
```

## 7) Post-Deployment Validation

From Web VM:

```bash
curl -I http://10.96.133.197:5000/api/healthz
curl -I http://127.0.0.1/
curl -fsS http://127.0.0.1/healthz >/dev/null && echo "OK: nginx /healthz -> app"
curl -fsS http://127.0.0.1/api/healthz >/dev/null && echo "OK: nginx /api/"
```

From App VM:

```bash
nc -zv 10.96.133.213 27017
curl -sS http://127.0.0.1:5000/api/healthz
```

Browser:

- `http://10.96.133.181`
- (IP-only production URL)

Default users (only when `SEED_DEFAULTS=true` during initial bootstrap):

- `superadmin@expo.com` / `superadmin123`
- `scy@expo.com` / `admin123`
- `it@expo.com` / `admin123`
- `noc@expo.com` / `admin123`

## 8) Zero-Downtime Update Pattern

App VM:

```bash
cd /opt/Expo
APP_DIR=/opt/Expo SERVICE_NAME=expo-app HEALTH_URL=http://127.0.0.1:5000/api/healthz ./scripts/deploy-app-safe.sh
```

Web VM:

```bash
cd /opt/Expo
APP_DIR=/opt/Expo WEB_ROOT=/var/www/expo/client NGINX_SITE=/etc/nginx/sites-available/expo HEALTH_URL=http://127.0.0.1/healthz ./scripts/deploy-web-safe.sh
```

## 9) Backup and Restore (mongodump/mongorestore)

Use the system backup endpoints from an authenticated Super Admin session.  
Upload/download artifact format is MongoDB archive (`.archive.gz`).

Create a backup artifact:

```bash
curl -sS -X POST http://127.0.0.1:5000/api/system/backups/create \
  -H "Content-Type: application/json" \
  -b "<cookie_file_or_sid>" \
  --data '{"backupType":"Full","trigger":"manual"}'
```

Restore from uploaded archive:

```bash
curl -sS -X POST http://127.0.0.1:5000/api/system/backups/upload-restore \
  -b "<cookie_file_or_sid>" \
  -F "backup=@/path/to/backup.archive.gz"
```

