# Mizan: the sync API and the web app in one container (DigitalOcean App Platform, see docs/SERVER.md).
# Build: docker build -t mizan .   Run: docker run -p 8787:8787 -e DATABASE_URL=... mizan

# 1. Build the web app.
FROM node:24-slim AS web
WORKDIR /app
# Build-time settings for the web app (App Platform passes BUILD_TIME variables as build arguments).
ARG VITE_SUPPORT_EMAIL
ARG VITE_OPERATOR_NAME
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

# 2. Run the API, serving the built app from dist/.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIR=dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY security-headers.ts ./
COPY --from=web /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.ts"]
