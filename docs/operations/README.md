# Litara operations notes (local build and rehearsal)

These pages describe what was actually exercised during T007 on a developer machine (Windows 11 host, Docker, PostgreSQL 17, one server process, synthetic data). They are **not** a supported-release runbook: there is no accepted production backup/retention policy, no automatic schema-upgrade policy (ADR-0030 still governs initialization), no signed artifacts and no supported platform other than the linux/amd64 test image. Where a page says "exercised", a script under `scripts/t007/` and evidence under `research/t007/evidence/` back it; everything else is marked "not exercised".

| Page | Contents |
| --- | --- |
| [setup.md](setup.md) | Clean local setup from the test image, first admin, first library, key handling |
| [tls-and-origins.md](tls-and-origins.md) | Two-origin and TLS requirements and what the rehearsal checked |
| [recovery.md](recovery.md) | What happens after a crash during extraction, imports, writes, mail and KOReader sync |
| [backup-restore.md](backup-restore.md) | The disposable backup and restore rehearsal and its limits |
| [troubleshooting.md](troubleshooting.md) | Symptoms seen during the rehearsals, upgrade caveats |
