# Council Transcript — stickynotes review (2026-06-01)

## Original question
> Take a look at the "stickynotes" project. Give me feedback on it (architecture, features, security, todos) and build a plan. Save this plan in a REVIEW.md.

## Framed question (given to all 5 advisors)
Project "stickynotes" — a self-hosted, dockerized Evernote-style sticky-notes app, MVP just completed. Stack: Angular 21 + ngx-tiptap/TipTap 3 (ProseMirror) frontend; NestJS 11 + Prisma 6.19 + PostgreSQL 16 backend; Docker Compose behind nginx, single URL. Features: rich-text notes (formatting, lists, autolinked clickable URLs), pasteable resizable inline images, debounced autosave, note manager (list + masonry wall views, multi-select + batch delete), per-note sharing (PRIVATE/PUBLIC where PUBLIC = any logged-in user + explicit per-user view grants), admin-managed users (no open signup), JWT-in-httpOnly-cookie auth. Architecture: decoupled editor + signal store (v2 floating-windows/Electron additive), image geometry in doc JSON, pure unit-tested `canAccess()` predicate + `NoteAccessGuard`, permission-checked image streaming, per-request account re-validation. Real security gaps found in code: no CSRF, no rate limiting, no helmet, no link-href sanitization (javascript: XSS), content JSON not schema-validated, shared dev/prod JWT secret. Known todos: orphaned image cleanup, last-write-wins autosave, thin tests, no backups/password-reset. Small scale, few hand-picked users; v2 vision = floating windows + Electron per-note windows.

## Anonymization mapping (for the peer-review round)
- Response A = The Outsider
- Response B = The Contrarian
- Response C = The Executor
- Response D = The First-Principles Thinker
- Response E = The Expansionist

---

## Advisor responses

### The Contrarian (downside)
No CSRF token with `SameSite=Lax` is the gap everyone will under-rate. Lax does NOT protect you — top-level navigations and auto-submitted forms sail through. httpOnly cookie auth with zero CSRF defense on every mutating route is the real hole.

But rank honestly. The thing that bites first and hardest is the `javascript:` href. That's stored XSS in a multi-user app where notes are *shared*. I paste a note with a poisoned link, share it PUBLIC, you click it, my script runs in your session. Combined with no CSRF, one shared note compromises accounts. Fix sanitization now; it's a one-line allowlist (`http/https/mailto`).

Second: no rate limiting on login. Admin-only signup means a handful of high-value accounts and no lockout — a brute-force gift. @nestjs/throttler is an afternoon.

What you're rationalizing away: the arbitrary-JSON content endpoint. "Top-level type==='doc'" is theater. Unvalidated ProseMirror JSON is a second XSS/DoS vector that renders straight back into other users' browsers.

Cosmetic by comparison: orphaned image cleanup (disk leak, not a breach), last-write-wins autosave (data loss for one user, annoying not dangerous). The shared dev/prod JWT secret means your repo *is* your prod key. Rotate it.

Order: href sanitize → CSRF → throttler → schema validation → secret rotation → helmet.

### The First-Principles Thinker (reframe)
First-principles question: who is the adversary, and what are they after? Few known users, manual access grants, no open signup, self-hosted behind nginx. Your real threat surface is overwhelmingly (1) the trusted users themselves, and (2) whatever's exposed on the public internet if reachable. Most "known gaps" defend against attackers you don't have.

CSRF, rate limiting, helmet, JWT secret hygiene matter the instant the URL is public, and they're cheap — do those. But link-href sanitization and content-JSON validation are XSS concerns, and your users are hand-picked; the blast radius of a malicious note is yourself. Near the bottom.

The part nobody's saying: you're not building a SaaS. "Few users, manual grants" is a personal tool with a login. Stop spending architecture budget on multi-tenant permission elegance — the `canAccess()` predicate with unit tests is lovely engineering for a problem you may not have.

The actual thing you're building is "individual windows with content." v2 floating windows + Electron-per-note IS the product. The real question isn't "what do I harden" — it's "have I validated the windows-as-notes metaphor?" Build the floating-window prototype now, before more hardening. Harden the cheap network-facing stuff, then go prove the product.

### The Expansionist (upside)
The MVP isn't an Evernote clone. ProseMirror JSON in jsonb plus a decoupled, signal-driven editor and a per-note access predicate is the substrate for a multiplayer document platform. The clone is the demo, not the product.

Highest-leverage bet: real-time collab via Yjs. Content is already ProseMirror, so y-prosemirror is nearly drop-in; jsonb stays the snapshot/checkpoint while Yjs handles the live CRDT. The moment two cursors land in one note, "sticky notes" becomes a Notion/FigJam competitor. Your per-user grant model already IS the sharing layer collab needs. That's the 10x.

Second, the Electron "each note is an OS window" angle is more unique than collab — nobody ships a notes app where notes are first-class desktop windows you arrange like a real corkboard that also sync live.

The undervalued asset hiding in plain sight: node attrs holding image geometry means your document IS a spatial canvas — the foundation for an infinite whiteboard. Seed now: templates (a note is just seed JSON) and a public document API (addressable JSON → headless CMS, embeds, webhooks). Build order: Yjs → spatial canvas → Electron.

### The Outsider (fresh eyes)
**The "I am the admin and I locked myself out" trap.** No sign-up means the first thing a self-hoster does is create the admin account. How? If that's a config/CLI step it needs to be dead obvious. Worse: email + password but no password reset means if the admin forgets their own password, the whole app is bricked with no clear way back in. Fix the admin bootstrap and a reset path before anything floating-window.

