# TODO — Sticky Notes

Two tracks live in this file:
1. **NAS deployment** (sections 0–6) — blocked on the §0 decisions.
2. **Feature backlog** (last section) — requested 2026-06-12, deliberately **not implemented yet**.

---

## NAS deployment

Goal: build the front + back images and produce a production Docker Compose so the
whole service runs on the NAS. Below is everything still outstanding to get there.

The current `docker-compose.yml` already *builds from source* and runs (db + api + web
behind nginx on one URL). What's missing is making it **NAS-ready**: building images for
the NAS's CPU, getting them onto the NAS, persisting data on NAS storage, and a few
production hardening touches.

---

## 0. Decisions needed first (blockers — answer these and the rest is mechanical)

- [ ] **CPU architecture of the NAS** → determines what we build.
  - ARM64/aarch64, amd64/x86_64, or multi-arch.
  - How to check on the NAS: `uname -m` (`aarch64` → arm64, `x86_64` → amd64).
- [ ] **How images reach the NAS**:
  - **A. `docker save` tarballs** — build on this PC, copy `.tar` files to the NAS, `docker load`. No registry/account needed (simplest for self-hosted).
  - **B. Registry** — push to Docker Hub / GHCR, NAS pulls. Needs an account + namespace.
  - **C. Build on the NAS** — ship source; NAS builds (needs build tools + RAM; the Angular
    build is heavy — heavier still since the 2026-06-12 Material rework — risky on low-end NAS).
- [ ] **Where data lives on the NAS**:
  - **Bind-mount** to a NAS share (e.g. `/volume1/docker/stickynotes/{db,uploads}`) — visible to NAS backup/snapshot tools (recommended). Need the base path.
  - or keep **named Docker volumes** (portable, but hidden from NAS backup tools).
- [ ] **Access details**: the URL/host + port the NAS will serve on (default `8080`), and
  whether TLS is terminated by the NAS reverse proxy (Synology/QNAP app portal) or by us.

---

## 1. Build the images for the NAS architecture

- [ ] Ensure Docker Buildx is available (for cross-arch builds from this amd64 PC).
- [ ] Build `stickynotes-api` and `stickynotes-web` for the chosen `--platform`
      (`linux/arm64`, `linux/amd64`, or both).
- [ ] Tag with a version (e.g. `:1.0.0` + `:latest`), not just `latest`.
- [ ] **Verify the arch** of the produced images (`docker image inspect ... Architecture`)
      — an arch mismatch is the #1 "exec format error" failure on NAS.

## 2. Deliver images to the NAS (per the decision above)

- [ ] **Tarball path:** `docker save` both images → `.tar` (or one combined), write a
      short `load-images.sh`, document the copy + `docker load` steps.
- [ ] **Registry path:** tag for the registry, `docker push`, document `docker compose pull`.

## 3. Production compose file for the NAS

Produce `docker-compose.nas.yml` (kept separate from the dev/build compose):

- [ ] Use **pre-built image references** (`image:`), not `build:` — the NAS shouldn't build.
- [ ] Wire **storage** per the decision (bind-mounts to the NAS path, or named volumes).
- [ ] Pin image **versions** (no floating `latest` in prod).
- [ ] Keep `db` **not** published to the host; only `web` exposes a port.
- [x] Healthchecks on `db` (have it) **and** `api` — added 2026-06-11 to the main
      compose (`/api/health` + `web` waits on api healthy); copy into the NAS compose.
- [ ] `restart: unless-stopped` on all services (have it).
- [ ] Resource limits (optional but kind to a NAS): modest mem limits per service.

## 4. Production configuration & secrets

- [ ] Create a real `.env` for the NAS from `.env.example` with **strong, unique**
      `JWT_SECRET` and `CSRF_SECRET` (the generator one-liner is in `.env.example`),
      a real `ADMIN_PASSWORD`, and DB credentials. Do **not** reuse the dev values.
- [ ] Decide `secure` cookie behavior vs TLS: cookies already key off `req.secure` via
      nginx `X-Forwarded-Proto` + `trust proxy`. If the NAS reverse proxy terminates TLS,
      confirm it forwards `X-Forwarded-Proto: https` (or add HSTS in nginx then).
- [ ] Confirm `WEB_PORT` doesn't collide with other NAS services (DSM uses 5000/5001, etc.).

## 5. First-run on the NAS

- [ ] `docker compose -f docker-compose.nas.yml up -d`.
- [ ] Confirm the api entrypoint runs `prisma migrate deploy` and seeds the admin on first boot.
- [ ] Smoke test: load the URL, log in as admin, create a note, paste an image, reload.
- [ ] Confirm data survives a `down`/`up` (volume/bind-mount persistence) and a NAS reboot.

## 6. Docs

- [ ] `DEPLOY.md` (or a README section): exact NAS steps — load/pull images, place `.env`,
      `up -d`, where data lives, how to back it up, how to update to a new version.

---

