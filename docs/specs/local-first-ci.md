# Local-first CI: GitHub as mirror and publisher

**Date:** `2026-10-22` · **Status:** Done. Phases 0 to 3 merged in PR oharms/PanWizard#57 (`75bdb74`), and branch protection was changed on `2026-10-22`. The first changes landed without a pull request were `0bb48b7` (H10 hard pair) and `45323c9` (H10 multi-phase pair). · **How to use it:** [docs/DEVELOPMENT.md, Local CI](../DEVELOPMENT.md#local-ci)

## Why

Every change used to reach `main` through a GitHub pull request. That meant a nine-job CI matrix, CodeQL, stacked pull requests that had to be rebased after each squash merge (#54 → #55 → #56), and waiting on GitHub runners. Nearly all of those gates can run on the maintainer's Windows machine, which has Docker, so the project now runs them there. GitHub stays the public mirror, runs the jobs that cannot run here, and publishes releases.

## Inventory and decisions

| GitHub dependency | Decision | Replacement |
|---|---|---|
| Test matrix (`ci.yml`, Windows, Ubuntu and macOS × Node 18, 20, 22) | Local, except macOS | `npm run ci:local`: the host suite under Node 18, 20 and 22 (fnm), plus the suite in `node:*-bookworm` containers. There is no Mac here, and the macOS jobs caught the 8 KB stdout truncation in PR #52, so `ci.yml` keeps only them |
| Harness tier 0 (`ci.yml`) | Local | A gate of `ci:local` |
| gitleaks (`ci.yml`) | Local | A gate of `ci:local`; the pre-commit hook scans once gitleaks is on `PATH` |
| `npm audit` (`ci.yml`) | Local | A gate of `ci:local`, and release-check Gate 3 |
| CodeQL (`codeql.yml`) | Local | `ci:local --codescan` (the CodeQL CLI's `security-extended` suite, else Semgrep in Docker) and the weekly `PanWizard-codescan` task. Accepted results live in `.codeql-accepted.json` with a reason each |
| Dependabot (`dependabot.yml`) | Local | The weekly `PanWizard-outdated` task (`npm outdated` and `npm audit`). The pinned action SHAs matter only for the two workflows left. Dependabot *alerts* stay on as a repository setting |
| Pull requests and merges | Local | `npm run land -- <branch>`: it refuses unless a full `ci:local` passed on the branch's HEAD from a clean tree. Then it squash-merges onto `main` and pushes, and never forces a push |
| npm release (`release.yml`) | Stays on GitHub | Tokenless OIDC publishing with `--provenance` needs a CI provider's identity token |
| Docs and changelog links | Local | `docs/` and `CHANGELOG.md` ship in the npm package; `/pan:update` reads the installed changelog |
| Project URLs, plugin marketplaces, market reading | Stay on GitHub | GitHub remains the public home; the market tools read other projects' repositories |
| `autodev --ci` | Both | `--ci local` uses the project's own gate (`npm run ci:local`, else `npm test`) as the oracle; the GitHub mode remains |

## Phases

| Phase | Scope | State |
|---|---|---|
| 0 | gitleaks and fnm (Node 18, 20, 22) installed; `docs/` and `CHANGELOG.md` shipped in the package | Done (PR #57) |
| 1 | `scripts/local-ci.cjs` (`npm run ci:local`), code scanning, `.ci-local/report.json`, the opt-in pre-push hook (`npm run hooks:pre-push`) | Done (PR #57); a full run passed every gate with none skipped |
| 2 | Weekly Task Scheduler jobs (`npm run ci:schedule -- --install`): `PanWizard-codescan`, `PanWizard-outdated`, `PanWizard-market-watch`; reports in `.ci-local/scheduled/`, linked from the State of PAN report | Done (PR #57); the tasks are registered on the maintainer's machine |
| 3 | `scripts/land.cjs` (`npm run land`); `ci.yml` cut down to macOS; `codeql.yml` and `dependabot.yml` removed; `autodev --ci local` | Done (PR #57) |

## Repository settings (owner, `2026-10-22`)

- Branch protection on `main` requires only `test (macos-latest · node 18)`, `test (macos-latest · node 20)` and `test (macos-latest · node 22)`. No pull request is required, force pushes stay off, and linear history stays on.
- The seven open Dependabot pull requests were closed, and the leftover remote branches were deleted.

## Not done, by choice

- A local pull-request page (for example Forgejo in Docker). Nothing needs it yet.
- Publishing from this machine. Releases stay on `release.yml`, for provenance.
