FROM node:22-slim

WORKDIR /app

# Copy application files from legacy-server-prototype
COPY legacy-server-prototype/package.json ./
COPY legacy-server-prototype/migrations ./migrations
COPY legacy-server-prototype/server ./server
COPY legacy-server-prototype/public ./public

# Include the compiled standalone web-app artifact inside public
COPY web-app/dist/index.html ./public/web-app.html

# Ensure data directory exists
RUN mkdir -p /data/uploads

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Persistent storage for SQLite database & uploaded files
VOLUME /data

# Expose internal port 3000 (traefik/coolify routes traffic here without binding host ports)
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
