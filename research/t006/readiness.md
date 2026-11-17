# T006 preparation and readiness

Date: 2026-11-16. Preparation branch: codex/t006-readiness. Integrated base: c65738a (PR #85, T005 merged). This is preparation evidence, not implemented delivery/protocol behavior.

## User decisions

Accepted in this chat on 2026-11-16: OPDS 1.2 plus 2.0 with revocable app passwords; server SMTP plus optional personal SMTP and user-owned saved recipients; explicit mail sends with review of uncertain outcomes; separate KOReader positions without conversion/completion changes; per-device KOReader credentials with retained conflicts; ebook/comic and individual original audio acquisition/email. ADR-0073 through ADR-0076 record these boundaries and their concrete safeguards.

## Observed integrated code

- apps/server/internal/httpapi/api.go registers Huma API auth under /api/v1 with bearer and browser-session/CSRF transports. OPDS Basic and KOReader x-auth headers are not current transports; isolate their middleware and authority.
- apps/server/internal/catalog/editions.go, titles.go and internal/reading provide file-anchored catalog and private/revisioned state. The /files/{id}/versions/{version}/content service already checks bytes, grants and Range/HEAD. Reuse these checks, not HTTP credential forwarding to yourself.
- River/PostgreSQL jobs exist. T006 must add an SMTP attempt ledger and explicit uncertain outcome rather than assuming worker retries give exactly-once email.
- No active OPDS/SMTP/KOReader package is implemented. T003 and T005 contracts are authoritative for existing routes. Do not reinterpret their credential or successful position bodies.
- T005 scenario coverage remains 36 covered, two partial; those and the named NAS/TLS/hardware/Android/codec gates remain T007. This assignment does not erase them.

## Historical reference observations

Read-only: archive/litara-v1/apps/api/src/opds/, mail/, koreader-sync/ and common/koreader-hash.ts; archive/litara-v1/apps/docs/docs/{opds,email-delivery,koreader-sync}.md. OPDS has Atom/JSON builders; mail selects a user or server transport and sends a file; KOReader has independent source records. Do not copy unsafe first-match partial hashes, absent adapter library checks, silent missing-document success, credentials/body logging, password hints, or a mail encryption key derived from a login secret. Do not run/archive-build any historical code.

## Current primary protocol references

Checked 2026-11-16. Context7 tools were not available in this session; official protocol specifications and upstream source were used. The implementation owner must use Context7 for library/API changes when available and record an official-source fallback if unavailable.

- [OPDS 1.2](https://specs.opds.io/opds-1.2.html): Atom navigation/acquisition and XML media types.
- [OPDS 2.0](https://specs.opds.io/opds-2.0.html): living JSON catalog standard. Pin the exact upstream schemas/revision used by validation before implementation, not an unversioned network fetch during CI/tests.
- [KOReader client](https://github.com/koreader/koreader/tree/4e973dacb07b592d9a32af505a1c20c6e84f7fd6/plugins/kosync.koplugin): main.lua and api.json inspected; protocol lacks a Litara revision/operation ID, accepts opaque positions and uses a password-derived x-auth-key. Binary and filename digest modes exist; this task selects binary only.
- [KOReader reference server](https://github.com/koreader/koreader-sync-server/tree/46ef6b84a3930b3f0265efac74899f2256c158f1/app/controllers/1): compatibility evidence for auth/progress envelopes; account lifecycle additions are not automatically T006 scope.

Pinned upstream observations are not runtime compatibility evidence. Use the MIT/AGPL licensing boundary: derive protocol fixtures from documented behavior; do not copy AGPL client/server implementation into the MIT backend.

## Ready criteria

Accepted ADRs, complete exclusive assignment, additive machine-readable API/protocol contracts, positive/negative fixtures, scenario matrix, collision/auth checks, and a committed immutable source checkpoint must all be present before assignment. Readiness is Unassigned, not an instruction to launch another worker. Preparation check results and exact source hash are recorded by the coordinator after verification.

## Preparation checks executed

On 2026-11-16 in the preparation worktree: `python scripts/contracts/check_t006.py` passed for 42 operations (26 management and 16 protocol), 35 schemas, 23 positive/negative examples, 38 scenarios and nine digest vectors. All 76 ADRs/index entries validated. Existing T003/T005 static checkers and the generated API comparison passed (90 existing operations / 119 schemas, zero pending T005 operations). Diff whitespace checks passed. No application/reader/Android changes, SMTP connection, email, CI run, deployment or release was performed for this preparation.

The small OPDS fixture checks are envelope/link/XML smoke checks; full published-schema/client conformance remains implementation acceptance. Digest vectors have deterministic preparation checks, but independent upstream agreement, sparse-large-file behavior and real device behavior remain implementation verification. The agent must report those results honestly.

The coordinator records the immutable committed source hash and clean-export verification below/in TASKS.md after freezing this package. A later register-only evidence commit may follow that source checkpoint; the worker should use the final coordinator-supplied branch tip, which includes the verified source.

## Immutable source and clean-export verification

Verified source checkpoint: `8136c2fff98446f16107fd4b5e74426f8acc92b3` on codex/t006-readiness, based on integrated main c65738a. Exported that committed tree to an independent new directory with Git archive. T006/T003/T005 static checkers, all 76 ADR/index checks, and existing generated API parity passed using only that committed source. The third-party Python validator dependencies were supplied separately; their installed distribution versions were checked against every pin in scripts/contracts/requirements.txt. The first clean-export attempt correctly failed because the optional local validator package was absent; supplying the verified third-party dependency environment resolved it without changing source.

This following evidence/register commit does not change application or protocol behavior. Supply the final preparation branch tip to the worker so it includes this evidence and the verified source. State: Ready, Unassigned. No implementation agent was started and no T006 runtime/client/SMTP acceptance is claimed.
