# T002 integration review

Reviewed: 2026-11-13
Reviewer: ADR/integration coordinator
Disposition: changes required before integration; rename reviewed and consistent with the user's instruction.

## Location and Git state

Work is in `G:\Programming\ebooker-android-import`, registered as a separate worktree on orphan branch `android/import-baseline`. The active `G:\Programming\ebooker` worktree has no `apps/android/` import yet.

Git reports 351 staged additions and no commit on the orphan branch at review time. The main repository's visible committed history still ends at `6720562a199cc6f72337d553c6ef9a674e422ed4`. The worker handoff also describes the files as uncommitted. T002 therefore is not checked in or integrated yet; the coordinator must prepare a rebuild checkpoint and a deliberate additive integration after the fixes. Do not merge unrelated histories or commit the main worktree's unrelated changes automatically.

## Required fix: executable Gradle wrapper

The staged index records `apps/android/gradlew` with mode `100644`. The root Android workflow invokes `./gradlew` directly at `.github/workflows/android.yml:77`, 80, 83, 89 and 97. A clean Linux checkout will not have execution permission, so CI will fail before lint/tests/builds start.

Preserve the wrapper's executable bit in Git (preferred), or consistently invoke it through the shell in CI/documented Linux invocations. Verify the staged mode is executable before the import commit; Windows-local Gradle success does not verify that bit. This is the one identified functional integration blocker in the reviewed baseline.

## Rename verification

Observed application ID and namespace: `com.litara`, debug `com.litara.debug`. Gradle and AppAuth both use `litara://oauth2-callback`; the full-flavor manifest references the renamed Cast options class; ProGuard paths and application/provider classes use the renamed package. Built full-debug APK metadata reports `com.litara.debug`, version code 1 and version name 0.1.0. Both full/fdroid build definitions remain present.

A search found no remaining `bookorbit` identifiers in `app/src`, the app build configuration, or project settings. Provenance references remain in licensing/upstream documents, as appropriate. Android's application identity is changed, not just the display label; this is a separate app from BookOrbit and will not update its installed package. Store/package availability and signing/release plans have not been verified.

The user's current instruction confirms that the rename itself was authorized. The worker reports that the user selected these exact identity values in the other session. This review records the implementation observed; it does not independently turn reported cross-session release choices into a new Accepted ADR. The accepted ADRs still need the coordinator's identity decision record before release work relies on final identifiers/signing.

## Source and test evidence checked

The read-only comparison helper `research/android/review_t002.py` compares 325 reference files against the candidate after normalizing BookOrbit-to-Litara substitutions and paths:

- 32 files were byte-identical.
- 284 files matched after mechanical renaming.
- Eight had residual changes: baseline version reset, notification icon reference, removal of the old deprecation block/strings, brand component, and launcher/background colors/assets.
- The old Orbit drawable was removed and a Litara logo drawable added.

The inspected player/queue/chapter/Cast implementation and tests had no residual logic changes beyond the expected icon reference after rename normalization. Library version catalog and core build configuration remained identical where not affected by app identity/version labels. This comparison is a scoped source check, not a proof that renamed protocol constants still interoperate with BookOrbit. The dormant networking is intentionally pending the Litara adapter.

Existing JUnit XML reports were parsed directly, rather than relying solely on the handoff: full and fdroid each have 52 suites / 335 tests, with zero failures/errors/skips. Existing Android instrumentation XML reports show 20 tests per flavor on the Android 16 emulator, with zero failures/errors/skips. The staged patch whitespace check passes.

No Gradle tests/builds or hardware checks were rerun by this reviewer. These are verified existing artifacts plus a source/index review, not a new execution of the worker's build procedure. Physical Cast/Auto, release/R8, and hosted CI remain unverified.

## Documentation corrections before handoff is final

The reports retain useful pre-rename verification history but also stale blanket claims. `UPSTREAM.md` says no behavior/version/test assertion changed and calls the reader tree unchanged; version numbers and some reader comment/name content were mechanically changed. `import-verification.md` begins by saying no identity choice was made although its later sections document the user-authorized rename. Make the distinction between pre-rename and final state explicit and provide the final commit hash after committing. The handoff currently has no final review commit because none exists.

## Known adaptation work, not new baseline regressions

- Local downloads/progress remain per-server rather than per-account (audit L6); keep its required regression/fix in the T003 adaptation package.
- The client still uses BookOrbit-shaped routes/DTOs/auth. There is no working new Litara backend integration yet.
- AGPL Android licensing and restored bundled notices are present. Exact vendor revisions and transitive notice inventory remain documented release gaps; do not claim compliance certification.
- Notification/themed icons, dark mode and real head-unit/Cast behavior still need their documented visual/hardware checks.

## Return to coordinator

Fix wrapper execution metadata, align the final-state documentation, and commit only the Android package's additive scope. Report the resulting commit, staged/committed wrapper mode, and verification evidence. Preserve other worktrees and the coordinator's uncommitted rebuild. Integration and final release identity/signing decisions remain separate steps.

## Verification addendum (2026-11-13, independent re-check)

Re-checked against the import worktree; no claim above needed correction.

- Orphan branch `android/import-baseline` still has no commits; 351 staged files; `git diff --cached --check` clean.
- `git ls-files -s apps/android/gradlew` shows mode `100644` (blocker still open). `gradlew.bat` is also `100644`, which is correct. Fix with `git update-index --chmod=+x apps/android/gradlew` before the import commit, then confirm `100755`.
- `.github/workflows/android.yml` is in the import worktree (not in the main worktree) and invokes `./gradlew` at lines 77, 80, 83, 89 and 97 as stated.
- `namespace` and `applicationId` are `com.litara` (debug suffix `.debug`); no `bookorbit` string in `app/src`, the Gradle scripts or settings.
- Unit-test XML re-parsed: full and fdroid each 52 suites / 335 tests, 0 failures/errors/skips. Instrumentation XML was not re-parsed; that figure stays as originally reviewed.
- Documentation drift confirmed: `UPSTREAM.md` lines 21-24 still say no behavior/version change and that the reader tree is unchanged; `research/android/import-verification.md` line 5 still says no identity choice was made. Both remain to be fixed by the worker.
- Gradle builds/tests were not rerun in this check.

## Fixes applied (2026-11-13)

- `apps/android/gradlew` staged as `100755` (was `100644`).
- `UPSTREAM.md` and `import-verification.md` now distinguish pre-rename and final state; the false "no version/identity change" and "reader unchanged" claims are corrected.
- Changes are staged in the import worktree, not committed. The final commit hash is still to be recorded in the docs and handoff after the commit.

## Commit recorded (2026-11-13)

Committed on `android/import-baseline`: `92ca5e3c1a8cc70f15532faa9513b9b0cff2bc36` (gradlew `100755` verified via `git ls-tree`), followed by a docs-only commit recording that hash. Commits used `PREK_ALLOW_NO_CONFIG=1` because the orphan branch has no hook config. Not merged into the main worktree; integration remains a coordinator step.
