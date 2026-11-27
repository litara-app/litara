# ADR-0111: Keep Android Litara downloads in phone storage

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner

## Context

On 2026-11-26 the owner asked for the Android features missing for Litara users, including a download location and "Wi-Fi only". "Wi-Fi only" is a device setting and needs no record. The download location changes who can read downloaded books, so it needs a choice.

Observed in the code on 2026-11-26:

- Litara downloads, cached books and unsent changes are stored in the app's private internal storage (`filesDir/litara-offline/<account hash>/`). Other apps cannot read them. Signing out locks them, and another account is never shown them ([ADR-0032](0032-offline-access-and-account-logout.md)).
- The imported BookOrbit part of the app lets a person pick any folder through Android's folder picker (`DownloadLocationStore`). Books written there are ordinary files in that folder. That setting does not apply to Litara downloads.
- ADR-0032 states that its lock controls access through the application. It does not protect against someone extracting files outside the app. It also requires that switching accounts never exposes another account's content.

## Decision

On 2026-11-26 the repository owner chose **phone storage only**.

- Litara downloads stay in the app's private internal storage, as before this record.
- The Litara app offers no download location setting: no removable card and no folder picker.
- This record covers Litara downloads only. It does not change or remove the folder picker in the imported BookOrbit part of the app.

## Alternatives

- **Phone storage or a removable card, in the app's own folder** (recommended in the proposal, not chosen). It gives more room for large audiobooks. A card is less private: it can be read on a computer, and Android 10 and older let other apps with storage permission read app folders on shared storage and cards. It also needs handling for a missing card.
- **Any folder the person picks** (not chosen). Books could be used by other apps and would survive uninstalling Litara. They could be read outside the app after sign-out, a library access removal or an account switch, which would need [ADR-0032](0032-offline-access-and-account-logout.md) amended.

## Consequences

No new application code. Other apps cannot read Litara downloads through normal Android storage access, and ADR-0032's locking stays as it is. Downloads are limited by the phone's internal storage, including on devices that have a card slot, and uninstalling Litara deletes them. This closes the download location part of the 2026-11-26 request for missing Litara features without adding a setting. Offering another location later needs a new record that supersedes this one.

## Verification

Observed in the code on 2026-11-26: Litara downloads are written under `filesDir/litara-offline/<account hash>/`, and the Litara settings screen shows no download location setting. The `Wi-Fi only` emulator test opens that screen; no test asserts that a location setting is absent.

## Open questions

None within this record's scope.
