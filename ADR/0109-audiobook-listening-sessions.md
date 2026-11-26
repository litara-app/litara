# ADR-0109: Record audiobook listening sessions

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0092](0092-record-reading-sessions.md), [ADR-0098](0098-reading-stats-and-heatmap.md)

## Context

[ADR-0092](0092-record-reading-sessions.md) records ebook reading sessions and leaves audiobook sessions out. [ADR-0098](0098-reading-stats-and-heatmap.md) stats are therefore ebook only. On 2026-11-26 the owner asked for listening and reading time to be recorded from Android. For ebooks the server already accepts `PUT /editions/{editionId}/reading-sessions/{sessionId}`. There is no route for a recording, and the `reading_sessions` table requires an edition ([research](../research/android/legacy-client-map.md)).

## Decision

On 2026-11-26 the owner agreed to this proposal and to the recommended answers to its open questions:

1. **Listened seconds are wall-clock seconds** during which audio played. At 2x speed, one minute listened is 60 seconds. Paused and buffering time does not count.
2. **Listening counts toward reading days and streaks.** A day's reading and listening time together count toward the 5-minute threshold of ADR-0098.
3. **Both the web player and Android send listening sessions.**
4. **Android keeps unsent sessions on the device and sends them when it can**, for listening sessions and for ebook reading sessions. The web keeps ADR-0092's rule: no offline queue.
5. The Stats page shows reading and listening separately and together.

The following are implementation defaults, open to the owner's change:

- `PUT /recordings/{recordingId}/listening-sessions/{sessionId}` and `GET /titles/{titleId}/listening-sessions`, with a table of their own. A session has a start, an end, listened seconds, and start and end places as a fraction of the recording. It uses the same idempotent upsert as reading sessions and is private to its account.
- A pause longer than thirty minutes ends a session.
- The API change is additive (ADR-0082). The table goes into the consolidated initial migration (ADR-0030).

## Alternatives

- Add a nullable recording to `reading_sessions` and its routes: one table, but the published ebook shapes require an edition, so a response could no longer promise one.
- Record seconds of book heard instead of wall-clock seconds: shows progress through the book, but overstates time spent.
- No offline queue: simpler, loses offline listening.
- Keep stats ebook only.

## Consequences

Listening appears in history, stats and streaks. Streak numbers will change for people who listen. A queue adds storage and retry rules on Android, scoped per account like other offline data.

## Verification

Planned: owner-only read and write; a retry or older update never shrinks a session; an unseen recording answers not found; speed and pause accounting; offline sessions sent after reconnect and after an app restart, under the right account.

## Open questions

The owner answered the proposal's questions on 2026-11-26 (see Decision). Not chosen by the owner: the endpoint shape, the thirty-minute limit, how often sessions are sent, how long unsent sessions are kept on a device, and how long sessions are kept on the server.

