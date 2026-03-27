FROM node:22-alpine AS builder
WORKDIR /app
COPY api/package.json api/package-lock.json ./
COPY api/prisma ./prisma
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
COPY chains.json /chains.json
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /chains.json /chains.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
