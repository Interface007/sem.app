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

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app
COPY --from=build --chown=root:root /out ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
