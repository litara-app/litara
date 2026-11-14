# ADR-0067: Isolate web readers and bound archive extraction

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

ADR-0027 requires pristine Foliate, direct PDF.js, Go-based CBR/CB7 extraction, CSP and validated bridge messages. Current upstream Foliate documentation warns that ebook scripts are unsafe and requires CSP. Existing application cookies must not reach rendered book code.

## Decision

Accepted by explicit user choices on 2026-11-14. The selected policy below was approved during T005 preparation.

Use a dedicated renderer document in an iframe sandbox allowing scripts but not same-origin, top navigation, popups, forms or downloads. The parent application authenticates file requests, then transfers exact-file bytes/ranges or image-page data over a validated per-open MessageChannel. The frame never receives credentials, CSRF values, arbitrary fetch privileges or arbitrary application API commands. Validate the initial source window, generation and expected handshake; the opaque origin string alone is not authentication. Close old channels on book/account change or logout.

Use a response-header CSP on reader documents and compatible policies on book documents: deny embedded scripts, network/external resources, navigation and plugins; allow only the exact pinned static renderer/worker/font assets needed. Serve static module assets with narrowly scoped anonymous CORS where required by the opaque sandbox; never enable credentialed API CORS. Script directives must not permit unsafe-inline/unsafe-eval or a book-controlled script URL. Styling needed for book layout is separate from script execution and must still block external resource fetches. PDF forms/JavaScript/XFA and external launch actions are disabled. Pin and bundle pristine engines/notices; no runtime CDN downloads. The worker must demonstrate the policy on target browsers; a CSP or sandbox incompatibility is a blocker, not permission to weaken isolation.

CBR/CB7 extraction stays in Go with vetted dependencies (licenses/pins/provenance verified before use), bounded subprocess-free library extraction where supported, and explicit unsupported states for unhandled variants. Do not introduce an extra native executable without a separate accepted decision. List entries before publishing anything, reject absolute/traversal/duplicate-normalized paths, links, devices and nested archives; stream only validated image entries to a private per-file/version cache. Natural case-insensitive numeric path ordering with bytewise UTF-8 tie-breaking produces a stable page manifest. Reject ambiguous duplicate page identities.

Selected default ceilings: 2 GiB compressed ebook/comic input; 10,000 archive entries; 10,000 pages; 8 GiB total expanded bytes; 100 MiB per entry; 100 megapixels per decoded image; 200:1 expansion ratio; 120 seconds extraction wall time; 2 extraction jobs per server; 16 GiB cache with least-recently-used eviction of inactive entries. Include staged bytes and reservations in that cache budget; fail cleanly if active reservations cannot fit. Enforce streaming counters, cancellation and restart cleanup; never trust archive headers alone. At most 8 MiB per bridge range reply and 2 outstanding range requests per open reader; never buffer an entire large file by default. Exceeding a limit reports a typed capability/limit issue and preserves originals. Operators may lower these ceilings; raising them requires a separately reviewed decision and evidence. Tuning is not a silent support claim.

## Alternatives

- Opaque sandbox plus CSP and a credential-free bridge, as selected: additional bridge work, one application origin.
- A separately hosted reader origin: strong origin separation but additional deployment/TLS configuration.
- Render book content in the authenticated application origin: unacceptable privilege boundary under ADR-0027.

## Consequences

Security and resource-limit tests are acceptance requirements. Not all unusual RAR/7z variants are guaranteed readable; preserve explicit capability states under ADR-0025. Foliate CBZ remains the selected web engine; equivalent bounded checks apply to its browser-side decompression, while server CBR/CB7 manifests drive the image reader.

## Verification

Planned browser tests: book scripts cannot execute or access cookies/parent/API/storage; external URLs do not fetch or navigate; forged/stale bridge messages are rejected; module/worker loading works under the actual CSP. Archive tests cover bombs, encrypted/solid/damaged inputs, traversal, symlinks, collisions, timeouts, interruption/restart, eviction, stable ordering and near-limit valid data. Test EPUB/CBZ decompression limits too; do not rely on a sandbox to bound memory.

## Open questions

None within the selected direction/ceilings. Exact dependency pins, CSP/asset configuration and browser compatibility are mandatory first-milestone implementation evidence. Incompatibility must be reported rather than weakening the selected isolation boundary; no parser support or browser security is claimed as already tested.

## References

- [Foliate security guidance](https://github.com/johnfactotum/foliate-js#security)
- [PDF.js API](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js)
