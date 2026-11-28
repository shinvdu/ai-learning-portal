# API image for the AI Learning Portal v2 monorepo.
#
# Debian bookworm-slim (glibc) is required by the prebuilt @node-rs/argon2
# native addon; alpine/musl would need a different optional dependency.
#
# Layout note: the runtime image keeps the monorepo directory structure
# (`apps/api`, `packages/*`) because npm workspace links in node_modules
# (@portal/*) point at ../../apps/... and ../../packages/.., and because
# compiled code resolves data files relative to its own location:
#   - packages/db/dist/migrate.js -> ../drizzle
#   - packages/content/dist/lectures.js -> ../lectures
#   - apps/api/dist/seed/records.js -> ../../../../packages/db/fixtures

# ---------------------------------------------------------------------------
# Build stage: install all workspaces and compile every workspace.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app

# Install OS certificates first so npm/registry traffic validates over TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Manifests only, so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/content/package.json ./packages/content/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json

RUN npm ci

# Sources plus build configs. node_modules/dist/docs are excluded by
# .dockerignore, so this layer only carries source files.
COPY . .

# All workspaces (packages + apps/api + apps/web); the web build is unused here
# but keeps the build command identical to CI and validates the whole tree.
RUN npm run build

# Reinstall production dependencies in a clean stage.
#
# `npm prune --omit=dev` is unreliable in npm workspaces (it reports hoisted
# dev packages such as typescript/vite as "extraneous"), and a plain
# `npm ci --omit=dev` still pulls workspace devDependencies. Installing only
# the API-side workspaces keeps the runtime tree at ~50MB instead of ~200MB;
# these are exactly the packages reachable from @portal/api. npm still creates
# the @portal/* `link` symlinks for every workspace, and the links the API uses
# resolve because the packages/ directories are copied below.
FROM build AS prod-deps
RUN rm -rf node_modules \
 && npm ci --omit=dev \
      --workspace @portal/api \
      --workspace @portal/config \
      --workspace @portal/contracts \
      --workspace @portal/content \
      --workspace @portal/db \
      --workspace @portal/domain

# ---------------------------------------------------------------------------
# Runtime stage: production dependencies + compiled output only.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app

# ca-certificates for outbound HTTPS (mail webhook, future SMTP).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production-only tree; node_modules/@portal/* -> ../../packages/* links kept.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# API workspace (dist + manifest; the manifest carries "type": "module").
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Workspace packages: dist + manifest, plus the runtime data folders.
COPY --from=build /app/packages/config/package.json ./packages/config/package.json
COPY --from=build /app/packages/config/dist ./packages/config/dist

COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist

COPY --from=build /app/packages/content/package.json ./packages/content/package.json
COPY --from=build /app/packages/content/dist ./packages/content/dist
COPY --from=build /app/packages/content/lectures ./packages/content/lectures

COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/fixtures ./packages/db/fixtures

COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist

# The node:* base image ships a non-root `node` user (uid 1000).
USER node

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]