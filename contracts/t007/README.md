# T007 integration acceptance contract

T007 consumes the existing T003–T006 wire contracts. It introduces no new application endpoint in preparation. `scenarios.json` defines 32 integration/implementation scenarios with governing accepted ADRs, inherited gap references, phase, expected behavior and required evidence. `research/t007/coverage.json` is the worker's result ledger, initially all Pending. No runtime check has passed merely because this static inventory validates.

## Inputs and fixtures

Reuse the committed synthetic generators and fixtures documented in `contracts/t003/`, `contracts/t005/fixtures.md`, `contracts/t006/`, `scripts/web/generate_reader_fixtures.py` and `scripts/web/generate_format_corpus.py`. Read their output-directory protections and requirements before invocation. Store generated/private-local media, exports, logs, TLS keys, SMTP keys and disposable database backups outside Git in an explicitly ignored test directory. Never use production credentials, mail recipients or original private books as writable fixtures.

The implementation owner adds bounded lawful fixtures and regression cases where a scenario demands them. Record source/permission or generator version, SHA-256, size, codec/container/renderer profile, and exact reproduction. Prefer small committed textual expectations plus generated media. Valid large media, sparse arithmetic and large upstream digest cases are separate evidence classes. Real files require provenance/permission and a private-local inventory where redistribution is not allowed.

Locator fixtures must be emitted by the actual preserved native and pristine web engines against identical content. Capture exact engine revisions and compare restored text/selection/page entry/coordinates. Fabricated locator syntax, percent-based restoration or a shared profile label alone does not establish equivalence.

## Result semantics

- `pending`: no completed current-scope verification.
- `passed`: expected behavior actually verified at identified source/environment with linked evidence.
- `failed`: run found a defect; record reproduction and open gap.
- `partial`: some required evidence exists, with exact missing checks recorded.
- `blocked`: an identified decision/resource prevents the check; continue independent work.
- `not-applicable`: requires a recorded coordinator/user disposition, not a worker silently reducing release scope.

Every non-pending row needs a command/procedure, environment, evidence path(s), and a concrete blocker/limitation if not passed. A release-hold row passes only by demonstrating that its hold is still correctly recorded; it does not satisfy the held migration/production gate. Track actual release acceptance separately in `research/t007/release-gates.md`.

Update the new ledger; do not retroactively edit earlier handoffs or claim historical runs as fresh. Add scenarios for newly discovered defects without dropping original ones. Additive API corrections must update their owning T003–T006 schemas/examples/parity and actual native/web consumers together. Behavioral changes beyond accepted architecture need a coordinator-owned proposed ADR and explicit decision first.

## Phase order

`local` starts immediately with clean baseline/emulators and no external hardware dependency. `assisted` needs coordinated NAS/app/corpus/accessibility resources. `external` identifies physical phone/head-unit resources currently unconfirmed. `cast-last` is delayed until local work and the user-assisted setup are reviewable. `release-hold` remains visibly open at the release level. This is sequencing, not authorization for a network/share/device action without the relevant resource owner.

Run `python scripts/t007/check_readiness.py` for static integrity only. The execution brief defines real implementation verification.
