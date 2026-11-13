# T003 implementation notes

Governing ADRs: 0009, 0013, 0018–0022, 0024, 0029–0043 (plus 0005/0017 for Android licensing and 0028 for the
inspector reused by the seed). Nothing here accepts or changes an ADR. The contract under `contracts/t003/` is the
implementation target; where the contract's prose and `openapi.json` disagree, `openapi.json` was followed (see
"Contract observations").

## What exists

### Go server (`apps/server`)

| Package | Responsibility |
| --- | --- |
| `internal/wire` | The contract's JSON shapes. Type names equal the OpenAPI component names so the generated and shared specs compare by name. `Nullable[T]` expresses `anyOf [$ref, null]` (Huma cannot tag a nullable `$ref`). |
| `internal/accounts` | Local accounts, atomic first-admin bootstrap (advisory lock), argon2id passwords, opaque tokens stored as SHA-256 verifiers, native sessions, browser sessions, serialized refresh, explicit grants, own-session list/revoke, in-process login throttle. |
| `internal/catalog` | Self-contained snapshot, list/search/pagination, readiness evaluation, chapter-source selection and whole-source validation, artwork/file authorization. |
| `internal/progress` | Position and completion writes, receipts, durable conflicts, conflict resolution. One transaction per mutation, locking the user/recording state row first. |
| `internal/media` | Byte-exact range/precondition planning and bounded file access. Outside Huma JSON serialization. |
| `internal/httpapi` | Huma wiring: middleware (request id, authentication, CSRF/Origin, admin gate), typed `Problem`, all 31 operations. |
| `internal/seed` | Explicit repeatable fixture (generated MP3/M4B/M4A and PNG, T001 inspector for size/duration), plus fixture-only `ReplaceContent` and `Reorder`. Never run at startup. |
| `cmd/ctl` | `bootstrap-admin`, `reset-password` (prompt or stdin only), `seed`, `gen-key`, `openapi`, plus the T001 commands. |

The schema is added to the single init migration (`00001_init.sql`, ADR-0030); River's history is untouched. sqlc
generates all data access (`internal/db/queries/{accounts,catalog,progress}.sql`).

### Security details chosen during implementation (review as implementation details)

- Passwords: argon2id, defaults m=64 MiB, t=3, p=2 (`LITARA_ARGON2_*`), 16-byte salt, PHC-style string. Minimum
  length 12 at creation; passwords are never trimmed or normalized. Unknown usernames still perform a hash.
- Tokens: 32 random bytes, base64url; only SHA-256 verifiers are stored. Browser CSRF token is derived from the cookie
  token (`SHA-256("litara-csrf-v1:"+cookie)`) so it is session-bound without a second stored secret.
- Refresh: the recoverable successful response is AES-256-GCM sealed with `LITARA_SECRET_KEY` (new required server
  setting), bound to session id + old verifier as AAD, and nulled after 60 seconds (lazy on use, plus a 10 s purge
  loop in the server, plus on logout/revocation/reset/deactivation). A late retry returns `refresh_retry_expired`
  from the retained nonsecret association; a different request id with an old verifier returns `refresh_reuse` and
  revokes only that session.
- Login throttle: 10 failures per normalized username per 5 minutes, in memory per process, `429` + `Retry-After`.
  Not shared across replicas; a policy for production is open.
- Cookie `litara_session`: HttpOnly, SameSite=Lax, `Path={mount}/api/v1`, no Domain, Secure unless the explicit
  `LITARA_DEV_INSECURE_HTTP=1` development mode is set.

### Decisions taken inside the accepted ADRs (please confirm or correct)

1. **Repeated finish / unfinish of an already-matching state** is accepted (`200`) with no revision bump and no
   history entry. A conflict-resolution `keep_server` does bump the revision (so stale clients re-sync) without
   changing the finished flag.
2. **Manual completion events ignore a stale layout revision**; only `natural_end` is anchored to the layout and
   returns `412 layout_changed`. The contract text says "final file/layout change -> 412" for the terminal anchor.
