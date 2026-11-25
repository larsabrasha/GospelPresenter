# The server on its own, with the web app beside it, for a church's own machine (docs/self-hosting.md). Built from the
# repository's root: docker build -f apps/server/Dockerfile --build-arg GP_COMMIT=$(git rev-parse HEAD) -t gospelpresenter .
#
# Two stages: the first installs and builds, the second holds only what runs. The server is one bundled file with no
# dependencies to install (build-node.mjs), and it uses Node's own SQLite, so the image needs Node's program and the C++
# library it links, on bare Alpine: no npm, yarn or corepack. Node itself is most of the image (2026-11-25: 128 MB of
# about 145; the server and the web app are 7 MB).
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/sync/package.json packages/sync/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @gp/web... --filter @gp/server...
COPY packages/core packages/core
COPY packages/sync packages/sync
COPY apps/web apps/web
COPY apps/server apps/server
# The version the app shows (its page and "Om appen"): the commit, which a build from a checkout passes in.
ARG GP_COMMIT=
ENV GP_COMMIT=$GP_COMMIT
RUN pnpm --filter @gp/web build && pnpm --filter @gp/server build:node

# The Alpine release node:*-alpine is built on, so the program finds the libraries it was linked against.
FROM alpine:3.24
RUN apk add --no-cache libstdc++ \
 && addgroup -S node && adduser -S -G node node \
 && mkdir /data && chown node:node /data
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /src/apps/server/dist/node-server.mjs ./
COPY --from=build /src/apps/web/dist ./web
# Everything a church has (its databases and files) is under /data: the one thing to keep and back up.
VOLUME /data
ENV NODE_ENV=production GP_DATA_DIR=/data PORT=8080
EXPOSE 8080
USER node
# Node's own SQLite still warns that it is experimental; the warning says nothing to the one running the server.
CMD ["node", "--disable-warning=ExperimentalWarning", "node-server.mjs"]
