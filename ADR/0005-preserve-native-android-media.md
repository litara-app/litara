# ADR-0005: Base Android on the existing native client and preserve media integrations

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Archived Litara uses Expo/React Native. The user instead selected `deranjer/bookorbit-android` and explicitly required preserving its Chromecast and Android Auto work. The inspected native app uses Kotlin/Compose and Media3, with dedicated Cast handoff/proxy and Auto browsing/search/playback code and tests. See [research](RESEARCH.md) for the pinned source.

## Decision

Start the new Litara Android application from that native client's setup and working behavior, in this repository at `apps/android/`. The user explicitly selected this placement so API and Android changes can be reviewed together. Do not replace it with the archived Expo client or discard Cast/Auto as optional redesign work. Adapt networking and branding to the new backend while retaining those integrations and their regression coverage.

## Alternatives

- Continue the archived Expo client.
- Create a new mobile application with no reuse.
- Adapt the native Android project, as selected.

## Consequences

The API and media-delivery contract must account for remote seeking, multi-file playback, artwork, offline content, and handoff. Preserve upstream notices and provenance. ADR-0017 now accepts retaining Android under AGPL, and ADR-0023 accepts both full and F-Droid distributions. Actual source import and application identity remain separate work; this ADR does not relabel AGPL material as MIT.

## Verification

Before claiming preservation: carry forward relevant unit/instrumentation tests; verify large-offset ranges, format/MIME behavior, queue replacement, seek/resume across files, and local/Cast handoff without duplicate playback. Verify Auto cold-start browsing, search, offline playback/artwork, and account isolation. Real Chromecast and Auto head-unit checks remain required; none were run in this task.

## Open questions

Application ID/signing, release setup, and source import strategy remain open. ADR-0009 accepts adapting to Litara's API; detailed contracts remain open. Current licensing is governed by ADR-0017, superseding ADR-0012. Selecting the destination does not mean the Android source has already been imported.
