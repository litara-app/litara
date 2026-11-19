# Troubleshooting and upgrade caveats

* **Server will not start with web enabled:** `LITARA_READER_ADDR` is required with `LITARA_WEB_DIR`, and the two origins must be bare origins with different hostnames.
* **No books appear after adding files:** a file needs two stable observations (`stabilitySecs` apart) before it is cataloged; trigger scans (`POST /admin/libraries/{id}/scans`) or wait for the scheduled scan. A scan already running returns 409 `scan_active`.
* **Original content returns 503 `temporarily_unavailable`:** the media root is unavailable, or the stored absolute file path no longer lies under the mounted root (seen after restoring media to another directory).
* **Comic pages stay `processing` after a crash:** wait for the stuck-job rescue (default 5 minutes).
* **Delivery shows `outcome_unknown`:** the server could not tell whether the message was submitted; confirm with the recipient and resend only with an explicit duplicate acknowledgement.
* **Metadata edits not in the file:** only EPUB in-file writes exist, and only after an operator enables the writer (`ctl writers enable epub --evidence PATH`) and an administrator approves a plan; other formats show a reason in `GET /admin/writers`.
* **`npm ci` fails in a Linux build with npm 11.21:** the lockfile was produced with npm 11.6.2; build with Node 25.2.1 as the Dockerfile pins (open finding for the web owner).
* **Port already allocated:** set `LITARA_HTTP_PORT` and `LITARA_READER_PORT`.

Upgrade caveats: migrations run with `ctl migrate up`; whether a server upgrade may migrate automatically is an undecided production policy (ADR-0030). Restoring a backup into a newer server version, and downgrades, were not exercised. Back up before any migration.
