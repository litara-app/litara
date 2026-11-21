# ADR-0084: Use TanStack Virtual to window long lists and grids

Status: Accepted
Date: 2026-11-20
Decision owner: Repository owner

## Context

The library page loads titles with endless scroll (24 per request) and renders every loaded row or cover tile. Each loaded cover also issues image requests and some tiles run a per-title editions query. With a few hundred titles this is fine; with several thousand the DOM grows without bound, scrolling slows and memory climbs, because already-seen rows are never released. TanStack's [virtualized infinite scrolling example](https://tanstack.com/table/latest/docs/framework/react/examples/virtualized-infinite-scrolling) pairs `useInfiniteQuery`, TanStack Table and `@tanstack/react-virtual` so only the visible rows are mounted and the next page loads near the end. [ADR-0083](0083-tanstack-table-for-data-tables.md) adds the table half.

## Decision

On 2026-11-20 the repository owner chose to implement virtualization now: add `@tanstack/react-virtual` to `apps/web` and use it for the library table (row virtualization) and the cover grid (row-based virtualization, with the column count taken from the container width the way an auto-fill grid would).

- The server keeps paging and the page keeps endless scroll; virtualization only limits what is in the DOM. The "load the next page" marker stays below the list.
- Table rows are one fixed height (56 px) so only rows near the viewport are drawn; spacer rows keep the scroll height exact. The table exposes `aria-rowcount` (total titles plus the header) and each drawn row its `aria-rowindex`. The cover grid measures its rows.
- Before the first measurement, and where there is no layout (tests), the first rows are drawn instead of nothing.
- The headless library renders nothing, so ADR-0079 is not affected.

## Alternatives

- Keep the current rendering and cap memory by dropping far-off pages from the query cache. Simple, but the scroll position and row heights jump, and it still mounts every cached row.
- A paged table with page numbers. Rejected earlier by the owner in favour of endless scroll.
- `react-window` or a hand-written windowing helper. Smaller, but less maintained for dynamic heights and grids than TanStack Virtual, and it would be a second TanStack-adjacent pattern to learn.
- TanStack Virtual (recommended).

## Consequences

Adds a dependency (MIT, headless). Scrolling and memory stay flat at thousands of titles. Costs: in-page find (Ctrl+F) only sees rendered rows, tests must scroll to reach later rows, and row-height changes need care. Cover tiles in a virtualized grid need a stable aspect ratio.

## Verification

Checked on 2026-11-20 against the demo library (72 titles, in the in-app browser): the table draws 16 of 72 rows at the end of the list, its scrolled height equals rows times row height exactly, and scrolling back shows the first rows; the cover grid draws about 15 of 72 tiles and keeps loading pages until all 72 are in; `tsc`, `vitest` (81) and the build pass. Not verified: a library of 5,000 or more titles, keyboard navigation to every row, screen reader output for `aria-rowcount`/`aria-rowindex`, and in-page find (Ctrl+F), which only sees drawn rows.

## Open questions

- Is losing in-page find across undrawn rows acceptable, or should the filter bar be the only way to find titles? The filter builder and search already cover this.
- Keyboard focus movement past the drawn window needs a check with real keyboard use.