**Sharing has no doorbell.** I share a note with you. Do you know? Where do you look for "notes shared with me"? If the answer is "you don't, unless I tell you," sharing is decorative. A "Shared with me" view plus a notification badge makes the headline feature actually work.

**Deletion with no undo, plus orphaned images.** Batch delete + no undo = one wrong click wipes a wall of notes. A trash/recycle bin (restore for 30 days) solves both the accident problem and quietly the leftover-image cleanup.

**Backups.** A self-hoster's #1 fear is losing everything. One README paragraph on where notes/images live beats any feature. Plus: mobile read, self-service password change. Floating windows and a desktop app are polish on a house with no front-door lock and no fire exit.

### The Executor (ship it)
Ship a single "trust hardening" PR this week. Monday, in order.

Batch into one hardening PR (1-2 days): JWT secret (one-liner, distinct env vars, do first, 5 min); helmet + nginx headers (30 min); throttler on /auth/login (30 min); link href allowlist (genuinely blocking — stored XSS lets a sharer pop your session; scheme-allowlist + sanitize on render, 1-2 hrs); CSRF double-submit cookie (real but contained, half a day). That PR makes it trustworthy to expose.

Second PR same week: autosave 409 (the field already exists in the DTO; client just sends `baseContentUpdatedAt` + handles 409 — you're losing your own edits today); orphaned images delete-on-delete (skip the periodic sweep cron for now).

Defer, and say so: ProseMirror server validation (low payoff for trusted users; render sanitization covers the actual XSS); e2e tests (add auth/sharing access-matrix specs after hardening); backups (not a PR — 10-line pg_dump cron, do it the day you put real notes in). All v2 features: hard defer.

Order: secret → headers → throttle → XSS → CSRF, then 409, then image cleanup.

---

## Peer reviews

**Reviewer 1:** Strongest = B (Contrarian) — only one to trace the exploit chain (shared notes make javascript: href XSS cross-account; CSRF compounds to takeover), refuting D's "blast radius is yourself." Biggest blind spot = D (First-Principles): its trusted-users premise collapses because sharing supports PUBLIC notes. All missed: object-level authorization / IDOR isn't end-to-end tested — can user X fetch user Y's note/image by guessing an ID? Image files especially. No access-matrix test exists.

**Reviewer 2:** Strongest = B (correct exploit chain; demotes orphaned-images/last-write-wins as cosmetic). Biggest blind spot = E (Expansionist): chases Yjs/whiteboard/CMS while shipped holes remain; scaling attack surface, not product. All missed: the threat model is self-contradictory and untested ("trusted users" vs worst-case public URL); no logging/audit trail, no dependency/CVE scanning, and "thin tests" means every fix ships unverified.

**Reviewer 3:** Strongest = B (chains XSS → CSRF → takeover; "type==='doc' is theater"). Biggest blind spot = D — "blast radius is yourself" is directly wrong since sharing makes notes multi-reader; its "stop investing in multi-tenant permissions" advice undercuts the very feature that creates the worst vuln; dangerously plausible. All missed: operational recovery as a security issue (failed Postgres volume or locked-out admin bricks the only instance); dependency/container CVE scanning; audit logging to detect compromise.

**Reviewer 4:** Strongest = B (orders by exploitability, nails the cheap fix). Biggest blind spot = E (real-time CRDT on an unauthenticated-mutation surface multiplies attack surface). All missed: dependency/supply-chain hygiene + Docker/deployment posture (claimed exposed Postgres port, default container creds, no TLS) — *[NOTE: grounding against compose showed the DB port is NOT host-exposed; only web:8080 is published — this reviewer claim partly corrected]*; logging/audit; legal/data-loss angle of zero backups + zero password reset together.

**Reviewer 5:** Strongest = B (sharing-amplifies-XSS is the sharpest single observation; correctly calls the content check theater). Biggest blind spot = E (10x fantasy on a foundation that can brick or be hijacked; a public document API on an unhardened backend multiplies every gap). All missed: no one demanded *verification* — security fixes are exactly the kind that silently regress, yet no "failing test first"; no dependency/supply-chain hygiene (`npm audit`, TipTap/Prisma CVEs); no logging/observability.

---

## Grounding pass (post-council, against the actual source)
- **Confirmed:** no `helmet`/`throttler` anywhere in app code; `setLink()` uses raw `window.prompt` with no scheme allowlist (note-editor.ts:135–147); nginx emits no security headers; `main.ts` has `trust proxy` + 5mb JSON limit + global ValidationPipe but no security middleware.
- **Corrected:** Postgres is NOT host-exposed — `docker-compose.yml` publishes only `web: ${WEB_PORT:-8080}:80`; `db` and `api` ports stay on the internal compose network. The "exposed DB port" reviewer concern was dropped from the final plan.
- **Nuance added:** TipTap 3's Link extension ships some built-in URI guarding (`isAllowedUri`), so the `javascript:` href is "verify-then-make-explicit" rather than asserted-exploitable — the plan says to confirm it and add an explicit allowlist regardless.

---

## Chairman synthesis → written to `REVIEW.md`
Verdict: the foundation is strong but not yet safe to expose. Run a one-week trust pass in three batches (PR1 hardening: href allowlist → throttler → helmet → distinct JWT secret → CSRF; PR2 don't-lose-data: access-matrix e2e/IDOR test, admin recovery + password change, autosave-409, backups; PR3 sharing-real + trash/undo, which also solves orphaned images). Defer server-side schema validation, audit logging + CVE scanning, and TLS until public exposure. Record the Yjs-collab / Electron-windows / spatial-canvas upside as the post-hardening v2 — the architecture is built for it. **One thing first:** URL-scheme allowlist + href render sanitization (~1–2 hrs), because it closes the one bug already exploitable through the headline sharing feature.
