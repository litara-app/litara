# ADR-0094: Store a highlight's colour and style in the annotation

Status: Proposed
Date: 2026-11-23
Decision owner: Repository owner

## Context

The shared reader frame (ADR-0093) can draw each highlight with its own colour (a hex value) and style (highlight, underline, squiggly, strikethrough). The Android reader already lets a reader choose both per highlight and keeps them in its local database. The server's annotation `data` (contracts/t005) has only `kind`, `anchor`, `selection`, `text` and `quote`, so the web app cannot choose or show a colour or style, and an Android highlight loses both when it is synced or opened elsewhere. The web app therefore does not send these fields to the frame yet.

Annotations are replayable by client-generated UUID, carry a base revision, and an unknown field in `data` is a contract question under ADR-0082 (the `/api/v1` API must not break a third-party client).

## Decision

Proposed, not approved. Add two optional fields to an annotation's `data` for highlights and notes with a text selection: `color`, a CSS hex colour (`#rgb` or `#rrggbb`, at most 9 characters), and `style`, one of `highlight`, `underline`, `squiggly`, `strikethrough`. Absent means the kind's default look (today's yellow highlight, blue note). The server validates and stores them, ignores them for bookmarks, and returns them unchanged. They are editable like `text`: a change is a new revision. Clients that do not know the fields keep working, and an older client that rewrites an annotation without them resets it to the default look, which is the same as today.

Apply this additively with `ctl api-baseline update`, and send the fields from the web reader's highlight popup (a small palette and style choice) and from Android's sync.

## Alternatives

- Keep colour and style local to each client. No API change, but a highlight looks different on every device and an Android highlight loses its look on the web.
- Store a free-form string or CSS. More flexible, but untrusted display data that every client must sanitise. A fixed palette of names would be simpler still, but cannot carry Android's existing custom colours.
- A fixed palette of named colours. Safer and themeable (dark mode), but Android's stored values would need mapping, and a later palette change would be a contract change.

## Consequences

Benefits: one look across web and Android, and Android's existing choice survives sync. Costs: an additive API change with a snapshot update, server validation, a sync mapping on Android, and a popup control on the web. A hex colour may be hard to read on a dark theme; clients may adjust drawing but must not rewrite the stored value. Annotations written before this change show the default look.

## Verification

Planned: API compatibility check passes with only additive snapshot changes; server tests for valid, invalid and absent values and for revision conflicts; a web test that a highlight keeps its colour and style across reload; an Android sync round trip; the frame protocol check with a stored value. Not yet done.

## Open questions

- Hex colour or a fixed named palette?
- Should the style apply to notes with a selection as well as highlights?
- Should the stored colour be adjusted for dark themes at draw time, or stored per theme?
- Does Android's local colour name set map to hex on upload, or does Android migrate to hex?
