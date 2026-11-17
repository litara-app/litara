# T006 acceptance ledger (38 scenarios)

Last updated at the SMTP slice. Source of scenarios: `contracts/t006/scenarios.json`. "Covered" means an automated test against the real PostgreSQL-backed server passes; it does not claim third-party-client, hardware or inbox success. Test names are in `apps/server/internal/httpapi/`.

| # | Scenario | State | Evidence / gap |
| - | --- | --- | --- |
| 1 | integration-settings | Covered | `TestIntegrationSettings`: disabled defaults, admin-only, 422 limits, replay, `operation_id_reused`, `stale_revision` with `currentRevision`. |
| 2 | credential-lifecycle | Covered | `TestCredentialLifecycleAndAuthenticationBoundaries`, `TestCredentialLimitsAndThrottle`: one-time secret, replay, own-only list, idempotent revoke, 50 limit, throttle. |
| 3 | credential-transport | Partial | Covered for OPDS (`TestOPDSAuthenticationBoundaries`) and KOReader (`TestKOReaderWireAuthAndEnvelopes`): wrong kind, main password, bearer, HTTPS rule and dev exception. No automated log-content inspection; secrets are kept out of URLs and logs by construction/code review only. |
| 4 | credential-account-disable | Covered | OPDS, KOReader and the queued-send recheck (`TestDeliveryRechecksAuthorityAndInputsBeforeSubmission/account_disabled`) all refuse a disabled account; no SMTP connection is made. |
| 5 | opds-v1-conformance | Partial | Namespace-aware Atom decode plus semantic checks. No official machine schema exists in the pinned set for OPDS 1.2; no RELAX NG run. |
| 6 | opds-v2-conformance | Covered | `TestOPDS2ConformsToPinnedOfficialSchemas` validates real feeds/publications (including empty pages) against pinned official schemas. See Known limits for the uri-template caveat. |
| 7 | opds-grants | Covered | `TestOPDSFeedsProjectOneGrantedDataset`, `TestOPDSAudioOriginalsAndArtwork`: ungranted and unknown are the same 404, artwork included. |
| 8 | opds-search-pagination | Covered | `TestOPDSSearchPaginationAndFilters`: literal NFC/case-insensitive, wildcard-literal, deterministic pages in both versions. |
| 9 | opds-original-range | Covered | `TestOPDSOriginalAcquisitionHeadRangeAndReplacement`: bytes, strong ETag, HEAD, 206/416/400/412/304, revocation mid-sequence. |
| 10 | opds-audio | Covered | One file per publication, file order, individual-file description, incomplete recording's available file downloadable, unavailable file never advertised. |
| 11 | opds-replacement | Covered | New content version advertised, old link 412 `content_changed`, deleted bytes 503 then unadvertised after rescan. |
| 12 | opds-real-client | **Not run** | No pinned external OPDS client was run. |
| 13 | smtp-config-ownership | Covered | `TestSMTPConfigurationOwnershipAndSecrets`, `TestPersonalTransportUsesItsOwnCredentialsAndNeverFallsBack`: admin-only server transport, per-user personal transport, explicit choice, no fallback, server details never exposed. |
| 14 | smtp-secret-key | Covered (simulated restart) | Ciphertext/nonce/key ID inspected in the database (no plaintext or fragment); key removed and wrong key (same ID) fail closed with settings intact (`SetKeys`). A real process restart with a changed environment key was not run. |
| 15 | smtp-tls-test | Covered | `TestSMTPConnectionTestsSendNothingAndNeverDowngrade`: STARTTLS and implicit success, untrusted certificate (both modes), missing STARTTLS (no plaintext fallback), explicit local plaintext, auth ok/refused; zero messages and zero DATA phases. |
| 16 | recipient-lifecycle | Covered | `TestRecipientLifecycleIsPrivateAndInjectionSafe`: concurrent create, stale update, foreign 404, CRLF/display-form/multi-address refusal, tombstone and replay. |
| 17 | send-intent | Covered | `TestDeliveryCreateIsAtomicAndIdempotent`: delivery, receipt and job in one transaction; owner-only history. |
| 18 | mail-originals | Covered | `TestDeliverySendsOriginalsByExactBytes`: ebook, comic and individual audio file; SHA-256 equal to the original; one attachment each; envelope and headers checked with an independent MIME parser. |
| 19 | mail-operation-replay | Covered | Six concurrent identical requests return one body and one job; replay after progress returns the original 202; changed payload is `operation_id_reused`. |
| 20 | mail-recheck | Covered | Ten cases (grant, account, replaced file, recipient edit/delete, transport change/disable, email disabled, limit lowered, key unavailable): each fails with a typed code and the sink sees no connection. |
| 21 | mail-safe-retry | Covered | Retry at 5 s then 30 s (controllable clock), at most three attempts, exhaustion fails; DATA never reached on recipient refusals. |
| 22 | mail-permanent-failure | Covered | 550 fails once with `smtp_rejected_550`; no retry; server text not echoed. |
| 23 | mail-unknown | Covered | Acknowledgement lost after the sink recorded the message: `outcome_unknown`, exactly one message, no resend by clock advance or redelivered job. |
| 24 | mail-restart | Covered (simulated crash) | Crash injected after the durable boundary: lease protects a live attempt, an expired lease recovers as `outcome_unknown`, no message sent. The crash is a test hook, not a killed process. The real River path (`MaxAttempts` 1, scheduled jobs) is covered by `TestDeliveryJobsAreNeverRetriedByTheQueue`. |
| 25 | mail-cancel-resend | Covered | Cancel only queued/retry_wait at the current revision; replay; accepted is `delivery_not_cancellable`; eight cancel-versus-claim races end in exactly one winner; explicit resend needs acknowledgement and leaves the old result unchanged. |
| 26 | mail-limits | Covered | Oversize refused before any job or network use; ten of fourteen concurrent distinct requests accepted, four 429 with Retry-After; window moves on. The 25 MiB default and 100 MiB bound are the settings defaults/limits; the attachment is streamed, not buffered. |
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

Totals at this commit: Covered 31 (incl. 14 and 24 with simulation caveats, 28 limited), Partial 4 (3, 5, 35, 38), Not run 2 (12, 36), Not started 1 (37 web flows). 31 + 4 + 2 + 1 = 38.
