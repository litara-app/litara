# ADR-0104: Defaults for the author and series pages

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0101](0101-authors-by-last-name.md), [ADR-0102](0102-editable-lockable-author-data.md), [ADR-0103](0103-series-data-and-missing-books.md)

## Context

[ADR-0101](0101-authors-by-last-name.md), [ADR-0102](0102-editable-lockable-author-data.md) and [ADR-0103](0103-series-data-and-missing-books.md) left questions open that block building the pages chosen in the [Authors and Series mockups](../design/mockups/reading-room-authors-series.html). The owner was offered a three-stage plan (new pages; editing; online data) with a recommended default for each blocking question.

## Decision

On 2026-11-26 the owner accepted all of the recommended defaults.

The work is built in three stages: (1) the new pages, (2) editing, (3) online data, each as its own pull request. The pages follow the mockups.

In stage 1:

- Authors without a photo show their initials, and a series page lists missing numbers as [ADR-0100](0100-author-and-series-directories.md) describes.
- **Continue reading** opens the most recently read unfinished book of the author or series, or otherwise the first unread one.
- The **Listen** and **Add to shelf** buttons on author and series pages are left out, because their meaning for several books is not defined.
- The A–Z filter and last-name sorting wait for stage 2, with the name rules and corrections.

Defaults for later stages:

1. **Editing access:** an administrator who can access a library containing the author or series can edit it. Changes are shared by everyone who sees it.
2. **Last names and A–Z:** the last name is guessed from the last word, keeping common surname prefixes such as "Le" and "van" with it and handling suffixes such as "Jr.". Any guess can be corrected. A first-name sort stays available, and the letters filter the list.
3. **Saved details:** authors have a last name, introduction, biography and photo. Series have a description, number of books and status. When a name changes, the saved details are kept, not deleted or moved automatically; the renamed author or series does not inherit them.
4. **Online services:** a service can be used if it is enabled in any library containing the author or series that the editing administrator can access.
5. **Lookups:** they run only on request and are reviewed before use. There is no auto-fill or automatic refresh yet.
6. **Missing books:** published, whole-numbered main books are shown, including those after the last one owned. Novellas, collections and unreleased books are left out.

Separately, on 2026-11-26 the owner permitted using their Hardcover token for testing. The [live test](../research/author-series-sources.md) ran the same day: author text and photos and series members and covers were returned; the three series checked had no description.

## Alternatives

- Settle each question as its stage starts: fewer early commitments, but each stage would stop for answers.
- Build everything in one change: one review, but nothing usable until the provider questions are settled.

## Consequences

Stage 1 needs only additive read fields ([ADR-0082](0082-api-compatibility-policy-and-enforcement.md)) and stores no new data. Stored author and series data starts in stage 2. If the live test or usage terms show Hardcover does not work for Litara, the provider order is revisited with the owner.

## Verification

Planned for each stage. Stage 1: library grants limit every new count and cover ([ADR-0013](0013-library-access-local-login.md)); the pages work in the Reading Room and Clean themes, light and dark, and at phone width; Continue reading follows the rule above.

Stage 1, 2026-11-26: Go test `TestAuthorAndSeriesDirectories` covers the new series covers, finished and series counts, the most-books order, Continue reading (nothing started, a later book in progress, finished books skipped) and an account without a grant. Web tests cover the cards, shelf filter, previous and next, missing-book places and the Continue button. Checked in Chromium against a local instance: Reading Room light and dark and Clean light had no sideways scroll, and the button opened the reader. At phone width every page, including ones this stage did not change, scrolls sideways by the width of the top bar's buttons. Not checked: Clean dark, other browsers, and the audiobook path in a browser.

## Open questions

- Rules for family-name-first, single and corporate names beyond what a correction can fix.
- The terms for storing and showing provider text and images.
- Photo storage limits.
- Which other book behaviors apply to author and series editing, such as revision conflict handling.
