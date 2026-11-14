# ADR-0068: Scope T005 to online web flows with recoverable pending writes

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

Android offline downloads are accepted and implemented for recordings; browser downloads/service workers have not been selected. T005 needs a finite client scope and must not reopen Android player/reader ownership accidentally.

## Decision

On 2026-11-14 the user selected "Online web with retry recovery" and separately requested shared and smart shelves. T005 is web-first: responsive catalog, edition/recording selection, reading, annotations, manual and smart shelves, web audio, account/library administration and T004 management/review flows against real APIs. Library-granted users can browse/read/listen and manage their personal state; catalog management requires administrator status plus the library grant. Book/recording choice is explicit; do not silently transfer positions between alternatives.

Opening content requires online authorization. Do not include browser offline book downloads or a service worker in T005. Short network failures retain pending personal-state operations in account/server-scoped IndexedDB, with their original operation IDs, base revisions and content versions. A failed request is not displayed as saved. Retry only after the same account is authenticated; after logout or detected access removal, lock pending data, clear visible protected content, and never send it as another user. Keep locked pending data without automatic pruning; expose its state on returning to the account. This is recovery for interrupted online use, not an offline-reading guarantee.

Preserve Android and its current audio API compatibility; use shared fixture-level locator evidence without porting Android reader code. Native ebook adaptation is a separately owned later package, not part of T005. T005 must document the remaining cross-client locator/hardware gate and may not claim full first-release readiness until it is resolved.

Browser acceptance targets current stable Chromium, Firefox and WebKit as pinned in the local test environment, including narrow-screen/touch and keyboard workflows. Test actual audio codec results; unsupported variants have explicit states. Do not add transcoding or reduce ADR-0025's broad release target silently.

## Alternatives

- Online web plus durable retry recovery, as proposed.
- Full browser offline downloads now: requires explicit quota, storage, encryption/access, eviction and synchronization policy.
- Web plus Android ebook adaptation in one assignment: broader package and native ownership/testing needed.

## Consequences

T005 can focus on the missing web/server reader path without replacing Android's reader. Explicit capability reporting and accessibility are part of completion. OPDS/email/KOReader remain T006. CI stays disabled; local development builds/tests are allowed.

## Verification

Planned: response loss/network failure/reload with pending writes; logout/switch account/access revocation; repeated operations; real browser persistence; paused/changed-content conflicts; browser/codec matrix; keyboard and touch use. Existing Android behavior remains a compatibility constraint; no new physical hardware success is implied.

## Open questions

None within the selected online-web scope. Shared/smart-shelf permissions and the reader isolation/contract details are separate pending decisions; acceptance here does not approve them.
