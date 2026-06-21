# Perpetuum Nota

A self-hosted, dockerized notes app (Evernote / Obsidian-style). Rich-text notes
with formatting, lists, checklists, code, LaTeX math, clickable URLs, `[[note]]`
cross-links, and pasteable resizable inline images. Organize with tags, folders,
pins, due dates and a sidebar calendar; browse as a list, a spatial wall, or a
link graph. Multi-user with per-note privacy/sharing, full-text search, and a
trash with 30-day retention. See [PLAN.md](PLAN.md) for the full design and
[REVIEW.md](REVIEW.md) for the hardening history.

## Features
- **Editor:** bold/italic/underline/strike, H1/H2, bulleted/numbered lists,
  checklists, inline code + fenced code blocks (syntax-highlighted), blockquotes,
  LaTeX math (KaTeX, self-hosted), text color & size. Safe auto-linking plus
  markdown `[title](url)` links and `[[note title]]` cross-links (with a backlink
  list). Paste/drop images (resizable, draggable) and autosave with conflict
  detection (409 + resolve banner). A minimizable table-of-contents nav bar,
  toggleable fullscreen, and export to Markdown or HTML from a single split
  button. Open many notes at once — tabs in List mode, floating windows on the Wall.
- **Organization:** full-text search (Postgres FTS); tags (create-on-use,
  autocomplete, deterministic per-tag colors, sidebar filter); folders (tree with
  subfolders, one folder per note); pins (with a pinned-only filter); due dates
  (emphasized when near, struck when past) with a sidebar calendar that filters by
  a day or a Shift+Click range. Sort by custom order / last edited / created /
  title; right-click context menu; collapsible sidebar; multi-select with batch
  trash / pin / unpin / move-to-folder. Three ways to browse:
  - **List** — two-pane with drag reorder (pinned notes always sort first).
  - **Wall** — a spatial grid: an almost-invisible grid that shows only small
    crosses at line intersections; notes snap to the grid, their footprint
    fills up to the nearest grid line, and they can be dragged anywhere on the
    grid (positions persist per note; never-placed notes auto-flow). Folders
    appear as cards; double-click opens one in a floating mini-grid window.
  - **Graph** — an Obsidian-style view of notes as nodes and their `[[links]]`
    as edges; hovering a node highlights its connections.
- **Sharing:** PRIVATE / PUBLIC (= any logged-in user) + per-user view grants;
  "Shared with me" view with an unseen badge; permission-checked image serving.
- **Safety:** trash with restore + 30-day auto-purge, orphaned image sweeps,
  per-note author / last-editor / last-edited attribution, self-service password
  change, last-admin lockout guard, break-glass admin reset, admin user management
  (create, enable/disable, rename, password reset, deletion with full data
  cleanup), documented backups ([BACKUP.md](BACKUP.md)).
- **UI:** Angular Material (M3) throughout, light + dark themes (toggle in the
  header, persisted, defaults to the OS preference), responsive with a mobile
  drawer, fully self-hosted fonts and icons (no CDN).
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

## Deploy to a NAS (production)
Build the images multi-arch, push them to the self-hosted Zot registry on the NAS,
and run from prebuilt (cosign-signed) images with `docker-compose.prod.yml`. Full
runbook — push, secrets, first run, backups, updates — is in [DEPLOY.md](DEPLOY.md).

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
on first boot; the admin creates other users, can disable/enable them, rename
them, reset their passwords, and can permanently delete a user together with all
their notes and images. Forgot the
admin password? See the break-glass procedure in [BACKUP.md](BACKUP.md). The
last active admin can never be deactivated, demoted, or deleted, and admins
cannot delete their own account.
