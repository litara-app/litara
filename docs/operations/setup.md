# Clean local setup

Exercised with `bash scripts/t007/package_check.sh` and `bash scripts/backend/smoke.sh` (evidence `research/t007/evidence/m5-package/`).

1. Build the unsigned test image from the repository root: `docker build -f deploy/Dockerfile -t litara-backend:dev .` (linux/amd64). The image carries the server, `ctl`, the web app and reader assets, and the pinned FFmpeg/ffprobe; no host FFmpeg and no downloads at run time (the FFmpeg archive is fetched and hash-checked at build time only).
2. Choose a media directory (`LITARA_MEDIA_DIR`, mounted read-only for index libraries) and a database password (`LITARA_DB_PASSWORD`). Generate the login secret key with `ctl gen-key` inside the image and export it as `LITARA_SECRET_KEY`. Never commit it.
3. `docker compose -f deploy/compose.yaml up -d` starts PostgreSQL, runs `ctl migrate up`, then the server. Ports default to 8080 (app) and 8081 (reader); override with `LITARA_HTTP_PORT` and `LITARA_READER_PORT` when a host service already uses them.
4. Origins: the compose file defaults to `http://app.localhost:PORT` and `http://reader.localhost:PORT` for local browsers. For anything else set `LITARA_PUBLIC_ORIGIN` and `LITARA_READER_ORIGIN` to two **different hostnames** (cookies are not port-scoped; the server refuses equal hostnames). See [tls-and-origins.md](tls-and-origins.md).
5. `LITARA_DEV_INSECURE_HTTP=1` makes cookies non-Secure and exists for local development only; leave it unset behind TLS.
6. First administrator: `ctl bootstrap-admin --username NAME` reads the password from standard input. Libraries, users and grants are created through the API (an `index` library reads a read-only mount; a `managed` library needs a writable root).
7. Not exercised: other Compose profiles, running the binaries outside a container as a service, non-amd64 hosts.

## Keys and secrets

* `LITARA_SECRET_KEY` protects short-lived refresh recovery. The SMTP password key ring is separate: `LITARA_SMTP_KEYS="id:base64key"` with `LITARA_SMTP_ACTIVE_KEY=id` (`ctl gen-key` produces a suitable 32-byte value). A stored SMTP password is bound to its key id; keep the ring with your backups, but not in the same place as the database dump if you want the encryption to mean something.
* Missing ring or a different key id: the server starts, SMTP reports `keyAvailable=false`, and all other state is intact (exercised). The same id with different key material is reported as available but fails the connection test with `configuration_unavailable` (exercised; a known reporting gap).
* `LITARA_SMTP_ALLOW_LOCAL_TEST=1` allows plaintext SMTP to a loopback sink and is for rehearsals only.
* Operator write-back switch: `ctl writers list|enable FORMAT --evidence PATH|disable FORMAT`. Only the built-in `epub` writer exists; other formats cannot be enabled.
