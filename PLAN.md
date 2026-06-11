# Sticky Notes SaaS (Evernote-style clone) — Implementation Plan

## Context

We're building a self-hosted, dockerized "sticky notes" app from scratch (new project, target dir `W:\stickynotes\`). The user wants Evernote-style notes: rich-text documents with formatting, lists, clickable URLs, and pasteable **resizable inline images**; persisted in a database; managed from a home screen with single + batch delete; multi-user with per-note sharing/privacy. The product identity is "individual windows with content," and a future v2 wants floating windows + an installable Windows (Electron) client where each note is its own OS window.

The whole MVP is architected so the **v2 features are additive, not rewrites**: the rich-text editor is a presentation-agnostic component fed by an open-notes store, and image geometry lives in document JSON node attributes — so floating windows, the Electron client, and free-floating images can be added later without touching the data model or editor core.

### Decisions locked during brainstorming
- **Editor model:** Document/flowing rich text (Notion/Evernote-style), **not** a free canvas. Images are inline + resizable now; free-floating images are a documented v2 (data model kept ready for it).
- **Stack:** **Angular + TipTap via `ngx-tiptap`** (TipTap 3 / ProseMirror) frontend; **NestJS + Prisma + PostgreSQL** backend; **Docker Compose** with an **nginx** front door on a single URL.
- **Note manager:** Build **both** a two-pane list view (**default**) and a Google-Keep-style masonry "sticky wall" view, with a persisted user toggle. Dense table view = deferred.
- **Note open:** Edit in the right-hand pane (option A) — but editor built decoupled so floating windows (v2) are additive.
- **Sharing:** `visibility = PRIVATE | PUBLIC`, where **PUBLIC = any logged-in user of this instance** (never anonymous internet links). A PRIVATE note can additionally be shared with specific chosen users (explicit per-user view grants). Editing is owner-only in the MVP.
- **Accounts:** Admin creates users / sends invites. **No open self-service signup.**

### Out of scope for MVP (documented v2, do not build)
Floating draggable windows, Electron desktop client, free-floating/repositionable images, dense table view, real-time collaboration.

---

## Architecture

### Repo layout — simple two-app npm-workspaces monorepo (not Nx)
Two deployables (Angular SPA, NestJS API) + infra. Nx earns its keep at ~4+ apps/libs; here it's ceremony. The one cross-cutting need — shared TypeScript types (DTOs, the ProseMirror doc shape, `Visibility` enum) — is solved by a tiny `shared/` workspace package consumed via path alias.

```
W:\stickynotes\
├─ package.json                 # npm workspaces ["frontend","backend","shared"]
├─ .env.example                 # JWT_SECRET, DB creds, ADMIN_EMAIL/ADMIN_PASSWORD
├─ docker-compose.yml           # nginx + api + db + named volumes
├─ docker-compose.dev.yml       # override: db-only for native dev loop
├─ shared/src/{prosemirror.ts,dto.ts,enums.ts}
├─ backend/                     # NestJS + Prisma
│  ├─ Dockerfile
│  ├─ prisma/{schema.prisma,migrations/,seed.ts}
│  └─ src/{main.ts,app.module.ts,prisma/,auth/,users/,notes/,sharing/,uploads/,common/}
├─ frontend/                    # Angular + ngx-tiptap (standalone components + signals)
│  ├─ Dockerfile                # multi-stage build -> static dist
│  └─ src/app/{core/,editor/,manager/,sharing/,shared-ui/}
└─ docker/nginx/{nginx.conf,Dockerfile}
```

### Data model (Postgres via Prisma; note content = `jsonb` ProseMirror doc)
- **User**: `id`, `email` (unique), `displayName`, `passwordHash` (argon2), `role` `USER|ADMIN`, `isActive`, timestamps.
- **Invite**: `id`, `email`, `tokenHash`, `role`, `invitedById→User`, `expiresAt`, `acceptedAt`. Redemption creates the User + sets password; signup otherwise closed.
- **Note**: `id`, `ownerId→User`, `title`, `content` **jsonb** (ProseMirror doc, default empty doc), `visibility` `PRIVATE|PUBLIC`, `contentUpdatedAt`, timestamps. **Image size/position stored as node attributes inside the doc JSON, never as columns** → free-floating images (v2) become additive.
- **NoteShare**: composite pk `(noteId, userId)`, both `onDelete: Cascade`. View-only in MVP (room for a `permission` enum in v2).
- **ImageAsset**: `id`, `noteId→Note` (cascade), `uploadedById→User`, `storagePath` (random filename on the uploads volume), `mimeType`, `sizeBytes`, `width`, `height`. The doc references images by app URL `/uploads/:assetId`, not a file path.

