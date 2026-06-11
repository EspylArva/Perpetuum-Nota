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

## Code review findings (Phase 2) — IN PROGRESS
### Bugs / risks
- (to be filled during review, with file:line)

### Architecture notes
- (to be filled during review)
