# Build context = repo root.
# ---------- build the Angular SPA ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY shared ./shared
COPY frontend ./frontend
RUN npm run build --workspace frontend

# ---------- nginx front door ----------
FROM nginx:alpine
LABEL org.opencontainers.image.description="Perpetuum Nota web — Angular SPA served by nginx (single public front door, proxies /api to the backend)." \
      org.opencontainers.image.source="https://github.com/EspylArva/Perpetuum-Nota"
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
# Angular application builder emits browser assets under dist/frontend/browser
COPY --from=build /app/frontend/dist/frontend/browser /usr/share/nginx/html
