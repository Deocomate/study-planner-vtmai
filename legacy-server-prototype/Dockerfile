FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY migrations ./migrations
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
