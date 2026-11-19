# Backup and restore rehearsal

Exercised with `python scripts/t007/backup_restore.py` (`research/t007/evidence/m3-backup-restore/`). A rehearsal on one host, not a retention or backup policy.

Inventory (what the rehearsal backed up): the PostgreSQL database (`pg_dump -Fc`), the roles/globals (`pg_dumpall --globals-only`; only `postgres` here), the media root, the login secret key and the SMTP key ring. Regenerable caches (the comic page cache) are not backed up. Stop the server before the dump so the set is consistent.

Restore steps used: create an empty database; `pg_restore --no-owner --exit-on-error`; put the media back **at the same absolute path**; start the server with the same keys against the new database.

Verified after restore: titles, editions, positions, annotations, completion, shelves and shelf membership, conflicts, KOReader credentials, libraries and users matched the source API output exactly (0 differences); an authenticated Range read of an original returned 206; fixture media were byte-identical to the backup; no secret appeared in output or the restored server log.

Known constraints:

* File locations are stored as absolute paths. Restoring media to a different directory made reads fail closed with 503 until the path matched. A path-update procedure does not exist.
* Starting with the SMTP key ring missing or under a different id leaves everything else intact; the encrypted SMTP password cannot be opened without its original key.
* Not exercised: audio recordings and playback after restore, queued deliveries, KOReader sync after restore, restore onto another host or a newer server version, point-in-time recovery, large databases.
