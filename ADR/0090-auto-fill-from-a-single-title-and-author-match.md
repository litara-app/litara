# ADR-0090: Let auto-fill use one clear title-and-author match when a book has no identifier

Status: Proposed
Date: 2026-11-22
Decision owner: Repository owner

## Context

ADR-0060 and ADR-0087 allow auto-fill only when a provider returns exactly one candidate that matches the book's identifier (ISBN or ASIN) and whose title and authors agree with what is stored. Everything else is sent to review.

On 2026-11-22 the owner tried Auto-fill on a test copy of Treasure Island and got "No single exact match to fill from". The book had no ISBN, so every result, however obvious, went to review. The owner found this odd because the match looks easy. Many real books have no ISBN in the file, so under the current rule Auto-fill will often do nothing for them.

## Decision

Proposal, not approval. Keep ADR-0060's identifier rule and add one more case. Auto-fill may also apply a result when all of these hold:

- the book has no identifier to match on, or none that any provider recognises;
- exactly one provider candidate was returned, from one provider, so a second result or a second provider's disagreeing result sends it to review;
- the candidate's title equals the book's stored title after the normalisation that already exists (case, accents, punctuation), not a partial or similar title;
- every author in the book's stored list appears among the candidate's authors, and the candidate adds none the book contradicts;
- the language, when both sides state one, is the same, so a translation is not taken for the original;
- it fills only fields with no stored value, never replaces a protected edit, a deliberate clear or a value from the files, and stores the provider and candidate as provenance like any other fill.

The result says which rule applied ("matched by title and author, no ISBN") so a person can tell it from an identifier match. The Edit metadata tab keeps search and review for everything else.

## Alternatives

- Keep the identifier-only rule: safest against a wrong book being filled in. Costs a manual review for every book without an ISBN.
- Accept the first or best-ranked result: rejected by ADR-0060 ("never select merely the first search result").
- Show the single match pre-selected in the review window and apply it on one click: no automatic filling, no risk of a wrong fill, one more step for the person. Cheaper to build and a possible middle path.
- A per-library switch for this rule, off by default: gives the owner control and keeps ADR-0060's behaviour unless chosen.

## Consequences

More books can be filled without review. A different book with the same title and authors, such as another edition, a translation or a series entry that repeats a title, could be matched wrongly. Fills are gap-only and stored with provenance, so a wrong fill can be reset field by field, and a person can lock a field to keep it. ADR-0060 would be amended, not removed: its identifier rule stays. If accepted, ADR-0060 and ADR-0087 should be marked as amended and linked both ways, and the explanations in the result text updated.

## Verification

Planned, not yet done: a single exact title-and-author result without an ISBN is applied to empty fields only; two results, two providers, a partial title, a different author list, a different language, a protected or cleared field and a failed lookup each send it to review or leave it alone; the result names the rule used; an identifier match behaves as before; the Treasure Island test copy fills.

## Open questions

- Should this be on for everyone, or a per-library setting that is off by default?
- Is the equal-title, author-subset and same-language rule right, or should it be stricter or looser?
- Should one provider agreeing be enough, or must two providers agree before anything is filled?
- Would the owner prefer the one-click pre-selected review instead of automatic filling?
