# ADR-0085: Let library filters stack into AND/OR groups

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner
Amended by: [ADR-0107](0107-one-filter-format-for-search-and-smart-shelves.md) (2026-11-26): smart shelves use this tree, and it gains a tag field, audio file formats, `contains` on language and NFC text matching.

## Context

The library page filters with one value per field, all combined with AND (author, series, publisher, language, format, status, rated), as added under T009. The owner wants filters that stack and nest, with groups combined by AND or OR, so a query like "(author is Doyle OR author is Christie) AND format is EPUB AND NOT finished" is possible.

BookOrbit, pinned in [research](RESEARCH.md), already does this. Its `GroupRule` is a recursive tree: a group has `join: 'AND' | 'OR'` and a list of rules or child groups; a rule has `field`, `operator`, `value` and an optional `valueTo`. The server validates each rule against a table of operators allowed per field (`FIELD_OPERATORS`), rejects unknown fields, caps list values at 20 and checks dates and numbers (`group-rule.validator.ts`). The client builder shows an indented rail per group headed "All of / Any of these", rows of field, operator and value, "Add filter" and "Add group" per group, a row menu (duplicate, wrap in group, ungroup, remove), a maximum depth, a live match count and a summary of the active filter. This is a code observation of the BookOrbit source, not a Litara behavior.

The current `/api/v1/titles` list takes flat query parameters. [ADR-0082](0082-api-compatibility-policy-and-enforcement.md) allows only additive change within `v1`.

## Decision

On 2026-11-20 the repository owner chose mockup A (a rule builder) and the answers below.

- **API.** `POST /api/v1/titles/search` takes a JSON body with an optional filter tree, the literal `q`, `libraryId`, `mediaKind`, `sort`, `order`, `page` and `size`, and returns the same `T009Titles` as `GET /titles`. The flat `GET /titles` parameters keep working unchanged. Both go through one compiler, so they cannot disagree.
- **Tree.** `{type: "group", join: "AND"|"OR", rules: [...]}` and `{type: "rule", field, operator, value, valueTo}`, the shape BookOrbit uses. The server validates every rule against a fixed catalogue of fields and the operators each accepts, and compiles to parameterized SQL; a field name selects a catalogue entry and is never written into SQL.
- **First-release fields.** Title, author, series, publisher, language, format, status, library, rating (stars, half steps), published (year), added (date), pages, series number, and the content flags has ebook, has audiobook and has description. Operators: is, is not, contains, does not contain, is empty, is not empty, greater than (or equal), less than (or equal), between, before, after; each field accepts the ones that make sense for it. List values are up to 20 strings.
- **Limits.** Depth 3 and 30 rules per filter; a refusal is HTTP 422 and nothing runs.
- **Saved filters.** Not in this decision; the tree stays in the page URL so it can be shared.
- **UI.** The mockup A rule builder: indented AND/OR group rails with "All of / Any of", rows of field, operator and value, Add filter and Add group per group, and Apply and Clear.
- **Not included.** A "has cover" flag: ebook covers are generated from the files on demand, not stored, so there is nothing true to filter on. It can be added when ebook covers are recorded.

## Alternatives

- Keep flat filters only. Simple, but cannot express OR or nesting.
- Parse a text query language (`author:Doyle OR format:epub`). Compact and shareable, harder to make discoverable and to validate for users.
- Client-side filtering of loaded rows. Rejected: it breaks with endless scroll and large libraries ([ADR-0084](0084-tanstack-virtual-for-long-lists.md)).
- A JSON tree validated and compiled by the server (recommended).

## Consequences

A new, additive API surface that must be recorded with `ctl api-baseline update` and the contracts. The server needs a field and operator catalogue shared by the validator, the SQL compiler and the web builder. Query cost needs limits (depth, rule count, timeouts). The flat parameters stay supported for the whole `v1` window ([ADR-0082](0082-api-compatibility-policy-and-enforcement.md)).

## Verification

Planned, after acceptance: table tests for every operator on every field; a tree with AND inside OR inside AND returns the expected titles; invalid fields, operators, depth and size are rejected with 422; no SQL injection through values (tested with hostile strings); the flat parameters still behave as before; `go test ./...` and the API compatibility check pass; the web builder is covered by tests and checked in the browser in both views. Nothing is verified yet.

## Open questions

- Saved and named filters, and feeding smart shelves from a tree (a later decision).
- A live match count while editing (the first build shows the total after Apply).
- Ebook cover presence as a filterable fact.
