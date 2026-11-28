# ADR-0114: Physical books in 2.0.0

Status: Accepted
Date: 2026-11-27
Decision owner: Repository owner
Amends: [ADR-0011](0011-first-usable-release.md)

## Context

Litara knows a book only through an ebook file or a recording, so a paper book cannot be recorded. The owner asked for
this option. The [physical books report](../research/physical-books/report.md) describes the uses, what exists today and
five questions.

## Decision

On 2026-11-27 the owner answered the report's questions:

- **Part of 2.0.0.** Physical books are in the 2.0.0 scope. This adds to the list in ADR-0011.
- **Ownership.** A physical copy belongs to a library that others can see. Asked about the recommendation, the owner
  answered "Yes sounds good."
- **Phone scanning** is not needed in the first slice and can be added later.
- **No lending** for now.
- **Page numbers** are allowed for reading a physical book and are not required.

## Alternatives

A copy that belongs to one person only; phone scanning from the start; lending early; reading status only, or required
page numbers; leaving physical books until after 2.0.0.

## Consequences

2.0.0 grows by one feature. Reading a paper book must work with no page number at all. Who sees a copy follows library
access. Nothing here builds lending or scanning.

## Verification

Planned: a copy is visible only to accounts with access to its library; a physical book can be marked as reading and
finished without a page number, and with one; no lending or scanning ships in the first slice. Nothing is implemented.

## Open questions

Later on 2026-11-27, [ADR-0116](0116-physical-copy-records.md) decided how a copy is stored, the first slice, optional CSV
import in 2.0.0, that phone scanning is not required for 2.0.0, how paper reading is counted and the API additions. It
lists what is still open.
