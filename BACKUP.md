# Backups & Recovery

Two things hold all user data; back up both, together:

| What | Where (Docker) | Contains |
|------|----------------|----------|
| PostgreSQL | volume `stickynotes_pgdata` (service `db`) | users, notes (incl. content JSON + search text), tags, shares, image metadata |
| Uploads | volume `stickynotes_uploads` (service `api`, mounted at `/data/uploads`) | the image files themselves |

A DB dump without the uploads volume restores notes with broken images; uploads
without the DB are unreadable orphans. Snapshot them as a pair.

## Backing up

### Database (pg_dump through the running container)
```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backup/stickynotes-$(date +%F).dump"
```
`-Fc` (custom format) allows selective/parallel restore with `pg_restore`.

### Uploads volume
```bash
docker run --rm \
  -v stickynotes_uploads:/data:ro \
  -v "$(pwd)/backup:/backup" \
  alpine tar czf "/backup/uploads-$(date +%F).tar.gz" -C /data .
```
(Adjust the volume name if your compose project name differs: `docker volume ls`.)

### Sample cron (daily at 03:30, keep 14 days)
```cron
30 3 * * * cd /path/to/stickynotes && \
  docker compose exec -T db pg_dump -U stickynotes -d stickynotes -Fc > backup/db-$(date +\%F).dump && \
  docker run --rm -v stickynotes_uploads:/data:ro -v $(pwd)/backup:/backup alpine \
    tar czf /backup/uploads-$(date +\%F).tar.gz -C /data . && \
  find backup -name '*.dump' -mtime +14 -delete && \
  find backup -name '*.tar.gz' -mtime +14 -delete
```
Copy the `backup/` directory off-machine (NAS snapshot, rclone, etc.).

## Restoring

```bash
# 1. fresh stack, db up (api stopped so nothing writes)
docker compose up -d db
docker compose stop api

# 2. restore the database (drops + recreates objects)
docker compose exec -T db pg_restore -U stickynotes -d stickynotes --clean --if-exists \
  < backup/stickynotes-YYYY-MM-DD.dump

# 3. restore uploads
docker run --rm \
  -v stickynotes_uploads:/data \
  -v "$(pwd)/backup:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/uploads-YYYY-MM-DD.tar.gz -C /data"

# 4. start the rest
docker compose up -d
```

## Admin lockout recovery (break-glass)

If the admin password is lost:

1. Set in `.env`: `ADMIN_FORCE_PASSWORD_RESET=true` and put the desired new
   password in `ADMIN_PASSWORD` (for the account in `ADMIN_EMAIL`).
2. `docker compose up -d api` (or restart the api container). On boot the
   account's password is reset, and its role/active flag restored.
3. Log in, then **remove `ADMIN_FORCE_PASSWORD_RESET` from `.env`** and restart
   once more — while the flag is set, the reset re-applies on every boot.

Note: the app also refuses to deactivate or demote the **last active admin**
(HTTP 409), so the lockout this recovers from is a forgotten password, not an
admin-less instance.

## What you do NOT need to back up
- `dist/`, `node_modules/`, images of the containers — rebuildable from source.
- The nginx container — stateless.

## Trash & retention reminder
Deleted notes sit in the trash for 30 days before a background sweep purges
them (rows + image files). A backup taken before a purge is the only way to
recover notes deleted more than 30 days ago.
