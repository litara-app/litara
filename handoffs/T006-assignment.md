# T006 assignment: OPDS, email delivery and basic KOReader sync

Prepared 2026-11-16. State: Ready for one implementation owner; unassigned. One full-stack implementation owner; unassigned. The coordinator records the exact immutable preparation checkpoint in TASKS.md. Start from that checkpoint, not moving main or uncommitted coordinator files. Suggested implementation branch: codex/t006-delivery.

## Outcome

Deliver working OPDS 1.2/2.0 catalog and original acquisition, explicit email delivery via server or personal SMTP, and separate-source KOReader progress with per-device credentials and retained conflicts. Integrate web settings, explicit file/recipient send controls, status/history and conflict resolution. Use the real PostgreSQL catalog, account/library grants, media services and durable jobs. A mocked UI or an isolated protocol stub is insufficient.

Governing accepted ADRs: 0073-0076, plus 0009/0011/0013/0015/0024/0025/0031/0037/0038/0040/0041/0043/0063/0064/0065/0068. Preserve ADR-0071 reader separation and ADR-0072 archive bounds. Read research/t006/readiness.md, contracts/t006/README.md, both OpenAPI files and scenarios/fixtures before coding.

## Base and exclusive ownership

Integrated main c65738a includes T001-T005. Use the coordinator's later exact preparation checkpoint. One owner receives:

- apps/server/** for protocol handlers, delivery/credential/KOReader services, durable SMTP attempts, hash indexing/bindings, account/grant enforcement, schema/query/model/API wiring and tests. Fold pre-production schema into migrations/00001_init.sql; do not alter River migrations or reset data.
- apps/web/** for user integration settings, administrator server SMTP and integration controls, recipient CRUD, exact-file send controls, delivery states, KOReader binding/candidate resolution and tests. Preserve reader/media behavior.
- contracts/t006/**, scripts/contracts/check_t006.py and necessary additive contract/parity checks. Do not weaken T003-T005 auth, media or successful position schemas. Extend parity reporting with implemented versus pending T006 management operations and separately test wire protocols; do not delete planned routes to pass.
- scripts/delivery/** and research/t006/** for local fake SMTP/protocol fixtures, provenance, client evidence and capability/acceptance reports; own handoffs/T006.md.
- deploy/** only for narrowly required unsigned local asset/config wiring. No public deployment, CI activation or release artifacts.

Do not edit TASKS.md, root AGENTS.md, ADR/**, other handoffs, Android, archive or .github. Report a concrete required shared-file change to the coordinator. No overlapping T007/server/schema worker is assigned. Preserve unrelated local files, secrets, books and signing material.

## Implementation milestones

1. Record owner/base/branch and a 38-scenario acceptance ledger in handoffs/T006.md and research/t006/coverage.md. Pin vetted dependencies and their licenses; use current documentation. Establish protocol/client fixture runner and local mail sink before any real send implementation.
2. Credentials and settings: typed scoped credentials, one-time secret disclosure, revocation/account-disable enforcement, per-user settings/recipients, admin transport settings, encrypted secrets/key failure behavior. Browser writes keep cookie+CSRF; normal API callers retain bearer.
3. OPDS: two feed formats over the same granted dataset, library navigation/search/page/detail/cover/original download, escaped metadata and stable IDs. Original audio is one file per publication with recording/file-order context; no implied whole-recording bundle. Test independent parsers and an actual pinned client.
4. SMTP: explicit immutable send intent/receipts, one attachment, auth/version/config rechecks, attempt ledger, safe bounded retries, accepted versus uncertain outcomes, explicit resend/status controls. Local sink only, synthetic fixtures/addresses. Never use real SMTP credentials or recipient mailboxes for acceptance.
5. KOReader: binary digest vectors/indexing, exact-version binding, per-device credentials and source state, conservative read/baseline/receipt/conflict transitions, authenticated web resolution. Prove unmodified client request/response behavior before claiming interoperability.
6. Full-stack verification: every scenario, fresh server build/vet/sqlc checks and PostgreSQL-required integration; static contracts plus runtime parity; web build/unit/browser settings and flows; existing reader-isolation and targeted T003/T005 regressions. Verify an independent clean checkout at the review commit. Record skips and concrete remaining T007 hardware gates.

## Acceptance and handoff

All management/protocol operations in contracts/t006 must exist with correct bodies, permissions and failure states. Exercise response loss/restart/concurrency, not only happy paths. Preserve original bytes and web/Android progress/completion. Generic protocol/SMTP responses must not leak secret/path/book/user data. No claims of inbox delivery, native KOReader revision support, exact-once SMTP or physical e-reader success from simulators.

Handoff must identify source/final commits, changed paths, ADRs, commands/environment, dependency/client pins/licenses, pass/fail/skip results for each scenario, setup steps, known limits and integration instructions. State Ready for review only when implementation evidence supports it; the coordinator owns approval/Done after integration. T007 retains NAS, two-hostname TLS, device accessibility, hardware and broader corpus gates. No release or legacy migration is included; Actions remains disabled under ADR-0064.
