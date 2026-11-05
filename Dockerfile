FROM node:22-slim

WORKDIR /app

# Backend (Node, no npm dependencies: uses built-in node:sqlite + zlib)
COPY server/package.json ./server/package.json
COPY server/*.js ./server/
COPY server/public ./server/public

# Web app (the UI, served at /) + sample files + screenshots
COPY web-app/dist/index.html ./web-app/dist/index.html
COPY web-app/samples ./web-app/samples
COPY web-app/docs/screenshots ./web-app/docs/screenshots

RUN mkdir -p /data/backups

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIR=/app/web-app \
    TZ=Asia/Ho_Chi_Minh

# Persistent storage: SQLite database (/data/study_planner.sqlite) + automatic backups (/data/backups)
VOLUME /data

# Internal port 3000 (Coolify/Traefik routes traffic here without binding host ports)
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
