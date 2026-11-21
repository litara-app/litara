# ADR-0084: Use TanStack Virtual to window long lists and grids

Status: Proposed
Date: 2026-11-20
Decision owner: Repository owner

## Context

The library page loads titles with endless scroll (24 per request) and renders every loaded row or cover tile. Each loaded cover also issues image requests and some tiles run a per-title editions query. With a few hundred titles this is fine; with several thousand the DOM grows without bound, scrolling slows and memory climbs, because already-seen rows are never released. TanStack's [virtualized infinite scrolling example](https://tanstack.com/table/latest/docs/framework/react/examples/virtualized-infinite-scrolling) pairs `useInfiniteQuery`, TanStack Table and `@tanstack/react-virtual` so only the visible rows are mounted and the next page loads near the end. [ADR-0083](0083-tanstack-table-for-data-tables.md) adds the table half.

## Decision

Recommendation, not approval: add `@tanstack/react-virtual` to `apps/web` and use it for the library table (row virtualization) and the cover grid (row-based virtualization with a column count taken from the container width).

- The server keeps paging; virtualization only limits what is in the DOM. The "load the next page near the end" trigger moves from the current intersection marker to the virtualizer's last visible index.
- Rows need a fixed or measured height; the table's expanded states (an Inspector or open menu) must not change a row's height.
- Keyboard and assistive technology: the list keeps `role` semantics from the table markup, total row count is exposed through `aria-rowcount` and `aria-rowindex`, and focus movement past the rendered window scrolls and renders the target row. This must be verified, not assumed.
- The headless library renders nothing, so ADR-0079 is not affected.

## Alternatives

- Keep the current rendering and cap memory by dropping far-off pages from the query cache. Simple, but the scroll position and row heights jump, and it still mounts every cached row.
- A paged table with page numbers. Rejected earlier by the owner in favour of endless scroll.
- `react-window` or a hand-written windowing helper. Smaller, but less maintained for dynamic heights and grids than TanStack Virtual, and it would be a second TanStack-adjacent pattern to learn.
- TanStack Virtual (recommended).

## Consequences

Adds a dependency (MIT, headless). Scrolling and memory stay flat at thousands of titles. Costs: in-page find (Ctrl+F) only sees rendered rows, tests must scroll to reach later rows, and row-height changes need care. Cover tiles in a virtualized grid need a stable aspect ratio.

## Verification

Planned, after acceptance: with a seeded library of at least 5,000 titles, the number of mounted rows stays bounded while scrolling to the end; the next page loads before the end is visible; keyboard navigation reaches every row; `aria-rowcount` equals the total; screen-reader and Ctrl+F limits are recorded in the handoff; `tsc`, `vitest` and `npm run build` pass. Nothing is verified yet.

## Open questions

- Accept, reject or defer virtualization until libraries are large enough to need it?
- Is losing Ctrl+F across unrendered rows acceptable, or should the filter bar be the only way to find titles?
- Should the cover grid and the table be virtualized together, or the table first?
