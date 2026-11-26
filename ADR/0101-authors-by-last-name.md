# ADR-0101: Sort and filter authors by last name by default

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amends: [ADR-0100](0100-author-and-series-directories.md)
Amended by: [ADR-0104](0104-author-and-series-page-defaults.md) (2026-11-26): answers several open questions below.

## Context

[ADR-0100](0100-author-and-series-directories.md) sorts the author directory by name as written, which usually means by first name. It recorded that as an implementation default the owner had not chosen. While reviewing the [Authors and Series mockups](../design/mockups/reading-room-authors-series.html), which add a row of letters above the authors, the owner was asked whether authors should sort and filter by last name or first name by default.

## Decision

On 2026-11-25 the owner chose **last name**. By default, the author directory is ordered by last name, and its letter filter groups authors by the first letter of the last name. Under H, for example, "Ambrose Hale" appears.

Also on 2026-11-25 the owner chose to **allow corrections**: the application guesses each author's last name, and the guess can be corrected for any author. A correction replaces the guess for sorting and letter grouping.

This replaces only ADR-0100's default of sorting authors by name as written. An author's identity (a name matched ignoring case) and the rest of ADR-0100 are unchanged. Series ordering is unchanged.

## Alternatives

- First name, or the name as written: needs no interpretation of names and was the previous default, but is not how most libraries order authors.
- Guess only: needs no stored data, but leaves wrong guesses in the wrong place.

## Consequences

Authors are stored as one name string, so the last name has to be derived or supplied. Taking the final word is wrong for some names, such as multi-word surnames ("Ursula K. Le Guin"), suffixes ("Jr."), family-name-first names and single or corporate names. Corrections have to be stored per author, which ADR-0100 did not need because it keeps no author records. ADR-0100's rule that an author is a name matched ignoring case still stands; the shape of the stored data, and any aliases or merging, are not decided here. Until the change is implemented, the application still sorts by name as written. Endpoint changes must stay additive under [ADR-0082](0082-api-compatibility-policy-and-enforcement.md).

## Verification

Planned, not yet done: the default author order and letter grouping follow the last name, with test cases for the name forms listed above once their rules are chosen; a corrected last name moves the author in both the order and the letter groups, and persists.

## Open questions

- The rules for the guess with multi-word surnames, suffixes, family-name-first, single and corporate names.
- Who may correct it, and what happens to a correction when the author's name changes in title metadata.
- How corrections are stored, and whether the same author data also holds photos and biographies.
- Whether the interface also offers a first-name sort, as the mockup does.
- Whether the letter row filters the list (as the mockup does) or jumps within it, and the endpoint shapes it needs.
