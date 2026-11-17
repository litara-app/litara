# T005 preparation evidence

Prepared 2026-11-14. Source base: integrated main `dae3f3e`, plus pending release documentation `5aa0b65`. No implementation worker assigned and no application code built by preparation.

## User decisions recorded

- Include shared and smart shelves now.
- Shared shelves: owner edits; signed-in viewers see only their permitted titles. Notes/highlights remain private.
- Shared smart filters: evaluate each viewer's own permissions and reading state, never expose owner's private progress.
- Online web with durable retry recovery; browser offline downloads and Android ebook adaptation are separate scope.
- Restricted reader frame at one Litara address, no application credentials in the reader.
- Separate edition per ebook file, exact-file resume, manual finish/unfinish and revisioned annotation edit/delete with preserved conflicts/tombstones.
- One web/server implementation owner, Go-served Vite app, accepted Go-based extraction ceilings and identity/history-preserving successor recording repair.

These choices were explicit user answers; ADR-0065–0070 record them. No unanswered policy is treated as accepted. Supporting pins are routine first-milestone implementation work within those decisions, not new product-policy choices.

## Current upstream research

Context7 resolved and queried `/johnfactotum/foliate-js`, `/mozilla/pdf.js`, and `/vitejs/vite` during preparation. This is documentation/source evidence, not an installed-version or runtime claim.

- [Foliate README](https://github.com/johnfactotum/foliate-js/blob/main/README.md): warns against using untrusted ebook content without CSP; scripted EPUB content is not a supported safe privilege model. Its [view API](https://github.com/johnfactotum/foliate-js/blob/main/view.js) accepts book/file abstractions, emits relocation/CFI events and supports CFI annotations. The selected restricted frame/bridge still needs real engine/browser proof; API familiarity is not isolation evidence.
- [PDF.js API](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js): provides in-memory and custom range transports/workers; resource/worker data paths must be deliberately configured. Pin/test the chosen distribution, do not use Foliate's experimental PDF adapter or rely on flags that do not exist in that revision.
- [Vite backend integration](https://vite.dev/guide/backend-integration) and [build guide](https://vite.dev/guide/build): static frontend output can be integrated with a backend and a development proxy. The production server is Go, not Vite preview; API/media routes must never hit SPA fallback.

## Source observations that shape the brief

- `apps/server/internal/catalog/service.go:ResolveFile` currently finds granted **recordings** for a file. Ebook membership authorization is missing, not just UI wiring.
- T004's handoff/schema has no edition/reading/annotation/shelf entities and no registered metadata writers.
- T004 metadata routes are recording-scoped. The additive T005 contract includes ebook metadata/provenance/protected-edit routes and bounded parser work rather than pretending the old routes cover it.
- T003 completion history entries require recording IDs. The T005 contract adds ebook reading history separately, preserving the existing successful recording history schema.
- Shared shelves and smart filters must filter IDs/counts/children by current viewer grants, including admin viewers.

## Verification boundary

Preparation checks cover ADR/index structure, OpenAPI/JSON Schema examples, schema/route/auth declarations, acceptance-scenario references and deterministic synthetic fixture generation. They do not prove implemented routes, SQL transactions, reader sandbox/CSP, browser codecs, broad-format coverage, or hardware behavior. The implementation assignment explicitly requires that evidence. No automatic CI/publication is authorized.

Completed preparation verification on 2026-11-14:

- ADR/index validation passed for all 70 records.
- Existing T003 static checker passed: 31 operations, 32 schemas, 32 positive/negative examples, 12 ranges and 20 inventoried runtime scenarios.
- T005 static checker passed: 28 additive paths, 38 operations, 65 schemas, 15 positive/negative examples and 38 referenced acceptance scenarios; no schema/route/operation-ID collision with T003/T004, and existing auth wire names retained.
- Synthetic fixture generator produced eight structurally checked inputs. Two independent generations produced identical SHA-256 manifests. A nonempty output directory was refused without changing its manifest.
- Diff whitespace checks passed. No application/Android/server/container build, runtime/browser/hardware test, release or CI run was launched by preparation.
- Verified committed source snapshot `208684e5fdce39f6b39baefa03a11517078355a7` in a clean Git-tree export: both contract checkers, all ADR/index checks and fixture generation passed without uncommitted coordinator source. Dependencies were supplied separately from the existing pinned requirements. The subsequent coordinator metadata commit records this evidence and is the final assignment checkout tip.
