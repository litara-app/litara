# ADR-0111: Choose where Android keeps Litara downloads

Status: Proposed
Date: 2026-11-26
Decision owner: Repository owner

## Context

On 2026-11-26 the owner asked for the Android features missing for Litara users, including a download location and "Wi-Fi only". "Wi-Fi only" is a device setting and needs no record. The download location changes who can read downloaded books, so it needs a choice.

Observed in the code on 2026-11-26:

- Litara downloads, cached books and unsent changes are stored in the app's private internal storage (`filesDir/litara-offline/<account hash>/`). Other apps cannot read them. Signing out locks them, and another account is never shown them ([ADR-0032](0032-offline-access-and-account-logout.md)).
- The imported BookOrbit part of the app lets a person pick any folder through Android's folder picker (`DownloadLocationStore`). Books written there are ordinary files in that folder. That setting does not apply to Litara downloads.
- ADR-0032 states that its lock controls access through the application. It does not protect against someone extracting files outside the app. It also requires that switching accounts never exposes another account's content.

## Decision

Proposal, not approval: offer **phone storage** (the default, as today) or **a removable card**, in both cases in the app's own folder for that storage.

- Only files for downloads move to the chosen storage. Account separation, locks, unsent progress and sign-in data stay as they are today.
- The choice is offered only when the device has a card with an app folder.
- Changing it affects new downloads. Existing downloads stay where they are and keep working. Nothing is moved or deleted automatically.
- If the card is missing, its downloads are shown as unavailable and are not removed from the list. New downloads go to phone storage and the app says so.

## Alternatives

- **Any folder the person picks**, as in the BookOrbit part of the app. Books could be used by other apps and would survive uninstalling Litara. Any app or person with access to the folder could read them, including after sign-out, a library access removal or an account switch. This conflicts with ADR-0032's rule that another account is never shown the content, so accepting it would need ADR-0032 amended.
- **Phone storage only.** No new work and the least exposure, but no way to use a card for large audiobooks.
- **Phone storage or a card in the app's own folder** (proposed). Gives more room while keeping the folder tied to the app.

## Consequences

With the proposal, uninstalling Litara deletes the downloads on both storages. A card is less private than internal storage: a card moved to a computer can be read there, and Android 10 and older let other apps with storage permission read app folders on shared storage and cards. The settings screen would need to say this. Devices without a card slot, which includes many current phones, would see no choice.

## Verification

Planned, after acceptance: downloads and resumed downloads on each storage; sign-out and account switching hide both; a removed library locks its content on both; a missing card keeps records and falls back for new downloads; changing the setting leaves existing downloads playable; an emulator with a virtual card. A physical card has not been tested.

## Open questions

- Phone storage or card, any folder, or phone storage only.
- Whether a later action should move existing downloads between storages.
