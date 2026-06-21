# DEPLOY.md — Perpetuum Nota on the NAS

The app runs on the NAS as three containers (`db`, `api`, `web`) pulled from a
self-hosted **Zot** OCI registry on the NAS itself. Images are built **once on a
build machine** (this PC), pushed multi-arch + cosign-signed to Zot, and the NAS
pulls them with [docker-compose.prod.yml](docker-compose.prod.yml).

```
build PC ──build multi-arch (amd64+arm64) + cosign sign──▶ scripts/deploy-to-zot.sh
                                                              │  push (curl / HTTP1.1)
                                                              ▼
                       Zot registry on the NAS  (https://lil-nas-x.tail27f957.ts.net:5000/)
                                                              │  docker compose pull (127.0.0.1:5000)
                                                              ▼
                       db + api + web  ──Tailscale Serve──▶ https://lil-nas-x.tail27f957.ts.net:8445
```

## Endpoints

| What                              | URL                                          |
| --------------------------------- | -------------------------------------------- |
| App (public, via Tailscale Serve) | https://lil-nas-x.tail27f957.ts.net:8445     |
| Zot registry (push target)        | https://lil-nas-x.tail27f957.ts.net:5000/    |
| Zot registry (NAS-local pull)     | 127.0.0.1:5000                               |

## 1. Build + push the images (on the build PC)

One-time prerequisites:

- Docker + Buildx.
- arm64 emulation for the cross-build:
  `docker run --privileged --rm tonistiigi/binfmt --install arm64`
- `cosign` on `PATH` (or `~/cosign.exe`), plus the signing key pair `cosign.key` /
  `cosign.pub` in the repo root.
- `node` (the script walks the OCI layout with a tiny CJS helper).
- A `.env` in the repo root containing:
  - `ZOT_URL=https://lil-nas-x.tail27f957.ts.net:5000/`
  - `COSIGN_PASSWORD=…` (password for `cosign.key`)
  - registry credentials — either `ZOT_USERNAME` / `ZOT_PASSWORD`, **or** run
    `docker login lil-nas-x.tail27f957.ts.net:5000` once (the script falls back to
    the Docker credential store).

Build, push, sign, and verify all three images:

```bash
bash scripts/deploy-to-zot.sh
```

This builds `api` and `web`, mirrors `postgres:16-alpine`, pushes them to
`<ZOT>/perpetuum-nota/{api,web,postgres}`, cosign-signs each, and verifies the
platforms + signatures. Override the arch for a single-arch build, e.g.
`PLATFORM=linux/arm64 bash scripts/deploy-to-zot.sh`.

**Versioning.** `api` and `web` are pushed under **both** a concrete version tag
and `:latest`. The version defaults to `git describe` (nearest tag + commit, or
the short sha when untagged, plus `-dirty` for an unclean tree); override it with
`VERSION=1.2.0 bash scripts/deploy-to-zot.sh`. The `api` image bakes the version,
commit, branch, build time, and author in as env vars, surfaced at
`GET /api/info` and in the app's **Settings → App info** panel. The script prints
the exact tag it pushed and the `API_TAG`/`WEB_TAG` line to pin it on the NAS.

Verify a signature from anywhere:

```bash
cosign verify --key cosign.pub lil-nas-x.tail27f957.ts.net:5000/perpetuum-nota/api:latest
```

## 2. Configure secrets (on the NAS)

Copy `.env.example` → `.env` in the deploy directory and set **strong, unique**
values (never reuse the dev values). Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`
- `JWT_SECRET`, `CSRF_SECRET` (unique each)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `WEB_PORT` (internal host port; Tailscale Serve maps `:8445` → this)

## 3. First run (on the NAS)

From the directory holding `docker-compose.prod.yml` + `.env`:

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env pull
sudo docker compose -f docker-compose.prod.yml --env-file .env up -d
```

On first boot the api runs `prisma migrate deploy` and seeds the admin from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. Open https://lil-nas-x.tail27f957.ts.net:8445,
log in as admin, create a note, paste an image, and reload to smoke-test.

(`sudo usermod -aG docker $USER` then re-login lets you drop the `sudo`.)

## 4. Where data lives & backups

Two named Docker volumes:

- `pgdata` — PostgreSQL data.
- `uploads` — uploaded images (`/data/uploads` inside the api container).

These are **named volumes**, so NAS snapshot tools don't see them as plain files —
back them up through Docker. See **[BACKUP.md](BACKUP.md)** for the dump/restore +
image-archive procedure and the break-glass admin reset
(`ADMIN_FORCE_PASSWORD_RESET`).

## 5. Update to a new version

1. On the build PC: `bash scripts/deploy-to-zot.sh` (rebuild + repush + re-sign).
2. On the NAS:
   ```bash
   sudo docker compose -f docker-compose.prod.yml --env-file .env pull
   sudo docker compose -f docker-compose.prod.yml --env-file .env up -d
   ```

New migrations apply automatically on api boot.

**Pinning a release (for reproducible rollbacks).** The compose file pulls
`:latest` by default but honors `API_TAG` / `WEB_TAG`, so you can pin the exact
version tag the build printed (set them in `.env`, or inline):

```bash
API_TAG=1.2.0 WEB_TAG=1.2.0 sudo docker compose -f docker-compose.prod.yml --env-file .env pull
API_TAG=1.2.0 WEB_TAG=1.2.0 sudo docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Confirm what's actually running at **Settings → App info** (or `GET /api/info`),
which reports the version/commit/build time baked into the live `api` image.

## Notes / gotchas

- The NAS pulls from `127.0.0.1:5000` (loopback), which dockerd trusts over HTTP —
  no `insecure-registries` entry and no login are needed for the pull. Bare
  `perpetuum-nota/…` names would resolve to Docker Hub and fail with "access denied",
  so the compose file names the local registry **explicitly** on purpose.
- TLS is terminated by Tailscale Serve. If `secure` cookies misbehave, confirm
  `X-Forwarded-Proto: https` reaches the api (nginx + `trust proxy` are already
  wired); otherwise add HSTS / force-secure in nginx.
- `db` is internal-only; `/api/uploads/*` is proxied through nginx
  (permission-checked), never served as a static alias.
