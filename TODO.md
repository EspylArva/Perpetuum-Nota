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

### 0. Decisions needed first (blockers — answer these and the rest is mechanical)

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

### 1. Build the images for the NAS architecture

- [ ] Ensure Docker Buildx is available (for cross-arch builds from this amd64 PC).
- [ ] Build `stickynotes-api` and `stickynotes-web` for the chosen `--platform`
      (`linux/arm64`, `linux/amd64`, or both).
- [ ] Tag with a version (e.g. `:1.0.0` + `:latest`), not just `latest`.
- [ ] **Verify the arch** of the produced images (`docker image inspect ... Architecture`)
      — an arch mismatch is the #1 "exec format error" failure on NAS.

### 2. Deliver images to the NAS (per the decision above)

- [ ] **Tarball path:** `docker save` both images → `.tar` (or one combined), write a
      short `load-images.sh`, document the copy + `docker load` steps.
- [ ] **Registry path:** tag for the registry, `docker push`, document `docker compose pull`.

### 3. Production compose file for the NAS

Produce `docker-compose.nas.yml` (kept separate from the dev/build compose):

- [ ] Use **pre-built image references** (`image:`), not `build:` — the NAS shouldn't build.
- [ ] Wire **storage** per the decision (bind-mounts to the NAS path, or named volumes).
- [ ] Pin image **versions** (no floating `latest` in prod).
- [ ] Keep `db` **not** published to the host; only `web` exposes a port.
- [x] Healthchecks on `db` (have it) **and** `api` — added 2026-06-11 to the main
      compose (`/api/health` + `web` waits on api healthy); copy into the NAS compose.
- [ ] `restart: unless-stopped` on all services (have it).
- [ ] Resource limits (optional but kind to a NAS): modest mem limits per service.

### 4. Production configuration & secrets

- [ ] Create a real `.env` for the NAS from `.env.example` with **strong, unique**
      `JWT_SECRET` and `CSRF_SECRET` (the generator one-liner is in `.env.example`),
      a real `ADMIN_PASSWORD`, and DB credentials. Do **not** reuse the dev values.
- [ ] Decide `secure` cookie behavior vs TLS: cookies already key off `req.secure` via
      nginx `X-Forwarded-Proto` + `trust proxy`. If the NAS reverse proxy terminates TLS,
      confirm it forwards `X-Forwarded-Proto: https` (or add HSTS in nginx then).
- [ ] Confirm `WEB_PORT` doesn't collide with other NAS services (DSM uses 5000/5001, etc.).

### 5. First-run on the NAS

- [ ] `docker compose -f docker-compose.nas.yml up -d`.
- [ ] Confirm the api entrypoint runs `prisma migrate deploy` and seeds the admin on first boot.
- [ ] Smoke test: load the URL, log in as admin, create a note, paste an image, reload.
- [ ] Confirm data survives a `down`/`up` (volume/bind-mount persistence) and a NAS reboot.

### 6. Docs

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
- [ ] Folders appear on the grid with the number of notes they contain. Double clicking 
      a folder opens it. Opened folder are displayed in a window with a close button and
      a similar grid. 

### Admin panel
- [ ] Temp password can be auto-generated in the create-user form.
- [ ] Reset password for an existing user (admin sets/generates a new temp password —
      complements the self-service change and the env break-glass).

---

## Ideas from other note apps (researched 2026-06-12 — NOT implemented)

Surveyed: Notesnook, Trilium, Synology Note Station, Joplin (3.x), Obsidian (incl. 2025
"Bases"), Evernote (incl. v11, Jan 2026). Only features that exist in none of our app and
aren't already in the backlog above; app names in parentheses credit the inspiration.
Cross-references marked ↔ where an idea pairs with an existing backlog item.

### Capture, import & export
- [ ] **Web clipper** browser extension — clip a page, selection, or screenshot into a
      note (Evernote, Joplin, Notesnook, Trilium, Note Station — the one capture feature
      every surveyed app has). Needs a token-based API auth path for the extension.
- [ ] **Importers**: Evernote `.enex`, Joplin JEX, Obsidian/markdown folder → notes with
      tags/images mapped (every app; Notesnook ships a dedicated importer). Biggest
      switching-cost killer for new users.
- [ ] **Full-vault export** to a markdown or HTML zip (complements per-note export and
      BACKUP.md; every surveyed app has an all-data export — useful as a no-lock-in
      guarantee).
- [ ] **Audio attachments + voice typing** (Joplin 3.3 audio recordings, 3.4 Whisper-based
      voice typing; Note Station audio notes). Voice typing only if a local/offline model
      is feasible — no cloud STT.
- [ ] Email-to-note inbox (Evernote) — niche for a LAN NAS deployment; record only.

### Files & search depth
- [ ] **Arbitrary file attachments** (PDF, docs, zip…) served through the same
      permission-checked endpoint as images (all surveyed apps; we are images-only).
