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
- Currently: `docker compose up --build -d` running → Playwright golden path next.

## Errors encountered
| Error | Resolution |
|-------|------------|
| `vandot` PS permission stream drop (one tool call) | re-ran command |
| Docker engine not running | started Docker Desktop, waited |
| e2e duplicate test: no upload src in content | fixture now PATCHes image node into body |
| vitest: Cannot find '@angular/compiler' | re-hoisted package (lockfile placement) |
| ng build: missing tiptap bubble/floating-menu | installed explicitly (ngx-tiptap imports) |
| npm dedupe ERESOLVE (typescript peers) | abandoned dedupe; targeted reinstall instead |
