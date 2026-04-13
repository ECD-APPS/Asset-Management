# Deployment checklist (servers & client laptops)

Use this before go-live or when copying the project to a new machine. It complements **`README_LOCAL.md`** (single host), **`DEPLOY.md`** (Docker), and **`README.md`** (3-tier IP layout). For **AI-generated step-by-step deploy commands** (e.g. Google Gemini), use **`MASTER_GEMINI_INSTRUCTIONS_MINIMAL.md`** on one box or **`MASTER_GEMINI_INSTRUCTIONS.md`** for app/web/db VMs.

## 1) Machine requirements

- **Node.js 20.x** (repo `engines`: `>=20.0.0 <21` in root `package.json`).
- **npm** 9+ recommended.
- **MongoDB** reachable from the app host (local service or remote URI).

## 2) Verify the codebase builds

From the repository root:

```bash
npm run verify:release
```

**Default:** `npm install` in **`server/`** and **`client/`** (no root install), **Vite production build** (`client/`), **client ESLint**, and a quick **Node load** of key server route modules (from `server/` so dependencies resolve). This avoids root `npm ci` races on some laptops. If **`server/`** install errors with **ENOTEMPTY**, delete `server/node_modules` once and re-run **`npm run verify:release`**.

**Strict (CI-equivalent, lockfile-clean):** same command with `VERIFY_RELEASE_STRICT=1` — runs root `npm run build` (`npm ci` in `server/` and `client/`, then Vite build) plus client lint. Use this on a clean CI runner or when you want an exact “from scratch” install.

Fix any errors before deploying.

## 3) Environment files (do not commit secrets)

| File | Purpose |
|------|---------|
| `server/.env` | Backend: Mongo, cookies, CORS, optional SMTP, etc. |
| `server/.env.example` | Template — copy to `server/.env` and edit. |
| `client/.env` | **Optional** — only for Vite dev proxy (`VITE_API_HOST`, `VITE_API_PORT`). |
| `client/.env.example` | Dev proxy template. |
| `.env.docker` | Docker Compose — copy from `.env.docker.example` if using containers. |

**Backups (PBM):** For API and scheduled snapshots, set **`PBM_MONGODB_URI`** (see `.env.docker.example` / `server/.env.vm.example`) and run **Percona Backup for MongoDB** agents + storage on MongoDB as in [PBM initial setup](https://docs.percona.com/percona-backup-mongodb/install/initial-setup.html). The `app` Docker image includes the `pbm` CLI.

**Observability:** With **`ENABLE_METRICS`** (defaults to on in production, off in dev unless set), the API exposes **`GET /metrics`** in Prometheus format. Set **`METRICS_SCRAPE_TOKEN`** for Bearer / `X-Metrics-Token` / `?token=` scraping on untrusted networks. Super Admins can use the in-app **Platform health** page at **`/system-health`** (`GET /api/system/operations-status`).

Production builds of the client use **`axios` `baseURL: '/api'`** (same origin). Your reverse proxy or `server` static hosting must serve **`/api`** and **`/uploads`** to the Node API (see `README_LOCAL.md` §6 and `nginx.conf` / `nginx.docker.conf`).

## 4) Minimum `server/.env` sanity (production)

- **`NODE_ENV=production`**
- **`MONGO_URI`** — valid connection string; database exists or will be created.
- **`CORS_ORIGIN`** — must **exactly** match the browser URL users type (scheme + host + port), e.g. `https://app.example.com` or `http://10.0.0.5:3000`. Wrong value → login/API failures in the browser.
- **`COOKIE_SECRET`** — required in production; use a long random string (`openssl rand -hex 32`).
- **`EMAIL_CONFIG_ENCRYPTION_KEY`** / **`EMERGENCY_RESET_SECRET`** — set before first prod use (see `server/.env.example`).
- **`COOKIE_SECURE`** — use `auto` or `true` behind HTTPS; for plain HTTP lab installs you may need `false` (see `README_LOCAL.md` “Common fixes”).
- **`TRUST_PROXY_HOPS`** — if behind Nginx/load balancer, usually `1` (see `server/server.js`).
- **`JSON_BODY_LIMIT`** — optional; caps JSON upload size (defaults **5mb** in production, **10mb** in development).
- **`ENABLE_HSTS`** — set to **`true`** only when users always reach the app over HTTPS; leave unset/false for plain-HTTP or lab URLs.
- **`LOGIN_RATE_LIMIT_MAX`** — optional override for `POST /api/auth/login` throttling (defaults **60** in production per IP+login per 5 minutes).
- **`PBM_MONGODB_URI`** — PBM user connection string for **Percona Backup for MongoDB** (required for `POST /api/system/backups/*` and schedulers that call `pbm`). Optional: **`PBM_BACKUP_WAIT_TIME`**, **`PBM_CLI_PATH`**.

## 5) How to run in production (short)

| Scenario | Command / doc |
|----------|-----------------|
| Single process, built UI + API | `npm run build:prod` then `npm run start:prod:3000` → `README_LOCAL.md` |
| Dev on laptop | `npm run dev:local` or `npm run dev` (see `README_LOCAL.md`) |
| Docker stack | `DEPLOY.md` → `./deploy.sh safe-release` |

## 6) Smoke checks after deploy

```bash
curl -fsS http://127.0.0.1:5000/api/healthz
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/auth/me
```

Expect **200** on `healthz`; **`/api/auth/me`** is **401** without a session (normal).

Open the app in a browser, log in, and confirm **Tools / Spare Parts / Locations** load without console network errors.

## 7) If something fails — what to send with logs

When asking for help after deploy, include (redact passwords):

1. **OS** and **Node** / **npm** versions.
2. **How you start** the app (exact command).
3. **`server/.env` keys only** (not values): e.g. `NODE_ENV, PORT, CORS_ORIGIN, COOKIE_SECURE, TRUST_PROXY_HOPS` — and whether Mongo is local or remote.
4. **Browser URL** you open vs **`CORS_ORIGIN`** value.
5. **Server log** from startup through first failed request (stack trace).
6. **Browser DevTools → Network** for one failed API call (status, response body snippet).

## 8) Common pitfalls

| Symptom | Likely cause |
|---------|----------------|
| Login fails, CORS errors in console | `CORS_ORIGIN` does not match browser origin. |
| Session not sticking | `COOKIE_SECURE=true` over HTTP, or wrong domain/path; check `COOKIE_SAMESITE` / proxy. |
| 502 on `/api` | Nginx upstream wrong or API not listening on `PORT`. |
| Blank page after deploy | Old cached assets; hard refresh or clear site data. |
| Mongo connection refused | Firewall, bind address, or wrong `MONGO_URI`. |

## 9) Optional CI / regression

- `npm run check:regression` — lint + build + light route load (see `scripts/regression-checklist.sh`).
- `npm run check:smoke` — API smoke script when dev server is up.
