## Context

Litara is a Turborepo monorepo with `apps/api` (NestJS) and `apps/web` (React/Vite). The project uses GitHub Actions for CI (PR checks, semantic release, Docker builds). There is currently no documentation site or `apps/docs` workspace.

## Goals / Non-Goals

**Goals:**

- Ship a working Docusaurus v3 docs site as a Turborepo workspace at `apps/docs/`
- Integrate into Turborepo so `npm run build` builds docs alongside other apps
- CI build check on PRs that touch `apps/docs/**`
- Automatic deploy to GitHub Pages on merge to `main` when docs change
- Minimal boilerplate — only the structure needed for a real docs site, not Docusaurus demo content

**Non-Goals:**

- PR preview deployments (Option A — build check only on PRs, deploy on merge)
- Versioned docs (no need for v1/v2 separation yet)
- Algolia search (local search is sufficient for now)
- Sharing React components between `apps/web` and `apps/docs`

## Decisions

### D1: Docusaurus v3 over VitePress / Astro Starlight

Docusaurus uses React and MDX, matching the project's existing frontend stack. It has the most mature GitHub Pages story (`docusaurus deploy` command, well-documented Actions recipes), and supports versioning and search for future growth. VitePress would introduce Vue; Astro Starlight would add a third framework.

### D2: `apps/docs/` as workspace location

Follows the existing `apps/*` workspace glob — no `package.json` changes needed. Consistent with the monorepo structure and signals that docs are a first-class app, not a side artifact.

### D3: Separate `docs.yml` workflow, not merged into `pr-checks.yml`

Keeps concerns separated. The docs workflow has different triggers (path filter on `apps/docs/**`), different permissions (`pages: write`, `id-token: write`), and a different deployment target. Merging into `pr-checks.yml` would complicate that file unnecessarily.

### D4: Path-filtered triggers

Both PR and push-to-main triggers include `paths: ['apps/docs/**']`. This avoids building/deploying docs on every unrelated change, keeping CI fast.

### D5: Deploy via `actions/deploy-pages` (official GitHub Pages action)

Uses the official GitHub Pages Actions (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`) rather than `peaceiris/actions-gh-pages`. The official approach uses GitHub's native Pages deployment API, requires no branch management, and is the current recommended path.

### D6: Turbo task configuration

Add a `docs#build` output to `turbo.json` with `outputs: ["build/**"]`. This allows Turbo to cache the docs build like any other app. The `dev` task for docs runs `docusaurus start`.

## Risks / Trade-offs

- **GitHub Pages must be configured**: The repo must have Pages enabled and set to "GitHub Actions" source in Settings. This is a one-time manual step. → Mitigation: document in the deployment section of the new docs site itself, and note in the PR.
- **`apps/docs/` adds ~200MB `node_modules`**: Docusaurus pulls in a significant dependency tree. → Acceptable for a dev tool; doesn't affect production Docker image.
- **Turbo remote cache won't help much for docs**: Doc content changes frequently. → Low impact; local cache still works.

## Migration Plan

1. Scaffold `apps/docs/` with Docusaurus v3 (npx create-docusaurus or manual setup)
2. Strip demo content, set up real site title/URL for `litara-app.github.io/litara` (or custom domain if applicable)
3. Add `docs` script entries and wire into `turbo.json`
4. Add `docs.yml` GitHub Actions workflow
5. Enable GitHub Pages in repo settings (manual, documented in PR)
6. Merge — first deploy happens automatically

## Open Questions

- **Custom domain?** If `litara-app` org has a custom domain, the `url` in `docusaurus.config.ts` and `baseUrl` need adjusting. Default: `https://litara-app.github.io` with `baseUrl: /litara/`.
- **Initial content scope**: What pages ship in the first version? Minimum viable: Installation, Configuration (env vars), Quick Start. Out of scope for this change: API reference generation from Swagger.
