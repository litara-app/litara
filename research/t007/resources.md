# Resource and operator plan

User report, 2026-11-17: resources available in principle, Android uses emulators, Chromecast network debugging delayed until last. This report supplies no device model, network address, credentials or permission to change personal systems.

| Phase | Resource | Current evidence / worker next step |
| --- | --- | --- |
| Local | Disposable PostgreSQL, generated media, local mail sink, separate TLS app/reader origins | Worker creates unique owned resources; inventory ports/processes first; no existing user DB reset. |
| Local | Android emulator full/F-Droid | User-selected Android route. Create/use only an owned disposable AVD; record API/ABI/WebView/SDK/Gradle/JDK, no claims about physical media behavior. |
| Local | Chromium/Firefox/WebKit and source/lockfile tools | Install exact project dependencies in clean checkout; report unavailable browsers/codec profiles. |
| Assisted | SMB/NFS mounted test root | User indicates availability; coordinate exact dedicated test share/copies, protocol/options, safe disconnect/reconnect. No arbitrary mount changes or writes to originals. |
| Assisted | Full KOReader application and OPDS client | Coordinate app/device/version and TLS address; synthetic account/device credentials. Two app installations/credentials for handoff; client-code stand-ins remain distinct. |
| Assisted | Screen reader, keyboard/touch and realistic corpus | Coordinate operator/software/version and lawful read-only fixtures. App and reader both need manual checks. |
| External | Physical Android phone and real Auto head unit | Unconfirmed: user specified Android emulators. Keep separate Pending/Blocked release gates; don't substitute fake/virtual Auto acceptance. |
| Last | Actual Chromecast plus controller/proxy and network debugging | User can help; request only after concrete local artifact/runbook exists. Record device/controller/firmware/topology and perform with the user. |
| Separate | Legacy migration sources and decisions | T008 preparation/assignment required; no legacy data is needed to start T007. |
| Held | Release/signing/registry/CI | Not authorized. No signing keys, release upload or Actions activation needed for T007. |

When requesting help, supply the exact synthetic fixture, unsigned debug artifact/checksum or local command, expected steps and evidence to capture. Keep credentials and raw private logs out of Git. Do not repeatedly poll the user for delayed hardware while independent local work remains.
