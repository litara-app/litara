# Architecture decision records

Only Accepted records authorize implementation. Proposed records are discussion material. Acceptance comes from explicit user choices, recorded on the date in each ADR. For accepted records with open questions, only the stated decision is authorized.

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-use-repository-adrs.md) | Enforce repository ADRs and archive the old stack | Accepted |
| [0002](0002-use-go-backend.md) | Build the backend in Go | Accepted |
| [0003](0003-start-fresh.md) | Start fresh without old-data/API compatibility | Accepted |
| [0004](0004-support-existing-and-managed-libraries.md) | Scan existing folders; offer managed imports | Accepted |
| [0005](0005-preserve-native-android-media.md) | Start from native Android; preserve Cast and Auto | Accepted |
| [0006](0006-model-titles-editions-and-files.md) | Separate titles, editions/recordings, and files | Accepted |
| [0007](0007-support-nas-book-storage.md) | Support NAS book folders with local state | Accepted |
| [0008](0008-use-postgresql.md) | Use PostgreSQL | Accepted |
| [0009](0009-open-versioned-api.md) | Publish an API open to third-party clients | Accepted |
| [0010](0010-react-mantine-web.md) | Retain React/TypeScript/Mantine | Accepted |
| [0011](0011-first-usable-release.md) | Define the first usable release scope | Accepted |
| [0012](0012-mit-licensing-direction.md) | Original all-MIT direction; replaced by 0017 | Superseded |
| [0013](0013-library-access-local-login.md) | Per-user library access; local login first | Accepted |
| [0014](0014-protect-metadata-edits.md) | Protect edits; make overwrite/write-back explicit | Accepted |
| [0015](0015-reading-state-and-sync.md) | Reading state and sync conflicts | Accepted |
| [0016](0016-backend-process-and-tooling.md) | Backend topology and tooling | Accepted |
| [0017](0017-separate-android-agpl-license.md) | Android AGPL; backend/web MIT | Accepted |
| [0018](0018-stable-media-identities.md) | Play recordings using stable versioned file identities | Accepted |
| [0019](0019-file-anchored-audio-positions.md) | File/version plus millisecond audio positions | Accepted |
| [0020](0020-bearer-media-and-cast-proxy.md) | Bearer media requests and the phone Cast proxy | Accepted |
| [0021](0021-native-refresh-sessions.md) | Rotating native refresh tokens and device sessions | Accepted |
| [0022](0022-edition-recording-completion.md) | Edition/recording completion and title history | Accepted |
| [0023](0023-android-distribution-flavors.md) | Full and Cast-free F-Droid builds | Accepted |
| [0024](0024-go-backend-tooling.md) | Huma, sqlc/pgx, Goose, and River backend tooling | Accepted |
| [0025](0025-broad-format-targets.md) | Broad format targets and explicit capability states | Accepted |
| [0026](0026-evaluate-wasm-media-inspection.md) | Original WASM evaluation-first approach; replaced by 0028 | Superseded |
| [0027](0027-web-reader-engines.md) | Pristine Foliate, dedicated PDF.js, and Android reader preservation | Accepted |
| [0028](0028-bundle-native-ffmpeg-tools.md) | Bundle ffprobe/FFmpeg now; defer WASM testing | Accepted |
| [0029](0029-recording-manifests-and-chapters.md) | File-relative chapters, CUE precedence, and fallback file markers | Accepted |

| [0030](0030-consolidate-preproduction-migrations.md) | Consolidate application migrations into init until production | Accepted |

| [0031](0031-admin-provisioned-accounts-and-library-grants.md) | Admin-provisioned accounts and explicit library grants | Accepted |
| [0032](0032-offline-access-and-account-logout.md) | Allow offline downloads until the next online access check | Accepted |

| [0033](0033-native-session-lifetimes.md) | Bound native access and refresh-session lifetimes | Accepted |

| [0034](0034-resume-conflict-choice.md) | Preserve competing resume positions and ask on resume | Accepted |

| [0035](0035-recording-natural-end-completion.md) | Complete recordings at natural end with manual controls | Accepted |

| [0036](0036-native-refresh-retry-and-revocation.md) | Make native refresh retries idempotent and revoke reused sessions | Accepted |

