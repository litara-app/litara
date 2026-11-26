# ADR-0092: Record every reading session

Status: Accepted
Date: 2026-11-22
Decision owner: Repository owner
Amended by: [ADR-0109](0109-audiobook-listening-sessions.md)

## Context

The title page's reading log shows only manual finish and unfinish events. Reading a few pages leaves a resume point and nothing else, so the log stays empty (observed 2026-11-22 on the short-stories test book). ADR-0015 and ADR-0065 define position and completion state but no record of when and how much a person read.

## Decision

On 2026-11-22 the owner decided that Litara records all reading sessions, including short ones of a few pages, because the history is useful. A heatmap of when and how much a person read, like a contribution calendar, is wanted later. This record covers recording and listing; the heatmap is a later feature that reads this data.

Each session belongs to one account and one edition, and is private to that account. A session has a start time, an end time, active seconds, and where the person was at the start and the end as a fraction of the book (null when unknown).

The following are implementation defaults chosen to deliver this and are open to the owner's change (see Open questions):

- The web reader starts a session when a book is open and the page is visible. Active time counts only while the page is visible and the person has done something (turned a page, pressed a key, moved the pointer) in the last two minutes. A pause longer than thirty minutes ends the session, and later activity starts a new one.
- The browser sends the session as an idempotent upsert keyed by a session ID it generates, about every thirty seconds while active and when the page is hidden or closed. The server keeps the largest active time and latest end it has seen, so retries and out-of-order sends are safe.
- Sessions are not queued for offline sending in this increment. A session that cannot be sent is lost.
- The server lists a person's sessions, newest first, for a title (and later by date range for the heatmap). Only the account's own sessions are ever returned, and only for titles it can still see.
- Sessions are kept until the account is deleted. The API change is additive (ADR-0082) and the table goes into the consolidated initial migration (ADR-0030).
- Audiobook listening sessions are not covered here.

## Alternatives

- Record only finish and start events: small, but cannot show how much or when someone read.
- Derive sessions from position updates on the server: no new client code, but position saves are throttled and carry no active time, so durations would be guesses.
- Queue sessions offline like annotations: more complete, and heavier. Deferred.

## Consequences

The reading log can show real reading. Every reading browser sends a small write every thirty seconds, which is modest. Time is measured in the browser and can be wrong if the page is left open and active. The data is personal reading history, so it stays private to the account and is removed with it.

## Verification

Planned and done at implementation: a session is created, updated and read back by its owner only; a retry or older update does not shrink it; a title the caller cannot see answers not found; the web reader sends sessions while active and not while idle or hidden; the reading log lists them.

## Open questions

The owner chose to record all sessions. Not yet chosen by the owner: the idle limits (two and thirty minutes), the send interval, offline queuing, how long sessions are kept, and audiobook sessions. The heatmap design is a later decision.
