# ADR-0110: Audiobook bookmarks

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner

## Context

The Android player had bookmarks through the BookOrbit client. Litara's server has none for recordings, so the button is hidden for Litara audiobooks ([research](../research/android/legacy-client-map.md)). On 2026-11-26 the owner asked for audio bookmarks. Ebook bookmarks are annotations anchored to one file version ([ADR-0066](0066-private-annotations-and-shelves.md)). Audio places are a file, a content version and a millisecond offset, with layout changes detected ([ADR-0019](0019-file-anchored-audio-positions.md)).

## Decision

On 2026-11-26 the owner agreed to this proposal and to the recommended answers to its open questions:

1. **Audiobook bookmarks are their own private resource** under a recording, separate from ebook annotations.
2. **Android and the web player** can both create, name, open and delete them.
3. **They are left out of the annotations hub and its export (ADR-0099) at first.**
4. Each bookmark has a client-generated ID, an anchor of file ID, content version and offset in milliseconds, the recording's layout revision, and an optional note.
5. Writes follow the annotation rules: a base revision, replay by operation ID, retained conflicts and tombstones, so a bookmark made offline is never silently lost or overwritten.
6. A bookmark whose file or version changed is kept and shown as unavailable. It is never moved to a guessed place. Recording repair (ADR-0070) carries bookmarks over only where a file anchor survives unchanged.

The API change is additive (ADR-0082).

## Alternatives

- Reuse edition annotations with a new locator kind: shares sync code and the annotations hub, but an annotation belongs to an edition and its `anchor` shape is published.
- Keep bookmarks only on the phone: no API work, lost with the device and absent on the web.
- Last write wins without revisions: smaller, but conflicts with how other personal state behaves.

## Consequences

Bookmarks follow the person across devices. This is a new synced resource with its own conflict handling and tests. It does not appear in the annotations hub (ADR-0099) or its export yet.

## Verification

Planned: owner-only access, replay and conflict cases, a changed file version keeping the bookmark unavailable, repair behaviour, an offline round trip on Android, and a web round trip.

## Open questions

The owner answered the proposal's questions on 2026-11-26 (see Decision). Adding audiobook bookmarks to the annotations hub and export is left for later.

