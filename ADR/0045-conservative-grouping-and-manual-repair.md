# ADR-0045: Group conservatively and preserve identities through manual repair

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0006 accepts title → edition/recording → physical file rather than folder identity. It leaves grouping confidence and merge/split controls open. Multiple narrations, translations and abridgements cannot safely be collapsed by display title alone.

## Decision

The user selected the following on 2026-11-13:

- Use consistent identifiers/metadata and clear audiobook folder/disc structure for automatic grouping.
- Keep translations, different narrators and abridged recordings distinct.
- Leave uncertain title/edition relationships for review.
- Provide manual merge/split controls that preserve file IDs and history.

## Alternatives

- Manual grouping for everything.
- Group mainly by folder/filename.
- Conservative evidence-based grouping with review and repair, as selected.

## Consequences

Translations remain distinct editions and different narrations/abridgements distinct recordings; they may relate to the same work/title under ADR-0006. Folder layout may suggest an audio-file set but cannot itself define title identity. Contradictory metadata must not be silently ignored to force a match. Manual merge/split records explicit associations and preserves original file/content-version anchors, completion/history and conflicting progress rather than rewriting or dropping them. Produce explainable grouping evidence and review states, not an unexplained confidence score.

## Verification

Planned for T004: same title/different narrators, translation under one title with separate editions, abridged versus unabridged, multi-disc ordering, conflicting identifiers, uncertain metadata and manual merge/split with saved progress/history. No implementation tests were run in this decision session.

## Open questions

ADR-0061 now selects audio ordering and provisional automatic linking rules. Exact deterministic matching fixtures must be frozen in the T004 brief. Cross-format position conversion and default recording-selection UI remain outside this record’s scope.
