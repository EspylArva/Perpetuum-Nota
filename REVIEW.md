# Sticky Notes — Council Review & Plan

*Reviewed 2026-06-01 via a 5-advisor council (Contrarian, First-Principles, Expansionist, Outsider, Executor) + peer review. Findings below were grounded against the actual code, not just the plan.*

---

## TL;DR

The MVP foundation is genuinely strong — a pure, unit-tested `canAccess()` predicate, permission-checked image streaming, per-request account re-validation, and a decoupled editor that makes the v2 vision additive. **But it is not yet safe to expose at a URL.** Sharing notes turns ordinarily-minor app bugs into cross-account risks, and a handful of standard protections are simply off. The right move is one tight **"trust hardening" pass this week**, then fix the two things that will actually brick or frustrate a real user (admin lockout, no undo), and *only then* chase the v2 vision.

The council was emphatic on one point the original threat model got wrong: **"few hand-picked users" does NOT mean "trusted content."** The moment a note is shared (especially PUBLIC = any logged-in user), a malicious link or payload in that note executes in *other people's* sessions. So security can't be deprioritized on "we know our users" grounds.

---

## Where the Council Agrees (high-confidence)

1. **Hardening comes before v2.** Four of five advisors independently said floating windows / Electron / collab are "polish on a house with no front-door lock." Don't build v2 on an unhardened base.
2. **The cheap network-facing fixes are non-negotiable and fast:** rate-limiting on login, security headers (helmet), distinct dev/prod JWT secret. Hours of work, large risk reduction.
3. **Sharing amplifies every content bug.** The strongest single insight: an unsanitized `javascript:` link (or unvalidated note JSON) in a *shared* note is stored-XSS against whoever opens it — not "blast radius is yourself."
4. **The architecture is a real asset, not just an MVP.** ProseMirror-JSON-in-jsonb + decoupled editor + per-note access predicate is unusually clean and is the foundation for much more than an Evernote clone.

## Where the Council Clashes

- **How much does security matter at this scale?** First-Principles argued most gaps defend against attackers you don't have (hand-picked users) and urged validating the "windows-as-notes" product metaphor *first*. **The peer review overruled this** — its "blast radius is yourself" premise is factually wrong given sharing/PUBLIC notes. Verdict: do the cheap hardening regardless; First-Principles is right that the *product metaphor* still needs validating, but not before the ~1-day hardening pass.
- **Build for 10x now, or later?** Expansionist wants Yjs real-time collab as the headline bet. Every reviewer flagged this as the biggest blind spot: building real-time CRDT collab and a public document API on top of stored-XSS + no-CSRF *multiplies* the attack surface. Verdict: the upside is real and worth recording, but it is explicitly **after** hardening.

## Blind Spots the Council Caught (emerged in peer review)

