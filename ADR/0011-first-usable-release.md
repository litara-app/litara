# ADR-0011: Define the first usable release around reading and listening

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Current Litara includes podcasts; BookOrbit's wider ecosystem adds advanced device and external-service sync, achievements, and other features. Attempting the entire ecosystem at once would obscure the initial release boundary.

## Decision

The user selected ebooks and audiobooks, Android with Chromecast/Android Auto, metadata, shelves, annotations, OPDS, email, and basic KOReader sync for the first usable release. Library ingestion, accounts, and browsing are necessary supporting capabilities. Defer podcasts and advanced sync.

## Alternatives

- All current Litara features including podcasts.
- Reading/listening and Android media with most integrations deferred.
- The selected core scope.

## Consequences

Kobo sync, full cross-device annotation conversion, external reading-service sync, achievements, and advanced read-along are not first-release requirements. This does not remove architectural support for later expansion. Ordinary cross-client saves for the same supported file remain part of usable reading state; advanced conversion is separate.

## Verification

Before calling the release usable, exercise ingest, metadata editing, shelf organization, ebook reading/annotations, audio playback/resume, Android offline/media flows, OPDS acquisition, email delivery, and basic KOReader progress. Hardware verification is required by ADR-0005. These are planned checks, not completed tests.

## Open questions

ADR-0025 now defines the broad first-release format target and incomplete capability states. Exact codec/capability verification, metadata-provider set, offline guarantees, and the basic KOReader contract remain to be specified.
