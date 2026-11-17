# M1 slice 4: private annotations (highlights, notes, bookmarks) on the native readers

Observed 2026-11-17 on `emulator-5554` (Pixel_9_Pro, Android 17), `full` debug APK, disposable stack from `scripts/t007/stack.py`,
synthetic books only. The "other device" is `scripts/t007/second_client.py` (API). No physical device. Governing contract: T005
annotations (`/editions/{id}/annotations`, ADR-0065); policy: `LocatorPolicy` (handoff F1).

## What is synced and what is not

- **Comic page bookmarks sync.** Their locator is the manifest's page identity and there is no text selection, so no renderer
  interpretation is involved (same reasoning as comic positions).
- **EPUB highlights, notes and bookmarks stay on the device.** A Foliate CFI/range is renderer-defined and not proven compatible with
  the web profile; they are stored for the exact file id and content version and are never sent. PDF has no annotation UI yet.
- Highlight colour and chapter title are device-only (the wire contract has no field for them).

| Step | Evidence | Observation |
| --- | --- | --- |
| 1. Highlight in an EPUB | `01-epub-selection-toolbar.png`, `02-epub-highlight-painted.png` | The preserved selection toolbar works on the Litara edition; the word "one" is highlighted green. |
| 2. Where it is stored | `04-device-annotation-store.json`, `04-server-annotations-epub.txt` | On the device: a `highlight` with `foliate-range` selection, quote "one", exact file id + content version, `synced: false`, no pending op. The server's annotation list for that edition is empty: nothing was sent. |
| 3. Survives process death | `05-epub-highlight-after-restart.png`, `05b-epub-highlights-list-after-restart.png` | After `am force-stop` the Highlights list shows "Chapter 2 — one" with the green marker. (The reader reopened further along at 19%, so the painted word was off screen; the list is the evidence.) |
| 4. Comic bookmark syncs | `06-comic-before-bookmark.png`, `07-comic-bookmarked.png`, `07-server-annotations-after-bookmark.txt` | Bookmarking page 5 created a server annotation: kind `bookmark`, page index 4, revision 1. |
| 5. Other device → phone | `08-second-device-bookmark.txt`, `09-phone-page2-bookmark-from-other-device.png` | The second device bookmarked page index 1 (client UUID, base revision 0); after a restart the phone shows a filled bookmark on page 2/5. |
| 6. Delete = tombstone | `10-bookmark-removed-on-phone.png`, `10-server-annotations-after-delete.txt` | Removing it on the phone sent a revision-checked delete: that annotation is now revision 2, `deleted=True` (a tombstone); the phone's own page-5 bookmark is unchanged. |
| 7. Offline create | `11-offline-bookmark.png`, `11-device-store-offline.json`, `11-server-before-relaunch.txt` | In airplane mode (ping: "Network is unreachable") the page-2 bookmark was saved on the device with `revision 0`, `synced false` and a pending operation id; the server did not have it. |
| 8. Delivered once | `12-server-after-relaunch.txt`, `12-device-store-after.json` | After force-stop, network restored and relaunch, the server shows it at revision 1 (once); the device record is `synced`, nothing pending. |

## Defect found and fixed during this run

After about an hour idle the Books screen showed `unauthenticated` although the account was fine. Cause: two screens loaded in
parallel; one refreshed (rotating both tokens) and the other sent the access token it had read before the rotation; the server no
longer knows that token and answers `unauthenticated`, not `token_expired`, so the client surfaced the error. `TokenRotationRaceTest`
reproduces it (failed before the fix, see `research/t007/logs/token-rotation-race-BEFORE-fix.xml`); `LitaraClient.execute` now retries
once with the current token when the token changed in flight. The fix was committed in `3eb9c56`, which also contains the annotation UI
wiring that was in the working tree at the time.

## Limits

- Highlights/notes were exercised on one EPUB with one colour; bookmark add/remove in the EPUB bookmark tab and note text editing were
  covered by unit tests only, not on the device.
- Annotation conflicts (stale revision on an annotation) are unit-tested; no real two-writer annotation conflict was produced, and
  the app only reports "decided in the web app" for them.
- Notes on comic pages are accepted and merged from the server but the comic UI shows only bookmarks.
- The local annotation id shown to the UI is a hash of the UUID (collision-possible, not guarded).
- Annotations of a superseded file version stay in their own file and are not shown; no UI lists them.
- No PDF annotation UI.
