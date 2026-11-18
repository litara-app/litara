# M4 KOReader + OPDS app session: runbook (prepared 2026-11-18; not yet run with the app)

**Status: prepared and self-tested only.** `python scripts/t007/koreader_session.py --ip <host-ip> --self-test` passed from this machine over real TLS with the generated CA (OPDS 1.x root 200 with `kind=navigation`, no credentials 401, KOReader `/1/users/auth` 200, the default trust store refuses the throwaway CA). No KOReader or OPDS app has been used yet; `koreader-app` stays pending.

## Setup (synthetic and disposable)
`python scripts/t007/koreader_session.py --ip <IP of this PC as seen by the KOReader machine> --minutes 90` starts the disposable server bound to 127.0.0.1 only, a throwaway-CA TLS proxy on 0.0.0.0:18443 (certificate names: that IP, 127.0.0.1, `litara.test`), enables OPDS and KOReader integrations, creates one synthetic OPDS credential and one synthetic KOReader credential, and writes the tester steps with those credentials to `.tmp/t007/koreader-session.md` (git-ignored). The generated CA is `.tmp/t007/tls/ca.pem`. Every 15 s it records, without secrets, per-edition KOReader positions/revisions, retained conflicts and the web position to `session-timeline.json` when it ends (`.tmp/t007/koreader-done` ends it early). A temporary Windows Firewall rule (TCP 18443, Private, LAN only) is needed only if KOReader runs on another machine; it is removed at the end.

## Steps for the tester (desktop KOReader)
1. Trust the throwaway CA for KOReader: append `.tmp/t007/tls/ca.pem` to the CA bundle KOReader uses (the desktop build's bundled CA file, or the system store on Linux; tell Claude which file/store you used and the KOReader version/OS).
2. OPDS: Search > OPDS catalog > add `https://<IP>:18443/opds/v1` with the OPDS username/password from `koreader-session.md`. Browse, search for a title, open a book entry, **download an EPUB and the CBZ**, open them. (Also try the OPDS 2 URL if your build supports it: `.../opds/v2`.)
3. Progress sync: Tools > Progress sync > Custom sync server `https://<IP>:18443`, Login (not Register) with the KOReader username/password. Open the downloaded EPUB, turn pages, push progress ("Push progress from this device now"), then close and reopen the book and pull progress.
4. A second "device": change KOReader's device name (Settings > Device > or in the sync dialog) or use a second KOReader profile/instance, push a different position from it. The expected server behavior (from the contract): the first device's position becomes canonical; a second device that never pulled a baseline is refused with 2007 and its position is retained as a candidate; the owner resolves it on the web or API ("keep server" / "use candidate"). KOReader itself shows only a generic failure for the refusal: please note exactly what it displays.
5. Tell Claude when each step is done and report any error text. Do not use real accounts, books or networks beyond this setup.

## What gets compared
Server-side timeline (positions, revisions, conflicts; the web position must stay unchanged), the app's visible behavior and error messages, whether downloads open, and whether KOReader accepts the TLS chain with the CA added.

## Not covered by this session
Large-file digest agreement with upstream KOReader (separate vector comparison), Kobo/Kindle/Android KOReader builds, other OPDS apps, a publicly trusted certificate.
