# Expo Asset Management - IP-Only Deployment Guide

This guide is for production deployment using IP addresses only (no domain).
For single-machine setup, use `README_LOCAL.md`.
For step-by-step server installation, use `README_SERVER_INSTALL.md`.

App baseline:
- Auth is HTTP-only cookie based (no JWT token auth).
- Backups/restores use `mongodump` and `mongorestore` archive flow.

**Where to deploy from this repo**

| Mode | Doc |
|------|-----|
| Docker Compose (single host) | `DEPLOY.md`, `./deploy.sh safe-release`, `Makefile` |
| 3-tier VMs (this IP guide + install steps) | `README.md`, `README_SERVER_INSTALL.md`, `MASTER_GEMINI_INSTRUCTIONS.md` |
| One Linux box, Node + Mongo (no Docker) | `README_LOCAL.md` |

## IP-Only Access (Final)

- End users must access the app via Web VM IP: `http://10.96.133.181`
- Do not use a domain name in production for this setup.
- Do not expose App VM (`10.96.133.197`) or DB VM (`10.96.133.213`) to end users.
- App VM API is private behind Nginx and must be reachable only from Web VM.

## VLAN and VM Layout (Your Production Design)

- Management VLAN `10.96.133.160/28` (VLAN 1746)
- Web VLAN `10.96.133.176/28` (VLAN 1747): Web VM `10.96.133.181`
- App VLAN `10.96.133.192/28` (VLAN 1748): App VM `10.96.133.197`
- DB VLAN `10.96.133.208/28` (VLAN 1749): DB VM `10.96.133.213`

Each `/28` provides 14 usable IPs.  
Gateways (ACI anycast):
- Mgmt GW: `10.96.133.161`
- Web GW: `10.96.133.177`
- App GW: `10.96.133.193`
- DB GW: `10.96.133.209`

Detailed allocation:

- Management EPG `EPG-ECD-PHY-SCY-HV3-MGMT`, VLAN `1746`
  - Subnet: `10.96.133.160/28`
  - Assigned: `10.96.133.165` (HV3 management)
  - Usable: `10.96.133.162 - 10.96.133.174`
- Web EPG `EPG-ECD-PHY-SCY-WE1`, VLAN `1747`
  - Subnet: `10.96.133.176/28`
  - Assigned: `10.96.133.181` (Web VM)
  - Usable: `10.96.133.178 - 10.96.133.190`
- App EPG `EPG-ECD-PHY-SCY-JA1`, VLAN `1748`
  - Subnet: `10.96.133.192/28`
  - Assigned: `10.96.133.197` (App VM)
  - Usable: `10.96.133.194 - 10.96.133.206`
- DB EPG `EPG-ECD-PHY-SCY-DB1`, VLAN `1749`
  - Subnet: `10.96.133.208/28`
  - Assigned: `10.96.133.213` (DB VM)
  - Usable: `10.96.133.210 - 10.96.133.222`

## Traffic Flow

`User -> Web(10.96.133.181) -> App(10.96.133.197:5000) -> DB(10.96.133.213:27017)`

## Security Policy (Mandatory)

Allow:
- Internet -> Web: `80`
- Internet -> Web: `443`
- Web -> App: `5000`
- App -> DB: `27017`
- Mgmt -> Servers: `22`

Deny:
- Web -> DB direct
- Internet -> App direct
- Internet -> DB direct
- App -> Mgmt VLAN
- Application VLANs -> Mgmt VLAN

Management VLAN policy:
- Only admin workstation access is allowed.
- No application traffic is allowed into management subnet.

## ACI Contracts (Recommended)

- `Web -> App`: Permit TCP `5000` only
- `App -> DB`: Permit TCP `27017` only
- `Mgmt -> All`: Permit TCP `22` only
- Deny all other east-west traffic by default

## App VM Setup (`10.96.133.197`)

Create env:

```bash
cd /path/to/Expo/server
cp .env.vm.example .env
```

Required values:

```env
MONGO_URI=mongodb://user:pass@10.96.133.213:27017/expo-stores
LOCAL_FALLBACK_MONGO_URI=mongodb://user:pass@10.96.133.213:27017/expo-stores
ALLOW_INMEMORY_FALLBACK=false
SHADOW_DB_NAME=expo_shadow
ENABLE_BACKUP_SCHEDULER=true
PORT=5000
NODE_ENV=production
COOKIE_SECRET=replace_with_secure_random_value
COOKIE_SECURE=auto
COOKIE_SAMESITE=lax
EMAIL_CONFIG_ENCRYPTION_KEY=replace_with_64_hex_chars_or_base64_32_bytes
EMERGENCY_RESET_SECRET=replace_with_secure_random_value
ENABLE_CSRF=true
TRUST_PROXY_HOPS=1
MAX_BACKUP_UPLOAD_MB=1024
CORS_ORIGIN=http://10.96.133.181
PUBLIC_BASE_URL=http://10.96.133.197:5000
# Optional deep-link URL used in email templates:
# PUBLIC_APP_URL=http://10.96.133.181
# CLIENT_URL=http://10.96.133.181
SEED_DEFAULTS=false
```