- **Object-level authorization isn't tested.** Lots of attention on XSS/CSRF; nobody initially asked whether *every* note/image endpoint actually enforces `canAccess` (IDOR — can user X fetch user Y's note/image by guessing an ID?). The predicate is unit-tested in isolation, but there is no end-to-end **access-matrix** test. For a multi-user app this is the highest-value test to write.
- **Operational recovery is a security issue.** The likeliest catastrophe isn't an attacker — it's a failed Postgres volume or a locked-out admin (no password reset) bricking the only instance. No backups + no reset, simultaneously, is the real durability risk.
- **No detection.** No audit log / structured auth logging — a compromise would be invisible and unprovable.
- **Fixes ship unverified.** Thin test coverage means every security patch (CSRF, href allowlist, throttler) is exactly the kind that silently regresses. Pair each fix with a test.
- *(Reviewer claim corrected against code: the Postgres port is **not** host-exposed — compose only publishes `web:8080` — so that specific concern doesn't apply. TLS/reverse-proxy posture still matters when you expose it.)*

---

## The Recommendation

**Do a one-week trust pass in three small batches, then re-evaluate before any v2 work.** Don't gold-plate (skip server-side ProseMirror schema validation for now — render-time sanitization covers the actual XSS vector for a trusted-author app). Don't chase Yjs/Electron yet. The sequence below is ordered by exploitability × likelihood, with the cheap-and-blocking items first.

### The One Thing to Do First
**Add a URL-scheme allowlist to link insertion (`http`/`https`/`mailto`) and sanitize hrefs on render.** It's ~1-2 hours, and it closes the one bug that's already exploitable *through the product's headline sharing feature*. (Verify current TipTap 3 link guarding first — then make the allowlist explicit regardless.)

---

## Prioritized Plan

### PR 1 — "Trust hardening" ✅ DONE (2026-06-01)
Make it safe to expose at a URL. **All items implemented and verified** (6/6 automated hardening checks + real-app golden path pass; 12 backend + 5 frontend unit tests green).

- [x] **Link href allowlist + render sanitization** — shared `isSafeLinkUrl()` guard (`frontend/src/app/editor/safe-url.ts`, allowlist `http`/`https`/`mailto`, strips control-char smuggling) wired into both `note-editor.ts setLink()` and the TipTap Link extension via `protocols` + `isAllowedUri` (`extensions.ts`). 5 unit tests (`safe-url.spec.ts`).
- [x] **Rate limiting** — `@nestjs/throttler` global default (100/min/IP) + strict `@Throttle(5/min)` on `POST /auth/login`. Verified: 429 after a login burst.
- [x] **Security headers** — `helmet()` in `main.ts` + `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` block in `nginx.conf`. Verified present on responses.
- [x] **Distinct dev/prod JWT + CSRF secret** — added `CSRF_SECRET` (falls back to `JWT_SECRET`), strong-gen guidance in `.env.example`, wired through `docker-compose.yml`; dev `.env` uses separate dev-only values.
- [x] **CSRF protection** — `csrf-csrf` double-submit (`auth/csrf.ts` + `csrf.service.ts`); middleware in `main.ts` protects mutating routes, exempts `/auth/login` + `/auth/csrf`; `GET /auth/csrf` issues the token; Angular `csrf.interceptor.ts` fetches + attaches `X-CSRF-Token`. Verified: tokenless mutation → 403, token-bearing mutation → 201, and the real Angular app creates/persists notes transparently.

> **Implementation note (gotcha for future work):** in this npm-workspaces layout `@nestjs/core` hoists to the repo root while `@nestjs/platform-express` resolves from `backend/node_modules`, so `NestFactory.create`'s auto HTTP-driver detection fails (`No driver (HTTP) has been selected`). Fixed by passing `new ExpressAdapter()` explicitly in `main.ts`. Also: deleting `node_modules` requires a `prisma generate` afterward (the generated client is what exports `Role`/`Visibility`/etc.).

### PR 2 — "Don't lose my data / don't lock me out" ✅ DONE (2026-06-11)

- [x] **Access-matrix e2e test** — `backend/test/access-matrix.e2e-spec.ts` (32 tests): owner / grantee / stranger × view/edit/delete/restore/duplicate across notes **and** images, trash visibility, revocation, public→private flips, deactivated-user cutoff. Runs in an isolated `e2e` schema.
- [x] **Admin self-recovery** — `ADMIN_FORCE_PASSWORD_RESET=true` break-glass reset (bootstrap), documented in BACKUP.md; plus a **last-admin lockout guard** (409 on deactivating/demoting the last active admin).
- [x] **Self-service password change** — `POST /api/auth/change-password` (throttled 5/min) + dialog in the header.
- [x] **Autosave 409** — client sends `baseContentUpdatedAt`; server enforces it atomically (`updateMany` conditional write); editor shows a conflict banner with "Load latest" / "Keep mine".
- [x] **Backups** — BACKUP.md: paired `pg_dump` + uploads-volume tar, sample cron, full restore procedure, retention note.

### PR 3 — "Make sharing real & deletion safe" ✅ DONE (2026-06-11)

- [x] **"Shared with me" view** — sidebar entry + unseen-count badge (`NoteShare.seenAt`, set when the recipient opens the note); "New" badge on unopened shares.
- [x] **Trash / recycle bin** — soft delete (`Note.deletedAt`), restore, delete-forever, empty-trash; 12-hourly sweep purges trash >30 days, drops note-body-unreferenced image assets (7-day grace) and orphaned disk files (24h grace). Trashed notes are invisible (and their images 404) to everyone but the owner.
- [x] **Mobile pass** — off-canvas sidebar <900px, single-pane editor <768px, full-screen wall modal, larger touch targets.

### Round 3 (2026-06-12): Material UI, dark theme, admin delete, spatial wall
- **Angular Material (M3)** across the app — toolbar, sidenav, form fields,
  selects, button toggles, chips (tag editor), checkboxes, slide toggles,
  confirm dialogs (replacing `window.confirm`), snackbars; theme built on
  `mat.theme` system tokens with a yellow primary.
- **Dark theme** — header toggle, persisted, defaults to OS preference;
  every surface (incl. custom components) rides the same `--mat-sys-*` tokens
  via `color-scheme` switching. Fonts/icons self-hosted (offline-friendly).
- **Admin: delete user** — `DELETE /api/users/:id` removes the account and all
  its data (notes/shares/tags/image rows + files). Blocks self-delete and the
  last active admin (409). Confirm dialog + snackbar in the UI; e2e-covered.
- **Wall became a spatial grid** — 40px cells; an almost-invisible grid drawn
  as small crosses at intersections only (masked SVG tile, theme-aware);
  cards are 6 cells wide, height auto-snaps up to the nearest cell; dragging
  snaps to the nearest intersection and persists per-note `wallX/wallY`
  (owner-only; viewers see shared notes where the owner placed them);
  unplaced notes auto-flow top-left without persisting; collision nudges down.

### Also shipped beyond the council list (2026-06-11, Evernote-parity)
- **Full-text search** — `Note.contentText` extracted at write time, GIN FTS index (`websearch_to_tsquery` + ILIKE fallback), debounced search box. Search results respect the access predicate (covered by e2e).
- **Tags** — owner-scoped, create-on-use, case-insensitive dedupe, auto-pruned when unused; sidebar filter with counts; chips in list/wall/editor.
- **Pinned notes**, **sort options** (custom/edited/created/title, persisted), **checklists** (TipTap task lists), **strikethrough**, **note duplication** (image files copied, visibility reset PRIVATE), **export as HTML**.
- **Fixes from this review pass:** non-owner editor was editable (silent 403 autosave loop) — now read-only with disabled title; CSRF cookie `secure` flag now follows `req.secure`; JWT_SECRET fail-fast in production; non-doc content returns 400 (was 409); flush-on-tab-hide so the last <900ms of typing isn't lost.

### Deferred (record, don't build yet)
- **Server-side ProseMirror schema validation** — low payoff for trusted authors once render sanitization is in; revisit when authors are untrusted or an API is exposed.
- **Audit/auth logging + dependency/CVE scanning (`npm audit`, image scan)** — add when you expose the URL publicly.
- **TLS / reverse-proxy hardening** — required before any public exposure.

### v2 / Upside (after hardening — the architecture is built for these)
- **Real-time collaboration via Yjs** (`y-prosemirror` is near-drop-in; jsonb stays the snapshot, Yjs is the live CRDT; the per-user grant model already is the sharing layer). The single biggest value multiplier — turns "notes" into a Notion/FigJam-class collaborative doc tool.
- **Floating draggable windows → Electron "each note is its own OS window"** — a genuinely under-occupied category, and the decoupled editor was built precisely for it. First-Principles' point stands: prototype the floating-window metaphor early to validate the product identity.
- **Spatial canvas / free-floating images** — image geometry already lives in node attrs, so the doc is one step from an infinite whiteboard.
- **Templates** (a note is just seed JSON) and a **public document API** (addressable JSON + webhooks → headless-CMS / embed use cases) — but the API only *after* the hardening pass, since it widens the attack surface.

---

## What's already good (keep it)
- Pure, unit-tested `canAccess()` predicate with the DB lookup isolated in a guard.
- Permission-checked image serving via the API (never an nginx static alias) — PRIVATE images stay private.
- Auth guard re-validates the account on every request (deactivated users lose access immediately).
- Decoupled `<note-editor>` + signal store + content-as-ProseMirror-JSON — the clean substrate the whole v2 roadmap rides on.
- Postgres port is not host-exposed; uploads on a named volume; cascade deletes modeled in the schema.
