# ADR-0064: Pause GitHub Actions until release readiness

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

On 2026-11-14 the user explicitly requested disabling CI so Android and server builds are not built or shipped before the project is fully ready to release. Live inspection of `litara-app/litara` showed Actions enabled, with rebuild validation workflows and historical preview/mobile/release workflows still listed as active. The local checkout predates the user's reported T004 merge and is not authoritative for the live workflow inventory.

## Decision

Disable GitHub Actions at the repository level for `litara-app/litara` immediately. This pauses all Actions workflows, including validation, Android/server builds, previews, and release publishing, across branches. Do not re-enable Actions merely because a task or PR has merged. Re-enabling requires the user's explicit release-readiness decision.

Check for queued or running workflows after disabling; cancel any remaining runs so the pause also covers work already scheduled. Preserve historical releases and artifacts; no deletion is requested.

Before re-enabling, audit workflows on the then-current default branch and supported branches for build/publish triggers and permissions. Release readiness must include [ADR-0011](0011-first-usable-release.md), the verified migration gate in [ADR-0063](0063-optional-legacy-data-import.md), and the intended 2.0.0 identity in [ADR-0062](0062-target-litara-2-release.md). Do not restore archived release workflows as part of the rebuild.

## Alternatives

- Pause publishing only, keeping build CI enabled: does not satisfy the explicit request to stop CI builds.
- Disable selected workflows: requires maintaining a complete inventory and does not cover newly introduced workflows.
- Disable Actions repository-wide, as selected: covers historical and new workflow triggers, at the cost of pausing automated validation too.

## Consequences

Automated checks stop along with builds and shipping. Continue appropriate local verification and report its limits. Required status checks may leave PRs waiting while CI is paused; branch protection is not changed by this decision. Workflow files remain available for review and later deliberate reactivation.

The operational hold lives in GitHub repository settings and takes effect without pushing this checkout. It does not prohibit local development builds or control independent publishing systems outside GitHub Actions.

## Verification

Read back repository Actions permissions and require `enabled: false`. Enumerate unfinished workflow runs and require none remain active. Record the actual result separately from planned readiness checks. No Android/server build or release should be launched to verify the hold.

Completed on 2026-11-14: the GitHub repository settings update succeeded and read-back returned `enabled: false`. A paginated enumeration of workflow runs returned no unfinished runs, so no cancellations were needed. ADR structure/index validation passed for all 64 records. No builds or releases were launched.

## Open questions

The concrete reactivation date, future publishing automation, update channels, and final migration conversion coverage remain undecided. No automatic reactivation is authorized.
