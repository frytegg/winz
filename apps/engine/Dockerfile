# syntax=docker/dockerfile:1
#
# Image of the engine (apps/engine). Built from the REPOSITORY ROOT as context, which is what
# Railway does with railway.json:
#
#   docker build -f apps/engine/Dockerfile -t winz-engine .
#
# The engine has no build step: it runs its TypeScript sources through tsx, as `pnpm start` does.
# Only the engine and the workspace packages it imports (@winz/shared, @winz/pricing) are installed,
# plus the root's dev tools, because tsx is declared there (see docs/deploy.md, "Moteur").
# The variables come from the platform at run time: the image holds no .env and no secret.

FROM node:22-bookworm-slim AS base
ENV CI=true \
    PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack
# corepack installs the pnpm version pinned by "packageManager" in the root package.json.
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Every package.json of the workspace, so that `--frozen-lockfile` checks the lockfile against the
# whole workspace, then the filter installs only what the engine needs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/engine/package.json apps/engine/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/pricing/package.json packages/pricing/
COPY packages/contracts/package.json packages/contracts/
# The optional secret "ca" is only for builds behind a TLS-intercepting proxy; Railway passes none.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    corepack install && \
    pnpm install --frozen-lockfile --filter "@winz/engine..." --filter "winz"

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    APP_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/apps/engine/node_modules ./apps/engine/node_modules
COPY --from=deps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps --chown=node:node /app/packages/pricing/node_modules ./packages/pricing/node_modules
COPY --chown=node:node package.json tsconfig.base.json ./
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node packages/pricing ./packages/pricing
COPY --chown=node:node apps/engine ./apps/engine
# Non-root: the image's own `node` user (uid 1000).
USER node
WORKDIR /app/apps/engine
# Exec form, no shell and no package manager in between: node is PID 1 and receives SIGTERM
# itself, so the engine's own stop runs (src/index.ts: 15 s grace, exit 0). `--import tsx`
# registers the TypeScript loader in this same process (the tsx CLI would fork a child).
CMD ["node", "--import", "tsx", "src/index.ts"]