If HTTPS is configured at Web tier, set:

```env
CORS_ORIGIN=https://10.96.133.181
```

Important: `CORS_ORIGIN` must exactly match the URL users open in browser.

### Default Login Accounts

When `SEED_DEFAULTS=true` (recommended only for first bootstrap), backend startup ensures these users exist with these credentials:

- `superadmin@expo.com` / `superadmin123`
- `scy@expo.com` / `admin123`
- `it@expo.com` / `admin123`
- `noc@expo.com` / `admin123`

This is idempotent and safe across restarts, as long as MongoDB data persists. After first bootstrap, set `SEED_DEFAULTS=false` for production operation.

Run backend:

```bash
cd /path/to/Expo/server
npm ci
npm run dev
```

Optional PM2:

```bash
sudo npm i -g pm2
pm2 start server.js --name expo-app
pm2 save
```

## DB VM Setup (`10.96.133.213`)

- Install MongoDB and keep it running.
- Allow inbound `27017` only from `10.96.133.197`.
- Deny other source networks.

## Web VM Setup (`10.96.133.181`)

Build frontend:

```bash
cd /path/to/Expo/client
npm ci
npm run build
```

Use repo `nginx.conf` (keep in sync with `nginx.docker.conf` behavior):
- serves frontend static files
- proxies `/healthz` and `/readyz` to the app (same as API server paths)
- proxies `/api/*` and `/uploads/*` to App API upstream
- for `deploy-web-safe.sh`, set upstream at runtime with `APP_UPSTREAM=10.96.133.197:5000` (default health check uses `http://127.0.0.1/healthz` after nginx reload)

Access URL:
- `http://10.96.133.181`

## Verification

From Web VM:

```bash
curl -I http://10.96.133.197:5000/api/healthz
```

From App VM:

```bash
nc -zv 10.96.133.213 27017
```

From browser:
- open `http://10.96.133.181`
- do not use `localhost` or domain URL for production access

From Web VM, validate App API path:

```bash
curl -I http://10.96.133.197:5000/api/healthz
```

Credential verification checklist:

```bash
# On App VM
curl -sS http://127.0.0.1:5000/api/healthz
```

- Login test in browser for:
  - `superadmin@expo.com` / `superadmin123`
  - `scy@expo.com` / `admin123`
  - `it@expo.com` / `admin123`
  - `noc@expo.com` / `admin123`

Restart persistence test:

```bash
# App VM
pm2 restart expo-app
curl -sS http://127.0.0.1:5000/api/healthz
```

Then re-test the same logins to confirm persisted availability.

## Troubleshooting

- CORS error: ensure `CORS_ORIGIN=http://10.96.133.181`.
- 502 from Nginx: backend not reachable at `10.96.133.197:5000`.
- Login failed: verify MongoDB service, firewall rules, and `MONGO_URI`.
- Deployment dependency errors: run preflight script:

```bash
ROLE=app ./scripts/check-deploy-readiness.sh
ROLE=web APP_IP=10.96.133.197 APP_PORT=5000 ./scripts/check-deploy-readiness.sh
ROLE=db ./scripts/check-deploy-readiness.sh
```

## One-Shot Rollback-Safe Updates

These scripts let you deploy with a single command and automatic rollback on failure.

### App VM script

File: `scripts/deploy-app-safe.sh`

Run:

```bash
cd /opt/Expo
APP_DIR=/opt/Expo SERVICE_NAME=expo-app HEALTH_URL=http://127.0.0.1:5000/api/healthz ./scripts/deploy-app-safe.sh
```

What it does:
- takes a full backup of current app directory
- pulls latest git changes
- installs dependencies
- restarts PM2 service
- checks `/api/healthz`
- auto-restores previous state if any step fails

### Web VM script

File: `scripts/deploy-web-safe.sh`

Run:

```bash
cd /opt/Expo
APP_DIR=/opt/Expo WEB_ROOT=/var/www/expo/client NGINX_SITE=/etc/nginx/sites-available/expo HEALTH_URL=http://127.0.0.1/healthz ./scripts/deploy-web-safe.sh
```

What it does:
- backs up deployed `dist` and nginx site config
- pulls latest git changes
- builds frontend
- swaps deployed files atomically
- validates and reloads nginx
- checks **`/healthz`** through nginx (default `HEALTH_URL`; confirms API reachability, not only static `index.html`)
- auto-restores previous dist + nginx config on failure
