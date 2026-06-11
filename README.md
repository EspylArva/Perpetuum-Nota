# Sticky Notes

A self-hosted, dockerized notes app (Evernote-style). Rich-text notes with
formatting, lists, checklists, clickable URLs, and pasteable resizable inline
images. Multi-user with per-note privacy/sharing, full-text search, tags, pins,
and a trash with 30-day retention. See [PLAN.md](PLAN.md) for the full design
and [REVIEW.md](REVIEW.md) for the hardening history.

## Features
- **Editor:** bold/italic/underline/strike, H1/H2, bulleted/numbered lists,
  checklists, safe auto-linking, paste/drop images (resizable, draggable),
  autosave with conflict detection (409 + resolve banner), export as HTML.
- **Organization:** full-text search (Postgres FTS), tags (create-on-use,
  sidebar filter), pinned notes, sort by custom order / last edited / created /
  title, list + masonry wall views, drag reorder, multi-select.
- **Sharing:** PRIVATE / PUBLIC (= any logged-in user) + per-user view grants;
  "Shared with me" view with an unseen badge; permission-checked image serving.
- **Safety:** trash with restore + 30-day auto-purge, orphaned image sweeps,
  self-service password change, last-admin lockout guard, break-glass admin
  reset, documented backups ([BACKUP.md](BACKUP.md)).
- **Security:** argon2 + JWT httpOnly cookie, CSRF double-submit, rate
  limiting, helmet, URL-scheme allowlist, per-request account re-validation.

## Stack
- **Frontend:** Angular + TipTap (`ngx-tiptap`, TipTap 3 / ProseMirror)
- **Backend:** NestJS + Prisma + PostgreSQL
- **Infra:** Docker Compose behind an nginx single-URL front door

## Layout
```
backend/    NestJS API (auth, notes, tags, sharing, uploads, maintenance)
frontend/   Angular SPA (decoupled editor + note manager)
shared/     Shared TypeScript types (DTOs, ProseMirror doc shape, enums)
docker/     nginx config + front-door image (also builds the SPA)
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

## Tests
```bash
npm run test:backend                  # unit (access predicate, text extraction)
npm run test:e2e --workspace backend  # access-matrix e2e (needs the dev Postgres)
npm test --workspace frontend         # frontend unit (vitest)
```
The e2e suite migrates and runs in an isolated `e2e` schema of the dev database.

## Accounts
No open signup. An admin is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
on first boot; the admin creates other users. Forgot the admin password? See
the break-glass procedure in [BACKUP.md](BACKUP.md). The last active admin can
never be deactivated or demoted.
