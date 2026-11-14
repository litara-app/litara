# T004 persistence boundary

Extends `contracts/t003/model.md` in the single init migration (ADR-0030). T003 identities are never reinterpreted as paths; no automatic deletion of catalog rows or source files.

| Logical entity | Required state / invariant |
| --- | --- |
| library_config | Library UUID, mode (index existing / managed), canonical root, symlink policy (default exclude), operator root-identity sentinel, scan interval (default 15 min), verification interval (default daily), writeback backups flag (default OFF) + backup location, import template, provider order |
| root_health | Last identity check result and time; absence reconciliation only when healthy; unavailable keeps catalog |
| file_observations | File UUID, relative path, size, mtime, first/last observed, stable flag (two observations >=30 s apart), missing-scan counter (two healthy absences before missing) |
| fingerprints | File version, SHA-256, size+mtime it was computed for, last full verification time; reuse only while stat unchanged |
| content_versions | New version when bytes change at the same path; file ID kept; affected recording layout revision bumped; old positions left unresolved |
| move_candidates | Missing file vs new file, match kind (unique full-hash / ambiguous), review state; only a unique same-library match preserves identity |
| scan_runs | Library, trigger (schedule/event/manual), state, counts, health outcome, job reference; resumable after restart |
| grouping_decisions | Evidence (identifiers, tags, folder/disc structure), result (auto/provisional/reviewed), manual merge/split history preserving file IDs |
| ordering_evidence | Per recording: disc/track tags, natural order, chosen order, conflict flag requiring review |
| associations | Sidecar/CUE to file/edition with candidates list; auto only when exactly one valid candidate; otherwise review item |
| metadata_values | Field, value, source (protected edit / sidecar / embedded / provider), precedence rank, protected-clear flag; edits never overwritten |
| provider_matches | Provider, identifier/strategy, confidence, state (applied / needs review / rejected), raw response bounded and sanitized |
| review_items | Typed queue (move, grouping, ordering, association, provider, import, write) with candidate payloads, grant-scoped, resolution audit |
| import_plans / import_items | Source, rendered target path, collision suffix, duplicate decision, verification hash; copy-only, source retained, approval record |
| writeback_plans / journal | Reviewed diff, target file/version, format writer, staged path, journal stage, backup (optional) ref, recheck result; recovery completes or abandons a verified stage |
| writer_capabilities | Per format (EPUB, MP3, FLAC, M4A/M4B): enabled flag with link to fidelity evidence; disabled by default |
