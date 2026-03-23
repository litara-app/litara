## 1. Scaffold Docusaurus App

- [x] 1.1 Create `apps/docs/` directory and run `npx create-docusaurus@latest . classic --typescript` inside it (or manually scaffold)
- [x] 1.2 Update `docusaurus.config.ts`: set `title`, `url` to `https://litara-app.github.io`, `baseUrl` to `/litara/`, `organizationName` to `litara-app`, `projectName` to `litara`
- [x] 1.3 Remove all Docusaurus demo/tutorial content from `docs/` and `src/pages/`
- [x] 1.4 Verify `apps/docs/package.json` has the correct `name` (e.g. `@litara/docs`) and build/start/serve scripts

## 2. Turborepo Integration

- [x] 2.1 Add `docs#build` and `docs#dev` pipeline entries to `turbo.json` with appropriate `outputs: ["build/**"]`
- [x] 2.2 Run `npm install` from repo root to register the new workspace
- [x] 2.3 Verify `npm run build` from repo root builds the docs without errors

## 3. Minimum Viable Content

- [x] 3.1 Create `docs/intro.md` — Introduction/overview of Litara
- [x] 3.2 Create `docs/installation.md` — Installation guide covering Docker Compose setup path
- [x] 3.3 Create `docs/configuration.md` — Configuration reference listing all environment variables (DATABASE_URL, JWT_SECRET, EBOOK_LIBRARY_PATH, PORT, METADATA_ENRICH_ON_SCAN, GOOGLE_BOOKS_API_KEY) with descriptions
- [x] 3.4 Update `docusaurus.config.ts` sidebar/navbar to link the above pages correctly

## 4. GitHub Actions Workflow

- [x] 4.1 Create `.github/workflows/docs.yml` with two jobs: `build` (runs on PRs touching `apps/docs/**`) and `deploy` (runs on push to `main` touching `apps/docs/**`, depends on `build`)
- [x] 4.2 `build` job: checkout, setup Node 20, `npm ci`, `npm run build --workspace=apps/docs`, upload pages artifact via `actions/upload-pages-artifact`
- [x] 4.3 `deploy` job: permissions `pages: write` + `id-token: write`, uses `actions/deploy-pages`, only runs on push to `main`
- [x] 4.4 Add `concurrency` group to the workflow to prevent overlapping deployments
- [x] 4.5 Verify path filters: both `on.pull_request.paths` and `on.push.paths` include `apps/docs/**`

## 5. Verification

- [x] 5.1 Run `npm run build --workspace=apps/docs` locally and confirm clean output in `apps/docs/build/`
- [ ] 5.2 Enable GitHub Pages in repo Settings → Pages → Source: "GitHub Actions" (manual step — document in PR description)
- [ ] 5.3 Open a test PR touching a doc file and confirm the docs build check appears and passes
- [ ] 5.4 Merge and confirm the deploy job runs and the site is live at `https://litara-app.github.io/litara/`
