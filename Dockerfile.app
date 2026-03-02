FROM node:18-alpine AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

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
CMD ["node", "server.js"]
