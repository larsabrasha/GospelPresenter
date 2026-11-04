# The export from 1.x as an image to run beside the old app, on its compose network, with its .env
# (docs/import-from-1x.md). Built from rewrite/: docker build -f apps/legacy/Dockerfile -t gospelpresenter-legacy-export .
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/legacy/package.json apps/legacy/
RUN pnpm install --frozen-lockfile --prod --filter @gp/legacy...
COPY packages/core/src packages/core/src
COPY apps/legacy/src apps/legacy/src
# The zip is written where the container starts: mount the folder it should land in at /out.
WORKDIR /out
ENTRYPOINT ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "/app/apps/legacy/src/main.ts"]
