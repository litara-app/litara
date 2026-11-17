# Vendored and pinned conformance schemas (T006)

Used only by `apps/server/internal/httpapi/opds_schema_integration_test.go`. Nothing is fetched at runtime or while tests run; the test loader maps the upstream `$id` URLs to local files and refuses any other URL.

| Set | Upstream | Pinned commit | License | In Git? |
| --- | --- | --- | --- | --- |
| `readium/` | github.com/readium/webpub-manifest `schema/` | `9bcf48e3108c567d1d3eb2e7ab0f847d62725691` (2026-09-14) | BSD-3-Clause (`readium/LICENSE`) | Yes, with SHA-256 in `readium/MANIFEST.json` |
| `opds/` | github.com/opds-community/specs `schema/` (served at specs.opds.io/schema) | `8fda670fc72f110abcf68ad5d26e99ecfeeabf03` (2026-06-20) | **None declared upstream** | No. `opds/MANIFEST.json` records URLs and SHA-256; run `python scripts/contracts/fetch_opds_schemas.py` to download and verify into the git-ignored `.tmp/t006-opds-schemas/` |

The OPDS schemas were not committed because the upstream repository has no license file, so redistribution rights are unclear. Coordinator disposition on 2026-11-17: retain the explicit pinned fetch-and-verify developer step. Readium remains vendored; the unlicensed OPDS schema files remain outside Git. This preserves local-only schema resolution during tests and does not authorize redistributing those files.

The previously documented `drafts.opds.io/schema/*` location is gone (404); the schemas moved from `opds-community/drafts` to `opds-community/specs` on 2026-05-18.

The test also registers its own RFC 6570 check for the `uri-template` format because jsonschema v6.0.3's built-in check rejects the query operator, including the spec's own `{?query}` example.

OPDS 1.2 (Atom) has no equivalent official machine-readable schema in this set; Atom output is checked with a namespace-aware parser and semantic assertions, not a RELAX NG validation.
