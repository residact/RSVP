FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/index.js"]
