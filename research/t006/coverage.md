# T006 acceptance ledger (38 scenarios)

Last updated at commit `f73ed22`. Source of scenarios: `contracts/t006/scenarios.json`. "Covered" means an automated test against the real PostgreSQL-backed server passes; it does not claim third-party-client, hardware or inbox success. Test names are in `apps/server/internal/httpapi/`.

| # | Scenario | State | Evidence / gap |
| - | --- | --- | --- |
| 1 | integration-settings | Covered | `TestIntegrationSettings`: disabled defaults, admin-only, 422 limits, replay, `operation_id_reused`, `stale_revision` with `currentRevision`. |
| 2 | credential-lifecycle | Covered | `TestCredentialLifecycleAndAuthenticationBoundaries`, `TestCredentialLimitsAndThrottle`: one-time secret, replay, own-only list, idempotent revoke, 50 limit, throttle. |
| 3 | credential-transport | Partial | Covered for OPDS (`TestOPDSAuthenticationBoundaries`) and KOReader (`TestKOReaderWireAuthAndEnvelopes`): wrong kind, main password, bearer, HTTPS rule and dev exception. No automated log-content inspection; secrets are kept out of URLs and logs by construction/code review only. |
| 4 | credential-account-disable | Partial | OPDS and KOReader covered. `createDelivery`/queued-send half is **not implemented**. |
| 5 | opds-v1-conformance | Partial | Namespace-aware Atom decode plus semantic checks. No official machine schema exists in the pinned set for OPDS 1.2; no RELAX NG run. |
| 6 | opds-v2-conformance | Covered | `TestOPDS2ConformsToPinnedOfficialSchemas` validates real feeds/publications (including empty pages) against pinned official schemas. See Known limits for the uri-template caveat. |
| 7 | opds-grants | Covered | `TestOPDSFeedsProjectOneGrantedDataset`, `TestOPDSAudioOriginalsAndArtwork`: ungranted and unknown are the same 404, artwork included. |
| 8 | opds-search-pagination | Covered | `TestOPDSSearchPaginationAndFilters`: literal NFC/case-insensitive, wildcard-literal, deterministic pages in both versions. |
| 9 | opds-original-range | Covered | `TestOPDSOriginalAcquisitionHeadRangeAndReplacement`: bytes, strong ETag, HEAD, 206/416/400/412/304, revocation mid-sequence. |
| 10 | opds-audio | Covered | One file per publication, file order, individual-file description, incomplete recording's available file downloadable, unavailable file never advertised. |
| 11 | opds-replacement | Covered | New content version advertised, old link 412 `content_changed`, deleted bytes 503 then unadvertised after rescan. |
| 12 | opds-real-client | **Not run** | No pinned external OPDS client was run. |
| 13 | smtp-config-ownership | **Not started** | |
| 14 | smtp-secret-key | **Not started** | |
| 15 | smtp-tls-test | **Not started** | |
| 16 | recipient-lifecycle | **Not started** | |
| 17 | send-intent | **Not started** | |
| 18 | mail-originals | **Not started** | |
| 19 | mail-operation-replay | **Not started** | |
| 20 | mail-recheck | **Not started** | |
| 21 | mail-safe-retry | **Not started** | |
| 22 | mail-permanent-failure | **Not started** | |
| 23 | mail-unknown | **Not started** | |
| 24 | mail-restart | **Not started** | |
| 25 | mail-cancel-resend | **Not started** | |
| 26 | mail-limits | **Not started** | |
| 27 | ko-wire-auth | Covered | Envelopes 2001/2003/2004/2005/2006/2009, registration refused, lifecycle methods not implemented, oversize body. |
| 28 | ko-digest | Covered (limited) | All nine contract vectors, plus a >3 GiB sparse file against an independently written reference. Agreement with real KOReader/upstream output is **not** established. |
| 29 | ko-binding | Covered | Ambiguity, binding validation, per-credential effect, stale revision, tombstone. |
| 30 | ko-source-isolation | Covered | Web position, completion and title history byte-identical after the full device sequence. |
| 31 | ko-backward | Covered | Backward payload accepted as a normal write. |
| 32 | ko-competing-devices | Covered | `TestKOReaderDeviceSequence` follows `koreader-device-sequence.json` step by step. |
| 33 | ko-retry | Covered | Replay while canonical, retained when no longer canonical, refused payload never re-recorded. |
| 34 | ko-resolve | Covered | keep_server, use_candidate, reapply, 4-way concurrent resolve (one winner), stale base, foreign 404, unresolved blocker. |
| 35 | ko-replacement | Partial | Replacement, superseded binding 412, content_changed candidate pinned to old version, grant loss covered. A **file move** keeping the stable file ID is not separately tested. |
| 36 | ko-real-client | **Not run** | No pinned unmodified KOReader was run; no captured real request sequence. |
| 37 | web-settings-flows | **Not started** | No web work yet. |
| 38 | release-regression | Partial | Full server suite (`go test ./...`) passed after slice 2; T003/T005 parity unchanged. Web build, reader-isolation and browser tests not rerun. |

Totals at this commit: Covered 16 (28 with limits), Partial 5 (3, 4, 5, 35, 38), Not run 2 (12, 36), Not started 15 (13-26 SMTP/recipients/deliveries, 37 web flows). 16 + 5 + 2 + 15 = 38.
