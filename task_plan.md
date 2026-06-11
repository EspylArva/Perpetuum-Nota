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

### Phase 2: Full code review — Status: in_progress
- [ ] Backend: schema.prisma, main.ts, auth/, common/ (note-access), notes/, uploads/, users/, bootstrap
- [ ] Frontend: core/, editor/, manager/, sharing/, admin/
- [ ] Shared types, docker compose files, nginx conf, Dockerfiles
- [ ] Log every bug/risk in findings.md with file:line

### Phase 3: Fix bugs found in review — Status: pending
- (fill in after Phase 2 from findings.md bug list)

### Phase 4: Architecture review — Status: pending
- [ ] Git init + baseline commit (before any code changes)
- [ ] Assess module boundaries, DTO/shared-type drift, service size

### Phase 5: PR 2 — data safety — Status: pending
- [ ] Access-matrix e2e test (notes + images IDOR)
- [ ] Admin break-glass reset (env-based forced reset) + docs
- [ ] Self-service password change (API + UI)
- [ ] Autosave 409 optimistic concurrency (server enforce + client handle)
- [ ] Backups doc (pg_dump + uploads snapshot + cron sample)

### Phase 6: PR 3 — sharing UX + trash — Status: pending
- [ ] Shared-with-me view + unseen-share badge
- [ ] Trash: soft delete, restore, permanent delete, 30-day purge sweep + orphan image sweep
- [ ] Mobile read-friendliness pass

### Phase 7: Evernote-parity features — Status: pending
- [ ] Full-text search (server-side contentText + Postgres FTS; search UI)
- [ ] Tags (schema + chips + filter)
- [ ] Pinned notes (pinned-first)
- [ ] Sort options (updated/created/title, persisted)
- [ ] Editor: task lists (checkboxes) if cheap
- [ ] Note duplication, export-as-HTML (client-side) if time allows

### Phase 8: Verification — Status: pending
- [ ] Backend unit + e2e green
- [ ] Frontend build + unit tests green
- [ ] Docker stack golden path via Playwright (search, tags, pin, trash, share badge, 409 banner)
- [ ] Update PLAN.md / REVIEW.md / README.md status sections

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
