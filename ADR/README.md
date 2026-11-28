# Architecture decision records

Only Accepted records authorize implementation. Proposed records are discussion material. Acceptance comes from explicit user choices, recorded on the date in each ADR. For accepted records with open questions, only the stated decision is authorized.

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-use-repository-adrs.md) | Enforce repository ADRs and archive the old stack | Accepted |
| [0002](0002-use-go-backend.md) | Build the backend in Go | Accepted |
| [0003](0003-start-fresh.md) | Original fresh-start migration exemption; replaced by 0063 | Superseded |
| [0004](0004-support-existing-and-managed-libraries.md) | Scan existing folders; offer managed imports | Accepted |
| [0005](0005-preserve-native-android-media.md) | Start from native Android; preserve Cast and Auto | Accepted |
| [0006](0006-model-titles-editions-and-files.md) | Separate titles, editions/recordings, and files | Accepted |
| [0007](0007-support-nas-book-storage.md) | Support NAS book folders with local state | Accepted |
| [0008](0008-use-postgresql.md) | Use PostgreSQL | Accepted |
| [0009](0009-open-versioned-api.md) | Publish an API open to third-party clients | Accepted |
| [0010](0010-react-mantine-web.md) | Original React/TypeScript/Mantine web decision; replaced by 0079 | Superseded |
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

| [0062](0062-target-litara-2-release.md) | Target 2.0.0 for the completed rebuild release | Accepted |

| [0063](0063-optional-legacy-data-import.md) | Require a personal-state migration path before 2.0.0 ships | Accepted |

| [0064](0064-pause-github-actions-until-release-readiness.md) | Pause GitHub Actions until explicit release readiness | Accepted |

| [0065](0065-ebook-editions-and-reading-state.md) | File-anchored ebook editions and revisioned reading state | Accepted |

| [0066](0066-private-annotations-and-shelves.md) | Private annotations and private/shared manual/smart shelves | Accepted |

| [0067](0067-isolated-web-readers-and-bounded-comic-extraction.md) | Isolated web readers and bounded comic extraction | Accepted |

| [0068](0068-web-offline-and-t005-client-scope.md) | Online web flows with recoverable pending writes | Accepted |

| [0069](0069-web-tooling-serving-and-t005-gap-ownership.md) | Same-origin web build and end-to-end T005 ownership | Accepted |

