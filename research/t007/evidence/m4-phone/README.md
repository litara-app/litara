# M4 physical phone: Litara Android app (2026-11-18, user-assisted)

**Device and setup:** Google Pixel 9 Pro (Android 17), same Wi-Fi as the host. The debug app `com.litara.debug` (built from this branch, with the F7 sign-in fix) was installed with `adb install` over wireless debugging, with the user's approval; screenshots and logs were limited to the Litara app. The disposable server ran behind the throwaway-CA TLS proxy (`python scripts/t007/koreader_session.py --ip <host-ip> --san <other-ip> --phone`), with a synthetic `phonereader` account (hex password), three 2-minute audio fixtures (MP3, FLAC, a three-chapter M4B) and the usual EPUB/PDF/CBZ. The test CA was installed in the Android user store and the app's per-host user-CA consent was used.

## Results
| Check | Result |
| --- | --- |
| Sign in over TLS with user-CA consent | worked; server session "Android Pixel 9 Pro" created |
| Library lists the three recordings | worked |
| MP3: play, lock the screen, lock-screen/notification media controls, pause | worked as expected (user report); media session PAUSED at 52.1 s with 120 s buffered; the server held 51.8 s (revision 12) |
| Force-stop then resume | resumed at 52 s exactly (user report) |
| FLAC and the chaptered M4B (Part 1 to 3) | played, scrubbed and chapter-jumped fine; a small click when scrubbing is expected for a pure sine tone; server positions 31.0 s (FLAC) and 82.4 s (chaptered, inside Part 3) |
| Books: EPUB (5 pages), PDF (page 3), CBZ (page 4), force-close, reopen | each returned to the same place (user report); the server held `foliate-cfi`, `pdf-page` index 2 and `comic-page` index 3 from the phone |
| Wi-Fi drop / address change (phone moved from .87 to .89 during the session) | the app showed offline for a while and recovered; positions made afterwards reached the server |
| Offline playback of a downloaded recording, then reconnect | see F10: the offline writes were refused and retained as conflicts, the app jumped back to the server position |

## Findings
* **F10 (Android, needs a fix):** after the app was force-closed and reopened while offline, its position writes carried `baseRevision` 0 (it had lost the server revision). After reconnecting, the server (revision 21) correctly refused them as `stale_revision` and retained them as two conflicts (35.6 s captured 00:21, 87.2 s captured 00:27); the user's real position (1:46) was never sent, and the app jumped back to the server's 35 s. The app should re-read the server position and revision on reconnect before sending queued writes, or persist the revision across cold starts.
* **F11 (UX):** the conflict prompt ("Which position? The server has file 1 at 35 s. Another write was kept: Android Pixel 9 Pro: file 1 at 35 s") offered two positions that were identical in practice, and showed the useless candidate first; the 87 s candidate appeared only in a second prompt.
* **F12 (UX):** "Choose a position..." accepts seconds only (typing 1:46 is not possible; 90 was entered and 90.000 s was stored, revision 23, both conflicts resolved).
* **F13 (gap):** ebooks cannot be downloaded for offline reading in this app: only recordings have a Download action (Library > recording > Download); the Books tab has no download and shows an offline error without the server. Offline ebook reading is therefore untested and unsupported in the current slice.
* The typing harness: adb `input text` drops punctuation such as `-`; the phone account password was therefore hex-only.

## Not covered
Sign-out and re-sign-in on the phone and whether the downloaded copy survives it (the user stopped the session), Bluetooth or headset controls, Android Auto and Cast on this phone, rotation, battery/doze behavior over long playback, the Cast-free F-Droid flavor on hardware (the full flavor was used), a second account, comics or PDFs offline. One phone, one OS version, one app flavor.

## Cleanup
The session, proxy and disposable database are stopped and adb is disconnected. Remaining user actions: remove the firewall rule (`Remove-NetFirewallRule -DisplayName "Litara T007 test"`, administrator PowerShell), remove the "T007 rehearsal CA" and `litara-t007-ca.crt` from the phone, switch Wireless debugging off and revoke the PC authorization, and uninstall `com.litara.debug` from the phone if it is no longer wanted.

## F10 fix (2026-11-19)
**Cause:** `ProgressSync` kept the newest server revision only in memory and started every new instance at `"0"`. After a force-close, a reporter that was reopened offline could not learn the revision, queued its writes against base 0, and after reconnecting the server (revision 21) refused them as `stale_revision`, so the offline progress went to conflicts and the UI showed the server position.

**Fix:** `ProgressSync` now persists the last server revision it has seen (`position-revision.txt`, atomically, next to the pending write; the offline-copy cleanup keeps it) and starts from it. A write queued offline therefore carries the revision the device really knew: it is accepted if the server has not moved, and still becomes a revision-aware conflict if another device did move it.

**Evidence:**
* Unit tests in `ProgressSyncTest`: `a restarted reporter remembers the last server revision and does not write against base 0` and `a revision learned by reading the server also survives a restart` **failed before the fix** and pass after; `a reporter that never reached the server still starts at base 0` passes both ways. Whole Android suite, both flavors: 878 tests, 0 failed, 4 skipped (`research/t007/logs/android-after-f10-fix.log`).
* Emulator check `scripts/t007/android_offline_resume.sh` (download, play online, airplane mode, force-close, reopen offline from Downloads, seek, keep the player open across the reconnect): **PASS on the fixed build** (`f10-emulator-check-fixed-build.txt`: position 3 to 5, 18.1 s, no conflicts). **The same check also passed on the pre-fix build** (`f10-emulator-check-old-build.txt`), so the emulator scenario does **not** reproduce the phone failure; the unit tests are the failing-first proof, and the fix has not been confirmed on the phone yet. A retest on the phone (offline cold start, reconnect, no conflict prompt) is still needed.


## Android follow-up

F11 now shows materially different usable positions first, with the device, filename and time. F12 removes the custom position box. F13 adds persistent downloads from Books for supported reflowable ebooks and PDFs. Offline Books shows downloads for the signed-in server/account, and the reader opens the saved exact file version. Comics still use the separate server page flow. Phone confirmation and user-assisted tests are deferred.

The Full Debug conflict instrumentation passed on an API 36 Pixel Tablet emulator against a disposable PostgreSQL-backed server. It seeded a 12.250 s near-duplicate and a 3.000 s candidate alongside the 12.000 s saved position. The 3.000 s choice appeared first and was applied. The second prompt used the updated saved position, and the test resolved it and a separate completion conflict.

Android unit tests passed in Full and F-Droid Debug with 440 cases per flavor, two skips per flavor, and zero failures. The added edition progress test covers the downloaded base revision, offline queuing, reconnect, and exact-version revision recovery.

The Full Debug offline EPUB instrumentation passed on the same API 36 emulator. It downloaded an EPUB from Books, waited for requests to fail after disabling networking, refreshed into the offline Books list, opened the saved edition, verified its exact version and file length, and loaded Chapter 1 from its table of contents. PDF uses the same download path and was not exercised in this offline run.
