# M4 KOReader + OPDS app session (2026-11-18): runbook and results

**Status: run with the real KOReader app on a physical phone (see "Results"); the preparation note follows.** `python scripts/t007/koreader_session.py --ip <host-ip> --self-test` passed from this machine over real TLS with the generated CA (OPDS 1.x root 200 with `kind=navigation`, no credentials 401, KOReader `/1/users/auth` 200, the default trust store refuses the throwaway CA).

## Setup (synthetic and disposable)
`python scripts/t007/koreader_session.py --ip <IP of this PC as seen by the KOReader machine> --minutes 90` starts the disposable server bound to 127.0.0.1 only, a throwaway-CA TLS proxy on 0.0.0.0:18443 (certificate names: that IP, 127.0.0.1, `litara.test`), enables OPDS and KOReader integrations, creates one synthetic OPDS credential and one synthetic KOReader credential, and writes the tester steps with those credentials to `.tmp/t007/koreader-session.md` (git-ignored). The generated CA is `.tmp/t007/tls/ca.pem`. Every 15 s it records, without secrets, per-edition KOReader positions/revisions, retained conflicts and the web position to `session-timeline.json` when it ends (`.tmp/t007/koreader-done` ends it early). A temporary Windows Firewall rule (TCP 18443, Private, LAN only) is needed only if KOReader runs on another machine; it is removed at the end.

## Steps for the tester (desktop KOReader)
1. Trust the throwaway CA for KOReader: append `.tmp/t007/tls/ca.pem` to the CA bundle KOReader uses (the desktop build's bundled CA file, or the system store on Linux; tell Claude which file/store you used and the KOReader version/OS).
2. OPDS: Search > OPDS catalog > add `https://<IP>:18443/opds/v1` with the OPDS username/password from `koreader-session.md`. Browse, search for a title, open a book entry, **download an EPUB and the CBZ**, open them. (Also try the OPDS 2 URL if your build supports it: `.../opds/v2`.)
3. Progress sync: Tools > Progress sync > Custom sync server `https://<IP>:18443/1`, Login (not Register) with the KOReader username/password. Open the downloaded EPUB, turn pages, push progress ("Push progress from this device now"), then close and reopen the book and pull progress.
4. A second "device": change KOReader's device name (Settings > Device > or in the sync dialog) or use a second KOReader profile/instance, push a different position from it. The expected server behavior (from the contract): the first device's position becomes canonical; a second device that never pulled a baseline is refused with 2007 and its position is retained as a candidate; the owner resolves it on the web or API ("keep server" / "use candidate"). KOReader itself shows only a generic failure for the refusal: please note exactly what it displays.
5. Tell Claude when each step is done and report any error text. Do not use real accounts, books or networks beyond this setup.

## What gets compared
Server-side timeline (positions, revisions, conflicts; the web position must stay unchanged), the app's visible behavior and error messages, whether downloads open, and whether KOReader accepts the TLS chain with the CA added.

## Not covered by this session
Large-file digest agreement with upstream KOReader (separate vector comparison), Kobo/Kindle/Android KOReader builds, other OPDS apps, a publicly trusted certificate.

## Results (user-assisted, 2026-11-18)
**Device:** Google Pixel 9 Pro, Android 17, KOReader v2026.07.1 (F-Droid build, `org.koreader.launcher.fdroid`), on the same Wi-Fi as the host, driven by the user; wireless debugging (adb) was used only to push the public CA file, open the security settings screen, read KOReader's log, and, with the user's approval, type the synthetic credentials into KOReader fields. **Server:** the disposable stack behind the throwaway-CA TLS proxy (`https://<host-ip>:18443`), server bound to 127.0.0.1, a temporary Windows Firewall rule for TCP 18443.

| Check | Result |
| --- | --- |
| Throwaway CA installed in the Android user store | KOReader accepted the TLS chain (no handshake error was logged) |
| OPDS 1.x catalog added with HTTPS and Basic credentials | Catalog browsed; the server logged `/opds/v1` (navigation), `/opds/v1/publications` (acquisition) and `/opds/v1/search.xml` with 200; the user reported downloading and opening an EPUB (the CBZ download was not separately confirmed); `HEAD` requests are sent by KOReader before `GET` |
| Wrong credentials (typed with a dropped hyphen) | KOReader showed "authentication required" (the server's 401 challenge) |
| Progress sync with the bare origin as the custom server | **`GET /users/auth` -> 404** (KOReader requests unprefixed paths), shown by KOReader as the generic "Unknown server error" (finding F9) |
| Progress sync with `https://<host>:18443/1` | `GET /1/users/auth` -> 200, "Logged in to KOReader server" |
| First pushes from a device that never pulled | `PUT /1/syncs/progress` -> 409 (code 2007, "Progress was retained for review in Litara"); KOReader shows only "Something went wrong with the sync process"; 4 candidates retained, canonical position untouched |
| Pull on an empty server position | "No progress found for this document" (this establishes the baseline) |
| Push while candidates were unresolved, and a replay of an already refused payload | 409 again (`unresolved_candidate`; the receipt fence replays refused payloads) |
| Owner resolution through the API (`use_candidate` for one, `keep_server` for the others; the web UI was not part of this session) | all 4 resolved; the next push from a new position was accepted (200, source revisions 2 and 3) |
| Reopen the book on the same device | no prompt (the stored position is from the same device name; KOReader prompts only for another device) |
| A second device name pushing 50% under the same credential (script) | KOReader showed a prompt, the user accepted, and the book moved to about 50% |
| Web position | unchanged: no web position was ever created (KOReader state is a separate source) |

Request log of the session (header names only, no secrets): `server-observed-requests.txt`; session state timeline: `session-timeline.json` (note: the monitor's own API token expired during the session, so many timeline entries are 401 errors from the monitor, not from KOReader).

## Findings
* **F9:** a stock KOReader pointed at the bare origin fails with "Unknown server error" because the server serves the KOReader wire only under `/1`. The setting must be `https://<host>/1`; the credential setup UI, operator setup and T006 contract now document it.
* A refused push shows KOReader only "Something went wrong"; the reason (retained for review in Litara, unresolved candidate) is not visible there. The server's message text reaches KOReader but is not displayed.
* `adb shell input text` dropped a `-` in the username (a harness artifact, not a product defect) and typing credentials into a phone is error-prone; the 32+ character minimum password makes manual entry impractical for users, who must copy/paste.
* The synthetic KOReader credential was first typed into the wrong menu path once; no credential was sent to any other service (the 404 on `/users/auth` came from our server).

## Not covered
Other KOReader builds (e-reader devices, desktop), the Kobo/Kindle OPDS clients, OPDS 2.0 in KOReader, the CBZ download and open, a publicly trusted certificate, the web resolution UI, KOReader's behavior while the screen is off or offline. One phone, one KOReader build.

## Cleanup
adb disconnected; the session, proxy, logging forwarder and disposable database are stopped. Remaining user actions: remove the firewall rule (`Remove-NetFirewallRule -DisplayName "Litara T007 test"` in an administrator PowerShell), remove the "T007 rehearsal CA" from the phone (Settings > Security & privacy > More security & privacy > Encryption & credentials > Trusted credentials > User), switch Wireless debugging off and revoke the PC's authorization, and delete `litara-t007-ca.crt` from the phone's Downloads.
