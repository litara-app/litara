# ADR-0094: Store a highlight's color in the annotation

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner

## Context

This record was first proposed on 2026-11-23 to store both a color and a style. Parts of that proposal's background were wrong. Observed in the code on 2026-11-26:

- Android offers five fixed highlight colors (yellow, green, blue, pink, orange). It has no custom colors and no style picker.
- Android's code uses two different blues: `#38BDF8` in the color picker and `#60a5fa` when the shared reader maps a color name.
- The Litara ebook reader always draws the plain highlight style. It keeps the chosen color only on the device, so it is lost when a highlight is synced or opened elsewhere.
- The web app has no color picker. It draws highlights yellow and notes blue.
- The shared reader frame (ADR-0093) can draw a given color and style.

The server's annotation `data` (contracts/t005) has only `kind`, `anchor`, `selection`, `text` and `quote`. The `/api/v1` API must not break a third-party client (ADR-0082).

## Decision

On 2026-11-26 the repository owner accepted the recommendation:

- An annotation's `data` gains one optional field, `color`, holding a **color name**: `yellow`, `green`, `blue`, `pink` or `orange`. Hex values are not stored.
- **Color only.** No style is stored. Styles can be added later as another optional field.
- It applies to highlights, and to notes attached to selected text.
- When it is absent, the annotation keeps today's default look.
- Each client chooses the shade it draws for a name and may adjust it for a dark theme. It does not change the stored name.

Follow-on rules needed to carry out that choice:

- The server refuses an unknown color name, and refuses a color on a bookmark or on a note with no selected text.
- The color is editable like the note text: a change is a new revision, with the same conflict handling.
- The change is additive in the API (ADR-0082). A client that rewrites an annotation without `color` resets it to the default look.
- The web app and Android both offer the five colors and show the stored one.

## Alternatives

- A CSS hex color. It could carry any shade, but a fixed shade may be hard to read on a dark theme, and it is free-form display data every client must check.
- Color and style, as first proposed. No Litara client offers a style choice today.
- Keep color local to each client. No API change, but a highlight looks different on each device and loses its color on the web.

## Consequences

One color per highlight across web and Android. Adding a color later is a change every client must handle, including older clients that meet a name they do not know; they should draw the default. Annotations saved before this change have no color. A color chosen on Android before this change exists only on that device; it is sent the next time that highlight is saved.

## Verification

Planned: the API compatibility check passes with only additive snapshot changes; server tests for each name, an unknown name, a bookmark, a note without a selection, an absent value and a stale revision; a web test that a chosen color is saved and drawn after reload; an Android sync test in both directions; both clients checked on screen.

## Open questions

None within this record's scope.
