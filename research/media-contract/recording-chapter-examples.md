# Recording and chapter proposal examples

Status: Examples for the chapter behavior accepted in [ADR-0029](../../ADR/0029-recording-manifests-and-chapters.md) on 2026-11-13. These examples do not publish or freeze the manifest API; unresolved validation/readiness details remain specification work.

## A chapter survives file reordering

Initial recording:

| Order | File identity | Content version | Duration | Recording start |
| --- | --- | --- | --- | --- |
| 1 | file-a | a-v1 | 60,000 ms | 0 ms |
| 2 | file-b | b-v1 | 90,000 ms | 60,000 ms |
| 3 | file-c | c-v1 | 30,000 ms | 150,000 ms |

A chapter begins at `file-b / b-v1 / 30,000 ms`. Its player-facing recording start is 90,000 ms. The total recording duration is 180,000 ms.

After moving file-b ahead of file-a, the chapter remains at the same file/content/offset, but its derived recording start becomes 30,000 ms. The recording layout revision changes. A saved progress update prepared against the old layout still requires revision/version handling under ADR-0019; this is not permission to reinterpret it blindly.

Renaming file-b changes its path/display name, not its identity or content version. Replacing its audio bytes requires a new content version and explicit handling of the old anchor; equal duration alone is not proof that positions remain equivalent.

## Chapters can span files

With the original order, one chapter starts at file-a + 50,000 ms and the next at file-b + 30,000 ms. Their whole-recording starts are 50,000 and 90,000 ms, so the first chapter spans 40,000 ms across the file boundary. Starting a new file need not create a new authored chapter.

This example does not settle whether an explicit end overrides the next start, how intro gaps are displayed, or how duplicate/out-of-range source entries are resolved. Those validation details must be specified before implementation.

## Chapter source conflict

Embedded metadata labels a point as Chapter 3 at 1,200,000 ms; an associated CUE labels a point as Chapter 3 at 1,225,000 ms. The accepted default prefers a valid associated CUE after protected explicit edits, then embedded chapters. Keep source evidence distinct rather than combining competing starts into invented extra chapters.

## Chapterless multi-file recording

For a recording with no chapter definitions, the accepted fallback creates navigation markers at 0, 60,000, and 150,000 ms for the three files. Markers are generated, not presented as extracted author-provided chapters. A single-file chapterless recording remains valid and need not show a one-item chapter list.

## Unknown duration

If file-b's duration cannot be determined, expose its timing as unknown rather than zero. The total and file-c's recording start cannot be claimed accurate. Preserve known file identities, versions, source chapters and file-relative anchors; report unavailable timeline-dependent capabilities. Exact playback readiness and UI behavior remain specification work, not a behavior selected by these examples.
