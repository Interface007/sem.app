# syntax=docker/dockerfile:1
# Build context: repository root.
#   docker build -f apps/server/Dockerfile --platform linux/amd64 -t sem-server .
# Target: Synology DS225+ (Intel Celeron J4125, no AVX) - see AGENTS.md.

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @sem/server...
COPY packages/contracts packages/contracts
COPY apps/server apps/server
RUN pnpm --filter @sem/server... build \
 && pnpm --filter @sem/server deploy --prod --legacy /out

FROM base AS mobile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @sem/mobile...
COPY packages/contracts packages/contracts
COPY apps/mobile apps/mobile
RUN pnpm --filter @sem/contracts build

FROM mobile AS web
RUN pnpm --filter @sem/mobile build

# Over-the-air update for the Android app (docs/updates.md). The build args
# must match the APK build (.github/workflows/android.yml), otherwise the
# runtime version (fingerprint) or the inlined server URL differ. Without
# EXPO_PUBLIC_SERVER_URL the folder stays empty and the server offers no update.
FROM mobile AS updates
ARG EXPO_PUBLIC_SERVER_URL=
ARG GIT_COMMIT=
WORKDIR /repo/apps/mobile
RUN pnpm exec tsx scripts/export-update.ts /repo/updates

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/Interface007/sem.app" \
      org.opencontainers.image.description="sem-server: API and web version of sem.app"
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_ROOT=/app/web \
    UPDATES_DIR=/app/updates \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app
COPY --from=build --chown=root:root /out ./
COPY --from=web --chown=root:root /repo/apps/mobile/dist ./web
COPY --from=updates --chown=root:root /repo/updates ./updates
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
