# ADR-0069: Use a same-origin web build and assign T005 end to end

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

Note (2026-11-19): ADR-0079 supersedes the Mantine part of this record; the tooling choices below are unchanged.


ADR-0010 accepts React/TypeScript/Mantine but leaves supporting tools open. The integrated rebuild has no web app. T004's missing ebook entities and manual recording repair cannot be solved by frontend mockups. CI is paused under ADR-0064.

## Decision

Accepted by explicit user choices on 2026-11-14. The selected policy below was approved during T005 preparation.

Use a Vite-built React/TypeScript/Mantine SPA, a pinned browser router and query/cache library selected and pinned in the first implementation milestone, Vitest plus Testing Library for meaningful component/protocol checks, and Playwright for real browser/API workflows. Keep personal pending writes in a small explicitly owned persistence layer rather than treating the query cache as durable state. No new SSR service or general-purpose state framework is required.

Serve built web/reader assets through the existing Go HTTP service, with SPA fallback restricted to web navigation routes. API/health/media/reader assets must never fall through to HTML. Development uses the web server's same-origin API proxy; no credentialed cross-origin browser API. Bundle reader dependencies/workers/fonts with source/notices and hashes; distribution must not depend on CDNs. Production packaging work is preparation only and never re-enables CI or publishes artifacts.

Assign one T005 implementation owner for web plus necessary server/catalog/edition/reading/annotation/shelf/schema/contracts integration. Include the already-accepted missing manual recording merge/split controls (ADR-0045), using retained identity aliases/tombstones and non-destructive membership history; preserve file IDs, progress/conflicts/completion/history, never physically delete merged-away identity evidence. A split must not guess a new canonical resume/completion for ambiguous saved state; preserve it for explicit review. Freeze exact repair semantics in the contract before Ready.

Do not expand T005 to implement unregistered metadata format writers, live provider qualification, filesystem watchers or physical NAS/hardware acceptance. Expose actual capabilities and explicit incomplete states; those accepted gaps remain separately tracked release work. T006 may not write overlapping server/schema/contracts while T005 owns them.

## Alternatives

- One end-to-end owner with real API integration, as selected.
- Frontend-only assignment after a separate server prerequisite: valid but cannot yet deliver reading and shelves.
- New rendering service/SSR runtime: more deployment components without an accepted requirement.

## Consequences

T005 needs a substantial complete brief, fixtures and acceptance gates, not a screen list. Supporting dependencies and exact pins must be documented from current upstream sources in the first implementation milestone before their application integration is claimed complete. No AGPL Android implementation enters the MIT web/backend.

## Verification

Planned: reproducible local web build, same-origin cookie/CSRF and fallback tests, bundled assets with network disabled, real browser/API reader and audio flows, metadata/import/review workflows and identity/history-preserving merge/split regressions. CI remains disabled.

## Open questions

None within the selected serving/tooling/ownership direction. ADR-0070 freezes recording-repair behavior. The implementation owner may select and pin compatible router/query/test dependencies as routine supporting tools within this SPA architecture, using current Context7/upstream sources and recording the choices in the first milestone. This does not authorize a different rendering service, cross-origin auth, or new global state architecture.

## References

- [Vite backend integration](https://vite.dev/guide/backend-integration)
- [Vite production builds](https://vite.dev/guide/build)
