# T004 contract

Status: **implemented and merged into the parity check.** `openapi.json` holds the 21 T004 operations (library management, scans, reviews, metadata, imports, write-back, writer status) and their schemas. It was extracted from the implemented Huma output and reviewed, unlike T003 where the contract came first. `scripts/contracts/compare.py` merges it with `contracts/t003/openapi.json` and fails on any drift. Policies are fixed by ADR-0044–0061; nothing here selects new architecture.

- [model.md](model.md): persistence boundary extending `contracts/t003/model.md`.
- [scenarios.json](scenarios.json): required generated-fixture scenarios and expected outcomes. Fixtures are generated at test time; no media is committed.
- Conventions come from ADR-0038 (versioned `/api/v1`, UUIDs, typed errors). Every management route requires an administrator **and** a grant on the owning library (ADR-0056); routes addressed by recording, file or write-back plan resolve the library first.

## Scenario coverage

Where a scenario is only partly covered, the gap is stated; "untested" means no test exercises it.

| Scenario | Test(s) | Notes |
| --- | --- | --- |
| move-unique | `ingest.TestUniqueMovePreservesIdentity` | |
| move-ambiguous | `TestAmbiguousMoveGoesToReview`, `TestReviewerCanApplyAnAmbiguousMove`, `TestKeepSeparateAddsNewFilesAndStopsAsking`, `httpapi.TestAmbiguousMoveReviewOverHTTP` | |
| replace-same-path | `TestSamePathReplacementCreatesNewVersion`, `TestReplacedFileBumpsRecordingLayout` | New version and layout bump are tested. That an old saved position then fails with 412 is T003 behavior and was **not** re-tested through a T004 replacement. |
| partial-copy | `TestPartialCopyIsNotCatalogedUntilStable`, `TestStabilityBeforeCataloging` | Stability is tested with an injected clock, not a real 30 s wait. |
| absence-two-scans | `TestAbsenceNeedsTwoHealthyScansAndNeverDeletes` | |
| root-unavailable | `TestUnavailableRootRetainsCatalog`, `TestEmptyListingWithoutSentinelIsNotTrusted` | Simulated by renaming a local directory; this is not NAS disconnect acceptance. |
| root-identity-mismatch | `TestIdentitySentinelBlocksAbsenceHandling`, `TestCheckRootNeverCreatesTheSentinel` | |
| symlink-outside-root | `TestWalkSymlinkRules` | Skipped on the Windows development host (no link privilege). Run and passed in a `golang:1.26` Linux container. |
| preserved-stat-change | `TestVerificationDetectsChangedBytesWithPreservedStat` | |
| multi-disc-order | `TestDiscFoldersJoinOneRecording`, `TestFolderBecomesOneRecordingOrderedByTags` | |
| order-conflict | `TestConflictingOrderNeedsReviewAndCreatesNoRecording`, `TestAmbiguousNumberingNeedsReview`, `TestReviewerSetsOrderAndRecordingIsCreated` | |
| cue-single | `TestSingleCueIsAssociatedAndWritesChapterSource` | Chapter validation and precedence run at read time (T003 `catalog`), not re-tested here. |
| cue-multiple | `TestTwoValidCuesAreNotChosen`, `TestChoosingACueSurvivesRescans` | |
| grouping-translation | `TestSameTitleWithoutIdentifierIsProvisional` | **Partial.** Recordings group by folder, so different narrators/languages in different folders stay separate. Two narrations interleaved in one folder are not split; that case is untested and would surface as a mixed-album or ordering review at best. |
| grouping-uncertain | `TestMixedAlbumsInOneFolderAreNotGrouped`, `TestSameTitleWithoutIdentifierIsProvisional`, `TestProvisionalTitleCanBeLinkedOrKeptSeparate` | |
| metadata-precedence | `metadata.TestPrecedence…`, `TestProtectedClearIsNeverRefilled`, `ingest.TestMetadataPrecedenceAcrossRescans` | |
| provider-uncertain | `TestSearchHitsAndInconsistentMatchesGoToReview`, `TestUnambiguousIdentifierMatchFillsGapsOnly`, `TestProvidersAreDisabledUntilEnabledPerLibrary` | Adapters are tested against local servers with the documented response shapes only. **No live provider call was made.** |
| import-collision | `importer.TestPlanReviewApproveCopyKeepsSourceAndNeverOverwrites` | |
| import-duplicate | `importer.TestDuplicatesAreSkippedUnlessKept` | |
| writeback-crash-stages | `writeback.TestCrashRecoveryAtEveryJournalStage`, `TestCrashAfterPublishBeforeJournalIsRecognized` | Crash points: after the staged write, after validation, and after publish before the journal advanced. The after-backup point is not exercised (backups are off in the crash tests). |
| writeback-version-recheck | `writeback.TestChangedAfterReviewIsRefused` | Tested for a sidecar target. The in-file content-version recheck is implemented but **untested**. |
| backup-failure-blocks | `writeback.TestBackupsDefaultOffAndOptInFailureBlocksTheWrite` | |
| no-grant-admin | `httpapi.TestEveryManagementRouteNeedsAdminAndGrant`, `TestLibraryManagementNeedsAdminAndGrant` | |

## Not implemented

- Manual merge and split of recordings (ADR-0045) and review resolution for `provider` items beyond apply/reject. Merge needs a tombstone model that touches T003 catalog queries and was not attempted.
- Any in-file metadata writer. The engine, journal and recovery are tested with a **test-only** ffmpeg stream-copy writer; no writer is registered in the server and every format is disabled in `writer_capabilities`.
- Ebook (EPUB/PDF/CBZ) catalog rows are created as files, but no editions or reader-facing entities exist yet (T005).
