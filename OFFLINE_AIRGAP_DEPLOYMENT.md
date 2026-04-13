# Air-gapped / no-internet deployment (step-by-step)

Use this when the **machine that runs Expo Stores never reaches the public internet** (or only your private LAN). The app, MongoDB, and **local USB-style backups** (`mongodump`) can all work without cloud services.

You need **one internet-connected “build machine” once** (or periodic updates) to download dependencies and produce an artifact bundle. The **runtime server** stays offline.

---

## Overview

| Phase | Where | What you do |
|-------|--------|----------------|
| **A** | Connected PC | Install deps, build client, optional `mongodump` tools package, create secrets, bundle folder or tarball |
| **B** | Offline server | Install Node 20 + MongoDB from **local** packages (or copy portable binaries), copy bundle, configure `server/.env`, start services |

---

## Phase A — On a machine **with** internet (prepare the bundle)

Do this in your repo clone.

### A1. Install dependencies and build the web UI

```bash
cd /path/to/Expo
npm run install:all
npm run build --prefix client
```

This produces **`client/dist/`** (static files the API can serve in production).

### A2. (Recommended) Production-style API + built UI test

```bash
NODE_ENV=production npm run start:prod
```

Confirm `http://127.0.0.1:5000/api/healthz` (adjust port if you set `PORT`). Stop the server after the check.

### A3. Install MongoDB Database Tools (for USB backups on the offline box)

On the **same OS family** as the offline server (e.g. both Ubuntu 22.04), install **MongoDB Database Tools** so `mongodump` exists. On the offline server you will install the **same .deb/.rpm** files (see Phase B).

### A4. Create `server/.env` for the **offline** host (template)

On the connected machine, copy and edit so it is **ready for the offline IP/hostname** (no `localhost` unless browsers also run on the same PC):

- **`MONGO_URI`** / **`LOCAL_FALLBACK_MONGO_URI`** — use the **offline** Mongo listen address (often `mongodb://127.0.0.1:27017/expo` if Mongo is local).
- **`CORS_ORIGIN`** — must **exactly** match how users open the app, e.g. `http://192.168.1.10:3000` or `http://intranet-app:5000` (scheme + host + port).
- **`PUBLIC_BASE_URL`** — base URL of the API as seen by browsers on the LAN.
- **`COOKIE_SECRET`**, **`EMAIL_CONFIG_ENCRYPTION_KEY`**, **`EMERGENCY_RESET_SECRET`** — strong random values; **do not commit** this file to git.
- **`NODE_ENV=production`** for a hardened offline server.
- **`ENABLE_LOCAL_MONGODUMP=true`** so Super Admins can create **local `.archive.gz`** backups without PBM cloud storage.
- Leave **`PBM_MONGODB_URI`** unset if you only use **local mongodump** backups; PBM is optional in an air-gap unless you deliberately deploy it on the LAN.

Keep this file **private**; you will copy it to the offline server (USB, sneakernet, etc.).

### A5. Pack everything to move offline

From the repo root, create an archive **excluding** huge or machine-specific junk if you want a smaller bundle (example):

```bash
tar --exclude='./.git' \
    --exclude='./client/node_modules/.cache' \
    -czvf expo-offline-bundle.tgz .
```

Or copy the whole project folder via USB. **Minimum** to run offline after `npm install` on the connected side:

- `server/` (including `node_modules/`)
- `client/dist/` (built UI)
- `client/package.json` + lockfile only if you do not ship `client/node_modules` (simplest is to **include** `client/node_modules` from Phase A so the offline box does not need `npm install` for the client in prod static mode)

**Simplest reliable approach:** after `npm run install:all` and `npm run build --prefix client`, tar the **entire repo** including both `server/node_modules` and `client/node_modules` plus `client/dist`.

Also copy **MongoDB server** installer packages and **Database Tools** packages for the offline OS.

---

## Phase B — On the **offline** server

### B1. Install Node.js **20.x** without internet

Use OS packages copied from Phase A, or install Node from an **internal** package mirror. The repo expects **Node >=20 &lt;21** (`package.json` / `engines`).

Verify:

```bash
node -v   # should print v20.x.x
```

### B2. Install and start MongoDB (offline)

Install from the **.deb / .rpm / msi** files you copied. Start the service (`mongod` / `mongodb` depending on distro).

Verify:

```bash
# If mongosh is installed locally:
mongosh --eval 'db.runCommand({ ping: 1 })'
```

Create the database name used in `MONGO_URI` (e.g. `expo`) on first run if empty; the app can create collections on first use.

### B3. Copy the application bundle

Extract your tarball (or copy the folder) to e.g. `/opt/expo`. Place **`server/.env`** you prepared in Phase A at **`/opt/expo/server/.env`**.

### B4. Final `server/.env` checks on the offline box

- Paths in env are valid on **this** host.
- **`CORS_ORIGIN`** matches the browser URL users type (LAN hostname/IP + port).
- If users only use **HTTPS** on the LAN, set **`COOKIE_SECURE`** appropriately (often `true` when always HTTPS).
- **`ENABLE_LOCAL_MONGODUMP=true`** if you want Portal **“Create local full backup (USB)”**.
- Install **`mongodump`** on the PATH (or set **`MONGODUMP_PATH`** in `server/.env`).

### B5. Run the application (production-style, no Vite)

From the app root:

```bash
cd /opt/expo
export NODE_ENV=production
node server/server.js
```

Or use **systemd** / **pm2** with the same command and `WorkingDirectory=/opt/expo/server` or run `node server/server.js` from repo root per your layout.

The server serves **`client/dist`** when `NODE_ENV=production` (see `server/server.js`). Users open the URL that matches **`CORS_ORIGIN`** and **`PUBLIC_BASE_URL`**.

### B6. Smoke test (all local)

From a workstation on the **same LAN** (still no internet required):

- Open the app URL in the browser.
- Log in.
- **Portal → Database maintenance** → **Create local full backup (USB)** → **Download** → copy file to USB.

---

## What does **not** need the internet

- MongoDB + this Node API + static web from `client/dist`
- Cookie login, CSRF (same-origin / LAN)
- **Local mongodump** backups and downloads
- Optional: PBM **if** storage and agents are **only** on your LAN (advanced; not required for USB backups)

## What **does** need internet (or an internal substitute)

- **`npm install` / `npm ci`** on the offline server unless you shipped full `node_modules` from Phase A
- **Email** (SMTP) to the public internet — disable or point SMTP to an **internal** mail relay
- **Pulling Docker base images** — use `docker load` from an image tarball prepared online
- **Percona `apt` repositories** on the offline server — use `.deb` files copied from a connected machine

---

## Optional: updates without internet

1. Repeat **Phase A** on a connected machine with a newer repo commit.
2. Replace `server/`, `client/dist/`, and optionally `node_modules` on the offline server during a maintenance window.
3. Run migrations/bootstrap as your release notes require; restart Node.

---

## Quick checklist before declaring “air-gap ready”

- [ ] Node 20 and MongoDB run on the offline host  
- [ ] `server/.env` present; `CORS_ORIGIN` matches browser URL  
- [ ] `curl -sS http://<api-host>:<port>/api/healthz` returns HTTP 200  
- [ ] Login works in the browser  
- [ ] Local backup creates a row and **Download** works  
- [ ] No critical feature depends on a public URL you did not replace  

For backup concepts only, see **`HOW_TO_BACKUP_DATABASE.md`**. For normal single-server install (not necessarily air-gap), see **`README_LOCAL.md`**.
