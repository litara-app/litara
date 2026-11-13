# ADR-0010: Retain React, TypeScript, and Mantine for the redesigned web app

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Litara uses React/TypeScript/Mantine; BookOrbit uses Vue. The user selected retaining Litara's frontend foundation while redesigning the experience.

## Decision

Use React, TypeScript, and Mantine for the replacement web application. Redesign screens and workflows around the accepted model and API rather than requiring the old UI to remain compatible.

## Alternatives

- Keep React but replace the component/styling foundation.
- Reconsider the entire frontend stack.
- Retain React/TypeScript/Mantine, as selected.

## Consequences

Existing UI patterns are useful references, not an obligation to copy whole components. Reader assets shared with Android need an explicit ownership/build strategy. No specific state-management, routing, bundling, or reader-library choice is made here.

## Verification

Planned: the new web app builds with the selected foundation and works against the documented API. Verify keyboard accessibility and responsive reading/listening flows as screens are built.

## Open questions

ADR-0027 now selects reader engines and initial Android/web separation. Versions, reader packaging/bridge, routing, and state/data-fetching tools remain open.
