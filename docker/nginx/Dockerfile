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
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
# Angular application builder emits browser assets under dist/frontend/browser
COPY --from=build /app/frontend/dist/frontend/browser /usr/share/nginx/html