| [0037](0037-same-origin-web-session-cookies.md) | Use protected same-origin browser session cookies | Accepted |

| [0038](0038-api-discovery-and-conventions.md) | Use one versioned API, discovery and pagination convention | Accepted |

| [0039](0039-recording-readiness-and-offline-content-versions.md) | Gate incomplete recordings and retain versioned downloads | Accepted |

| [0040](0040-revisioned-audio-progress-protocol.md) | Use idempotent revisioned audio writes with explicit conflicts | Accepted |

| [0041](0041-opaque-credentials-and-browser-session-profile.md) | Use opaque credentials and a protected browser session profile | Accepted |

| [0042](0042-validate-whole-chapter-sources.md) | Validate chapter sources as a whole before falling back | Accepted |

| [0043](0043-t003-retention-and-seeded-integration-scope.md) | Retain sync evidence and scope T003 to a seeded integration slice | Accepted |

| [0044](0044-fingerprint-moves-and-content-replacements.md) | Match unique file moves and version changed bytes | Accepted |

| [0045](0045-conservative-grouping-and-manual-repair.md) | Group conservatively and preserve identities through manual repair | Accepted |

| [0046](0046-reviewed-copy-only-managed-imports.md) | Copy verified managed imports after explicit review | Accepted |

| [0047](0047-metadata-source-priority-and-protected-clears.md) | Prefer protected edits then sidecar metadata over embedded values | Accepted |

| [0048](0048-reviewed-in-file-metadata-writeback.md) | Include explicitly reviewed in-file metadata updates | Accepted |

| [0049](0049-opt-in-metadata-providers.md) | Include opt-in Open Library Google Books and Audnexus enrichment | Accepted |

| [0050](0050-mounted-nas-reconciliation-and-stability.md) | Reconcile OS-mounted libraries without destructive absence handling | Accepted |

| [0051](0051-optional-backups-per-library.md) | Make metadata write-back backups optional per library | Accepted |

| [0052](0052-fidelity-tested-tag-writing-formats.md) | Enable metadata writes only for fidelity-tested formats | Accepted |

| [0053](0053-reviewed-json-sidecar-export.md) | Offer previewed JSON sidecar export alongside in-file updates | Accepted |

| [0054](0054-per-library-modes-and-managed-naming.md) | Configure library modes and preview managed-import templates | Accepted |

| [0055](0055-unambiguous-sidecar-and-cue-association.md) | Associate sidecars and CUE only without ambiguity | Accepted |

| [0056](0056-shared-catalog-administrator-library-permissions.md) | Require administrator status and a library grant for catalog management | Accepted |

| [0057](0057-writeback-recovery-with-backups-off-by-default.md) | Default backups off while requiring recoverable staged writes | Accepted |

| [0058](0058-sha256-cache-and-content-verification.md) | Cache SHA-256 fingerprints with daily and manual verification | Accepted |

| [0059](0059-canonical-root-boundaries-and-explicit-health.md) | Contain paths and explicitly verify library root identity | Accepted |

| [0060](0060-provider-priority-and-identifier-match-review.md) | Configure provider priority and review uncertain metadata matches | Accepted |

| [0061](0061-audio-ordering-and-provisional-title-links.md) | Order audio from consistent evidence and review uncertain title links | Accepted |

## Workflow

1. Read [research](RESEARCH.md), relevant decisions, and the reference code.
2. Create a numbered proposal using [the template](TEMPLATE.md). Include concrete user-visible differences and meaningful alternatives.
3. Ask focused questions. Record the user's answer; do not assume the recommended option was selected.
4. Update status and index after explicit acceptance. Unanswered implementation choices remain open.
5. Reference governing accepted ADRs in implementation PRs/handoffs. Review behavior against the record.
6. To change an accepted decision, accept a new superseding ADR first, then mark/link the old one as Superseded. Do not erase the original rationale.

Statuses: Proposed, Accepted, Rejected, Superseded. No application implementation may rely on a Proposed or Rejected decision.

Run `pwsh -NoProfile -File scripts/Validate-Adrs.ps1`. CI checks numbering, metadata, sections, local links, and index status. Human review enforces decision substance and approval; automation does not infer either.
