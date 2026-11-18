# M4 NAS rehearsal: runbook and dry-run (2026-11-18)

**Status: dry-run only.** `python scripts/t007/nas_check.py --share <folder> --simulate` passed 15/15 on a LOCAL folder (`run-simulated.json`, connection loss simulated by renaming the test subdirectory). No real share has been used yet; the `nas-mounted` gate stays pending.

## What is needed from you (nothing has been mounted, unmounted or touched)
* A **dedicated test share** (SMB or NFS) mounted on this Windows machine as a drive letter, UNC path or mount point, with at least 1 GB free and read/write access. Not a library or share with private data: the script only creates and removes one new subdirectory `litara-t007-<id>` (with a marker file), but a disconnect test should never be run on a share other things are using.
* Say which protocol it is (SMB/NFS), the NAS model/OS and the Windows mount form, so the evidence can name them.
* Agreement that during one step the share will be disconnected and reconnected (about 2 minutes). You do the disconnect (for example unplug/disable that network path, or disconnect the mapped drive); the script never unmounts anything.

## What the script does (all inside the new subdirectory)
1. Measures the share: rename, atomic replace over an existing file, hard links (the import publish path uses them and falls back to a checked rename), case rules, mtime resolution, long names.
2. Starts the disposable server (`LITARA_MEDIA_ROOT` = the subdirectory), creates an index library there, scans synthetic EPUB/PDF/CBZ fixtures, reads an original with an authenticated Range request and compares bytes.
3. Renames a file on the share (the id must stay), replaces a file in place (same id, new content version), runs an approved EPUB write-back (atomic replacement, no staged leftovers, catalog follows).
4. **Waits for you** to disconnect the share: the scan must report the root `unavailable`, mark nothing missing, delete nothing, and originals must answer 503. After you reconnect, the same ids/versions must be available again.
5. Deletes and restores a file: marked unavailable only after confirming scans, never removed; the same bytes re-attach the same file id.
6. Removes only its own subdirectory (unless `--keep`).

While it waits, the instruction is in `.tmp/t007/nas-prompt.txt`; create `.tmp/t007/nas-continue` (or tell Claude) to continue.

## Finding from the dry run (F8)
Files under a library root that is not inside `LITARA_MEDIA_ROOT` are cataloged but their content is refused with 503 (`media.Open` restricts to the media root; the first dry-run attempt hit this). The NAS rehearsal therefore points `LITARA_MEDIA_ROOT` at the share. Open question: the compose file sets `LITARA_MEDIA_ROOT=/media` while managed libraries live under `/library`; whether managed-library originals are served in that layout was not verified here.
