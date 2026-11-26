# ADR-0098: Reading stats and a reading heatmap

Status: Accepted
Date: 2026-11-25
Decision owner: Repository owner
Amended by: [ADR-0109](0109-audiobook-listening-sessions.md)

## Context

[ADR-0092](0092-record-reading-sessions.md) records every ebook reading session (start, end, active seconds, start and end fraction, edition), private to its account. It names a contribution-style heatmap of when and how much a person read as wanted later, and leaves the heatmap design as a later decision. BookOrbit offers reading stats (daily time, streaks, pace, top authors and genres); the 2026-11-25 sweep ranked stats and a heatmap first among BookOrbit features (`research/sweep-2026-11-25.md`).

Nothing yet defines what a day is, what counts as a reading day for a streak, which stats are shown, or where they live. These choices change the numbers a person sees, so they are the owner's.

Only ebook sessions exist. Audiobook listening sessions are not recorded (ADR-0092), so audiobooks cannot be included without new recording work.

## Decision

On 2026-11-25 the owner chose:

1. **Day boundaries use the reader's time zone.** The client sends its IANA time zone (for example `Europe/Berlin`) and the server groups sessions by the local calendar day of their start time. A session that crosses midnight counts on the day it started.
2. **A reading day is a day with at least 5 minutes of active reading** (the sum of that day's sessions). Streaks count consecutive reading days. The heatmap still shows the minutes of days below the threshold, but they do not count as reading days.
3. **The first increment is a 12-month heatmap of active minutes per day, totals for the shown period, and the current and longest streaks.** Top authors and genres, pace and goals are later increments.
4. **A Stats page in the main navigation**, next to Library and Shelves, built with UI SDK (ADR-0079).

The following are implementation defaults, open to the owner's change (see Open questions):

- A read-only, additive endpoint `GET /stats/reading?from=&to=&timeZone=` (dates `YYYY-MM-DD`, inclusive) returns per-day active seconds and the summary. It covers only the caller's own sessions on editions the caller can still see, accepts at most 366 days, and stores nothing (ADR-0082 additive).
- Totals are active time, reading days, sessions and distinct books in the range. The current streak still counts when the latest reading day is today or yesterday in the reader's time zone; the longest streak is within the requested range.
- The heatmap shows intensity in a few steps, gives each day a text label, and has a table alternative for screen readers.
- Ebooks only: audiobook listening is not recorded (ADR-0092), and the page says so.

## Alternatives

- UTC days: simpler and consistent across devices, but evening reading lands on the wrong day for most people.
- A day counts on every day a session touches, split by minutes: more exact, more complex, and rarely different.
- A 1-minute threshold: counts every real reading, but a brief look at one page keeps a streak alive. A 15-minute threshold: only substantial reading counts. The owner chose 5 minutes.
- Precomputed daily rollups: faster for very large histories, but they add a writer and a consistency rule. Not needed at personal-library scale.
- Stats on the profile or in Settings rather than the main navigation.

## Consequences

Stats are only as accurate as the browser-measured active time (ADR-0092). Sessions from editions the person can no longer see drop out of the totals. Changing the threshold or day rule later changes historical numbers, which is acceptable because nothing is stored. Audiobooks need listening sessions before they can be counted.

## Verification

Planned: day grouping in a non-UTC time zone, including a session just before local midnight; the 5-minute reading-day threshold (summed per day); current streak counting today or yesterday and breaking after a gap; the longest streak; another account's sessions and unseen editions excluded; a range over 366 days refused; the heatmap renders intensity steps and an accessible table.

## Open questions

Not chosen by the owner: the endpoint shape and 366-day limit, the exact totals, streak counting through yesterday, and the heatmap's intensity steps. Including audiobooks needs listening sessions first (ADR-0092).
