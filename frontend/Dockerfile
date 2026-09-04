FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── dev: usado pelo docker-compose local (vite dev server + hot reload) ──
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ── build: bundle de producao ──
FROM base AS builder
COPY . .
RUN npm run build

# ── production: nginx servindo o build estatico ──
FROM nginx:1.31-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
