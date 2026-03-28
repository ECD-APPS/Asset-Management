FROM node:20-bookworm-slim AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --prefer-offline

FROM node:20-bookworm-slim
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app/server
# mongodump/mongorestore for scheduled backups and pre-deploy artifacts (matches backupRecovery.js)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor \
  && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-database-tools \
  && apt-get purge -y curl gnupg \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 appuser \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
# Ensure runtime directories exist and are writable
RUN mkdir -p /app/server/uploads /app/server/backups /app/server/storage/backups /app/server/storage/tmp /app/server/storage/immutable-backups \
  && chown -R appuser:appuser /app
USER appuser
EXPOSE 5000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=10 CMD node -e "require('http').get('http://127.0.0.1:5000/api/healthz', (r)=>process.exit(r.statusCode===200?0:1)).on('error', ()=>process.exit(1));"
CMD ["node", "server.js"]
