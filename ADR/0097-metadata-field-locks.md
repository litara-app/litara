# ADR-0097: Make metadata locks separate from edits

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amends: [ADR-0095](0095-field-level-metadata-editing-and-provider-review.md)

## Context

[ADR-0095](0095-field-level-metadata-editing-and-provider-review.md) treats `edited` and `locked` as different states. Its first decision says a lock blocks even a reviewed provider apply until the field is unlocked. Its second says applying to a locked or cleared field requires unlocking or an explicit per-field override. Those two statements conflict for locked fields.

On 2026-11-25 the code on `main` was traced. The metadata tables store a source and a protected-clear flag, with no lock state, and the web tab labels every user-sourced value "Locked". Temporary tests reproduced the following:

- "Use all" followed by Apply replaced a user-edited value and a deliberate clear.
- Unlock, which deletes the user value, left a saved auto-fill field empty when no other source had a value.

[ADR-0087](0087-hardcover-provider-search-cache-and-reviewed-autofill.md) already says applying a reviewed value is a protected edit. [ADR-0090](0090-auto-fill-from-a-single-title-and-author-match.md) requires a saved auto-fill to keep provider and candidate as provenance.

## Decision

On 2026-11-25 the repository owner chose:

1. **A locked field must be unlocked first.** A reviewed provider apply cannot replace a locked field, and there is no per-field override for it. An edited or deliberately cleared field that is not locked can be replaced only by choosing that field individually. "Use all" skips locked, edited and cleared fields. This replaces the override in ADR-0095 decision 2 for locked fields only.
2. **A field is locked only when the person locks it.** Typed edits and applied online values stay protected from rescans and unattended lookups, and are shown as edited, not locked.
3. **Unlock keeps the value.** It removes only the lock. A separate "Reset to source" action discards the saved value so that other sources apply again.
4. **A saved auto-fill is a protected edit**, ranked like a manually applied search result. A later sidecar or file value does not replace it. Its provider and match details are kept, as ADR-0090 requires.

## Alternatives

- Allow an explicit per-field override of a locked field. Rejected: a lock would then differ little from an ordinary edit.
- Lock on every manual edit, or on everything saved. Rejected in favor of an explicit lock action.
- Unlock discards the value, with a warning. Rejected: unlocking and discarding are separate intentions.
- Rank a saved auto-fill with online values, below sidecar and file values. Rejected: it would treat a reviewed value differently from a picked search result.

## Consequences

Lock state must be stored separately from the value's source, and the server must enforce it, so that a client cannot replace a locked value by omission. Provider writes must say that they come from a provider and which match, which a plain protected edit does not do today. These need database and API changes. API changes must stay additive under [ADR-0082](0082-api-compatibility-policy-and-enforcement.md), and the schema follows [ADR-0030](0030-consolidate-preproduction-migrations.md). The existing remove-override request keeps meaning "discard the saved value"; unlocking needs its own operation. The rules apply to ebook editions and audiobook recordings, which ADR-0095 both covers.

## Verification

Planned, none done: a locked field is refused by the server for a reviewed apply and is skipped by "Use all" and auto-fill; an unlocked edit or clear changes only when chosen individually; saving or applying a value does not lock it; unlock leaves the value unchanged, including a field with no other source; "Reset to source" restores source priority; a saved auto-fill survives a later sidecar and file change and reports its provider and candidate; edition and recording behave the same.

## Open questions

- May a person type over a locked field directly in the tab, or must they unlock it first? The choices above cover provider applies only.
- How existing user values in development databases are treated when lock state is added. Under decision 2 they would not be assumed locked, but the owner was not asked.
