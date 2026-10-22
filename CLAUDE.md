# PAN Wizard — Development Rules

**Branch:** main · **Source of truth:** `package.json` for version, this file for counts

---

## CRITICAL: Single source of truth for counts

This file is the **only** place where test counts, command counts, agent counts, module counts, etc. are recorded as numbers. **All other docs** (README.md, docs/*.md, comments, etc.) MUST NOT embed these numbers — they drift instantly. Use qualitative phrasing ("multi-agent", "extensive command set", "all shipped commands") or refer back here.

If you're auditing a doc and find a number that looks like it should match a filesystem count (test count, command count, etc.), **delete the number** rather than chasing the drift across N files. The fix isn't to update; the fix is to remove.

To refresh the counts table below, run from repo root:

```bash
node -e "
const fs = require('fs'), path = require('path');
const pkg = require('./package.json');
const ls = (p, glob = /\.md$/) => fs.readdirSync(p).filter(f => glob.test(f)).length;
const walkMd = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) n += walkMd(fp);
    else if (e.name.endsWith('.md')) n++;
  }
  return n;
};
const lib = fs.readdirSync('pan-wizard-core/bin/lib').filter(f => f.endsWith('.cjs')).length;
console.log({
  version: pkg.version,
  commands: ls('commands/pan'),
  agents: ls('agents'),
  modules: lib,
  workflows: ls('pan-wizard-core/workflows'),
  templates: walkMd('pan-wizard-core/templates'),    // recursive — counts research-project/, codebase/ subtrees
  references: ls('pan-wizard-core/references'),
  unitTests: ls('tests', /\.test\.cjs$/),
  scenarioTests: ls('tests/scenarios', /\.test\.cjs$/),
  hooks: ls('hooks', /\.js$/),                       // sources, matching the row label — hooks/dist/ is gitignored build output and absent on a fresh clone
  specs: ls('docs/specs'),
  adrs: ls('docs/decisions', /^ADR-.*\.md$/),
});
"
```

Then run `npm run test:all 2>&1 | grep -E '^ℹ (tests|suites)'` to refresh the test count.

### Counts (the only place these live)

| What | Count |
|---|---|
| Version | (see `package.json`) |
| Commands (`commands/pan/*.md`) | 46 |
| Agents (`agents/*.md`) | 24 |
| Core modules (`pan-wizard-core/bin/lib/*.cjs`) | 80 |
| Workflows (`pan-wizard-core/workflows/*.md`) | 40 |
| Templates (`pan-wizard-core/templates/**/*.md`) | 42 |
| References (`pan-wizard-core/references/*.md`) | 17 |
| Unit test files (`tests/*.test.cjs`) | 232 |
| Scenario test files (`tests/scenarios/*.test.cjs`) | 37 |
| Total tests (npm run test:all) | 6013 |
| Total test suites | 1301 |
| Hooks (`hooks/*.js`) | 8 |
| Specs (`docs/specs/*.md`) | 57 |
| ADRs (`docs/decisions/ADR-*.md`) | 49 |

These are a snapshot of the **current working tree**, not of any released tag — a branch mid-audit carries files `main` does not (test files especially). They drift; refresh via the snippet above when needed. **Never propagate them to another doc.**

---

## CRITICAL: Never install PAN into the source repository

**This is the PAN Wizard source code repository.** Do NOT install PAN into this directory.

- NEVER run `node bin/install.js` from `d:/PanWizard/` (or wherever this repo is cloned)
- NEVER create `.claude/pan-wizard-core/`, `.claude/pan-file-manifest.json`, or `.claude/package.json` in this repo
- NEVER copy source files into `.codex/`, `.gemini/`, `.opencode/`, or `.github/` (Copilot's project dir) within this repo
- The installer has a hard guard (`PAN_SOURCE_ROOT` check in `bin/install.js` — search for the constant) that refuses to run from the source directory
- `.gitignore` blocks most self-install artifacts, not all: depending on the runtime, a local install would also write `AGENTS.md`, `.mcp.json`, `.agents/skills/` (and `.agents/pan-wizard-core/` under `--unified-skills`), `.claude/workflows/pan-*.js`, `.github/mcp.json` and `.github/copilot/settings.json` (Copilot's statusline), none of them ignored, and edit the tracked `CLAUDE.md` and `.claude/settings.json` — the installer guard is what keeps them out

## Testing PAN installations

Use a **separate directory** for testing PAN installations:

```bash
# Correct — install into a test directory (single runtime)
cd d:/pantesting && node d:/PanWizard/bin/install.js --claude --local

# Correct — full deployment (all 5 runtimes)
cd d:/pantesting && node d:/PanWizard/bin/install.js --claude --codex --gemini --opencode --copilot --local

# Wrong — this will be rejected by the installer
cd d:/PanWizard && node bin/install.js --claude --local
```

The test directory is `d:\pantesting`. All manual installation testing goes there.

Automated tests (`npm test`, `npm run test:scenarios`) use OS temp directories via `os.tmpdir()` and are safe to run from the source repo.

## Test commands

```bash
npm test                # Unit tests (tests/*.test.cjs)
npm run test:scenarios  # Scenario tests (tests/scenarios/*.test.cjs)
npm run test:all        # All tests
npm run build:hooks     # Copy hook scripts to hooks/dist/ (copy-only; PAN hooks are pure Node.js)
```

## 5 target runtimes

PAN Wizard installs into 5 AI coding tool runtimes:

| Runtime | Directory | CLI Flag | Tool |
|---------|-----------|----------|------|
| Claude  | `.claude/` | `--claude` | Claude Code |
| Codex   | `.codex/` | `--codex` | OpenAI Codex CLI |
| Gemini  | `.gemini/` | `--gemini` | Google Gemini CLI |
| OpenCode | `.opencode/` | `--opencode` | OpenCode |
| Copilot | `.github/` | `--copilot` | GitHub Copilot CLI |

## Project structure

### Source code (shipped by installer)

- `bin/install.js` — Installer entry point
- `bin/install-lib.cjs` — Installer functions, free of filesystem writes (`verifyInstall()`/`verifyHookEntrypoints()`/`dirDigest()` only read; the merge and strip helpers `stripPanHookEntries()`, `mergeCodexHooksConfig()`, `removeCodexPanHooks()`, `mergeMcpRegistration()`, `stripMcpRegistration()`, `addOpencodePermissions()` and `stripOpencodePermissions()` edit the object they are given)
- `pan-wizard-core/bin/pan-tools.cjs` — CLI dispatcher
- `pan-wizard-core/bin/lib/*.cjs` — Core CJS modules
- `pan-wizard-core/workflows/*.md` — Multi-step workflow definitions
- `pan-wizard-core/templates/` — Scaffolding templates (`*.md`, the `codebase/` and `research-project/` subdirectories, and `config.json`)
- `pan-wizard-core/references/*.md` — Agent-loaded reference docs
- `pan-wizard-core/opencode/pan-wizard.js` — OpenCode plugin. An OpenCode install copies it to `plugins/pan-wizard.js` in its config dir, where it keeps PAN's position through a compaction
- `pan-wizard-core/mcp/*.cjs` — **MCP bridge (canonical home).** Zero-dep dual-era JSON-RPC stdio server exposing `pan-tools` verbs as MCP tools/resources, plus the registry, the `next-action` state machine, and the human merge gate. Lives under the core so it ships to every install and every runtime. `pan-zcode/` is a **consumer**, not the owner — never fork a copy back under it.
- `commands/pan/*.md` — Command definitions (copied by installer)
- `agents/*.md` — Agent definitions (copied by installer)
- `hooks/*.js` — Hooks (source, built → `hooks/dist/`)
- `pan-zcode/*` — **Experimental (preview):** ZCode-native subsystem. Ports PAN's agents to ZCode subagents and emits an MCP registration pointing at the shared server in `pan-wizard-core/mcp/`; its own installer (`pan-zcode/bin/install-zcode.js`) is separate from `bin/install.js` and is NOT a 6th runtime of the main installer. See `pan-zcode/README.md`.

### Tests

- `tests/*.test.cjs` — Unit test files
- `tests/scenarios/*.test.cjs` — Scenario test files (installer + integration + workflow)

### Documentation

- `docs/*.md` — User and developer docs (USER-GUIDE, ARCHITECTURE, CLI-REFERENCE, etc.)
- `docs/decisions/ADR-*.md` — Architecture Decision Records
- `docs/specs/*.md` — Feature specs
- `docs/` (all but `docs/branding/assets/`, the images) and `CHANGELOG.md` ship in the npm package, so users can read them without GitHub; the installer copies `CHANGELOG.md` into each installed core, where `/pan:update` points

### Development tools (for PAN development only — `.claude/`, `marketplace/` and `harness/` are not shipped; `scripts/` does ship because `package.json` `files` includes it)

- `.claude/commands/*.md` — Dev commands (`/build`, `/test`, `/check`, `/pandev`, etc.)
- `.claude/agents/*.md` — Dev agents (dev-orchestrator, dev-workflow)
- `.claude/workflows/*.md` — Workflow protocols
- `.claude/settings.json` — Claude Code permissions, plus PAN hook and statusline registrations that run `.claude/hooks/pan-*.js`, a gitignored path that holds no files in a checkout
- `scripts/build-hooks.js` — hook copy script (copies the hooks listed in `HOOKS_TO_COPY` to `hooks/dist/`; copy-only, no bundler — a new hook must be added to that list)
- `scripts/build-plugin.js` — emits the Claude Code plugin to `dist/pan-wizard-plugin/` (manifest, commands, agents, hooks, workflows, `.mcp.json`, core, plus `evals/` from `harness/plugin-evals/` when built from a checkout)
- `scripts/plugin-path.js` — rebuilds the plugin and prints its absolute path as **exactly one stdout line**, the contract a plugin-marketplace `command` source requires. Claude Code runs it from the user's HOME, so nothing may depend on cwd, and the builder's output is relayed to stderr
- `scripts/npm-dist-tag.js` — prints the npm dist-tag a version publishes under (`next` for a prerelease, `latest` otherwise); `release.yml` publishes with it so a release candidate never becomes `latest`
- `scripts/deprecate-old-versions.js` — release housekeeping: after a successful publish, deprecates every stable release outside the newest-3 window plus any superseded prerelease. Dry-run by default; **never unpublishes** (a test asserts the script has no unpublish path)
- `scripts/test-surface.cjs` — derives the shipped surface from the code (verbs, subcommands, dispatcher arms, installer flags, hook × runtime, MCP tools/resources, config keys, content dirs) into `tests/fixtures/surface.json`; `--check` fails on drift, `--map` shows which test names each row, `--scaffold <dir>` writes a todo stub per unreferenced row. `tests/surface-map.test.cjs` enforces it with `tests/fixtures/surface-allowlist.json` (every entry needs a reason). It is also the **liveness registry** (program L1): `--check` fails when a shipped command or agent is named by no harness scenario, a verb or subcommand has no caller in a shipped prompt, native workflow or MCP tool, or a config default has no reader, unless `tests/fixtures/liveness-allowlist.json` gives the reason; `--liveness` lists who uses what
- `scripts/coverage-gate.cjs` — runs the suite under Node's own coverage (`node --test --experimental-test-coverage`, Node 22+) and fails when a dispatcher `case` arm never executed, or when overall line or function coverage, or a module group's line coverage, drops below its floor in `tests/fixtures/coverage-policy.json`. Release-check Gate 9; advisory CI step on the Node 22 jobs. `npm run test:coverage`
- `scripts/mutation-probe.cjs` — **report-only** (`npm run test:mutate`): breaks the code on purpose inside a throwaway `git worktree` and reports which mutations the suite failed to notice. Answers what coverage cannot — not "did the line run" but "would a test fail if it were wrong". Sampled and seeded (`--max`, `--seed`, `--target`); targets the cost and trace logger hooks, `cost.cjs`, `cost-rebuild.cjs` and the dispatcher. Never a gate: release-check and CI do not run it, and `tests/mutation-probe.test.cjs` asserts they do not
- `scripts/test-quality-lint.cjs` — the assertion shapes that passed while the feature was broken (OR-shaped liveness asserts, in-process `cmd*` calls that exit the process, `assert(true)`, length-only CLI asserts, bare platform returns, tight wall-clock bounds, real-HOME reads, committed todos, OR-of-bare-property existence asserts), applied to the suite by `tests/test-quality.test.cjs` with `tests/fixtures/test-quality-allowlist.json`
- `scripts/prompt-lint.cjs` — the prompt-contract lint (program L2): every `pan-tools` call in a shipped prompt names a real verb and subcommand, an agent is never told to use a tool it is not granted, no prompt @-includes engine source, no AskUserQuestion offers more than four options, every spawn names its model and role spawns name their agent type, and no shipped prompt sends the user to a dev-only skill. Applied by `tests/prompt-lint.test.cjs` with `tests/fixtures/prompt-lint-allowlist.json` (every entry needs a reason, and a stale entry fails)
- `scripts/prompt-rules.cjs` — the prompt-rule registry (program H6): every normative line (MUST, NEVER, always, do not …) in a shipped prompt gets a stable id (`<file>:<sha1 prefix of its text>`) in `tests/fixtures/prompt-rules.json`. A harness scenario claims the rules it exercises with `covers: [ids]`. Rules present when the registry was created are `baseline`; any other unclaimed rule fails `--check` (and `test-surface.cjs --check`) unless `tests/fixtures/prompt-rules-allowlist.json` gives a reason. After editing a prompt's normative lines, run `--write`. `harness/src/run.cjs --prompt-mutant <id>` deletes that rule from the packed package and runs only the scenarios that cover it: all passing means the rule is decorative; each run appends a row to `harness/prompt-mutants.jsonl`
- `harness/autopilot/` — the **autopilot** (programs S1, S2, S5; not shipped, and `tests/autopilot.test.cjs` checks `npm pack` carries nothing under `harness/`). `market-watch.cjs` evaluates the machine predicates in `docs/specs/watch-triggers.json` for the ideas ledger's WATCH rows, model-free (npm dist-tags, GitHub releases by ETag, `CHANGELOG.md`, harness results), and appends fired triggers to `harness/autopilot/state/inbox.md`; it never writes the ledger. `autopilot.cjs <lane>` prints a dry-run plan by default; a model lane (`lanes.json`) runs only with `--run --approve-usd N`, in a worktree under the test directory on a local `bot/<lane>/<id>` branch, and never publishes; `bot-scope-check.cjs` refuses evaluator files and files outside the lane, and the canaries in `canaries.json` must stay red. `PAN_AUTOPILOT_KILL=1` stops every lane; a monthly cap applies. `state-of-pan.cjs` writes the deterministic weekly report. The fix lanes (S3) run in the order their gate is mechanical (mutant, surface row, dispatcher arm, docs, harness finding, prompt); each opens after the one before has three branches the owner merged and none reverted (`autopilot.cjs record <branch> merged|reverted`), and a branch is kept only when it passes its lane's gates (same-seed mutation re-probe, test-quality lint, suite). The dogfood lane (S6, `dogfood.cjs`, `autopilot.cjs dogfood --run --approve-usd N`) runs PAN on PAN: a worktree of this repository, PAN installed from the packed tarball into a scratch `--global --config-dir` (never into the source repo), the oldest open harness finding handed to `/pan:quick --full`, and the branch kept only when that verification passed and the diff passes the scope check. Local state is in `harness/autopilot/state/` (gitignored)
- `harness/src/evolve.cjs` and `/evolve-prompt` — guarded prompt evolution (program S4): one section of one judge prompt, reflected from training failures only, scored paired against the baseline with a deletion arm, accepted only when non-inferior on held-out data (`harness/evolve/split.json`, δ 0.05). The evolver writes only under `harness/variants/` and aborts if the scorer, corpus, scenarios, cassettes or split change during a generation (`tests/evolve-guard.test.cjs`). `harness/src/run.cjs --variant <installed path>=<harness/variants file>` runs a variant as an arm. Paid; the owner approves each run
- `scripts/local-ci.cjs` — `npm run ci:local`: the GitHub CI gates on this machine, in parallel — the suite on the host per Node version fnm has (else the current Node, the rest reported skipped), the suite under Node 18, 20 and 22 in `node:*-bookworm` containers (checkout mounted read-only and copied in, run as the unprivileged `node` user), the harness at tier 0 with `--no-ledger` and `--require-run` for the double-backed scenarios, gitleaks, `npm audit --omit=dev --audit-level=high`, `links validate`, `test-surface.cjs --check`, the coverage gate, and a clean-tree check (the run leaves the tree as it found it). `--codescan` adds the CodeQL CLI's security-extended suite when installed (PATH or `%USERPROFILE%\.codeql-cli`; blocks on error level or security severity 7.0+ unless the rule and file are accepted with a reason in `.codeql-accepted.json`, seeded from GitHub's dismissed alerts), else Semgrep in Docker on files changed against `main`. A missing tool is SKIP, never PASS; any FAIL exits 1 (`--strict`: a SKIP too). Writes `.ci-local/report.json` and per-gate logs (gitignored; `--out` elsewhere); a full run also records its verdict per commit in `<git-common-dir>/pan-ci-local/<sha>.json` for `land`. `--fast` is the pre-push subset (host suite on the current Node, harness, gitleaks), run by the tracked `scripts/git-hooks/pre-push`, which stays inert until `npm run hooks:pre-push` (`scripts/install-pre-push.cjs`) sets `pan.prePush` in the clone's git config
- `scripts/land.cjs` — `npm run land -- <branch>`: the merge flow without pull requests. Refuses unless a full `ci:local` passed on the branch's HEAD from a clean tree with no gate skipped (`--allow-skips`) and the branch contains `origin/main`; then fast-forwards `main` to `origin/main` (in the checkout that has `main`, else a temporary worktree), squash-merges, checks the tree equals the one `ci:local` passed, commits with the branch's summary and pushes `main`, never forced. `--dry-run`, `--no-push`, `--title`
- `scripts/local-schedule.cjs` — `npm run ci:schedule -- --install|--uninstall|--list|--run <job>`: weekly Windows Task Scheduler tasks for the current user, no admin (`PanWizard-codescan`, `-outdated`, `-market-watch`), in place of GitHub's CodeQL workflow and Dependabot. Runs in the main worktree; reports to `.ci-local/scheduled/<job>/` (`last-run.json` is linked by `harness/autopilot/state-of-pan.cjs`). Requiring it runs nothing
- `.github/workflows/` — only `ci.yml` (the macOS test jobs: no local substitute) and `release.yml` (npm publish with provenance through OIDC) remain; everything else runs locally
- `scripts/build-help.cjs` — generates the command index in `pan-wizard-core/workflows/help.md` (what `/pan:help` prints) from each `commands/pan/*.md` file's `group` and `description` frontmatter; `--write` refreshes it, `--check` exits 1 when stale, and `tests/help-generated.test.cjs` fails on a stale block or a missing command
- `marketplace/` — a local `command`-source marketplace (`marketplace/.claude-plugin/marketplace.json`) that installs the plugin from this checkout without publishing. Not shipped — absent from `package.json` `files`. See `marketplace/README.md`
- `scripts/build-agent-plugin.js` — emits the vendor-neutral **Agent Plugins** bundle to `dist/pan-agent-plugin/` (ADR-0045) for Copilot CLI, Codex, Cursor, Kiro. `.agents/plugins/marketplace.json` (Codex) and `.github/plugin/marketplace.json` (Copilot) point at it
- `harness/` — the **PAN Harness** (ADR-0047): behavioural scenarios run against deployed installs built from a packed artifact. `npm run harness` is tier 0 (model-free, free); model tiers spend, capped at $15 per run unless `--max-usd` or `PAN_HARNESS_MAX_USD` says otherwise. Run state goes to `d:\pantesting\harness-runs\` on Windows when `d:\pantesting` exists, else the OS temp directory (`PAN_HARNESS_STATE` or `--state-dir` overrides it); `harness/plugin-evals/` holds the `claude plugin eval` suite `scripts/build-plugin.js` copies into the plugin's `evals/`; `harness/corpus/` holds the seeded-defect projects (a clean twin, a defective twin and a catching test each) that `harness/scripts/catch-rate.cjs` scores judges against, catch rate and false-alarm rate with Wilson intervals; `harness/ledger.jsonl` is the tracked finding history — `--no-ledger` leaves it alone, which is how CI runs tier 0 on the ubuntu Node-22 job without dirtying the tree. Not shipped. See `harness/README.md`

### Key design patterns

- **CommonJS (.cjs)** for all core modules — required for Claude Code compatibility
- **Pure functions** in `install-lib.cjs` — no filesystem writes — the read-only helpers (`verifyInstall()`, `verifyHookEntrypoints()`, `dirDigest()`) read the filesystem, and the merge and strip helpers (`stripPanHookEntries()`, `mergeCodexHooksConfig()`, `removeCodexPanHooks()`, `mergeMcpRegistration()`, `stripMcpRegistration()`, `addOpencodePermissions()`, `stripOpencodePermissions()`) edit the object they are given; fully testable
- **Runtime-agnostic** commands and agents — no PAN-specific hardcoding in shipped content
- **Path normalization** via `toPosix()` — cross-platform path handling
- **Line endings** — planning files are parsed on LF (`toLf()`) and written back in their own ending (`dominantEol()`, `withEol()`), all in `core.cjs`; `tests/crlf-parity.test.cjs` runs the parsers on LF and CRLF copies
- **Manifest-based tracking** — `pan-file-manifest.json` hashes the PAN files the installer copies in (the runtime's own core — not the shared `.agents/pan-wizard-core/` of a `--unified-skills` install — commands or skills, agents, hook scripts, native workflows, OpenCode's plugin), not the config files it writes or merges into
