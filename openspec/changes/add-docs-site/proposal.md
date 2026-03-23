## Why

Litara has no user-facing documentation. Users self-hosting the app have no reference for configuration, setup, environment variables, or features. A documentation website will lower the barrier to adoption and reduce support burden.

## What Changes

- Add `apps/docs/` — a Docusaurus v3 app within the existing Turborepo monorepo
- Add a GitHub Actions workflow to build the docs on PRs (CI check) and deploy to GitHub Pages on merge to `main`
- Add path-filtered triggers so the workflow only runs when files under `apps/docs/` change

## Capabilities

### New Capabilities

- `docs-site`: Docusaurus v3 documentation site at `apps/docs/`, integrated into the Turborepo build pipeline, deployed to GitHub Pages via GitHub Actions

### Modified Capabilities

- `ci-pipeline`: New workflow added for docs build and deploy; existing workflows are not modified

## Impact

- New workspace: `apps/docs/` added to `package.json` workspaces (covered by `apps/*` glob — no change needed)
- Turborepo: `turbo.json` updated to include `docs#build` task
- GitHub Actions: new `docs.yml` workflow file
- No changes to `apps/api`, `apps/web`, or any packages
- No database, API, or runtime changes
