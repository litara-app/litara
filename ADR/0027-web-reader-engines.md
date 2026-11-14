# ADR-0027: Use pristine Foliate and dedicated PDF.js while preserving Android's reader baseline

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The MIT web component cannot simply import BookOrbit's AGPL-modified reader assets. The Android baseline can retain them under AGPL. Upstream Foliate is MIT and offers multiple ebook parsers, but its API is not stable and its PDF adapter is experimental.

## Decision

The user accepted pristine upstream MIT Foliate for web EPUB/KEPUB, MOBI/AZW/AZW3, FB2 and CBZ reading; integrate PDF.js directly for PDFs. CBR/CB7 use Go archive extraction feeding an image reader. Preserve the existing AGPL Android reader initially rather than replacing both engines in one increment. Verify location behavior using shared fixtures without copying AGPL reader modifications into MIT web source.

## Alternatives

- Replace web and Android reader implementations immediately with pristine Foliate.
- Evaluate another reader engine before selection.
- Independent web adoption with Android preservation, as selected.

## Consequences

Pin a tested Foliate revision and retain MIT/vendor notices. Keep a Litara-owned bridge and UI outside upstream renderer code. PDF highlights/positions and image-page progress need format-specific integration. Enforce content isolation/CSP and validate bridge messages; book scripts must not gain application credentials or unrestricted privileges. Matching engine ancestry does not guarantee exact location compatibility. Archive extraction needs bounded resource use and stable page ordering. This does not select a server parser for all ebook metadata.

## Verification

Planned: test supported-format fixtures, navigation, selection, highlights/notes where applicable, and exact-file resume across layout/font changes. Verify PDF zoom/rotation coordinates, comic page ordering, unsafe embedded content, large-file resource use, and web/Android locator round trips. Preserve Android regression checks; a new web reader has not been implemented in this decision round.

## Open questions

Pinned versions, reader asset packaging, location/annotation schema, isolation mechanism, UI details, PDF metadata extraction, CBR/CB7 parser selection and archive limits remain open.

## References

- [Foliate source and documentation](https://github.com/johnfactotum/foliate-js)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [Android licensing boundary](0017-separate-android-agpl-license.md)
