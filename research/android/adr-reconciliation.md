# Android audit reconciliation with accepted ADRs

Date: 2026-11-12

The seven original reports were copied byte-for-byte from `E:\Programming\ebooker\research\android\` into the active Git repository at `G:\Programming\ebooker\research\android\`. SHA-256 comparisons verified every copy. The external reference clone and build logs remain on `E:\Programming\_reference\`; they were not moved or imported into `apps/android/`.

The audit had no access to this repository's ADRs. Its observations and baseline results remain useful evidence; its recommendations do not override accepted decisions. Read this note before using the original plan's prerequisites or minimum media contract.

## Licensing change

[ADR-0017](../../ADR/0017-separate-android-agpl-license.md) supersedes ADR-0012: Android retains AGPL, while new first-party backend/web work remains MIT. The user's decision removes MIT relicensing permission and a complete per-line ownership CSV as prerequisites for reusing AGPL Android contributions under their existing license. The original audit's P1-P4, readiness table, sole-owner-only import sequence, and contributor-contact recommendations were written for an all-MIT target and are no longer the current import plan.

Preserve attribution/provenance and restore applicable dependency notices identified by the audit. A source/dependency inventory remains useful; do not describe it as evidence of permission to relicense. Do not copy AGPL-modified reader assets into the MIT web component. Retaining those assets inside AGPL Android and deciding the MIT web reader are separate choices. No source has been imported or relicensed here. No contributor contact is authorized by this reconciliation.

## The audit's 13 questions

| Audit question | Current disposition |
| --- | --- |
| 1. Playable unit and IDs | Accepted in [ADR-0018](../../ADR/0018-stable-media-identities.md): specific recording, stable opaque recording/file IDs, explicit content versions. UUID flavor/encoding remains open. |
| 2. Position and concurrency | [ADR-0019](../../ADR/0019-file-anchored-audio-positions.md): file/version plus millisecond offset, derived recording time, layout-change detection. [ADR-0015](../../ADR/0015-reading-state-and-sync.md): revision-aware conflicts, not capture-time-only winners. Exact protocol remains open. |
| 3. Chapter ownership/time base | Still open. Recording-specific timing follows the separate-recording model; whole-recording versus per-file transport and authoritative chapter source need specification. |
| 4. Media authentication | [ADR-0020](../../ADR/0020-bearer-media-and-cast-proxy.md): bearer app-to-server media, preserve phone proxy for Cast. Signed server URLs are not required initially. |
| 5. Native refresh transport | [ADR-0021](../../ADR/0021-native-refresh-sessions.md): explicit rotating native refresh tokens in protected storage, with revocable device sessions. Web auth remains open. |
| 6. Discovery/server identity | Open: endpoint, stable server identity, capability negotiation, and URL changes. Server/account isolation is already required by ADR-0013. |
| 7. Pagination | Open: one consistent contract, caps, counts, and ordering must be designed. |
| 8. Offline snapshot | Open: required fields, schema version, reconciliation, and invalidation. |
| 9. Annotation/bookmark addressing | Exact locations are file-bound under ADR-0006; resource addressing, audio bookmark time base, deletion, and idempotency remain open. |
| 10. Finished/read state | [ADR-0022](../../ADR/0022-edition-recording-completion.md): completion per edition/recording and aggregated title history. Thresholds/manual overrides remain open. |
| 11. Third-party access | Already accepted in ADR-0009: a documented open versioned API without ordinary official-app identity gating; auth/library permissions still apply. |
| 12. Android identity/flavors | Placement already accepted as `apps/android/`. [ADR-0023](../../ADR/0023-android-distribution-flavors.md) accepts full plus Cast-free F-Droid builds. Application ID, name/URI details, signing continuity, and publishing remain open. |
| 13. Licensing intake | ADR-0017 replaces the all-MIT target for Android. Preserve source licenses/notices and fix missing dependency notices; exact intake packaging remains to be implemented. |

## Required corrections before adaptation

1. **Resume ordering:** the original plan's newer-`capturedAt`-wins rule is not accepted. Capture time is context, not sole authority. Android's resolution, retry, and conflict tests need adaptation to ADR-0015/0019. Preserve unresolved offline positions rather than auto-overwriting by clock time or arrival order.
2. **Content replacement:** file-relative positions do not inherently survive replacement or re-encoding. Distinguish file ID, content version, recording layout revision, and position revision. Do not silently reuse offsets against incompatible bytes.
3. **Account isolation:** the audit's L6 is a defect to fix, not preserved behavior. Partition local downloads, progress, cached metadata, restore state, and queued operations by server and authenticated account. Requests started under one scope must not publish into another after account changes. Include a regression for dirty progress from account A never uploading as account B.
4. **Reader licensing boundary:** a shared copy of BookOrbit-modified Foliate cannot simply become the MIT web reader. Shared asset/build design remains undecided. Existing Android behavior can be preserved under its own license with proper notices.
5. **Verification:** the audit reports 335 unit tests and 20 instrumentation tests passing per flavor on an Android 16 emulator, plus builds/lint. These were not rerun in this ADR session. Cast proxy/fake-player tests are not a real Cast session; physical Chromecast and projected Auto/head-unit acceptance remain outstanding.
6. **Scope:** retaining behavior does not mean every existing class stays byte-identical. Networking, account storage, identifiers, and progress reconciliation must change where accepted ADRs require it. Do not implement roughly 75 BookOrbit UI routes just to avoid adapting the client.

## Updated next-work direction

The original plan's authorship CSV is no longer the critical path. The next useful engineering package is a provenance-preserving AGPL Android baseline under `apps/android/`, retaining both distributions and the existing regression suite, followed by a media adapter and fake Litara contract. This is a proposed work sequence, not authorization to choose unresolved application identity, toolchain/library changes, or API details.

Before source import, settle application identity/signing expectations and notice packaging. Before the fake/backend contract becomes authoritative, settle chapter representation, discovery, pagination/offline snapshots, revision/error semantics, and refresh concurrency. Hardware acceptance remains mandatory at integration milestones. No app implementation was performed in this reconciliation.