### Notes / gotchas already known (carry into the build)
- The backend Dockerfile passes `new ExpressAdapter()` explicitly; multi-stage build
  generates the Prisma client + runs `migrate deploy` on boot. Cross-arch builds must keep
  the `sharp` (image lib) and Prisma engine native binaries matching the target arch — buildx
  handles this when `--platform` is set correctly.
- `db` port is internal-only; `/api/uploads/*` is proxied through nginx (permission-checked),
  never served as a static alias — keep that in the NAS compose.
- ~~PR 2 / PR 3 from the review~~ — **done 2026-06-11** (access-matrix e2e, break-glass
  admin reset, password change, autosave-409, BACKUP.md, shared-with-me, trash, mobile),
  plus search/tags/pins/checklists/duplicate/export. See REVIEW.md.
- **2026-06-12 round** (Material UI + dark theme, admin delete-user, spatial wall grid)
  changes nothing NAS-specific: no new services, ports, or required env vars; the new
  migrations apply automatically on boot like the others. Fonts and icons are self-hosted
  (no CDN), so the app works on a LAN-only NAS with no internet access.
- The NAS `.env` additionally supports `ADMIN_FORCE_PASSWORD_RESET` (break-glass; see BACKUP.md).

---

## Feature backlog (added 2026-06-12 — NOT implemented)

Requested feature set, recorded for planning. Items marked ✅ already exist (noted for
accuracy); everything else is open. Implementation notes in parentheses are hints, not
decisions.

### Features
- [x] ~~Make a table for tags in the database~~ — ✅ already shipped 2026-06-11
      (`Tag` + `NoteTag` tables, owner-scoped, unique per owner).
- [ ] Tags should autocomplete from the list of tags in the database (the tag input is
      free-text today; `GET /api/tags` already returns the candidate list).
- [ ] Open multiple notes in multiple tabs using Ctrl + Click (needs a per-note deep-link
      route, e.g. `/note/:id`, so a browser tab can open one note directly).
- [ ] Contextual menu using right click on a note (open / open in new tab / pin / tag /
      share / duplicate / trash…).
- [ ] Folder system: a note can only be in one folder at a time; folders can have
      subfolders (tree). (Schema: `Folder {id, ownerId, parentId?}` + `Note.folderId?`;
      sidebar tree UI; decide how folders interact with filters/search.)
- [ ] LaTeX-style math support in note content (candidate: TipTap Mathematics extension,
      KaTeX-based — keep self-hosted/offline).
- [ ] Associate a date to a note ("due date"): emphasized when nearing, crossed out when
      passed; filterable by min/max date range.
- [ ] Calendar in the left menu only: notes with a date appear on it; clicking a date
      filters to that date; with a date selected, Shift+Click another date filters by the
      min/max range.
- [ ] Make the left menu collapsible and expandable (desktop; mobile already has the
      over-mode drawer).
- [ ] Note-to-note links via `[[title of another note]]` in the text. Linked notes are
      listed below the tag pills in the same pill style but visually distinct (different
      color). (Needs link resolution by title + storage/refresh of the reference list;
      decide behavior on title rename and on ambiguous titles.)
- [ ] Graph view (Obsidian-style) as a menu entry: notes are nodes; an undirected edge
      exists when either note references the other; note name rendered below each node;
      hovering a node highlights its edges and linked nodes.
- [ ] Button in the top bar to select all notes (current view).
- [ ] Show the author of each note, plus last editor and last edit date. (Author =
      existing `ownerId`; last editor needs a new `lastEditedById` column — only owners
      can edit today, but that changes if shared editing ever lands.)

### Note content formatting
- [ ] Code blocks fenced with triple backticks rendered framed with a slightly different
      background. If possible add syntax highlighting for the language specified after the
      fence. (TipTap CodeBlock already parses ``` fences today; the framed styling and
      language highlighting — e.g. CodeBlockLowlight — are the open parts.)
- [ ] Lines starting with `>` open a quote paragraph emphasized with a vertical line.
      (TipTap Blockquote already parses `>`; the vertical-line emphasis styling is the
      open part.)
- [ ] Markdown-style link support: `[title of link](url)` becomes a link while typing.
- [ ] Text color control.
- [ ] Text size control. (Both likely via TipTap TextStyle + Color/FontSize, with toolbar
      controls; keep the URL-scheme allowlist intact for links.)

### Grid mode (wall)
- [ ] Emphasize the card title by giving it a transparent border.
- [ ] Pan vertically/horizontally by left-click-dragging empty grid space. Panning is
      clamped to (farthest note position + 1 viewport) in each direction.
- [ ] Moving a note (left-click on note + drag) must not open the note editor. (CDK
      suppresses the click after a real drag; verify the under-threshold micro-drag case
      and suppress open on any movement.)

### Admin panel
- [ ] Temp password can be auto-generated in the create-user form.
- [ ] Reset password for an existing user (admin sets/generates a new temp password —
      complements the self-service change and the env break-glass).
