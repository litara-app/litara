# ADR-0071: Serve the web reader from a separate origin

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

ADR-0067 selected an opaque-origin sandbox (`sandbox="allow-scripts"`) for the reader frame, with pristine Foliate. T005 milestone-1 testing (`handoffs/T005.md`, `apps/web/tests/reader-isolation.spec.ts`) found that pristine Foliate loads each section into a child iframe and reads its `contentDocument`. Inside an opaque-origin sandbox that value is null in Chromium, Firefox and WebKit, because nested sandboxes inherit the missing `allow-same-origin`; rerouting section frames to `srcdoc` fails the same way. Pristine Foliate therefore cannot render EPUB, CBZ or FB2 under ADR-0067's frame boundary. ADR-0067 listed a separately hosted reader origin as a considered alternative and required incompatibilities to be reported rather than weakened.

## Decision

Accepted by the user's explicit choice on 2026-11-14 ("Separate origin") after the blocker was reported.

Serve the reader document and its pinned engine assets from a second origin that differs from the application origin by hostname (cookies are host-scoped, not port-scoped, so a port-only difference is not enough). The application embeds it with `sandbox="allow-scripts allow-same-origin"`; "same-origin" then refers only to the reader origin, which holds no Litara credentials, API routes or application storage. The reader origin serves only static reader assets from the bundled reader directory: no API, health, media, cookie-setting or SPA fallback routes, and no CORS for credentialed requests.

All other ADR-0067 controls remain in force: response-header CSP denying embedded scripts, network and external resources (`default-src 'none'`; no `unsafe-inline`/`unsafe-eval` scripts; `connect-src` limited to blob), `frame-ancestors` limited to the configured application origin, a CSP `sandbox` header on the reader document, the credential-free per-open MessageChannel bridge with source/origin/nonce/generation validation and byte budgets, bounded archive handling, and bundled pristine engines without CDN downloads. The application CSP's `frame-src` allows only the configured reader origin. Parent and frame check the exact peer origin on the handshake.

Configuration adds a reader listen address and an explicit reader origin (and the application's public origin). Production requires distinct hostnames and TLS for both; a reverse proxy routes each hostname to the corresponding listener. Local development uses distinct loopback names (for example `127.0.0.1` and `localhost` on different ports). A deployment that cannot provide a second hostname has no supported web reader for Foliate formats; weakening to a shared origin remains prohibited without a new accepted ADR.

## Alternatives

- Opaque sandbox (ADR-0067 as written): rejected by measurement; pristine Foliate cannot render.
- Litara-owned renderer using Foliate parsers but not its paginator: defers the engine decision and abandons the pristine renderer; not selected.
- `allow-same-origin` on the application origin: breaks credential isolation; prohibited.

## Consequences

Deployment needs a second hostname/listener and TLS certificate, and operators must configure both origins. PDF.js can use a normal same-origin module worker in the reader origin. Anonymous CORS on reader assets is no longer needed. Book content that somehow executes would still run only in the credential-free reader origin, and CSP continues to block embedded scripts and network requests. Android's reader is unaffected.

## Verification

Real-browser tests in Chromium, Firefox and WebKit must show: EPUB/CBZ/FB2 render through pristine Foliate; PDF renders; reader origin differs from the application origin; the frame cannot read application cookies, storage or DOM; embedded scripts and external images do not run or load; the reader origin returns 404 for application, API and media paths; forged or wrong-origin bridge messages are rejected. Production-like proxy and TLS behavior is not yet verified.

## Open questions

None within the selected direction. Concrete hostnames, proxy examples and certificate guidance belong to deployment documentation. ADR-0067's frame-isolation paragraph is amended by this decision; its remaining controls and ceilings are unchanged.
