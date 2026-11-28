# Web image: Vite build of @portal/web served by Nginx.

# ---------------------------------------------------------------------------
# Build stage: install workspaces and build only the web app.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# npm ci validates every workspace listed in package-lock.json, so all
# workspace manifests must be present even though only apps/web is built.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/content/package.json ./packages/content/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json

RUN npm ci

COPY apps/web ./apps/web

RUN npm run build -w @portal/web

# ---------------------------------------------------------------------------
# Runtime stage: static files behind Nginx.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1