# Workspace-aware multi-stage build for @fredy/agent.
# Build context MUST be the repo root (see docker-compose.yml).

# Stage 1: install all workspace deps
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/common/package.json ./packages/common/
COPY services/agent/package.json ./services/agent/
COPY services/rag/package.json ./services/rag/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: build common + agent
FROM deps AS build
COPY packages/common ./packages/common
COPY services/agent ./services/agent
RUN pnpm --filter @fredy/common build \
 && pnpm --filter @fredy/agent build

# Stage 3: produce a self-contained production bundle via pnpm deploy
FROM build AS deploy
RUN pnpm --filter @fredy/agent --prod --legacy --ignore-scripts deploy /app

# Stage 4: minimal runtime image
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deploy /app /app
EXPOSE 8001
ENTRYPOINT ["node", "dist/main.js"]