3. **Offset validation precedes the stale-revision conflict**: a stale write with an out-of-range offset is a `422`
   and creates no conflict (no unusable candidate is stored). The contract lists base revision and offset together.
4. **Anchor classification order**: unknown/nonmember file -> `422 invalid_position` (or `412 layout_changed` when the
   layout is stale); known old content version -> `412 content_changed` even if the layout also moved; stale layout
   with a valid anchor -> `412 layout_changed`.
5. **Thumbnails larger than 5 MiB are treated as absent (404)** to honor the Android Auto limit; covers are unlimited.
6. **Superseded content versions** are not served: `412 content_changed`; never-known versions are `404`.
7. **File access** for a file in several recordings is allowed if any containing recording is in a granted library, and
   is `409 recording_incomplete` if any such granted recording is incomplete.
8. **History order** is the server insertion sequence (`completion_history.seq`), not a timestamp, because timestamps
   can tie. The contract only requires stable ordering.
9. Usernames: lookup key is `lowercase(NFC(trim(name)))`; the trimmed display spelling is kept.

### Contract observations (not silently changed)

- `contracts/t003/README.md` says `POST /conflicts/{id}/resolve`; `openapi.json` defines
  `POST /recordings/{recordingId}/conflicts/{conflictId}/resolve`. The latter is implemented.
- `Problem` in the contract allows additional properties. The Huma type is closed with the five documented optional
  members (`errors`, `conflictId`, `current`, `currentCompletion`, `currentLayoutRevision`).
- `UpdateUser.minProperties: 1` is enforced by the handler (`422`) rather than by the generated schema.

## Verification map: contract scenarios -> executed tests

`contracts/t003/fixtures/scenarios.json` (20 scenarios). All server tests below use real PostgreSQL 17.6, the T001
inspector, and ffmpeg-generated media. Android rows are JVM unit tests unless stated.

| Scenario | Evidence |
| --- | --- |
| admin-grant-boundary | `TestListSearchPaginationRecentAndGrants`, `TestMediaAuthorizationAndTokenExpiryRetry` |
| l6-account-switch | Android `AccountScopeTest` (failed first, see `l6-baseline-failure.md`), `OfflineStoreTest`; server-side `TestTwoDeviceContention…` |
| refresh-lost-response / refresh-reuse | `TestRefreshExchangeRules`, `TestConcurrentIdenticalRefreshRotatesOnce`; Android `LitaraClientTest` |
| position-retry / position-id-collision | `TestPositionRevisionsReceiptsAndBackwardSeek` |
| stale-position | `TestTwoDeviceContentionPreservesBothCandidates`, `TestConcurrentWritersExactlyOneWins` |
| layout-change / replacement | `TestLayoutAndContentChangesPreserveCandidates`, `TestContentReplacementAndReorderKeepOldVersionsHonest` |
| conflict-resolution-race | `TestConflictResolutionChoicesAndRaces` |
| natural-end / seek-only | `TestCompletionNaturalEndManualAndHistory` |
| access-revoked / offline-outage | `TestMediaAuthorizationAndTokenExpiryRetry` (revocation applies at every delivery path); Android `LitaraClientTest` (network error keeps scope) |
| logout | `OfflineStoreTest` (task started before logout cannot commit) |
| chapter-invalid-source | `TestChapterSourceFixtures` (shared `chapter-sources.json`), `TestContentReplacement…` (reorder rejects the whole source) |
| incomplete | `TestIncompleteAndMissingMedia` |
| web-csrf | `TestBrowserSessionCookieOriginAndCSRF` |
| native-third-party | `scripts/contracts/live_check.py` (stdlib HTTP only) |
| completion-stale | `TestCompletionNaturalEndManualAndHistory` |

Range cases: `internal/media` tests run the shared `ranges.json` and a sparse >4 GiB read; `TestOriginalBytesAndRangeSemantics`
exercises them through HTTP against generated MP3 and M4B files. The sparse test proves offset arithmetic only; it is
not a valid-large-audiobook verification.
