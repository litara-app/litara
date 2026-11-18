# Crash and restart recovery

All cases below were exercised by killing the real server process hard (`taskkill /F`, no shutdown hooks) with `scripts/t007/*_kill.py`; evidence is in `research/t007/evidence/m3-*`. Queue recovery relies on River's stuck-job rescue: a job that was running when the process died is retried after `LITARA_RESCUE_STUCK_AFTER` (default 5 minutes, must be at least `LITARA_INSPECT_TIMEOUT` + 30 s). Expect that delay after a crash; shorten it only for rehearsals.

| Interrupted operation | Observed result after restart |
| --- | --- |
| Comic page extraction | Manifest stays `processing` with no pages (never partial); the job reruns after the rescue delay; final page count and cache files match the archive; one extraction row |
| Copy-only import (several large files) | Plan resumes; published items are skipped and a partial `.litara-import-*.tmp` is replaced; every target has exactly the reviewed bytes; nothing overwritten; no duplicates after a scan |
| Approved EPUB write-back | Staged copy partial, or complete but not yet journaled: plan `abandoned`, original byte-identical, staged file removed. Journaled `validated`: completed from the journal on start, and the new content version and metadata appear in the catalog. The target is never torn |
| Server SMTP delivery at the submission boundary | Exactly one message at the sink; the ledger settles at `outcome_unknown` after the lease and recovery sweep (about 5 to 6 minutes); never resent automatically; a resend needs explicit acknowledgement of a possible duplicate |
| KOReader progress state | Canonical position, retained candidates, missing baselines and receipt fencing are unchanged; replays are idempotent; conflicts remain resolvable |

Operator actions: none were required for the cases above; check the plan or delivery state through the admin API if the result matters. Not exercised: kills under concurrent load, a container under an orchestrator's restart policy, disk-full during staging, filesystems without hard links (the import publish path then uses a checked rename with a documented tiny race), NAS mounts.
