# ADR-0090: Let auto-fill use one clear title-and-author match when a book has no identifier

Status: Accepted
Date: 2026-11-22
Decision owner: Repository owner
Amends: [ADR-0060](0060-provider-priority-and-identifier-match-review.md) and [ADR-0087](0087-hardcover-provider-search-cache-and-reviewed-autofill.md); both keep their identifier rule.

## Context

ADR-0060 and ADR-0087 allow auto-fill only when a provider returns exactly one candidate that matches the book's identifier (ISBN or ASIN) and whose title and authors agree with what is stored. Everything else is sent to review.

On 2026-11-22 the owner tried Auto-fill on a test copy of Treasure Island and got "No single exact match to fill from". The book had no ISBN, so every result, however obvious, went to review. The owner found this odd because the match looks easy. Many real books have no ISBN in the file, so under the current rule Auto-fill will often do nothing for them.

## Decision

On 2026-11-22 the owner answered the open questions below: the rule is right as proposed, it is a per-library setting that is off by default, and auto-fill may fill every field the match has. The person can then reset single fields or all of them if the match was bad, and saves once it looks right. The owner also decided that the review-then-save step applies to identifier matches as well, so every auto-fill is reviewed before it is saved, and that an unsaved fill is discarded as soon as the person leaves the page.

Keep ADR-0060's identifier rule and add one more case. When the library's setting is on, auto-fill may also use a result when all of these hold:

- the book has no identifier to match on, or none that any provider recognises;
- some provider returned a candidate with that exact title and author list (see the revision below for how one is chosen among several);
- the candidate's title equals the book's stored title after the normalisation that already exists (case, accents, punctuation), not a partial or similar title;
- every author in the book's stored list appears among the candidate's authors, and the candidate adds none the book contradicts;
- the language, when both sides state one, is the same, so a translation is not taken for the original;
- it fills only fields with no stored value, never replaces a protected edit, a deliberate clear or a value from the files.

Review before saving (chosen by the owner, for identifier matches too): Auto-fill on the Edit metadata tab shows the fill as unsaved changes. Each filled field can be reset on its own, there is a Reset all, and Save writes what is left with provider and candidate as provenance. Nothing is stored until Save. This needs auto-fill to be able to return the values without writing them, an additive change under ADR-0082. Leaving the page, switching tab or switching book discards any unsaved fill; it is never kept for later. A fill that is not wanted leaves no trace.

The result says which rule applied ("matched by title and author, no ISBN") so a person can tell it from an identifier match. Search and review stay for everything else. The setting lives in each library's settings and is off by default, so the title-and-author case does not run until it is turned on. Identifier matches still work as ADR-0060 says, with the added review step before saving.

## Revision, 2026-11-22: several records of the same work

A live check on the Treasure Island test copy showed the "exactly one candidate" condition never holds for a common title. Open Library returned five records, three of them exactly "Treasure Island" by Robert Louis Stevenson, and Google Books was unavailable, which the first version also treated as a block. The owner chose to take the best-ranked exact result.

The title-and-author case now works like this. It applies only when the library's setting is on and no candidate matched by identifier. Going through the library's providers in their configured order, it takes the first provider that has a candidate whose normalised title equals the book's title and whose authors include every stored author (and whose language is the same when both state one). Within that provider it takes the best-ranked such candidate. A partial or similar title, a candidate with other authors, and a provider that failed or has no exact candidate do not block it; they are skipped. If no provider has an exact candidate, the result goes to review as before. The other conditions are unchanged: only empty fields are filled, and every fill is reviewed before saving.

This is looser than ADR-0060's "never select merely the first search result": several records for one work are treated as one work, and a different book with the same title and authors can be taken. The review step, gap-only filling and provenance are what limit that harm.

The alternative the owner declined was to require two providers to agree on the same title and authors, which is safer but fires less often.

## Alternatives

- Keep the identifier-only rule: safest against a wrong book being filled in. Costs a manual review for every book without an ISBN.
- Accept the first or best-ranked result: rejected by ADR-0060 ("never select merely the first search result").
- Show the single match pre-selected in the review window and apply it on one click: no automatic filling, no risk of a wrong fill, one more step for the person. Cheaper to build and a possible middle path.
- A per-library switch for this rule, off by default: gives the owner control and keeps ADR-0060's behaviour unless chosen.

## Consequences

More books can be filled without review. A different book with the same title and authors, such as another edition, a translation or a series entry that repeats a title, could be matched wrongly. Fills are gap-only and stored with provenance, so a wrong fill can be reset field by field, and a person can lock a field to keep it. ADR-0060 would be amended, not removed: its identifier rule stays. If accepted, ADR-0060 and ADR-0087 should be marked as amended and linked both ways, and the explanations in the result text updated.

## Verification

Covered by tests under the revision: with the setting on and no ISBN, the best-ranked exact title-and-author candidate is proposed, even with several records of the work, partial-title hits ranked above it, and a failed provider before it; with the setting off, a partial title only, another author list, another language or an identifier-matched candidate with a different title send it to review; a protected or cleared field is not overwritten; the result names the rule used; an identifier match behaves as before; the Treasure Island test copy fills.

## Open questions

None within this record's scope.
