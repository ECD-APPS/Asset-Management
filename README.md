# Expo Asset Management (MERN)

Production‑ready asset and store management system with session‑based authentication, Super Admin portal, branding customization, backup/restore, and first‑class Docker + GitHub Actions deployment.

## Highlights

- Asset lifecycle and inventory across multiple stores
- Admin and Technician portals (mobile‑friendly scanner via html5‑qrcode)
- Session‑based auth with role control (Super Admin, Admin, Technician)
- Super Admin Portal (/portal): seed stores, reset utilities, backup/restore
- Branding: upload a custom application logo and live favicon update
- Secure Express best‑practices (helmet, rate limits, mongo‑sanitize)
- One‑command production via Docker Compose
- GitHub Actions workflow for remote Docker deployments over SSH

## Monorepo Layout

- server/ — Express API, MongoDB models, routes, and static serving
- client/ — React app (Vite, Tailwind)
- Dockerfile, docker-compose.yml — Production build & run
- .github/workflows/deploy.yml — SSH deploy using Docker Compose

## Quick Start (Local Dev)

Prerequisites:
- Node.js 18+
- MongoDB running locally (or use docker-compose below)

Install and run:

```bash
# From project root
npm run install:all
npm run dev
```

This starts:
- API on http://localhost:5000
- Vite dev client on http://localhost:5173

Default data:
- On first run, the system seeds default stores and ensures a Super Admin exists.

## Environment Variables (server/.env)

Copy and adjust:

```bash
cp server/.env.example server/.env
```

Key variables:
- MONGO_URI=mongodb://127.0.0.1:27017/expo-stores
- PORT=5000
- NODE_ENV=development
- SESSION_MAX_AGE_MS=2592000000
- COOKIE_SECURE=false                  # true in production over HTTPS
- COOKIE_SECRET=<random_32_bytes>
- CORS_ORIGIN=http://localhost:5173    # Dev client origin
- SMTP_* (optional for emails)
- EMERGENCY_RESET_SECRET=emergency_unlock  # Dev only

## Production with Docker Compose

Build and run:

```bash
docker compose build
docker compose up -d
```

Services:
- web (Node 18): serves API on port 5000 and static client built from client/dist
- mongo (MongoDB 6): data persisted in a named volume

Ports:
- http://<host>:5000
- MongoDB available at 27017 (host) if you keep the port mapping

Logs and status:

```bash
docker compose ps
docker compose logs -f web
```

## CI/CD: GitHub Actions (Deploy via SSH + Docker Compose)

Workflow: `.github/workflows/deploy.yml`
- Trigger: push to `main` (or manual)
- Action: SSH to your server, clone/update the repo in `/srv/expo-asset`, ensure Docker/Compose is installed, then `docker compose build && docker compose up -d`

Repository secrets (Settings → Secrets and variables → Actions):
- `SSH_HOST` — server IP or hostname
- `SSH_USER` — deploy user (e.g., ubuntu)
- `SSH_PRIVATE_KEY` — private key (ed25519 or RSA) contents
- `SSH_PORT` — SSH port (e.g., 22)

Alternatively, you can use a password instead of a private key:
- `SSH_PASSWORD` — password for SSH_USER (leave SSH_PRIVATE_KEY empty)

Server prerequisites:
- Linux machine with SSH access
- Docker Engine and docker‑compose plugin (workflow installs them if missing on apt‑based distros)

Verification after a run:

```bash
ssh $SSH_USER@$SSH_HOST -p $SSH_PORT
cd /srv/expo-asset
docker compose ps
docker compose logs -f web
```

## Reverse Proxy (Nginx) for HTTPS

For Secure cookies and production CSRF, run behind HTTPS. A ready template is provided:

- scripts/deploy/nginx-expo-asset.conf

Steps (Ubuntu):
1. Install Nginx and Certbot.
2. Copy the template to `/etc/nginx/sites-available/expo-asset.conf`, replace your domain and cert paths.
3. Enable and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/expo-asset.conf /etc/nginx/sites-enabled/expo-asset.conf
   sudo nginx -t && sudo systemctl restart nginx
   ```
4. Obtain TLS certs with Certbot:
   ```bash
   sudo certbot --nginx -d your-domain.example.com
   ```

Express already runs with `trust proxy` so Secure cookies work behind Nginx.

## Branding: Custom Application Logo

- Super Admin page: http://<host>:5000/portal
- Under “Admin Utilities” → “Customize Application Logo”
- Accepts PNG/JPG/SVG up to 2 MB
- Stored at `/uploads/branding/...` and published through `/api/system/public-config`
- The client pulls the logo at startup and updates the favicon automatically
- Fallback is `/logo.svg` (client/public)

## Backup & Restore (Super Admin)

- Download backup (JSON): Portal → Admin Utilities → “Download Backup File”
- Restore from file: Portal → Admin Utilities → “Restore From Backup File”
- API endpoints (for automation):
  - `GET /api/system/backup-file` — download full JSON backup (Super Admin)
  - `POST /api/system/restore-from-file` — upload JSON to restore (Super Admin)

## Security Notes

- Set `COOKIE_SECURE=true` and serve over HTTPS in production
- CSRF protection can be enabled for production (middleware hook in server.js)
- Emergency reset route is disabled in production and gated by `EMERGENCY_RESET_SECRET` in non‑prod
- Sessions include a TTL index to auto‑expire in MongoDB

## Scripts Reference (root)

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "build": "cd server && npm install && cd ../client && npm install && npm run build",
    "install:all": "npm install && cd server && npm install && cd ../client && npm install",
    "build:prod": "npm ci --omit=dev && cd client && npm ci --omit=dev && npm run build",
    "start:prod": "NODE_ENV=production node server/server.js"
  }
}
```

## Tech Stack

- MongoDB, Mongoose
- Express (helmet, rate limit, sanitize)
- React (Vite, Tailwind)
- Multer, Sharp (image handling)
- Winston (logging)
- Docker, GitHub Actions
