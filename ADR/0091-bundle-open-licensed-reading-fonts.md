# ADR-0091: Bundle open-licensed reading fonts with the app

Status: Accepted
Date: 2026-11-22
Decision owner: Repository owner

## Context

The reader's font picker (added 2026-11-22) offered four CSS font stacks: Serif, Sans, Humanist sans and Monospace. They name fonts that are installed on some systems and missing on others, so the same choice looks different on each device. Browsers do not let a page list the installed fonts, and the font access API that does exists only in Chromium and asks for permission. The reader frame also runs under ADR-0071's strict policy: `font-src blob: data:` and no network origins, so it cannot load a font from a URL.

## Decision

On 2026-11-22 the owner decided to bundle fonts with the app. Litara ships a small set of open-licensed reading fonts, so each choice looks the same on every device.

- The fonts are SIL OFL 1.1 licensed families, delivered from npm packages and bundled in the web build. Third-party notices and licence texts are preserved in `apps/web/THIRD_PARTY_NOTICES.md`.
- The initial set is Literata (serif, made for long reading), Atkinson Hyperlegible (sans, designed for legibility) and OpenDyslexic. The system serif, system sans and monospace stacks stay as choices, and the book's own font stays the default. The "Humanist sans" stack is dropped because it varied most between devices.
- Only the Latin subset in regular, italic and bold is bundled. Books in other scripts fall back to their own or system fonts.
- A font is fetched by the app origin only when a reader picks it, then handed to the reader frame over the existing message channel as bytes, and the frame creates blob URLs for it. The reader origin's policy does not change.
- Web only for now. The Android reader keeps its own settings.

## Alternatives

- Keep system stacks only: no download, but inconsistent between devices.
- Detect installed fonts: not possible across browsers, and permission-gated where it exists.
- Allow the reader origin to load fonts from its own origin: simpler, but widens the reader policy that ADR-0071 keeps closed.

## Consequences

Consistent type on every device, at a cost of about 100-300 KB of font files, downloaded only when chosen. The set is fixed until another is chosen. Licence notices must be kept. Fonts for other scripts are not provided.

## Verification

Planned and done at implementation: choosing each bundled font changes the book's text in the reader; the reader frame's policy is unchanged; licence texts are present; the font files are not fetched until a font is picked.

## Open questions

The owner chose to bundle fonts but did not name the families. The initial set above is a recommendation that is built now and can be changed. Whether to add a serif with wider script coverage is open.
