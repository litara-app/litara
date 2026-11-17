# ADR-0073: T006 OPDS acquisition and app credentials

Status: Accepted
Date: 2026-11-16
Decision owner: Repository owner

## Context

T005 merged in PR #85 at c65738a. The current Go application has granted catalog/media routes but no OPDS routes or app-password transport. Archived Litara has both feeds; its controllers are reference material, not a portable implementation. OPDS 1.2 uses Atom, while 2.0 uses JSON. Consult the official specifications linked in research/t006/readiness.md.

## Decision

On 2026-11-16 the user chose OPDS 1.2 plus OPDS 2.0 with per-user revocable app passwords, and acquisition of ebook/comic originals plus individual original audio files. Implement authenticated catalog/navigation, search, pagination, publication detail, artwork and exact-version original acquisition.

Use separate protocol credentials; do not accept the main account password as an app password or expand an OPDS credential into general API authority. HTTP Basic is restricted to the OPDS surface over HTTPS, with the existing explicit development-only HTTP exception. Account disablement, credential revocation and current library grants apply to every feed, cover, HEAD and byte-range request. Never put credentials in feed URLs. The two versions project the same authorized catalog.

An ebook/comic publication represents one edition/file; an audio publication represents one original file and includes its recording identity and file order in display metadata. Multiple audio links must not be advertised as interchangeable whole-recording editions. No synthesized ZIP, streaming manifest, conversion, DRM removal, or completion/progress mutation follows from acquisition.

## Alternatives

OPDS 1.2 only; reuse the main login password; public/signed acquisition links; or whole-recording packaging. The user selected both versions and app passwords; packaging/conversion was explicitly excluded from this scope.

## Consequences

One protocol owner implements OPDS wrappers around existing catalog and version-aware media services. Missing/incomplete playback support is distinct from availability of an original file; inaccessible or missing bytes are never advertised as acquired successfully. Unknown/ungranted entries return no metadata payload. OPDS does not expose private annotations or personal sync candidates.

## Verification

Parse Atom with a namespace-aware XML parser and validate JSON against pinned upstream schemas. Test both versions with multiple granted/ungranted libraries, XML/JSON escaping, stable publication identity, deterministic pagination, original bytes/HEAD/Range/ETag/412, credential revocation, account disablement, and original audio order. Include an actual OPDS client/emulator run with pinned version; label any hardware limit.

These are implementation acceptance requirements. Preparation checks do not establish runtime or third-party-client success.

## Open questions

None within this T006 assignment boundary. Release/hardware verification remains T007.
