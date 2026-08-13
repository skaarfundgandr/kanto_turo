FROM oven/bun:1.3.14 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
ENV SVELTEKIT_ADAPTER=node
RUN bun run build

FROM oven/bun:1.3.14 AS production-dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app
COPY --chown=node:node --from=build /app/build ./build
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json ./

USER node

EXPOSE 3000

CMD ["node", "build"]
