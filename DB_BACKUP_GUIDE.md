# Local PostgreSQL Backup and Restore Guide

This project runs its local PostgreSQL database in Docker via [docker-compose.yml](docker-compose.yml).

## Database location

The local DB is hosted inside the `db` container defined in [docker-compose.yml](docker-compose.yml#L5-L31).

- Database name: `waterapp`
- Username: `waterapp`
- Password: `waterapp_secret`
- Docker volume: `pgdata`

The backend connects using the connection string in [backend/src/db/index.js](backend/src/db/index.js#L1-L9):

```text
postgresql://waterapp:waterapp_secret@db:5432/waterapp
```

## Persistence

The database is persisted because Docker stores the Postgres data files in the named volume:

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
```

That means the DB survives container restarts. It is only reset if you remove the volume, for example:

```bash
docker compose down -v
```

The schema is initialized once on first startup from [backend/src/db/init.sql](backend/src/db/init.sql), and the app does not automatically reinitialize the full database every time.

## Create a backup

From the project root:

```bash
mkdir -p backups

docker exec waterapp-db pg_dump \
  -U waterapp \
  -d waterapp \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  > backups/waterapp-local-$(date +%F-%H%M%S).sql
```

Compressed version:

```bash
gzip backups/waterapp-local-*.sql
```

## Restore a backup

If you want to restore a plain SQL file:

```bash
docker exec -i waterapp-db psql -U waterapp -d waterapp < backups/waterapp-local-2026-10-04-123456.sql
```

If you have a gzip file:

```bash
gunzip -c backups/waterapp-local-2026-10-04-123456.sql.gz | \
docker exec -i waterapp-db psql -U waterapp -d waterapp
```

## Full volume snapshot (advanced)

This is less portable than a SQL dump, but it captures the entire DB volume:

```bash
docker run --rm \
  -v waterapp_pgdata:/data \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'tar czf /backup/pgdata-$(date +%F-%H%M%S).tgz -C /data .'
```

## Recommended workflow

- Back up before making data changes
- Keep SQL dump files under `backups/`
- Restore from SQL dumps when you need a clean local reset
- Use `docker compose down -v` only when you intentionally want to wipe the local database
