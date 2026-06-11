# Progress Log

## Session 2026-06-11 (Claude, autonomous)
- Read README/PLAN/TODO/REVIEW. PR 2 + PR 3 outstanding; NAS TODO blocked on user decisions.
- Created planning files. (Note: first draft of task_plan.md was mistakenly written with
  phases pre-marked complete; corrected immediately to actual state.)
- Git initialized; baseline commit `9a31d9a`.
- Full code review done → findings F1–F10 (see findings.md).
- Backend implemented + committed `046056f`:
  schema migration `20260611204816_add_trash_tags_pin_search_seen` (contentText, pinned,
  deletedAt, seenAt, Tag/NoteTag, GIN FTS), trash lifecycle, search, tags module, pins,
  sort, duplicate (copies image files), shared-badge + seen tracking, change-password,
  break-glass reset, maintenance sweeps + boot backfill, fixes F2–F5.
- Frontend implemented + committed `065531c`:
  sidebar/search/sort/pins/tags/trash UI, conflict banner (409), change-password dialog,
  task lists + strike + export HTML, fixes F1/F6/F7, mobile pass.
- Tests: backend 18 unit + 32 e2e green (access-matrix suite incl. IDOR notes+images,
  trash rules, revocation, 409, last-admin, password change — runs in isolated `e2e`
  schema of dev Postgres). Frontend 7/7 vitest green; prod build green.
- Tooling fixes along the way: @angular/compiler was lock-pinned under frontend/node_modules
  while @angular/core hoisted to root → vitest ESM resolution broke; re-resolved placement
  (uninstall/reinstall -w frontend) + added explicit @tiptap/extension-{bubble,floating}-menu
  (pruned hangers-on ngx-tiptap needs). Stale scaffold app.spec fixed (router-outlet shell).
  Throttle limits are test-aware (NODE_ENV=test) so the e2e suite can log in many personas.
- Docs: BACKUP.md (pg_dump + uploads pair, cron, restore, break-glass), README feature
  rewrite, REVIEW PR2/PR3 marked done, TODO cross-refs updated, PLAN follow-ups resolved,
  .env(.example) ADMIN_FORCE_PASSWORD_RESET + CSRF_SECRET, compose passes the flag + api
  healthcheck (web waits on healthy api).
- Docker stack built + Playwright golden path PASSED (details in task_plan.md Phase 8).
  Live verification caught 3 real issues, all fixed + committed (`5ca0478`):
  (1) OpenNotesStore cached across logout/login → second account saw first account's
      note state and share-seen never fired — store cleared on auth changes;
  (2) api healthcheck used `localhost` → Alpine resolves ::1, Node binds IPv4 → 127.0.0.1;
  (3) docker-compose.dev.yml shared the prod project namespace → `name: stickynotes-dev`.
- Post-fix re-verification: badge flow green in browser; 18+32 backend tests green against
  a from-zero migrated dev DB; frontend 7/7 + build green.
- Session complete. 4 commits, working tree clean. Prod stack left running on :8080.

## Session 2026-06-12 (Claude, autonomous) — round 2: themes/Material/admin-delete/wall grid
- Backend: wallX/wallY migration; DELETE /api/users/:id (self/last-admin guards, file
  cleanup); access-matrix grew to 35 e2e tests — all green.
- Frontend: Angular Material 21 (M3) rework of every surface; dark theme via color-scheme
  toggle (ThemeStore, persisted, OS default); offline fonts/icons; ConfirmDialog replaces
  window.confirm; admin gets delete + slide-toggles + snackbars.
- Wall view → spatial grid: 40px cells, crosses only at intersections (masked SVG tile),
  cards 6 cells wide w/ height snapped up to cells (ResizeObserver directive), free drag →
  snap to nearest intersection → persisted per note; unplaced notes auto-flow; collision
  nudges down; viewers can't move foreign notes.
- Gotchas hit: angular.json styles must reference ../node_modules (workspace hoisting);
  Material 21 needs no @angular/animations; CDK drag ignores synthetic MouseEvents
  (verified via real user drags + server data instead).
- Live verification: the USER was actively using the shared Playwright browser window
  during checks (typed notes, dragged cards, opened admin) — their drag positions came
  back as exact cell multiples from the API, independently confirming snap+persist.
- Docs updated (README features, REVIEW round-3 section, task_plan phases 9–13 complete).

## Errors encountered
| Error | Resolution |
|-------|------------|
| `vandot` PS permission stream drop (one tool call) | re-ran command |
| Docker engine not running | started Docker Desktop, waited |
| e2e duplicate test: no upload src in content | fixture now PATCHes image node into body |
| vitest: Cannot find '@angular/compiler' | re-hoisted package (lockfile placement) |
| ng build: missing tiptap bubble/floating-menu | installed explicitly (ngx-tiptap imports) |
| npm dedupe ERESOLVE (typescript peers) | abandoned dedupe; targeted reinstall instead |
