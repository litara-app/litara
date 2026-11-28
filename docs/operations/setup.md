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
* Operator write-back switch: `ctl writers list|enable FORMAT --evidence PATH|disable FORMAT`. EPUB, MP3, FLAC, M4A and M4B are built in and disabled by default. The audio writers accept title edits. See [audio writer qualification](../../research/t007/evidence/m2-audio-writers/README.md) for supported layouts and the evidence reference.

## KOReader progress sync

In KOReader, set **Progress sync → Custom sync server** to your Litara app origin followed by `/1`, for example `https://books.example.com/1`. Use **Login** with the KOReader device credential generated in Litara. Set up the OPDS catalog separately under `/opds/v1`.

## Settings file (.env)

The server reads `KEY=value` lines from a `.env` file in the folder it starts in, or from the file named by `LITARA_ENV_FILE`. Copy [.env.example](../../.env.example) to `.env` and fill in provider tokens there. `.env` is ignored by Git. Anything already set in the real environment wins over the file, so a deployment's own settings are never overridden. The server logs the names it read, never the values. Restart the server after editing. Compose deployments should keep using the environment.

## Metadata providers

Enable providers in each library that should use external metadata. Set `LITARA_OPEN_LIBRARY_CONTACT` to a monitored operator email address if you want Open Library to identify this instance. Litara sends the contact in its Open Library User-Agent. Leave the setting unset for anonymous access. Open Library requests are paced at up to 1 per second anonymously or 3 per second with a contact. [Open Library API guidelines](https://openlibrary.org/developers/api)

Hardcover ([ADR-0087](../../ADR/0087-hardcover-provider-search-cache-and-reviewed-autofill.md)) is also available once the operator sets `LITARA_HARDCOVER_TOKEN` (a Hardcover API token, kept in server configuration only) and a library lists it; without a token it shows as not set up and is never contacted. Provider searches from the Edit metadata tab are cached in memory for `LITARA_PROVIDER_SEARCH_CACHE_MINUTES` minutes (default 10; 0 turns the cache off). Google Books without `LITARA_GOOGLE_BOOKS_API_KEY` is often rate limited by Google's shared anonymous quota.

Goodreads ([ADR-0115](../../ADR/0115-goodreads-through-its-graphql-endpoint.md)) is off until a library lists it and needs no setup. It is unofficial: Litara uses the GraphQL endpoint and public key of the Goodreads website, Goodreads does not offer them to other applications, its terms of use do not permit automated collection, and it can block or change them at any time. Searches send an ISBN or a title. When a library lists it, its images also appear in the online cover search (if that is turned on). If every Goodreads search shows as unavailable, the key has probably changed: set `LITARA_GOODREADS_API_KEY` (and `LITARA_GOODREADS_ENDPOINT`, an `https://` address, if that moved too) and restart. The current values are the `x-api-key` header and address of the GraphQL requests a Goodreads book page makes, visible in the browser's developer tools.

Google Books and Audnexus each start at one request per second. These budgets are shared by library jobs in one server process. Litara can retry a throttled request once within its 15-second lookup budget and honors longer Retry-After cooldowns across jobs. Open Library responses can be cached in memory for up to 15 minutes when response headers permit it. Audnexus remains an opt-in ASIN lookup.

### Author and series lookups

Administrators can look up authors and series from their pages ([ADR-0102](../../ADR/0102-editable-lockable-author-data.md), [ADR-0103](../../ADR/0103-series-data-and-missing-books.md)). Hardcover is asked first and Open Library only when Hardcover gives nothing, and only when a library holding that author or series enables them. A lookup sends the author's name, or the titles, authors and ISBNs of a few books in the series. Nothing is saved until an administrator applies it.

Litara keeps its own copies of the author photos you apply and of covers for the books a matched series is missing. It shows them only to signed-in users who can see that author or series, and links to the source on the author and series pages ([ADR-0106](../../ADR/0106-provider-text-and-images.md)). The author directory shows applied photos without a link of its own.

**If your server is reachable by the public, check the providers' terms first.** Hardcover's images are uploaded by its users, and its documentation says that anyone showing them publicly needs a DMCA takedown policy. No license was found for Open Library author photos or biographies. Neither provider has confirmed that this use is allowed.

## Damaged EPUB or KEPUB

An edition marked **Damaged file** still has its catalog entry, history, and authorized original download. Replace the damaged file at its existing library path and run a scan. Litara checks the replacement under its new content version and clears the damage issue when its basic EPUB structure passes.
