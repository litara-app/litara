# ADR-0112: Remove the BookOrbit client from Android and abandon its data

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner

## Context

The Android app began as `deranjer/bookorbit-android` ([ADR-0005](0005-preserve-native-android-media.md)) and still contains its BookOrbit client: the sign-in that appears first, its screens, API layer, local database, download folders and queues of unsent changes. [ADR-0009](0009-open-versioned-api.md) already selects adapting Android to the Litara API without BookOrbit compatibility. The [dependency map](../research/android/legacy-client-map.md) of 2026-11-26 asked what happens to files and unsent changes left by the old client, and recommended leaving the files and saying so in release notes.

## Decision

On 2026-11-26 the repository owner chose, in their words: "completely abandon them and don't mention in release, entirely different project not trying to confuse people."

- Remove the BookOrbit client from the Android app. Litara sign-in is the only way in.
- Abandon the old client's downloads, local data and unsent changes. The app does not read, import, migrate or send them, and no code is written to preserve them.
- Release notes and other user-facing text do not mention BookOrbit or what happens to its data.

What this does not change:

- The Cast, Android Auto and offline behaviour that [ADR-0005](0005-preserve-native-android-media.md) requires stays, for Litara.
- License, copyright and source provenance notices stay as [ADR-0017](0017-separate-android-agpl-license.md) and [ADR-0005](0005-preserve-native-android-media.md) require. "Do not mention" applies to release notes and user-facing text about this removal, not to attribution the license requires.
- Developer records in this repository (decisions, research and handoffs) keep their history.

## Alternatives

- Leave old downloads in place and say so in release notes (the earlier recommendation, not chosen).
- Import old downloads or send unsent changes. They belong to a different server product.
- Keep BookOrbit as a supported second mode. This would contradict ADR-0009.

## Consequences

Less code and one sign-in path. Anyone who used this build with a BookOrbit server loses access to that data in the app. Files the old client saved to a folder the person picked remain there, because the app neither reads nor deletes them. Data in the app's private storage that nothing reads still takes up space until the app is uninstalled or its data is cleared; the owner did not ask for it to be deleted.

## Verification

Planned: both Android flavors build and their tests pass; no BookOrbit API, sign-in or screen remains; Litara playback, offline downloads, Android Auto and the Cast proxy tests still pass; license and notice files are unchanged.

## Open questions

None within this record's scope.
