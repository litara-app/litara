# ADR-0107: Use one filter format for library search and smart shelves

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0066](0066-private-annotations-and-shelves.md), [ADR-0085](0085-stackable-filter-groups.md)

## Context

The API publishes two filter trees for selecting titles. Smart shelves ([ADR-0066](0066-private-annotations-and-shelves.md), grammar in `contracts/t005/README.md`) use `ShelfFilter` (formerly `T005Filter`): `all`, `any` and `not` nodes over nine fields with `equals` and `contains`, at most 4 levels including the rule, 32 rules and 32 KiB. Library search ([ADR-0085](0085-stackable-filter-groups.md)) uses `TitleFilter`: `AND` and `OR` groups over 16 fields with 13 operators, at most 3 group levels and 30 rules. ADR-0085 left feeding smart shelves from its tree to a later decision.

No API version has been released. After the first release, [ADR-0082](0082-api-compatibility-policy-and-enforcement.md) keeps both shapes in `v1`.

Observed in the code (`reading/smart.go`, `catalog/titlefilter.go` and the `title_rows` function) on 2026-11-26. Library search cannot yet express everything a smart shelf can:

- It has no tag field.
- Its format field lists ebook formats and the single value `audio`, not audio file formats.
- Its language field has no `contains`.
- Smart shelves compare text after Unicode NFC normalization; search only lowercases it.
- It has no `not` node. A negation can be rewritten with negative operators and swapped joins, if every field has the negative operators.
- "In progress" differs. A smart shelf matches a title when any edition or recording has a position and that same item is unfinished. Search's `reading` status excludes a title once any of its editions or recordings is finished.

The web app creates a smart shelf with a single rule. Library search has a full rule builder. No use of `ShelfFilter` was found in the Litara Android client.

## Decision

On 2026-11-26 the repository owner chose to move smart shelves to the library search filter format, and then chose:

- **In progress:** smart shelves use search's `status` (`unread`, `reading`, `finished`). A title with any finished edition or recording is not `reading`.
- **Library rules:** allowed on shared smart shelves as well as private ones.
- **Rating rules:** allowed, and evaluated against the viewer's own rating. This extends ADR-0066's list of what a shelf may filter on (public catalog metadata and the viewer's own progress and completion).

Later on 2026-11-26 the owner accepted this record as a whole, including the exception to ADR-0066 for library IDs. The accepted decision also includes:

- A smart shelf's `filter` is a `TitleFilter`. `ShelfFilter`, `ShelfFilterGroup`, `ShelfFilterNot` and `ShelfPredicate` are removed. Search and shelves share one validator and one query compiler.
- Library search, and so smart shelves, gain:
  - a `tag` field with `is`, `is_not`, `contains`, `not_contains`, `is_empty` and `not_empty`, matching the title tags and granted edition tags that smart shelves match today;
  - audio file formats as `format` values, keeping `audio`;
  - `contains` and `not_contains` on `language`;
  - NFC normalization of both stored text and rule values.
- No `not` node is added.
- ADR-0085's limits (3 group levels, 30 rules) apply to both. A smart shelf also keeps the 32 KiB stored-filter limit and must hold at least one rule, because an empty search tree matches every title.
- A shared smart shelf's filter is sent to viewers unchanged, including the IDs in its library rules, even IDs of libraries a viewer cannot access. This is an exception to ADR-0066's statement that non-owners cannot see unavailable IDs. The rule holds IDs only, not library names or contents, and grants no access. Each viewer's results stay limited to their own granted libraries.
- Other fields that search offers (publisher, published, added, pages, series number and the content flags) are allowed. A shared shelf is still evaluated with each viewer's grants and state.
- The web app edits smart shelf filters with the library rule builder.
- The API change is recorded as named waivers while the API is in development.
- No data conversion is built. Development databases are recreated, as under [ADR-0030](0030-consolidate-preproduction-migrations.md).
- The files in `contracts/t005/` stay as agreed. The contract comparison records the difference.

This record amends ADR-0066 (filter fields, their meaning, and which IDs non-owners can see) and ADR-0085 (shelf use and new fields).

## Alternatives

- Keep both formats. No work now, but both become permanent in `v1`, and new fields or fixes may be needed twice.
- Move search to the smart shelf format. It has a stricter schema and a `not` node, but has fewer fields and operators, and the search endpoint and rule builder would need rewriting.
- Accept both formats on smart shelves. Nothing breaks, but both remain to be maintained.
- Keep the any-item meaning of "in progress" as a separate rule. It preserves today's shelf results, but the library table and shelves could disagree about whether a title is being read.
- Allow library rules only on private shelves. No library ID reaches other users, but shared shelves cannot select by library. This was the earlier recommendation.
- Allow library rules on shared shelves but remove inaccessible IDs from what viewers receive. No unavailable ID is shown, but viewers would receive a filter that differs from the one evaluated.

## Consequences

One format and engine, more smart shelf fields, and a path to saved filters (still undecided). `TitleFilter` is typed more loosely than `ShelfFilter`: one node shape, with values of any type that the server checks, so generated clients get less help. Some existing smart shelf results would change, because of the new in-progress meaning. Filters allow 30 rules where smart shelves allowed 32. NFC normalization changes which text search matches. Adding the tag field and audio formats is expected to change `title_rows` in the initial migration, so development databases need recreating. A viewer of a shared shelf can learn the ID of a library they cannot access, and that the owner filtered on it. A rule such as "library is" an inaccessible library matches none of the viewer's titles. "Library is not" that library excludes none of them. Smart shelf result order (by title ID) is not changed by this record.

## Verification

Planned, after acceptance; none is done:

- Table tests for the new fields and operators, including negations and NFC and decomposed forms of the same text.
- Each former smart shelf field has an equivalent rule, and its negation returns the complementary titles.
- Two users see viewer-specific results for a shared shelf, including rating and status rules, without gaining titles outside their grants.
- On a shared shelf with a library rule, a viewer without that library's grant receives the stored filter, and no titles, counts or library names from it, for both `is` and `is_not`.
- A smart shelf with no rules, too many rules, too much depth or over 32 KiB is refused.
- `go test ./...`, the API compatibility check with its waivers, the contract comparison, web tests and a browser check of creating and editing a smart shelf.

## Open questions

None within this record's scope. Saved filters remain undecided (ADR-0085).
