# Sticky Notes

A self-hosted, dockerized sticky-notes app (Evernote-style). Rich-text notes with
formatting, lists, clickable URLs, and pasteable resizable inline images. Multi-user
with per-note privacy/sharing. See [PLAN.md](PLAN.md) for the full design.

## Stack
- **Frontend:** Angular + TipTap (`ngx-tiptap`, TipTap 3 / ProseMirror)
- **Backend:** NestJS + Prisma + PostgreSQL
- **Infra:** Docker Compose behind an nginx single-URL front door

## Layout
```
backend/    NestJS API (auth, notes, sharing, uploads)
frontend/   Angular SPA (decoupled editor + note manager)
shared/     Shared TypeScript types (DTOs, ProseMirror doc shape, enums)
docker/     nginx config + front-door image
```

## Run (Docker)
```bash
cp .env.example .env   # then edit secrets
docker compose up --build
```
The app is served on a single URL (default `http://localhost:8080`).

## Develop (native, recommended on Windows)
Run Postgres in Docker, the apps natively (faster reload than bind-mounts):
```bash
docker compose -f docker-compose.dev.yml up -d   # postgres only
npm install                                       # root workspaces
# backend
cd backend && npm run start:dev
# frontend (new terminal)
cd frontend && npm start
```

## Accounts
No open signup. An admin is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
on first boot; the admin creates/invites other users.
