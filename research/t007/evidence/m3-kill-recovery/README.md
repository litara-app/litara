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

## Not covered
Kill during import staging/publication (open), KOReader state/candidate restarts, kill during a metadata write-back replacement, kill under concurrent load, Linux/container process supervision, graceful-shutdown behavior, and the missing/wrong SMTP key restart (covered separately in `../m3-backup-restore/`).
