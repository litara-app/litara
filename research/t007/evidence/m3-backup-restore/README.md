# M3 evidence: disposable backup/restore rehearsal (2026-11-17)

Command: `python scripts/t007/backup_restore.py` (PostgreSQL 17 in Docker, Windows 11, disposable stack from `scripts/t007/stack.py`). Raw results: `run.json`. This is a rehearsal, not a production backup/retention or schema-upgrade policy.

Result: PASS. Source state (comic position, note annotation, completion, private shelf, KOReader credential, encrypted SMTP password, titles, editions, libraries, users) was snapshotted through the API, the server stopped, and database (`pg_dump -Fc`), globals, media root, secret key and SMTP key ring backed up. Restored into a fresh database, fresh cache and a second server: all snapshots equal the source exactly (0 differences), the media tree equals the backup byte for byte, an authenticated Range read of a restored original returns 206, and no secret appears in output or the restored server log.

Findings (observed):
* Library file locations are stored as absolute paths. Restoring media to a different directory makes reads fail closed with 503 `temporarily_unavailable`; restoring to the same path works. Operators must restore to the same mount path (or a path-update procedure is needed: decision for coordinator).
* With the SMTP key ring missing, or a different key id, the server starts and reports `keyAvailable=false`; all other state is intact.
* With the same key id but wrong key material, `GET /admin/delivery/smtp` reports `keyAvailable=true` (it checks only that the id exists), while the connection test fails safely with `configuration_unavailable`. The report can overstate key availability.

Not covered: process-kill recovery, queued-delivery and KOReader sync-state restore under load, audio recordings, roles other than `postgres`, cross-version restore, restore on another host.
