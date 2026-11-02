FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js db.js db-async.js db-postgres.js store.js social.js permissions.js catalog.js zones.json gear.json nidraven.html ./
ENV PORT=8080 STATIC_FILE=/app/nidraven.html DB_SCHEMA=nidraven_game
EXPOSE 8080
CMD ["node","--disable-warning=ExperimentalWarning","server.js"]
