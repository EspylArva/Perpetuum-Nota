# TODO — Make Sticky Notes deployable on the NAS

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
