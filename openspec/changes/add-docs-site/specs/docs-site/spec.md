## ADDED Requirements

### Requirement: Docs site exists as a Turborepo workspace

The system SHALL include a Docusaurus v3 documentation site at `apps/docs/` as a fully integrated Turborepo workspace with its own `package.json` and build output.

#### Scenario: Docs build via Turborepo

- **WHEN** `npm run build` is executed from the repo root
- **THEN** the docs site builds successfully alongside `apps/api` and `apps/web`

#### Scenario: Docs dev server starts

- **WHEN** `npm run dev` is executed from the repo root
- **THEN** the Docusaurus dev server starts and serves the docs site locally

### Requirement: Docs site is deployed to GitHub Pages

The system SHALL automatically deploy the built docs site to GitHub Pages when changes to `apps/docs/**` are merged to `main`.

#### Scenario: Deploy on merge to main

- **WHEN** a commit touching `apps/docs/**` is pushed to `main`
- **THEN** the GitHub Actions docs workflow builds the site and deploys it to GitHub Pages

#### Scenario: No deploy for unrelated changes

- **WHEN** a commit to `main` does NOT touch any file under `apps/docs/`
- **THEN** the docs deploy workflow does NOT run

### Requirement: Docs site includes minimum viable content

The docs site SHALL ship with at minimum: an Introduction page, an Installation/Quick Start guide, and a Configuration reference covering all environment variables.

#### Scenario: Environment variable reference is complete

- **WHEN** a user views the Configuration page
- **THEN** all environment variables documented in `CLAUDE.md` (DATABASE_URL, JWT_SECRET, EBOOK_LIBRARY_PATH, PORT, METADATA_ENRICH_ON_SCAN, GOOGLE_BOOKS_API_KEY) are listed with descriptions

#### Scenario: Installation guide covers Docker Compose path

- **WHEN** a user views the Installation page
- **THEN** the guide includes instructions for the Docker Compose setup path
