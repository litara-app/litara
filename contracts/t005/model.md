# T005 persistence and ownership boundary

Extend the integrated T003/T004 model and the single first-party init under ADR-0030. River history remains untouched. Fresh development DB initialization is explicit; never reset an existing user database automatically. Logical names below specify invariants, not mandatory SQL identifiers.

| Entity | Required invariant |
| --- | --- |
| editions | UUID, title/library/file UUIDs, stable identity, revision, language/label, capability/readiness evidence; one active edition per initial ebook file. Same-path replacement retains edition/file IDs but changes current version. |
| edition associations | Strong metadata evidence and protected explicit title links; uncertain association review; title-text match alone is insufficient. |
| reader profiles | Format, pinned engine/build profile, supported locator schema versions/capabilities, limits, known unsupported reasons; no blanket support=true. |
| ebook position state | Unique user/edition, server revision and nullable exact file/version locator; do not replace it from device clock. |
| ebook device evidence | User/server/device/session-scoped candidates, captured/received times and original anchor, preserved on conflict. |
| ebook completion/history | Unique user/edition state revision and finished flag; immutable per-edition title history with file/version; old recording history remains recording history. |
| annotations | UUID, user/edition, revision, kind, exact file/version/typed locator/selection, private text/quote, updated time, tombstone. No owner ID from a write body. |
| shelves | UUID, owner, revision, immutable manual/smart kind, private/shared visibility, name, bounded filter or null, tombstone. Non-owners never edit. |
| manual shelf membership | Unique shelf/title, stable total order; hidden members retained without leaking IDs/counts. No materialized smart membership. |
| T005 operation receipts | Unique user/operation UUID across personal mutation kinds; method/resource/request fingerprint, original status/body, created time; state/history/conflict/receipt committed together. No automatic pruning. |
| T005 personal conflicts | Owner/resource kind/ID, original candidate/base/content version, current context, durable create/resolve evidence and receipt; no arbitrary cross-account/cross-grant reads. |
| extraction state | Unique file/version/profile job, status/manifest/page-entry evidence, accepted limits/reservations, private cache paths, hashes/errors; no user-controlled absolute paths. |
| repair plans | Admin actor and library/title, plan revision/state, immutable input layouts/membership/versions, ordered output partition, approvals, result-ID mapping, receipts. |
| recording tombstones | Retained original recording UUID, reason, source layout, ordered successor links; original user state/conflicts/history retained, active listings exclude tombstones. |
| successor position evidence | User-specific source-recording/file/version anchors valid for a successor; canonical position remains absent until explicit user action. Source completion is historical, not copied as successor completion. |

Indexes/foreign keys must prevent duplicate edition-file assignments, memberships, receipts and extraction jobs. Row locks/CAS and a consistent lock order must make concurrent writes, grant changes, repair application and replay safe. Keep caller ownership and grants in server authorization queries rather than trusting cached UI or filters.

Extend byte/artwork/content access carefully: the existing file resolver depends on granted recording memberships; ebook-only files need granted edition membership without a fake recording. History queries and smart-filter evaluation must not leak another library or private owner state. Unknown/inaccessible object error semantics must remain consistent with existing contracts.

No Android code, archive changes or untested metadata writers belong to this persistence assignment. New models must expose documented normal write paths so a later legacy importer can restore supported state without bypassing revisions/permissions; importer conversion rules are not selected here.
