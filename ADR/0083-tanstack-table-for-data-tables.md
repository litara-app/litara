# ADR-0083: Use TanStack Table for the web app's data tables

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner

## Context

The library table is built from first-party `Table` components in `apps/web/src/ui/` with hand-written sorting state, column widths and a resize handle (T009). [ADR-0079](0079-ui-sdk-only-web-interface.md) removed Mantine and requires UI SDK for components, with first-party layout and typography primitives. It does not address headless logic libraries. The library table needs server-side sorting, stackable filters ([ADR-0085](0085-stackable-filter-groups.md) will propose them), adjustable column sizes and, later, hidden and reordered columns. Writing that bookkeeping by hand repeats work that a maintained headless library already does.

## Decision

On 2026-11-20 the repository owner chose to add `@tanstack/react-table` to `apps/web` now and use it for the library table.

- TanStack Table is headless: it supplies column definitions, sorting, column sizing, visibility and ordering state, and renders nothing. Markup and styling stay with the first-party table components and design tokens, so this does not conflict with ADR-0079.
- Sorting, filtering and paging stay on the server. The table runs in manual mode (`manualSorting`, `manualFiltering`) and only reports state; it never sorts or filters rows in the browser.
- It governs data tables in the web app. Forms, menus, dialogs and every other control still come from UI SDK.
- The version is pinned in `package-lock.json` and upgraded deliberately, as UI SDK is.
- Row virtualization is a separate decision ([ADR-0084](0084-tanstack-virtual-for-long-lists.md)).

## Alternatives

- Keep the hand-written table and add state as needed. Rejected by the owner: it grows into a second table library.
- AG Grid or MUI Data Grid. Rejected: they are component libraries with their own markup and theme, which ADR-0079 excludes.
- TanStack Table (chosen).

## Consequences

One more runtime dependency (MIT, no UI of its own). Column definitions move out of the page into typed objects, which makes column hiding, reordering and per-column filters data-driven. The table components keep their markup, so design-language rules and the existing tests still apply. The Android app is unaffected.

## Verification

Planned: the library table renders from TanStack column definitions; clicking a header changes the sort and the request's `sort` and `order`; dragging or keyboard-resizing a column changes its width and the width is remembered; no row is sorted or filtered in the browser; `designLanguage.test.ts`, `tsc`, `vitest` and `npm run build` pass. Completed checks are recorded in `handoffs/T009.md`.

## Open questions

None within this record's scope.
