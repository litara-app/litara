# Contributing to Litara

## Development setup

For a full walkthrough, see the [Local Development guide](https://litara-app.github.io/litara/development/local-setup) in the docs.

**Quick start:**

```bash
git clone https://github.com/litara-app/litara.git
cd litara
npm install
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

| Service            | URL                        |
| ------------------ | -------------------------- |
| Web UI             | http://localhost:5173      |
| API                | http://localhost:3000      |
| API docs (Swagger) | http://localhost:3000/docs |

For project structure and package details, see the [Packages & Apps](https://litara-app.github.io/litara/development/packages) page.

---

## Proposing large changes

For significant features or changes that touch multiple parts of the codebase, please spec out the change using [OpenSpec](https://openspec.dev) before opening a PR. This helps reviewers understand the intent and trade-offs before diving into code.

OpenSpec artifacts live in the `openspec/` directory and should be committed alongside the implementation. A typical change produces three files:

```
openspec/changes/<change-name>/
  proposal.md   # what & why
  design.md     # how
  tasks.md      # implementation checklist
```

**Using Claude Code?** The OpenSpec skills are included in `.claude/skills/` and will be available automatically. Use `/opsx:propose` to create a fully scaffolded change proposal in one step.

---

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). A `commit-msg` hook enforces the format on every commit.

| Prefix                                            | Effect                       |
| ------------------------------------------------- | ---------------------------- |
| `feat:`                                           | Minor version bump + release |
| `fix:`                                            | Patch version bump + release |
| `BREAKING CHANGE`                                 | Major version bump + release |
| `chore:`, `docs:`, `style:`, `refactor:`, `test:` | No release                   |

---

## Pull request checklist

These are the checks CI runs on every PR — they must all pass before merging:

- [ ] `npm run lint` passes (ESLint across all workspaces)
- [ ] Commit messages follow the conventional commits format (enforced by commitlint)

Additional things to verify manually:

- [ ] Migrations are included if `apps/api/prisma/schema.prisma` changed
- [ ] New API endpoints have a corresponding e2e test in `apps/api/test/`

**Using Claude Code?** Run `/feature-wrap` before opening a PR. It checks Swagger decorators, TypeScript compilation, Mantine v8 API usage, CSP compliance, and documentation — catching common issues before review.
