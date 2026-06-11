# Task Plan — Review, Fix & Evernote-ify Sticky Notes

## Goal
Per user request: (1) read docs/plan/todo, (2) review the repository, (3) fix bugs found or
predicted, (4) review/correct architecture, (5) implement missing planned features
(REVIEW.md PR 2 + PR 3) and Evernote-parity features (search, tags/pins, etc.).

## Context
- Repo: `W:\stickynotes` — Angular 21 + TipTap 3 frontend, NestJS 11 + Prisma 6.19 + Postgres 16 backend, nginx single-URL Docker front door.
- MVP complete (PLAN.md), PR 1 trust-hardening done (REVIEW.md).
- Outstanding per REVIEW.md: **PR 2** (access-matrix e2e, admin recovery, password change, autosave 409, backups doc), **PR 3** (shared-with-me view, trash/soft-delete, mobile pass).
- TODO.md (NAS deploy) is blocked on user hardware decisions — out of scope this session, except generic prep that needs no decisions.
- Repo was NOT a git repository — initialize one for diff safety before changes.

## Phases

### Phase 1: Read documentation — Status: complete
- [x] README.md, PLAN.md, TODO.md, REVIEW.md read. Key facts in findings.md.

### Phase 2: Full code review — Status: complete
- [x] All backend/frontend/shared/infra reviewed; findings F1–F10 in findings.md

### Phase 3: Fix bugs found in review — Status: complete
- [x] F1 non-owner editable editor (manager [editable] + title disable + floating-image drag guard)
- [x] F2 last-admin lockout guard (users.service 409)
- [x] F3 atomic optimistic concurrency + 400 for non-doc + client sends base + 409 UI
- [x] F4 CSRF cookie secure flag per-request (csrf-csrf v4 cookieOptions merge)
- [x] F5 JWT_SECRET fail-fast in prod (main.ts)
- [x] F6 flush on visibilitychange/pagehide
- [x] F7 saveError signal + status surface
- [x] F8 Invite model: left in schema, documented as unused (admin-direct creation)
- [x] F9 false alarm (PowerShell console encoding)
- [x] F10 access-matrix e2e suite added (32 tests)

### Phase 4: Architecture review — Status: complete
- [x] Git init + baseline commit 9a31d9a
- [x] Tags as own module; maintenance module for sweeps; uploads exports service
- [x] Preview derived from write-time contentText (no per-read JSON walks)
- [x] Shared DTOs updated in lockstep

### Phase 5: PR 2 — data safety — Status: complete (docs pending in Phase 8)
- [x] Access-matrix e2e (notes+images IDOR, trash, revocation, 409, last-admin, pw change)
- [x] ADMIN_FORCE_PASSWORD_RESET break-glass in bootstrap
- [x] POST /api/auth/change-password + dialog UI (throttled 5/min)
- [x] Autosave 409 end-to-end (atomic updateMany + client base + conflict banner)
- [ ] BACKUP.md (pg_dump + uploads snapshot + cron sample) — Phase 8

### Phase 6: PR 3 — sharing UX + trash — Status: complete
- [x] Shared-with-me sidebar view + NoteShare.seenAt unseen badge (open marks seen)
- [x] Trash: soft delete/restore/permanent/empty + 30d purge sweep + unreferenced-asset (7d) + orphan-file (24h) sweeps
- [x] Mobile: off-canvas sidebar <900px, single-pane editor <768px, larger touch targets

### Phase 7: Evernote-parity features — Status: complete
- [x] Full-text search (contentText + GIN websearch + ILIKE; debounced search box)
- [x] Tags (Tag/NoteTag, create-on-use, case-insensitive dedupe, auto-prune; chips + sidebar filter + editor tag input)
- [x] Pinned notes (pinned-first in all sorts)
- [x] Sort options (custom/edited/created/title, persisted)
- [x] Task lists (checkboxes) + strikethrough buttons
- [x] Note duplication (copies image files, resets PRIVATE)
- [x] Export note as standalone HTML (client-side)

### Phase 8: Verification + docs — Status: complete
- [x] Backend: tsc clean; 18 unit + 32 e2e green (re-verified against a from-zero migrated DB)
- [x] Frontend: build green; 7/7 vitest green (fixed @angular/compiler hoisting + stale scaffold spec)
- [x] Docker stack golden path via Playwright — login, create, type, task list, tag (chip+
      sidebar+count), pin, FTS search by body text, trash→restore (tag count 0→1),
      share→Maya badge "1"→"New" chip→read-only editor→badge clears on open,
      conflict: second-window PATCH → typing → 409 banner → "Load latest" applies server copy,
      export downloads real HTML file, wall view screenshot, password dialog, last-admin
      Disable → 409 (now surfaced in UI)
- [x] BACKUP.md + README/PLAN/REVIEW/TODO updates + .env CSRF_SECRET + compose healthcheck
- [x] Live-verification bugs fixed: cross-account OpenNotesStore cache (B11), api healthcheck
      localhost→127.0.0.1 (Alpine ::1), dev/prod compose project-name collision

## Final state (2026-06-11)
- Commits: 9a31d9a (baseline) → 046056f (backend) → 065531c (frontend) → 5ca0478 (fixes+docs)
- Both stacks coexist: prod on :8080 (left running), dev Postgres on :5432 (project stickynotes-dev)
- All REVIEW.md PR 2 + PR 3 items closed; Evernote-parity features shipped
- Remaining (user-blocked): TODO.md NAS deployment decisions (arch, delivery, storage, TLS)

## Key decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Scope of TODO.md NAS items | Skip (blocked on user decisions) | CPU arch / registry / storage paths unknown |
| Search impl | contentText column + Postgres FTS | No new infra (no ES), works on NAS Postgres |
| Tags vs notebooks | Tags only | Evernote's own direction; notebooks≈tag filter; less schema |
| Share discovery | seenAt on NoteShare + badge | Cheap, no notification infra |
| Git | init + baseline commit before changes | Diff safety, reviewability |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
