FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:3000
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm i -g serve@14
COPY --from=builder /app/dist ./dist
EXPOSE 5173
CMD ["serve", "dist", "-l", "5173", "-s"]
