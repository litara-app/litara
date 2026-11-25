# ADR-0095: Edit metadata per field with locks, provenance and reviewed provider apply

Status: Accepted
Date: 2026-11-21
Decision owner: Repository owner
Amended by: [ADR-0096](0096-reconcile-metadata-editing-with-provider-and-cover-decisions.md) (2026-11-25): Hardcover is selected (ADR-0087), auto-fill also follows ADR-0090, and cover sources follow ADR-0086. Also amended by [ADR-0097](0097-metadata-field-locks.md) (2026-11-25): a locked field must be unlocked first, only an explicit lock locks, and unlock keeps the value.

## Context

The user wants an Edit Metadata tab like the BookOrbit one (screenshot reviewed 2026-11-21): every catalog field editable, a per-field lock, a completeness score, provider search/auto-fill, cover replacement, and a separate "write to file" action. The tab must also pull from metadata providers.

Accepted decisions already fix the policy: ADR-0014 (protect edits/locks, explicit overwrite and write-back), ADR-0047 (protected edits/clears, then sidecar, embedded, provider gaps; an explicit clear is a protected value; fields absent from a source never delete), ADR-0049 (opt-in Open Library, Google Books, Audnexus; no file uploads), ADR-0060 (per-library provider order; auto-fill only on an unambiguous identifier match; uncertain matches go to review) and ADR-0048/0051–0053/0057 (reviewed write-back). The screenshot also shows Goodreads, Hardcover, Amazon, iTunes and Audible providers; those are not selected, and the user chose on 2026-11-21 to keep the ADR-0049 set.

What is not yet decided is the user-facing and wire behavior that ties these together. This record proposes it. See [the tab specification](../research/t004/edit-metadata-tab.md) for fields, layout, and flows.

## Decision

The user accepted this record, including the answers below, on 2026-11-21:

1. **Editing is per field.** Saving sends only changed fields. Each field has a state: `inherited` (from sidecar/embedded/provider), `edited` (user value), `cleared` (deliberate empty, protected per ADR-0047) and `locked` (user edit or inherited value frozen against all unattended sources). An edited field is protected whether or not it is locked; a lock additionally blocks even reviewed provider apply until the user unlocks it.
2. **Provider pulls always go through a per-field diff review.** Search returns candidates with a match explanation; picking one opens current-versus-candidate per field. The user chooses fields to apply. Locked and cleared fields are shown but not preselected; applying one requires unlocking or an explicit per-field override. Applying provider values changes the stored catalog metadata only, never file bytes.
3. **Auto-fill is gap-only.** It runs only for an identifier-unambiguous match with consistent metadata (ADR-0060) and fills empty, unlocked, uncleared fields. Everything else becomes review.
4. **Edits use optimistic concurrency.** Saves carry the revision the form was loaded from; a stale save returns a conflict listing changed fields so a queued enrichment or other user's edit is never silently overwritten (ADR-0047 commit-time protection).
5. **Provenance is returned per field** (source, provider/candidate id, fetched time, state) so the tab can explain every value.
6. **Write to file is a separate, reviewed action** under ADR-0048; saving the tab never touches files.

## Alternatives

- Auto-apply the top provider result, as BookOrbit's Auto-fill appears to: rejected by ADR-0060.
- Whole-record save (last write wins): simpler, but loses ADR-0047 race protection.
- A single lock per record instead of per field: too coarse for ADR-0014.
- Per-field edit/lock/review, as proposed here.

## Consequences

The API needs field-granular patch, state and provenance shapes, plus a provider search/candidate/apply flow, all inside T004's contract; none of that exists yet. The web tab belongs to T005 and depends on T003/T004. Provider calls only run for libraries that enabled them, and the tab must show disabled, missing-key, rate-limited and unavailable states. The score and its missing-field list are derived from stored values and carry no policy weight.

## Verification

Planned, none done: saving one field leaves others untouched; a cleared field survives rescan and enrichment; a locked field is not preselected or applied without override; a stale revision returns a conflict; a queued enrichment racing with an edit cannot overwrite it; auto-fill needs a unique consistent identifier match; several search hits go to review; disabled provider states render; file bytes are unchanged after save and provider apply.

## User answers on open questions (2026-11-21)

The user answered these and then accepted the record as a whole.

- **Entity:** edition-centered tab with a title section in the same form; audio recordings get narrator/duration fields in their own section.
- **Clear representation:** an explicit per-field state in the patch (`value: null` with state `cleared`); an absent key means unchanged.
- **Lock storage:** a per-field state table keyed by entity and field, holding state, source and provenance. Locks stay with the entity they were set on.
- **Covers in the first release:** upload from file and selection from a provider candidate. Arbitrary-URL fetching is not included.
- **Completeness score:** not selected for the first release.

## Open questions

- Whether title-level locks are shown read-only when editing from another edition of the same title.
- Cover size/type limits and where covers are stored.
- Exact provider field mappings and candidate schema (T004 contract work).
