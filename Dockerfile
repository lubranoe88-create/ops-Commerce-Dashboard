FROM node:22-bookworm-slim

WORKDIR /app

# System deps for Playwright Chromium + Python worker
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ca-certificates curl fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./backend/
# Skip postinstall during npm ci — we install runtime explicitly below
RUN cd backend && npm ci --omit=dev --ignore-scripts

COPY backend ./backend
COPY public ./public

WORKDIR /app/backend
RUN bash scripts/install-browser-use-runtime.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV MEMORY_DB_PATH=/data/memory.sqlite
ENV BROWSER_USE_ENABLED=true
ENV PLAYWRIGHT_BROWSERS_PATH=/app/backend/.browser-use-runtime/ms-playwright
ENV BROWSER_USE_ALLOW_ORIGIN=https://ops-commerce-dashboard.onrender.com

RUN mkdir -p /data

EXPOSE 8787

CMD ["node", "src/server.js"]
