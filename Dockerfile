# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Native build tools for modules like bcrypt
RUN apk add --no-cache python3 make g++

# Copy workspace manifests for layer caching
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/mobi-parser/package.json ./packages/mobi-parser/
COPY packages/cbz-parser/package.json ./packages/cbz-parser/

# Install all deps; skip lifecycle scripts so 'prek install' doesn't fail
# without a .git directory, then rebuild native addons explicitly
RUN npm ci --ignore-scripts && npm rebuild --ignore-scripts

# Copy source
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages ./packages

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Build in dependency order: local packages first, then web and API
RUN npm run build --workspace=@litara/mobi-parser
RUN npm run build --workspace=@litara/cbz-parser
RUN npm run build --workspace=@litara/web
RUN npm run build --workspace=@litara/api

# Drop dev dependencies to slim the copied node_modules
RUN npm prune --omit=dev

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# libstdc++ is required to load native addons (e.g., bcrypt) on Alpine
RUN apk add --no-cache libstdc++

# Production node_modules (pruned)
COPY --from=builder /app/node_modules ./node_modules

# Compiled API
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Compiled mobi-parser — node_modules/@litara/mobi-parser is a symlink to
# ../../packages/mobi-parser, so the dist must exist in the production image
COPY --from=builder /app/packages/mobi-parser/dist ./packages/mobi-parser/dist
COPY packages/mobi-parser/package.json ./packages/mobi-parser/

# Compiled cbz-parser — same symlink pattern as mobi-parser
COPY --from=builder /app/packages/cbz-parser/dist ./packages/cbz-parser/dist
COPY packages/cbz-parser/package.json ./packages/cbz-parser/

# Prisma schema + migrations (needed for 'prisma migrate deploy' on startup)
COPY apps/api/prisma ./apps/api/prisma
# Prisma config — tells the CLI where to find the schema and datasource URL
COPY apps/api/prisma.config.ts ./apps/api/

# Built web SPA — served by NestJS ServeStaticModule
# The mobi-parser path alias pulls in files from ../../packages, so TypeScript
# infers rootDir as the monorepo root. nest build outputs to dist/apps/api/src/.
# At runtime __dirname is dist/apps/api/src/, so '../public' = dist/apps/api/public/.
COPY --from=builder /app/apps/web/dist ./apps/api/dist/apps/api/public

ENV LITARA_ROOT=/app
COPY --from=builder /app/package.json ./package.json

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/apps/api/src/main"]
