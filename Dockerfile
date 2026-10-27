FROM node:22-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV MEMORY_DB_PATH=/data/memory.sqlite

RUN mkdir -p /data

WORKDIR /app/backend
EXPOSE 8787

CMD ["node", "src/server.js"]
