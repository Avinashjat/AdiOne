# =============================================================================
# AdiOne API — production image
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source. Prisma Client is generated in the build stage and copied across,
# because generating it at container start would make every restart slower and
# depend on the network.
# =============================================================================

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first: this layer is cached until package.json changes, so a
# code-only change rebuilds in seconds rather than re-installing everything.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies but keep the generated client.
RUN npm prune --omit=dev


FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# dumb-init makes PID 1 forward signals properly, so SIGTERM reaches Node and
# the graceful shutdown actually runs instead of the container being killed
# mid-transaction.
RUN apk add --no-cache dumb-init

# Never run as root.
RUN addgroup -g 1001 adione && adduser -u 1001 -G adione -s /bin/sh -D adione

COPY --from=build --chown=adione:adione /app/node_modules ./node_modules
COPY --from=build --chown=adione:adione /app/dist ./dist
COPY --from=build --chown=adione:adione /app/prisma ./prisma
COPY --chown=adione:adione package*.json ./

USER adione
EXPOSE 4000

# Readiness, not liveness: this checks the database and cache too, so an
# orchestrator stops routing traffic to an instance that cannot serve it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
