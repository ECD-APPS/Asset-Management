# Deployment Runbook (2 Minutes)

This runbook covers first-time setup, regular deploys, and quick troubleshooting for the Expo stack.

Current app behavior this runbook assumes:
- Authentication is HTTP-only cookie based (no JWT tokens).
- Database backup/restore uses `mongodump`/`mongorestore` archive flow.

For **Gemini-style paste prompts** alongside Docker, see **`MASTER_GEMINI_INSTRUCTIONS_MINIMAL.md`** (single host) or **`MASTER_GEMINI_INSTRUCTIONS.md`** (3-tier VMs).

## Build verification (any host, including CI)

From a clean clone or before tagging a release:

```bash
npm run verify:release
```

Default: `npm install` in **server/** and **client/**, production **client** build, client lint, and a quick server route load. For a **lockfile-clean** build (like CI), run **`VERIFY_RELEASE_STRICT=1 npm run verify:release`**.

## Prerequisites

- Docker with Compose plugin installed (`docker compose version`; BuildKit enabled by default for faster image builds)
- Access to this repository on the deployment host
- Open ports:
  - `3000` for web
  - `5000` for API (optional if only web is exposed)
  - `27017` for MongoDB (optional; restrict in production if not needed externally)

## 1) First-Time Setup

From project root:

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` and set secure values:

- `COOKIE_SECRET`
- `EMAIL_CONFIG_ENCRYPTION_KEY`
- `EMERGENCY_RESET_SECRET`
- `MONGO_URI` (if using external Mongo instead of compose Mongo)

Guide selection:
- 3-tier deployment (Web/App/DB VMs): use `README_SERVER_INSTALL.md` and `README.md`.
- Single-server deployment: use `README_LOCAL.md`.

Recommended secret generation example:

```bash
openssl rand -hex 32
```

Generate and persist `EMAIL_CONFIG_ENCRYPTION_KEY` (Linux):

```bash
EMAIL_CONFIG_ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf '\nEMAIL_CONFIG_ENCRYPTION_KEY=%s\n' "$EMAIL_CONFIG_ENCRYPTION_KEY" >> .env.docker
```

Important:

- Set this key before first production start that uses SMTP settings.
- Keep this key stable across restarts/deploys, or stored SMTP passwords cannot be decrypted.
- If rotating this key, re-save SMTP settings after rotation.

## 2) Deploy (Recommended)

### Option A: One command script (Safe Release)

```bash
./deploy.sh safe-release
```

This runs prechecks, creates a pre-deploy `mongodump` backup artifact when the app container is already running, deploys, then verifies API + web health endpoints.

### Option B: Makefile

```bash
make safe-release-prod
```

## 3) Verify Health

Check containers:

```bash
./deploy.sh ps
```

Stream logs:

```bash
./deploy.sh logs
```

Health endpoints:

```bash
curl -f http://localhost:3000/ || echo "web unhealthy"
curl -f http://localhost:5000/api/healthz || echo "api unhealthy"
curl -f http://localhost:3000/api/healthz || echo "web→api proxy unhealthy"
curl -f http://localhost:3000/healthz || echo "web→app /healthz unhealthy"
```

Or run automated verification:

```bash
./deploy.sh verify
```

Optional Makefile alias (same as `./deploy.sh verify`):

```bash
make verify-resilience-prod
```

## 4) Regular Update Deployment

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
./deploy.sh safe-release
```

This rebuilds changed images and recreates services safely. Use `--ff-only` to avoid accidental merge commits on production hosts.

## 5) Common Operations

Restart services:

```bash
./deploy.sh restart
```

Stop stack:

```bash
./deploy.sh down
```

Build only:

```bash
./deploy.sh build
```

## 6) Quick Rollback (Git-based)

If latest deployment is bad:

```bash
./deploy.sh rollback-help
```

Then follow the printed commands (checkout previous good commit + safe release).

After rollback, create a hotfix branch and investigate before re-updating.

## 7) Troubleshooting

### Error: missing `.env.docker`

- Create it from `.env.docker.example`.

### Error: placeholder secrets detected

- Replace placeholder values in `.env.docker` (same patterns as `deploy.sh` / `make validate-prod`: `COOKIE_SECRET`, `EMAIL_CONFIG_ENCRYPTION_KEY`, `EMERGENCY_RESET_SECRET`, etc.).

### Web opens but API fails

- Check API health:
  - `curl http://localhost:5000/api/healthz`
- Check app logs:
  - `./deploy.sh logs`

### Mongo connection issues

- If using compose Mongo, ensure `mongo` service is healthy in `./deploy.sh ps`.
- If using external Mongo, verify `MONGO_URI` in `.env.docker`.

### Disk growth from logs

- Log rotation is enabled in compose.
- Prune unused images periodically:

```bash
docker image prune -f
```

## 8) Security Notes

- Never commit `.env.docker`.
- Use strong unique secrets per environment.
- Restrict public exposure of MongoDB port in production.
- Keep host OS and Docker engine updated.

---

For daily use, your team only needs:

```bash
git pull --ff-only origin main && ./deploy.sh safe-release
```
