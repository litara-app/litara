# M1 slice 2: manual finish/unfinish and personal-conflict resolution (native Android, real server)

Observed 2026-11-17 on `emulator-5554` (Pixel_9_Pro, Android 17) with the `full` debug APK against the disposable stack from
`scripts/t007/stack.py` (merged T001–T006 + this branch). A second device was simulated with `scripts/t007/second_client.py`
(synthetic reader account, bearer API). Server state lines are copied from that script's output. No physical device.

Governing contracts: T005 `PUT /editions/{id}/completion`, `GET /personal-conflicts`, `POST /personal-conflicts/{id}/resolve`
(ADR-0065/0066). Completion carries file id + content version and no locator, so it does not depend on the unresolved
native/web locator compatibility question (handoff F1).

| Step | Evidence | Observation |
| --- | --- | --- |
| 1. Finish from the phone | `01-finished-on-phone.png`, `01-server-state.txt` | "Synthetic Tale" revision 0 → 1, finished=True on the server. |
| 2. Stale write by the phone | `02-stale-write-conflict-saved.png`, `02-server-state.txt` | Second device finished then unfinished "Second Tale" (revision 2). The phone, still holding revision 0, tapped "Mark finished". Server kept it as a durable `completion stale_revision base=0 current=2` conflict; nothing was overwritten; the phone refreshed to the server's unfinished state and showed the decision banner. |
| 3. Decision | `03-decision-dialog.png` | Dialog offers "Keep server's" and "Use mine" with a plain explanation. |
| 4. Use mine | `04-after-use-mine.png`, `04-server-state.txt` | Resolve with the conflict's current revision and the edition's file version: "Second Tale" revision 3 finished=True; 0 unresolved conflicts. |
| 5. Offline + process death | `05a-offline-before.png`, `05b-offline-queued.png`, `05b-pending-file-on-device.json` | Airplane mode on (ping to the host: "Network is unreachable"). "Mark finished" saved a pending write on the device with operation id, base revision 2, file id and content version; the server stayed at revision 2 unfinished. |
| 6. Restart online | `06-after-restart-online.png`, `06-server-state.txt` | After `am force-stop`, airplane mode off and relaunch, the Books refresh delivered the saved write: "Synthetic Tale" revision 2 → 3 finished=True (delivered once), the saved file is gone, 0 conflicts. |

A first offline attempt (Wi-Fi off only) did not isolate the emulator (mobile data stayed up) and its write was delivered
immediately; it was discarded as evidence and redone with airplane mode. One tap during step 5 missed its button because the layout
had shifted and was repeated; neither changed server state in a way that affects the table.

## Limits of this evidence

- Single synthetic account, two EPUB editions, one emulator (Android 17, x86_64); the "second device" is an API script, not a second app.
- "Keep server's" was not exercised on the device (covered by the unit test of the request shape only).
- Position conflicts (`resourceKind: position`) have the same dialog but were not produced: native position sync is off (F1).
- Annotation, shelf, membership and shelf-order conflicts are listed with "decided in the web app" and not resolved natively.
- The ebook title history (`GET /titles/{id}/reading-history`) was not read by the app.
- Lost-response replay after a transport failure *during* a request was shown by unit tests, not on the device.