- [ ] **OCR**: extract text from images/PDF attachments into `contentText` so search finds
      it (Evernote; Joplin, which is even moving toward handwriting/HTR). Server-side
      tesseract — watch CPU/RAM cost on a NAS.
- [ ] **Search operators**: `tag:x`, `in:trash`, `is:pinned`, `has:image`,
      `before:/after:` (Joplin/Evernote/Trilium all have a search DSL; ↔ backlog
      min/max-date filter).
- [ ] **Saved searches** pinned to the sidebar (Trilium Saved Search, Note Station smart
      notebooks) — any filter+query combination becomes a named view.
- [ ] Semantic search over notes (Evernote v11 headline) — only viable self-hosted via
      local embeddings + pgvector; record as optional/heavy.

### Organization & metadata
- [ ] **Note version history** with restore + diff view (Evernote history, Trilium
      revisions, Joplin note history, Notesnook session history, Note Station versioning
      — universal among surveyed apps, and the natural extension of our autosave-409
      machinery; snapshot on save-debounce with retention).
- [ ] **Per-note colors** (Notesnook) — very fitting for a sticky-notes wall; needs a
      dark-theme-aware palette mapping rather than raw hex.
- [ ] **Reminders/notifications** for notes (Evernote reminders, Notesnook recurring
      reminders, Joplin alarms) — ↔ backlog due dates: due date is the data, this is the
      delivery (web push / in-app toast; recurring optional).
- [ ] **Note templates** (Evernote, Obsidian templates + variables, Trilium template
      notes) — a note is already seed JSON (PLAN.md noted this); add a "save as
      template" + "new from template" flow.
- [ ] **Daily notes / journal** entry point: one keystroke opens today's note, created on
      demand (Obsidian daily notes, Trilium day notes; ↔ backlog calendar).
- [ ] **Custom note properties** (key:value) shown in a panel and queryable (Trilium
      attributes, Obsidian properties); the maximal version is an Obsidian-Bases-style
      **table/database view** over notes filtered by properties (Obsidian 1.9, 2025).
- [ ] Bookmarks/shortcuts sidebar section for favorite notes, tags, and saved searches
      (Evernote shortcuts, Obsidian bookmarks) — distinct from pinning (which sorts).

### Editor
- [ ] **Tables** (TipTap Table extension) — every surveyed app has tables; we have none
      and it's not in the backlog above.
- [ ] **Mermaid diagrams** from fenced code blocks (Trilium, Obsidian, Joplin plugin) —
      text-to-diagram, renders fully offline.
- [ ] **Slash commands** (`/` insert menu: heading, list, table, image, date…) including
      dynamic date mentions like `@Today` (Evernote v11 added 16 slash commands; Notion
      pattern).
- [ ] **Outline/TOC panel** generated from headings, click-to-scroll (Obsidian outline).
- [ ] Markdown source mode toggle per note (Joplin dual editor) — power-user escape hatch;
      our storage stays ProseMirror JSON, so this is a converter, not a new format.
- [ ] Editor extras: callouts/admonitions and footnotes (Obsidian 1.9 ships a footnotes
      view) — record; prioritize behind the backlog formatting items.

### Security & privacy
- [ ] **Per-note vault**: lock individual notes with a password, client-side encrypted,
      auto-relock after inactivity (Notesnook vault, Trilium protected notes, Note
      Station encryption). Server stores ciphertext for vaulted notes — search and
      previews must gracefully exclude them.
- [ ] App lock: require re-auth after N minutes idle (Notesnook app lock) — cheap privacy
      win on shared machines, independent of the JWT lifetime.

### Sharing & collaboration
- [ ] **Publish to public link** ("monograph": Notesnook monographs, Obsidian Publish) —
      optional password, expiry, or view-once self-destruct. ⚠ PLAN.md deliberately
      excluded anonymous links from the MVP threat model; adopting this requires a
      conscious decision + rate limiting and abuse controls on the public endpoint.
- [ ] Comments on shared notes (Note Station) — lets grantees give feedback without
      edit rights (which stay owner-only today).
- [ ] Presentation mode: render a note as slides (Note Station, classic Evernote) — low
      priority, pairs well with H1/H2 structure.
- Real-time co-editing (Yjs) is already recorded as the headline v2 bet in REVIEW.md —
  not duplicated here.

### Wall / canvas
- [ ] **Edges between wall cards**: draw labeled arrows/connections card-to-card,
      Obsidian-Canvas-style (canvas connections now even feed Obsidian's graph) —
      ↔ backlog graph view and `[[wikilinks]]`; the wall already has the spatial half.

### AI (record only — self-hosted constraint)
- [ ] Evernote v11 ships an AI assistant, semantic search, and AI meeting notes. For this
      app, any AI feature should be opt-in and local-model-only (no data leaves the NAS);
      otherwise out of scope.
