# Production image. Migrations are NOT run here; CI runs `prisma migrate deploy` before triggering a deploy.

# 1. Build: full install (dev deps, Prisma CLI), generate the client and compile to dist/.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run build

# 2. Runtime dependencies only. The Prisma CLI and TypeScript are optional peers of @prisma/client
#    ("devOptional" in the lockfile), so --omit=dev alone keeps them; --omit=optional drops them.
#    The only prod-optional package is pg-cloudflare (Cloudflare Workers), which we don't use.
#    The generated Prisma client is already compiled into dist/.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

# 3. Runtime: patched OS packages, no package managers (npm/yarn/corepack are never used at runtime).
FROM node:24-alpine
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