**Canonical access predicate** — pure & unit-tested first (`backend/src/common/note-access.ts`):
```ts
canAccess(note, user, action, isSharedWithUser):
  if action in {edit, delete}: return note.ownerId === user.id          // owner-only mutation
  if note.ownerId === user.id: return true
  if note.visibility === 'PUBLIC': return true                          // any logged-in user
  return isSharedWithUser                                               // PRIVATE + explicit grant
```
Keep it pure (share membership passed in); the DB lookup lives in the guard.

### Backend (NestJS + Prisma)
- **auth/**: argon2 + JWT in an **httpOnly, SameSite=Lax** cookie (single-origin → no CORS). Global `JwtAuthGuard` + `@Public()` whitelist (login, accept-invite) + `@CurrentUser()`. Admin bootstrapped idempotently from env via `prisma/seed.ts` on container start.
- **users/**: `GET /api/users` (id/displayName/email for the share picker, any logged-in user); admin-only create/update/deactivate + invite create/accept (`RolesGuard` + `@Roles('ADMIN')`).
- **notes/**: create; `GET /api/notes` returns viewable notes via one Prisma `OR` (`ownerId=me OR visibility=PUBLIC OR shares.some.userId=me`) with `filter=mine|shared|all`; get/update guarded by **`NoteAccessGuard`** (loads note + share membership, runs `canAccess`, attaches note to request); `PATCH /api/notes/:id/content` thin **debounced autosave** target (validate it's a `doc`); single delete; `POST /api/notes/batch-delete` (owner-filtered, transactional, returns deleted ids).
- **sharing/**: `PATCH /notes/:id/visibility`, `PUT|POST|DELETE /notes/:id/shares[/:userId]`, `GET /notes/:id/shares` — all owner-only.
- **uploads/**: `POST /api/notes/:id/images` (Multer `FileInterceptor`, mime allowlist png/jpeg/gif/webp, size cap, `sharp` for dimensions, random filename → uploads volume). `GET /uploads/:assetId` **streams via `StreamableFile` only after re-running `canAccess` for the asset's note** — served through the API, **never** via an nginx static alias (that would leak PRIVATE images).

### Frontend (Angular + ngx-tiptap, standalone + signals)
- **core/**: typed `ApiService` over `HttpClient` (`withCredentials:true`); `authInterceptor` (401→login); `AuthService` (`currentUser` signal); `authGuard`; **`ViewModeStore`** signal (`'list'|'wall'`) persisted to localStorage.
- **editor/ (load-bearing):**
  - **`<note-editor [noteId] [editable]>`** — presentation-agnostic; knows nothing about panes/windows/routing; instantiates TipTap with the shared extensions, reads content from the store, emits debounced changes. All TipTap/ProseMirror imports stay inside `editor/`.
  - **`OpenNotesStore`** — signal store mapping `noteId → { content, dirty, saving }`; owns fetch + autosave debounce/flush + optimistic state. MVP pane binds one entry; **v2 floating windows / Electron mount the same `<note-editor>` against the same store entries — only the chrome differs.**
  - **`extensions/`** — `StarterKit` (paragraph, bold, italic, headings, ordered/unordered lists, history) + `@tiptap/extension-underline` + `@tiptap/extension-link` (`{ autolink:true, linkOnPaste:true, openOnClick:'whenNotEditable', HTMLAttributes:{ target:'_blank', rel:'noopener nofollow' } }`) + `@tiptap/extension-image` with the built-in **`resize`** option. Paste handler intercepts image blobs → upload → insert image node at `/uploads/:id`. A custom `AngularNodeViewRenderer` resizable-image component is **scaffolded** (not the primary path) as the fallback + v2 free-floating prep.
- **manager/**: container fetches viewable notes + hosts the view switch. **List view (default):** two-pane (left list w/ PUBLIC/shared badges, right `<note-editor>`). **Wall view:** masonry cards. Multi-select set + batch-action bar → `batch-delete` (optimistic, reconcile from returned ids); single delete w/ confirm.
- **sharing/**: share dialog — visibility toggle (copy: "any logged-in user can view") + typeahead user picker for grants; owner-only.

### Docker topology (single URL)
- **db**: `postgres:16`, named volume `pgdata`, healthcheck, not host-exposed in prod.
- **api**: NestJS multi-stage image, mounts `uploads:/data/uploads`, entrypoint runs `prisma migrate deploy` then starts; `depends_on: db` healthy.
- **web/proxy (nginx)** — the single public URL: `/` serves the SPA (`try_files $uri /index.html`); `/api/` and `/uploads/` `proxy_pass` to api (uploads stay permission-checked); raised `client_max_body_size`.

---

## Key libraries to use (verified against current docs)
- **`ngx-tiptap`** (Angular bindings for **TipTap 3**) — `AngularNodeViewRenderer(Component,{injector})` + `AngularNodeViewComponent` (`this.node/updateAttributes/selected`) for custom node views. [ngx-tiptap](https://github.com/sibiraj-s/ngx-tiptap)
- **`@tiptap/extension-image`** built-in `resize` (`ResizableNodeView`: directions, min size, aspect ratio, `onCommit`). [Image](https://tiptap.dev/docs/editor/extensions/nodes/image) · [Resizable node views](https://tiptap.dev/docs/editor/api/resizable-nodeviews)
- **`@tiptap/extension-link`** `autolink`/`openOnClick`/`linkOnPaste`. [Link](https://tiptap.dev/docs/editor/extensions/marks/link)
- **NestJS** guards/`StreamableFile` for authz + file streaming. [Auth](https://docs.nestjs.com/security/authentication) · [Authz](https://docs.nestjs.com/security/authorization)
- **Prisma** `Json`→`@db.JsonB` for note content.

---

## Build order (each chunk independently testable)
0. **Skeleton & infra** — workspaces, NestJS + Angular scaffolds, compose (db + hello api + nginx). ✔ single URL loads shell; `/api/health` 200 through proxy.
1. **Data model & Prisma** — schema, first migration, `PrismaService`, admin seed. ✔ admin created; tables in Studio.
2. **Auth** — login/logout/me, argon2, JWT cookie, guards; FE login + guard + interceptor. ✔ protected routes gated.
3. **Access core + Notes CRUD** — **`canAccess()` with its unit tests written first (TDD)**, `NoteAccessGuard`, CRUD + batch-delete. ✔ access matrix green; owner-only mutation.
4. **Decoupled editor + autosave** — `OpenNotesStore`, `<note-editor>`, StarterKit + Underline + Link, debounced `PATCH /content`. ✔ formatting/lists persist; URLs auto-link + open new tab.
5. **Uploads + resizable inline images** — upload endpoint (Multer+sharp+volume), permission-checked serve, paste-to-upload, Image `resize`. ✔ paste/resize persists; non-grantee gets 403 on image URL.
6. **Manager: two views + multi-select** — list (default) + wall + persisted toggle; batch + single delete. ✔ toggle persists; batch deletes only owned.
7. **Sharing & visibility** — endpoints + share dialog. ✔ PUBLIC visible to any user; PRIVATE+grant visible only to grantee; revoke cuts access (incl. images).
8. **Admin users & invites** — admin CRUD + invite create/accept; user list. ✔ invite→accept→login; no open signup exists.
9. **Hardening & e2e** — validation pipes, body-size/mime limits, error UX, Playwright golden-path.

---

## Verification
- **Backend unit (Jest):** exhaustive `canAccess()` matrix (owner/non-owner × PRIVATE/PUBLIC × shared/not × view/edit/delete) — write first.
- **Backend e2e (`@nestjs/testing` + Supertest):** auth cookie flow; notes CRUD + owner-only mutation + viewable-list filtering + batch-delete owner filtering; sharing transitions; **image-serve authz mirrors note access (403 for non-grantee)**. Run against a disposable Postgres.
- **Full-stack e2e (Playwright MCP — `browser_*` tools available here):** golden path against the running Docker stack — login → create note → bold/italic/underline + heading + ordered & unordered list → paste image + corner-drag resize → typed URL becomes clickable new-tab link → share dialog (PUBLIC, then PRIVATE+grant) → toggle wall/list (persists across reload) → multi-select + batch delete. Add a second-user assertion: sees a PUBLIC note, not a non-shared PRIVATE one.

---

## Decisions to confirm during build (flagged, not blocking)
1. **Link click UX while editing** — plan uses `openOnClick:'whenNotEditable'` (links open only in read mode; in edit mode clicking selects). Alternative: hover popover with an "open" button.
2. **Autosave concurrency** — last-write-wins is fine (single owner-editor, no collab), but the owner with two tabs open can clobber. Optional `contentUpdatedAt` optimistic-concurrency check.
3. **Orphaned image files** — DB cascade clears `ImageAsset` rows, but files + images removed from the doc body need a cleanup hook + periodic sweep (maintenance, not MVP-blocking).
4. **`ngx-tiptap` / TipTap 3 version pinning** — small community binding + new `resize` API: pin exact `@tiptap/*` + `ngx-tiptap` versions and verify peer-dep ranges before committing; custom node-view component is the fallback.
5. **Windows dev loop** — bind-mount hot-reload on Windows volumes is slow; develop Node/Angular natively on the host (Node 22.15 present) with compose for Postgres, then full compose for integration/e2e.

---

## Build status (MVP complete — 2026-05-31)

All 9 phases implemented and verified end-to-end. Stack as built: **Angular 21 + ngx-tiptap 14 / TipTap 3.24** frontend, **NestJS 11 + Prisma 6.19 + PostgreSQL 16** backend, **Docker Compose behind nginx** on a single URL (`http://localhost:8080`).

Verified:
- **Dockerized golden path** (fresh login → create note → bold/italic/underline + headings + lists → typed URL auto-links and opens in a new tab → paste image, resizable, served permission-checked via `/api/uploads/:id` → autosave → **all persist across full reload** from Postgres + the uploads volume).
- **Access control:** pure `canAccess()` predicate, 11 unit tests; cross-user denial (non-owner gets 404 on private notes/images, can't mutate or change visibility); 12/12 backend tests pass.
- **Sharing:** PRIVATE↔PUBLIC (public = any logged-in user) + explicit per-user grants, via the share dialog.
- **Admin:** roles guard; admin-only create/list/enable-disable users; **no open signup**; deactivated users lose access immediately (auth guard re-validates the account each request).
- **Manager:** list (default) + masonry wall views with persisted toggle; multi-select + batch delete.

### Deviations from the original plan (all deliberate)
- **Editor library:** Angular 21's StarterKit v3 **bundles link + underline**, so they're configured via `StarterKit.configure({...})` rather than added as separate extensions. Resizable images use TipTap 3's **built-in `Image` `resize` option** (no custom node view needed for the MVP).
- **Prisma pinned to 6.19** (not the newer 7.x) to keep the classic embedded-engine generator and avoid the v7 driver-adapter/ESM setup surface.
- **Admin bootstrap** runs in-app via `OnApplicationBootstrap` (idempotent) instead of a separate seed script.
- **Login cookie `secure` flag** is derived from the actual request protocol (`req.secure` via nginx `X-Forwarded-Proto` + `trust proxy`), so it works over plain HTTP locally and is secure under HTTPS — rather than keying off `NODE_ENV`.

### How to run
- **Prod (single URL):** `cp .env.example .env` (edit secrets) → `docker compose up --build` → open `http://localhost:8080`. Admin is seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **Native dev:** `docker compose -f docker-compose.dev.yml up -d` (Postgres) → `npm run dev:api` + `npm run dev:web`.

### Known follow-ups (non-blocking)
- Orphaned image-file cleanup (DB cascade removes `ImageAsset` rows; files on the volume + images removed from a doc body still need a sweep).
- Autosave is last-write-wins; the optimistic-concurrency guard (`baseContentUpdatedAt`) exists in the DTO but isn't enforced from the client yet.
- `dev`/`prod` stacks share `JWT_SECRET` in the committed `.env`; use distinct secrets per environment in real deployments.
