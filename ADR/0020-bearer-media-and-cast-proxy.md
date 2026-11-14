# ADR-0020: Authenticate media with bearer tokens and retain the phone Cast proxy

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The native Android implementation already has a phone-hosted Cast proxy that authenticates upstream and handles receiver range requests. The [audit](../research/android/backend-contract.md) identifies byte-exact ranges, identity encoding, MIME metadata, and artwork as media requirements. Signed URLs would be another delivery mechanism.

## Decision

The user selected bearer authentication for app-to-server media requests and preserving the phone Cast proxy. The Chromecast connects to that proxy; ordinary server access tokens must not be exposed to the receiver or embedded in public media URLs. Signed server media URLs are not a first-release requirement.

## Alternatives

- Use short-lived signed URLs as the primary delivery path.
- Require both bearer and signed URL delivery initially.
- Bearer upstream plus the existing Cast proxy, as selected.

## Consequences

Media authorization must enforce library access on requests and support refresh/retry. Preserve the proxy's existing session-scoped access protections. Byte ranges must work for authenticated streaming/downloads without content transformation that changes byte offsets. Bearer transport does not yet choose token format, endpoint paths, or proxy-session credentials.

## Verification

Planned: expired-token refresh followed by an authorized range retry, revoked access rejection, bounded/suffix/large-offset ranges, exact content headers and MIME values, and receiver access without server credentials. Retain Cast regression tests and real-device acceptance checks. Reverse-proxy behavior is part of deployment verification.

## Open questions

HTTP contract details, proxy token lifecycle, allowed redirects, CORS scope, cache behavior after revocation, and long-stream expiry policy remain open.
