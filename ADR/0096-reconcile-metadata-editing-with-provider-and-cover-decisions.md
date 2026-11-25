# ADR-0096: Reconcile ADR-0095 with the Hardcover, auto-fill and cover decisions

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amends: [ADR-0095](0095-field-level-metadata-editing-and-provider-review.md)

## Context

[ADR-0095](0095-field-level-metadata-editing-and-provider-review.md) was accepted on 2026-11-21 on a branch that did not reach `main`, where it was numbered 0065. It was restored as ADR-0095 on 2026-11-24 without being compared with the records that `main` had accepted in the meantime. Three of its statements disagree with other Accepted records:

| Topic | ADR-0095 says | Other Accepted record says |
| --- | --- | --- |
| Providers | Hardcover is not selected; keep the ADR-0049 set. | [ADR-0087](0087-hardcover-provider-search-cache-and-reviewed-autofill.md) (2026-11-21) adds Hardcover, off until a library lists it and the operator sets a token. |
| Auto-fill | Gap-only, on an identifier-unambiguous match; everything else is reviewed. Decision 3 and the planned check "needs a unique consistent identifier match". | [ADR-0090](0090-auto-fill-from-a-single-title-and-author-match.md) (2026-11-22) adds a title-and-author case, a per-library setting that is off by default, and requires review and Save for every auto-fill, identifier matches included. |
| Cover sources | In the first release: file upload and provider candidate. Arbitrary-URL fetching is not included. | [ADR-0086](0086-cover-replacement.md) (2026-11-20) includes upload, a guarded fetch of a URL, online search (Open Library and iTunes, off until an administrator enables it) and regeneration from the file. |

On order: Git shows ADR-0095's original commit at 2026-11-21 18:53 and the commit adding ADR-0087 at 19:25 the same day. A commit time does not show when a decision was made. ADR-0086 was committed on 2026-11-20, before ADR-0095, so for covers the later record is the narrower one. It does not mention ADR-0086, and date order alone does not settle which one the owner intends.

Code observations on `main`, not runtime tests: the server registers the `cover/from-url` route, has a `title_author` auto-fill rule, and its tests refer to a `hardcover` provider.

## Decision

On 2026-11-25 the repository owner accepted all three changes below ("Accept all three"). They amend only the matching statements; the rest of ADR-0095 stays in force.

1. **Providers.** The selected metadata providers are those of ADR-0049 plus Hardcover under the conditions in ADR-0087. ADR-0095's statement that Hardcover is not selected no longer applies. Goodreads, Amazon and Audible remain undecided under [ADR-0088](0088-goodreads-amazon-and-audible-metadata.md). iTunes is not a metadata provider; its use for cover search is governed by ADR-0086.
2. **Auto-fill.** Decision 3 of ADR-0095, and the sentences in its Consequences and Verification that depend on it, are read together with ADR-0087 and ADR-0090: auto-fill stays gap-only; it uses an identifier match, or the title-and-author case when the library has turned that on; its result is shown as unsaved changes and nothing is stored until Save.
3. **Cover sources.** ADR-0086 governs which cover sources exist and their limits. ADR-0095's limit to upload and provider candidate, including the exclusion of arbitrary-URL fetching, no longer applies. Choosing a candidate cover in the metadata tab remains allowed within ADR-0086's rules.

This record selects no new provider, cover source or auto-fill rule.

## Alternatives

- **Keep ADR-0095's cover limit.** URL fetching would then be outside the accepted scope. That needs an amendment to ADR-0086 and removal or disabling of the existing route, which must follow the API compatibility policy in [ADR-0082](0082-api-compatibility-policy-and-enforcement.md).
- **Mark ADR-0095 Superseded and write a full replacement.** One self-contained record, at the cost of restating the parts that do not conflict.
- **Edit ADR-0095 in place.** Rejected by the ADR rules, which preserve the original decision and rationale.

## Consequences

Readers of ADR-0095 are directed to the newer rules, and its per-field editing, concurrency, provenance and separate write-back decisions are unchanged. ADR-0095 keeps its original text and gains an "Amended by" link. The existing fetch-by-URL route stays within ADR-0086.

## Verification

Check `scripts/Validate-Adrs.ps1` and that the links run in both directions. This record changes no application behavior.

Not verified: that the server and web behave as ADR-0086, ADR-0087, ADR-0090 or ADR-0095 describe. In particular, ADR-0095 separates `edited` from `locked`, with a lock also blocking reviewed provider apply. A text search of the server, migrations and web source found no separate lock flag, and the web metadata tab labels user-sourced values "Locked". That needs its own code review; it is not a conflict between records and this record does not change the requirement.

## Open questions

None within this record's scope.
