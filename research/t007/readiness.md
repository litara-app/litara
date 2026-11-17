# T007 preparation and immutable checkpoint

Prepared: 2026-11-17. Status: **Ready and Unassigned** after local and immutable clean-export verification. No worker assigned or launched.

## Baseline and evidence sources

Merged main `8de06b96c704bbf2a6067dc4df61a25401390393` integrates T006 through PR #86. Created isolated coordinator worktree `.task-worktrees/t007-readiness`, branch `codex/t007-readiness`, from that commit. The historical root checkout and existing task worktrees were left intact.

Read root instructions, ADR index/relevant accepted policies, current T003/T004/T005/T006 handoffs and T005/T006 ledgers. Observed current native audio-only reader boundary and empty production writer registry in source; T005 already closed ebook persistence and successor repair gaps. The inventory distinguishes those observations, historical test evidence and work still required. The user's scope/resource answers are in `decisions.md`.

## Assignment artifacts

- [Full exclusive assignment](../../handoffs/T007-assignment.md).
- [Acceptance contract](../../contracts/t007/README.md) and [32 scenarios](../../contracts/t007/scenarios.json).
- [Inherited gaps](gaps.md), [user decisions](decisions.md), [resource plan](resources.md) and [initial evidence ledger](coverage.json).
- Standard-library static checker: `python scripts/t007/check_readiness.py`.

No new wire API or architectural policy is selected during preparation. Existing T003–T006 contracts remain authoritative. Android profile compatibility requires actual renderer evidence before canonical sync; new semantics require the normal ADR decision. T008 migration is separate and not implementation-ready. Production support/signing/distribution/migration execution decisions and physical hardware remain open. No worker, CI, release, email or deployment was launched.

## Current documentation consulted

Context7 resolved PostgreSQL to `/websites/postgresql` and queried database backup/restore/global-object coverage on 2026-11-17. PostgreSQL 17 primary docs distinguish per-database dumps from cluster-global objects and archive restoration. The T007 brief therefore requires an independent restore, required role/config/key/media inventory and workflow assertions; it does not claim a database dump includes application keys/media or select production backup policy.

- https://www.postgresql.org/docs/17/app-pg-dumpall.html
- https://www.postgresql.org/docs/17/app-pgrestore.html
- https://www.postgresql.org/docs/17/backup-dump.html

The implementation worker must fetch current documentation for actual library/platform changes. This preparation's documentation query is not runtime verification.

## Verification and committed source

Local preparation checks passed on 2026-11-17:

- T007 standard-library checker: 32 unique scenarios, all 18 gaps referenced, five phases, accepted ADR references and document links checked; all 32 runtime results still Pending.
- Existing T003 checker: 31 operations/32 schemas/39 examples/12 ranges/20 scenario references; T005: 38 operations/65 schemas/15 examples/38 scenarios; T006: 42 operations/35 schemas/23 examples/38 scenarios/nine digest vectors. All pass.
- All 76 ADRs/index entries validate. No ADR was added, accepted or altered during preparation. PowerShell emitted an environment FileSystem-drive initialization warning but the validator completed with exit code 0.
- `git diff --check` passed. Changes are preparation/register/instructions only; application, existing API contracts, deployments, workflows and archive are unchanged. No application build/runtime/browser/emulator/hardware check was run for this documentation-only preparation.

The first existing-contract run correctly failed because `openapi_spec_validator` was absent from the default Python environment. Rerun supplied only the existing third-party package directory `G:/Programming/ebooker/.tmp/t003-validation`; all 18 installed package versions were checked against every pin in `scripts/contracts/requirements.txt`. No uncommitted project source was supplied through that path. A new worker should install the pinned requirements in its own environment; the absolute local cache is not a project dependency.

**Verified immutable source commit: `7ea3d929c663d8c50a9445559ffb68b3a29bf644`**, branch `codex/t007-readiness`, parent merged main `8de06b96c704bbf2a6067dc4df61a25401390393`.

Exported that exact Git commit with `git archive` to a new independent `.tmp/t007-source-check` directory. From that directory the T007 integrity checker, all existing T003/T005/T006 static contract checks and all 76 ADR/index checks passed. All 18 supplied third-party validator package versions again matched the pinned requirements. No project source was read from the coordinator's uncommitted working tree. The ADR validator repeated its environment drive-initialization warning and completed successfully.

The following coordinator evidence-only commit records those results and marks readiness; it changes no assignment behavior, runtime source, schema, existing wire contract or scenario. Supply that **final branch-tip commit hash** to the worker; it includes the verified source plus this evidence. Record it as the worker base and do not silently follow later ref movement. No worker was started, and every runtime result remains Pending.
