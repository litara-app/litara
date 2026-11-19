# M3 evidence: hard process kill at real boundaries (2026-11-17)

The real `server` binary (disposable stack, PostgreSQL 17) is killed with `taskkill /F` (no shutdown hooks). Raw results: `run.json` here and `../m3-smtp-kill/run.json`.

## Comic page extraction (`python scripts/t007/kill_recovery.py`, run.json here): PASS
* Fixture: 300-page CBZ of 3000x2000 PNGs (6.7 MB). Killed 1.5 s after the request, with partial pages on disk (15 files at the observation, 177 by the time the process was gone).
* While dead and right after restart the manifest stayed `processing` with 0 pages: no partial reader manifest was ever visible. The River job stayed `running`, attempt 1.
* Recovery is by River's stuck-job rescue (here `LITARA_RESCUE_STUCK_AFTER=90s`, default 5 min): ready 94.4 s after restart, 300 pages, 300 cache files (no leftovers), one extraction row, job completed on attempt 2. With the default, recovery takes about 5 minutes after restart.

## SMTP submission boundary (`python scripts/t007/smtp_kill.py`, ../m3-smtp-kill/run.json): PASS
* A local sink (127.0.0.1:2525, synthetic recipient `reader@example.test`, no external mail) accepts a message through the end of DATA and never replies. The server was killed with the delivery in `sending`, attempt 1, `attempt_open` true.
* After restart the sink received no second copy over ~6 minutes. The ledger moved from `sending` to `outcome_unknown` (code `attempt_interrupted`) only after the lease plus recovery sweep (between about 5 and 6 minutes after the kill; the one-minute poll of this script did not capture the exact instant). It never became a resubmission.
* A resend without acknowledging a possible duplicate is refused with 422 `duplicate_acknowledgement_required`.

## In-file write-back (`python scripts/t007/writeback_kill.py`, ../m3-writeback-kill/run.json): PASS, 3 kill points
400 MB EPUB, approved EPUB title/author write, hard kill at (A) partial staged copy (49.7 MB of 419 MB), (B) complete staged copy before the journal advanced, (C) journal at `validated`. After restart: A and B were `abandoned` ("original untouched"): target byte-identical to the original, staged file removed, catalog unchanged. C was `recovered` ("completed from the journal"): the target is the new valid EPUB, the new content version and title/author appear in the catalog (through the metadata refresh added in this task), no staged leftovers. No torn target in any case.

## Copy-only import (`python scripts/t007/import_kill.py`, ../m3-import-kill/run.json): PASS
Managed library, six 150 MB files, killed with 1 item published, 1 copying (a `.litara-import-*.tmp` partial on disk), 4 planned. After restart (River rescue, ~314 s at the default 5 min) the plan completed: 6/6 published with the exact reviewed SHA-256, no temp files, source unchanged, a scan cataloged 6 editions and no duplicate titles. Observation: import targets were named under "Unknown Author" although the files carry an author tag (target naming ignores embedded author at plan time).

## KOReader state (`python scripts/t007/koreader_kill.py`, ../m3-koreader-kill/run.json): PASS, 11/11
Accepted progress, a retained candidate (device without baseline refused with 2007), web position and completion are identical after a hard kill and restart; B's retry is refused again without a new candidate; A's replay is idempotent; the owner can still resolve the conflict.

## Not covered
Kill under concurrent load, Linux/container supervision, graceful-shutdown behavior, kill during sidecar write-back, KOReader receipts after credential revocation, and the missing/wrong SMTP key restart (covered in `../m3-backup-restore/`).
