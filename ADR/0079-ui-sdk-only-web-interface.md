# ADR-0079: Build the web interface with UI SDK only and remove Mantine

Status: Accepted
Date: 2026-11-19
Decision owner: Repository owner
Supersedes: [ADR-0010](0010-react-mantine-web.md)

## Context

[ADR-0010](0010-react-mantine-web.md) kept React/TypeScript/Mantine for the web app. The T009 setup installed `@ui-sdk/core` and `@ui-sdk/react` beside Mantine, and the owner reviewed four design mockups in `design/mockups/`. The owner chose the "A · Ledger" direction (dense table, inspector pane, top bar) with a sidebar that collapses to an icon rail with flyouts, and recorded [a3-ledger-collapsible.html](../design/mockups/a3-ledger-collapsible.html) as the visual starting point. Running two component systems would give two focus models, two sets of tokens and two accessibility audits. The owner then explicitly decided to purge Mantine and use UI SDK for all web interfaces from now on, excluding mobile.

## Decision

On 2026-11-19 the repository owner chose:

- Remove `@mantine/core`, `@mantine/hooks`, their CSS, provider, theme and the Mantine-specific accessibility overrides from `apps/web`.
- Build every web interface from `@ui-sdk/react` components and `@ui-sdk/core` behaviors. A behavior UI SDK does not ship is built from `@ui-sdk/core` (the skill's component-creation path), not from another component library.
- Pure layout and typography primitives (stack, row, text, heading, card, table, badge, code, empty state) are first-party Litara components under `apps/web/src/ui/`, styled only from design tokens.
- Visual and interaction standards are defined in [design/DESIGN-LANGUAGE.md](../design/DESIGN-LANGUAGE.md). Screens compose the shared components and tokens; they do not carry one-off styles.
- Mobile (Android, [ADR-0005](0005-preserve-native-android-media.md)) is out of scope.
- React, TypeScript and the tooling chosen in [ADR-0069](0069-web-tooling-serving-and-t005-gap-ownership.md) are unchanged.

## Alternatives

- Keep Mantine and add UI SDK beside it, as ADR-0010 and the T009 setup allowed.
- Replace Mantine with Tailwind and a third-party primitive library.
- Remove Mantine and use UI SDK only, as chosen.

## Consequences

UI SDK is a `0.1.0-beta` dependency, so its API may change; versions stay pinned and upgrades are deliberate. Every existing screen and test that touched Mantine must be migrated, which is a one-time cost, and component test selectors change with the markup. Mantine's ready-made layout components, notifications and date or table helpers are replaced by first-party components or UI SDK equivalents. Components render without a default look except what `web.css` supplies, so the design language document carries the burden of consistency. UI SDK exposes agent-readable controls, which becomes a usable property of the web app. This decision does not select a state-management, routing or icon-set choice.

## Verification

Completed on 2026-11-19 in `apps/web`: no source file or dependency references Mantine (enforced by `src/ui/designLanguage.test.ts`); `npx tsc --noEmit` and `npm run build` pass; `npm test` passes all 59 tests (the 53 existing, adapted to the new markup, plus 6 design-language checks); `pwsh -NoProfile -File scripts/Validate-Adrs.ps1` passes.

Browser review (Chromium pane, mock API, 1400 by 820): axe-core with WCAG 2.0 to 2.2 A and AA plus best-practice rules ran on 13 routes plus the listening player, the reader chrome and its drawer, in light and dark. It found badge contrast of 3.84:1 and 4.39:1, skipped heading levels, links in text distinguished only by color, and missing `main` and `h1` landmarks on fullscreen routes; all were fixed and the rerun reports no violations in light and 0 in dark apart from the link item, which was fixed afterward without a further dark rerun. Keyboard checks: tab order follows the page, focus rings are visible, `[` toggles the sidebar, a menu opens with Enter and focuses its first item, a confirmation dialog focuses Cancel, closes on Escape and returns focus.

Not verified: the Playwright end-to-end suite (needs the Go server), the real reader engine and comic reader against files, audio playback, a phone-width layout, screen reader output, and the agent-readiness tests from the `ui-sdk` skill. Collapsed-sidebar library flyouts are hover and focus only and are not reachable with Tab; the Library page's own filter offers the same choice. UI SDK logs a development warning for its pagination link part (`focus` slot); it is a library message.
## Open questions

None within this record's scope. Icon set and a dark theme are design-language follow-ups.
