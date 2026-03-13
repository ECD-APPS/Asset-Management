FROM node:18-alpine AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --prefer-offline

FROM node:18-alpine
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app/server
RUN adduser -D -u 10001 appuser
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
# Ensure runtime directories exist and are writable
RUN mkdir -p /app/server/uploads /app/server/backups && chown -R appuser:appuser /app
USER appuser
EXPOSE 5000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=10 CMD node -e "require('http').get('http://127.0.0.1:5000/api/healthz', (r)=>process.exit(r.statusCode===200?0:1)).on('error', ()=>process.exit(1));"
CMD ["node", "server.js"]
