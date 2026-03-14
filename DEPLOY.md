# Deployment Runbook (2 Minutes)

This runbook covers first-time setup, regular deploys, and quick troubleshooting for the Expo stack.

## Prerequisites

- Docker with Compose plugin installed (`docker compose version`)
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

- `JWT_SECRET`
- `COOKIE_SECRET`
- `EMERGENCY_RESET_SECRET`
- `MONGO_URI` (if using external Mongo instead of compose Mongo)

Recommended secret generation example:

```bash
openssl rand -hex 32
```

## 2) Deploy (Recommended)

### Option A: One command script (Safe Release)

```bash
./deploy.sh safe-release
```

This runs prechecks, creates pre-deploy backup + journal marker (if app is running), deploys, runs shadow-sync and backup verification checks, then verifies API + web health.

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
```

Or run automated verification:

```bash
./deploy.sh verify
```

Run resilience verification only:

```bash
make verify-resilience-prod
```

## 4) Regular Update Deployment

```bash
git pull
./deploy.sh safe-release
```

This rebuilds changed images and recreates services safely.

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

- Replace `replace_with_secure_random_value` in `.env.docker`.

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
git pull && ./deploy.sh safe-release
```
