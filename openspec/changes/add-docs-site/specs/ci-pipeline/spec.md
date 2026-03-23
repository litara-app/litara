## ADDED Requirements

### Requirement: Docs CI build check runs on PRs

The CI pipeline SHALL run a docs build check on any pull request that includes changes under `apps/docs/**`.

#### Scenario: Docs build check passes on valid PR

- **WHEN** a PR is opened or updated with changes under `apps/docs/`
- **THEN** the docs workflow runs `npm run build` for the docs workspace and the check passes if the build succeeds

#### Scenario: Docs build check fails on broken docs

- **WHEN** a PR introduces a broken Docusaurus configuration or invalid MDX
- **THEN** the docs workflow build step fails and the PR check is marked failed

#### Scenario: Docs build check skipped for unrelated PRs

- **WHEN** a PR contains no changes under `apps/docs/`
- **THEN** the docs workflow does NOT trigger

### Requirement: Docs deploy workflow has required permissions

The docs deploy workflow SHALL request only the minimum GitHub Actions permissions required: `contents: read`, `pages: write`, and `id-token: write`.

#### Scenario: Deploy job uses scoped permissions

- **WHEN** the docs deploy workflow runs on push to `main`
- **THEN** only the deploy job has elevated `pages: write` and `id-token: write` permissions; the build job uses default read-only permissions