| [0070](0070-recording-repair-successors-and-retained-state.md) | Recording repair successors with retained source state | Accepted |
| [0071](0071-separate-reader-origin.md) | Serve the web reader from a separate origin | Accepted |
| [0072](0072-cbr-cb7-extraction-libraries.md) | CBR and CB7 extraction libraries | Accepted |
| [0073](0073-t006-opds-acquisition-and-credentials.md) | T006 OPDS acquisition and app credentials | Accepted |
| [0074](0074-t006-smtp-ownership-and-delivery-recovery.md) | T006 SMTP ownership and recoverable delivery | Accepted |
| [0075](0075-t006-koreader-separate-source-and-identity.md) | T006 isolated KOReader positions and file identity | Accepted |
| [0076](0076-t006-koreader-device-revisions-and-conflicts.md) | T006 KOReader device credentials and retained conflicts | Accepted |
| [0077](0077-provider-identification-and-rate-limits.md) | Optional Open Library contact and per-provider request budgets | Accepted |
| [0078](0078-report-confirmed-ebook-damage.md) | Report confirmed ebook damage as incomplete | Accepted |
| [0079](0079-ui-sdk-only-web-interface.md) | Build the web interface with UI SDK only and remove Mantine | Accepted |
| [0080](0080-optional-short-browser-sessions.md) | Let people choose a shorter browser sign-in | Rejected |
| [0081](0081-book-details-rating-review-and-dates.md) | Add descriptive book details and personal rating, review and reading dates | Accepted |
| [0082](0082-api-compatibility-policy-and-enforcement.md) | Keep the versioned API compatible, and enforce it mechanically | Accepted |
| [0083](0083-tanstack-table-for-data-tables.md) | Use TanStack Table for the web app's data tables | Accepted |
| [0084](0084-tanstack-virtual-for-long-lists.md) | Use TanStack Virtual to window long lists and grids | Accepted |
| [0085](0085-stackable-filter-groups.md) | Let library filters stack into AND/OR groups | Accepted |
| [0086](0086-cover-replacement.md) | Let administrators replace a title's cover | Accepted |
| [0087](0087-hardcover-provider-search-cache-and-reviewed-autofill.md) | Add Hardcover, cache provider searches and offer reviewed auto-fill | Accepted |
| [0088](0088-goodreads-amazon-and-audible-metadata.md) | Decide whether to use Goodreads, Amazon and Audible metadata | Proposed |
| [0089](0089-notification-system.md) | Route responses to actions through a notification system | Accepted |
| [0090](0090-auto-fill-from-a-single-title-and-author-match.md) | Let auto-fill use one clear title-and-author match when a book has no identifier | Accepted |
| [0091](0091-bundle-open-licensed-reading-fonts.md) | Bundle open-licensed reading fonts with the app | Accepted |
| [0092](0092-record-reading-sessions.md) | Record every reading session | Accepted |
| [0093](0093-android-reader-parity-with-the-web-reader.md) | Bring the web reader's features to the Android reader | Accepted |
| [0094](0094-highlight-colour-and-style-in-annotations.md) | Store a highlight's color in the annotation | Accepted |
| [0095](0095-field-level-metadata-editing-and-provider-review.md) | Edit metadata per field with locks, provenance and reviewed provider apply | Accepted |
| [0096](0096-reconcile-metadata-editing-with-provider-and-cover-decisions.md) | Reconcile ADR-0095 with the Hardcover, auto-fill and cover decisions | Accepted |
| [0097](0097-metadata-field-locks.md) | Make metadata locks separate from edits | Accepted |
| [0098](0098-reading-stats-and-heatmap.md) | Reading stats and a reading heatmap | Accepted |
| [0099](0099-annotations-hub.md) | An annotations hub with search and export | Accepted |
| [0100](0100-author-and-series-directories.md) | Author and series directories | Accepted |
| [0101](0101-authors-by-last-name.md) | Sort and filter authors by last name by default | Accepted |
| [0102](0102-editable-lockable-author-data.md) | Pull, edit and lock author data as for books | Accepted |
| [0103](0103-series-data-and-missing-books.md) | Series data and books missing from the library | Accepted |
| [0104](0104-author-and-series-page-defaults.md) | Defaults for the author and series pages | Accepted |
| [0105](0105-author-photos-and-concurrent-edits.md) | Store author photos like covers and refuse out-of-date edits | Accepted |
| [0106](0106-provider-text-and-images.md) | Keep and credit author and series text and images from providers | Accepted |
| [0107](0107-one-filter-format-for-search-and-smart-shelves.md) | Use one filter format for library search and smart shelves | Accepted |
| [0108](0108-schema-names-in-api-compatibility.md) | Keep published schema names stable within `v1` | Accepted |
| [0109](0109-audiobook-listening-sessions.md) | Record audiobook listening sessions | Accepted |
| [0110](0110-audiobook-bookmarks.md) | Audiobook bookmarks | Accepted |
| [0111](0111-android-download-location.md) | Keep Android Litara downloads in phone storage | Accepted |
| [0112](0112-remove-the-bookorbit-client.md) | Remove the BookOrbit client from Android and abandon its data | Accepted |
| [0113](0113-android-pdf-highlighting.md) | How Android creates and draws PDF highlights | Accepted |
| [0114](0114-physical-books-in-2-0-0.md) | Physical books in 2.0.0 | Accepted |

## Workflow

1. Read [research](RESEARCH.md), relevant decisions, and the reference code.
2. Create a numbered proposal using [the template](TEMPLATE.md). Include concrete user-visible differences and meaningful alternatives.
3. Ask focused questions. Record the user's answer; do not assume the recommended option was selected.
4. Update status and index after explicit acceptance. Unanswered implementation choices remain open.
5. Reference governing accepted ADRs in implementation PRs/handoffs. Review behavior against the record.
6. To change an accepted decision, accept a new superseding ADR first, then mark/link the old one as Superseded. Do not erase the original rationale.

Statuses: Proposed, Accepted, Rejected, Superseded. No application implementation may rely on a Proposed or Rejected decision.

Run `pwsh -NoProfile -File scripts/Validate-Adrs.ps1`. CI checks numbering, metadata, sections, local links, and index status. Human review enforces decision substance and approval; automation does not infer either.
