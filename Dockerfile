FROM node:22-slim

WORKDIR /app

# Copy application files from legacy-server-prototype
COPY legacy-server-prototype/package.json ./
COPY legacy-server-prototype/migrations ./migrations
COPY legacy-server-prototype/server ./server
COPY legacy-server-prototype/public ./public

# Archive legacy prototype at /legacy.html
RUN mv ./public/index.html ./public/legacy.html

# Serve the true client app (web-app) as the main root index.html
COPY web-app/dist/index.html ./public/index.html
COPY web-app/dist/index.html ./public/web-app.html

# Copy sample files so users can download or test import
COPY web-app/samples ./public/samples

# Copy screenshots for reference
COPY web-app/docs/screenshots ./public/screenshots

# Ensure Content-Security-Policy allows web-app's inline scripts and fonts
RUN sed -i "s/script-src 'self'/script-src 'self' 'unsafe-inline'/g" ./server/app.js && \
    sed -i "s/style-src 'self' 'unsafe-inline'/style-src 'self' 'unsafe-inline' https:\/\/fonts.googleapis.com/g" ./server/app.js && \
    sed -i "s/default-src 'self'/default-src 'self' data: blob: https:\/\/fonts.googleapis.com https:\/\/fonts.gstatic.com/g" ./server/app.js

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
