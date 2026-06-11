# Findings — Sticky Notes review session (2026-06-11)

## From docs (Phase 1)
- Stack: Angular 21 + ngx-tiptap 14 / TipTap 3.24; NestJS 11 + Prisma 6.19 + PG16; nginx front door :8080.
- Auth: argon2 + JWT httpOnly cookie SameSite=Lax; CSRF double-submit (csrf-csrf); throttler (100/min global, 5/min login); helmet.
- Access: pure `canAccess()` (owner-only mutation; PUBLIC = any logged-in user; PRIVATE + per-user grants).
- Images: served via API StreamableFile after canAccess — never static nginx alias.
- Known follow-ups from PLAN.md: orphaned image sweep, autosave 409 client-side, distinct prod secrets.
- REVIEW.md PR 2 + PR 3 lists = the planned missing features (see task_plan.md phases 5–6).
- TODO.md = NAS deployment, blocked on: NAS CPU arch, image delivery route, storage path, TLS posture.
- Build gotcha: `NestFactory.create` needs explicit `new ExpressAdapter()` (workspace hoisting). After node_modules wipe run `prisma generate`.
- Dev loop: `docker compose -f docker-compose.dev.yml up -d` (Postgres) + `npm run dev:api` + `npm run dev:web`.
- Repo has .gitignore but NO .git directory — version control missing.

## Code review findings (Phase 2) — COMPLETE

### Bugs / risks (ordered by severity)
- **F1 HIGH** `frontend/src/app/manager/manager.html:58,97` — `<app-note-editor [noteId]="id" />` never binds `[editable]`; share recipients (non-owners) get a fully editable editor whose autosave PATCH 403s silently (store leaves `dirty=true`, status stuck "Unsaved changes"). Title input + rename same issue. Also `floating-image.ts` pointer-drag doesn't check `editor.isEditable`.
- **F2 HIGH** `backend/src/users/users.service.ts:57` — admin can deactivate/demote THEMSELVES or the last admin; combined with no password reset = bricked instance (REVIEW.md PR 2 concern, confirmed in code).
- **F3 MED** `backend/src/notes/notes.service.ts:118-145` — optimistic concurrency: read-then-write race (not atomic); client never sends `baseContentUpdatedAt` (`notes.api.ts updateContent`); non-doc content rejected with 409 ConflictException (should be 400).
- **F4 MED** `backend/src/auth/csrf.ts:26` — comment claims secure flag is "overridden per-request below via req.secure-aware wrapper"; NO wrapper exists, csrf cookie is always `secure:false`.
- **F5 LOW** `backend/src/auth/auth.module.ts` + `csrf.service.ts` — JWT_SECRET unset → boots fine, login 500s at sign time; CSRF silently falls back to literal `'dev-csrf-secret-change-me'`. No production fail-fast.
- **F6 LOW** `frontend/src/app/editor/open-notes.store.ts` — debounce (900ms) never flushed on tab close/hide; last edit lost. flush() exists but only wired to component destroy.
- **F7 LOW** `open-notes.store.ts:86` — flush error → `saving=false`, no user feedback, no retry; ties into 409 handling.
- **F8 INFO** `backend/prisma/schema.prisma:36` — `Invite` model is dead schema: zero endpoints reference it (admin creates users directly). Document as intentional or implement invites.
- **F9 VERIFY** `note-editor.html` showed mojibake via PowerShell (likely console encoding only — verify with Read before judging).
- **F10 INFO** `backend/test/` contains only the hello-world scaffold e2e; REVIEW.md "12 backend tests" = unit specs (note-access 11 + app controller 1). No integration coverage of authz.

### Architecture notes
- Layering is genuinely clean: pure `canAccess` + NoteAccessService (one DB loader shared by guard + uploads) + decoupled editor/store. Keep.
- `listViewable` runs `extractPlainText` (full JSON walk) per note per request — when adding `contentText` for search, compute text+preview ONCE at write time.
- nginx `client_max_body_size 25m` > multer 10MB — fine. JSON body limit 5mb — fine.
- README says `frontend/Dockerfile` but SPA builds inside `docker/nginx/Dockerfile` — doc drift.
- Frontend tests = vitest via `ng test` (safe-url.spec 5 + app.spec 1). Backend jest.
- `backend/scripts/*.cjs` = ad-hoc manual verification scripts (hardening/sharing/upload) — keep as-is.
- Plan: split new backend domains into `tags/` module + `trash` logic inside notes module + sweep service; avoids one giant notes.service.

### Library facts to verify before coding
- TipTap 3 StarterKit deps: does `@tiptap/extension-list` (bundling TaskList/TaskItem) ship transitively? → check node_modules.
- csrf-csrf v4 `generateCsrfToken(req, res, ?)` — per-request cookie option override shape.

### Implementation design (Phases 5–7)
- One additive migration: Note.{pinned,deletedAt,contentText} + NoteShare.seenAt + Tag + NoteTag + index (ownerId,deletedAt) + raw GIN FTS index on to_tsvector('simple', title || ' ' || contentText).
- Search: $queryRaw id-prefilter (websearch_to_tsquery OR ILIKE) → Prisma where {id in ids} ∩ access ∩ deletedAt:null.
- Trash: DELETE /:id = soft; POST /:id/restore; DELETE /:id/permanent; POST /notes/trash/empty; batch-delete = soft. Sweep (12h interval): purge trash >30d (unlink files), delete ImageAsset rows unreferenced by their note's content & older than 7d (file too), unlink disk files with no row (>24h old).
- Shares: GET /:id marks NoteShare.seenAt for viewer; badge = count unseen via GET /notes/shared-badge (or folded into list response meta).
- Tags: GET /api/tags (mine + counts); PUT /api/notes/:id/tags {names[]} create-on-use owner-only; DELETE /api/tags/:id.
- Duplicate: POST /:id/duplicate — clones title+" (copy)", content, tags; visibility reset PRIVATE; copies image FILES + asset rows and rewrites doc src ids (no shared-file refs).
- Pin: PATCH /:id {pinned}; list orders pinned first.
- Sort: ?sort=position|updated|created|title (default position for mine; pinned always first).
- change-password: POST /api/auth/change-password {currentPassword,newPassword} (verify current, rehash).
- Break-glass: ADMIN_FORCE_PASSWORD_RESET=true → bootstrap resets admin pw to ADMIN_PASSWORD + role/active restore + warn log.
- Frontend: sidebar (All/Mine/Shared+badge/Trash + tag list), search box (debounced), sort select, pin toggles, tag chips + editor tag input, 409 conflict banner (Reload/Overwrite), change-password dialog, task-list+strike toolbar buttons, export HTML (editor.getHTML→blob), mobile collapse <768px.
