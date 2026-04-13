# Node 20.x matches package.json engines (>=20 <21). Rebuild after server/package-lock.json changes.
FROM node:20-bookworm-slim AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --prefer-offline

FROM node:20-bookworm-slim
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app/server
# Percona Backup for MongoDB CLI (pbm) — used by backupRecovery.js / backup_db.js (PBM_MONGODB_URI at runtime)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget gnupg2 lsb-release \
  && wget -qO /tmp/percona-release.deb https://repo.percona.com/apt/percona-release_latest.generic_all.deb \
  && dpkg -i /tmp/percona-release.deb \
  && rm -f /tmp/percona-release.deb \
  && percona-release enable pbm release \
  && apt-get update \
  && apt-get install -y --no-install-recommends percona-backup-mongodb \
  && apt-get purge -y wget \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 appuser \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY docker-entrypoint-app.sh /usr/local/bin/docker-entrypoint-app.sh
# Ensure runtime directories exist and are writable in the image layer (bind mounts use entrypoint)
RUN mkdir -p /app/server/uploads /app/server/backups /app/server/storage/backups /app/server/storage/backups/pbm /app/server/storage/tmp /app/server/storage/immutable-backups \
  && chown -R appuser:appuser /app \
  && chmod +x /usr/local/bin/docker-entrypoint-app.sh
EXPOSE 5000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=10 CMD node -e "require('http').get('http://127.0.0.1:5000/api/healthz', (r)=>process.exit(r.statusCode===200?0:1)).on('error', ()=>process.exit(1));"
ENTRYPOINT ["docker-entrypoint-app.sh"]
CMD ["node", "server.js"]
