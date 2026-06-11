# Build context = repo root (so the shared/ workspace is reachable).
# ---------- build (deps, generate client, compile) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared ./shared
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY backend ./backend
# prisma CLI + @prisma/client live under backend/node_modules, so run from there.
RUN cd backend && npx prisma generate && cd .. && npm run build --workspace backend

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copy both node_modules trees: root (hoisted nest/etc.) + backend
# (prisma CLI, @prisma/client, generated client, .bin).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
EXPOSE 3000
# Apply migrations, then start. BootstrapService seeds the admin on boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
