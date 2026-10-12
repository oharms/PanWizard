# /featureAI Spec: Q4 2026 Roadmap and Competitive Analysis

**Date:** `2026-10-11`
**Status:** Realigned `2026-10-12` — the owner set features first and exposure later. The program is now `product_excellence_program_2026_q4_featureai.md`; this spec's competitive analysis stands as background, its publication bet (F3) moves to that program's deferred Exposure phase, and F1 and F2 are absorbed there (R45 in W1; R46 by V9 and V1 in W1, with V2 in W2).
**Tree:** `feat/memory-optimization-2026-10` @ `4994ed5` (`3.34.0`, released `2026-10-10`) plus the same-day doc audit's working tree
**Supersedes:** `industry_comparison_and_feature_gaps_featureai.md` (`2026-02-28`) and `industry_analysis_strategic_additions_featureai.md` (`2026-03-03`) as the strategic read
**Evidence base (all `2026-10-11`):** the market idea scan with a feature-level read of Superpowers (ledger rows MI-110 to MI-126), the doc audit, the reality check (§11 of `docs/ECOSYSTEM-REVIEW-2026-08.md`), and a feature-level landscape of Spec Kit, BMAD, gsd-core and OpenSpec read from their READMEs, docs, releases APIs and registries. Queue ids (M, R) refer to the Addendum of `docs/specs/market-ideas-2026-10.md`.

---

## Phase 0: Problem Framing

### 0.1 Problem statement

PAN Wizard is ahead of its category on rigour and nearly invisible in it. The reality check found a product that does what its docs say on all five runtimes. It has a behavioural harness that installs from a packed artifact, an MCP server with a forbidden-verb list and a human merge gate, a cost ledger priced from a dated rate table, and deterministic orchestration beside portable markdown workflows. No direct peer was found with all four. But `pan-wizard` drew 1,599 npm downloads from `2026-09-11` to `2026-10-10` (api.npmjs.org). OpenSpec drew about 2.9 million and BMAD about 77,500 in a comparable window. Superpowers is listed in three official plugin marketplaces; PAN is listed in none. Three things make this the quarter to act:
- **The peers are moving onto PAN's ground.** gsd-core shares PAN's `.planning/` file vocabulary and loop. BMAD v7 adds an eval tool. Superpowers runs an eval lab against real CLIs.
- **The distribution channels have opened.** Anthropic takes directory submissions through a developer portal, and Codex and Copilot ship default marketplaces.
- **A host is changing under PAN.** OpenCode 2 is now pushed to users and does not load PAN's plugin.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| A sequenced roadmap for `2026-10` to `2026-12`: correctness, publication, measured behaviour, plan quality | A sixth runtime (MI-017), standardising `.planning/` (MI-018), skills-marketplace listings on quality grounds alone (MI-020) |
| A competitive analysis of the direct peers and the host-tool natives | The IDE peers in `docs/COMPARISON.md`, whose rows did not change this quarter |
| Implement-ready specs for the roadmap's first items (F1, F2) and design-level specs for the strategic ones (F3, F4, F5) | Building anything: this spec feeds `/execplan` |
| The decisions only the owner can make, named and sized | Telemetry of any kind (MI-056) |

### 0.3 Success criteria (roadmap level)

```text
SC-1: PAN's plugin is installable from at least one official marketplace (Anthropic's directory, Codex's or Copilot's default marketplaces) by 2026-12-31, from a tracked artifact a test validates.
SC-2: Every capability claim in README.md and docs/COMPARISON.md is backed by code or a harness scenario; the claims audit of the next reality check finds no FALSE row and no WEAKENED row in PAN's own column.
SC-3: The OpenCode plugin loads on OpenCode 1.x and 2.x, proven by a live check on each.
SC-4: A failed test gate cannot complete a phase on any runtime, enforced by code that a test pins.
SC-5: At least one portable behavioural chain (exec-phase) passes the harness on a second host CLI (MI-104).
SC-6: UAT runs as a command on all five runtimes and feeds the diagnose loop (closes the COMPARISON "UAT only as a template" row).
SC-7: No regression: the full suite, every release gate and harness tier 0 stay green at each step.
```

### 0.4 User stories

```text
As a developer choosing a planning framework, I want to find and install PAN from my host's marketplace,
so that I can try it in one step, instead of discovering it on npm and reading an install guide.

As an OpenCode user moved to OpenCode 2, I want PAN's compaction hand-off to keep working,
so that a long session resumes where it stopped, instead of losing PAN's position silently.

As a team lead relying on verification, I want a failing test suite to stop the phase in code,
so that a verifier's mistaken "passed" cannot ship broken work, instead of trusting the prompt.

As a product owner, I want to walk a phase's acceptance criteria with the agent and have gaps diagnosed,
so that UAT is part of the loop, instead of a template nobody runs.

As a maintainer, I want the portable chain proven on more than Claude Code,
so that "works on five runtimes" means behaviour, not only installation.
```

---

## Phase 1: Internal Reconnaissance (what the reality check established)

### 1.1 Strengths, with evidence

| Strength | Evidence |
|---|---|
| Installs and runs on all five runtimes | Packed-tarball install of all five in seconds; `validate deployment` clean on each; harness tier 0 all green except the Antigravity gate (no `agy`) |
| Fresh context per plan | `workflows/exec-phase.md` spawns `pan-executor` with paths only; tier-2 chain scenarios count reads from each executor's own transcript |
| Deterministic orchestration where control flow is knowable | Native Claude Code workflow scripts (`buildNativeWorkflowScripts` in `bin/install-lib.cjs`) beside portable markdown; the oracle measured parity (MI-002) |
| Engine over MCP with guard rails | `pan-wizard-core/mcp/`: fixed registry, `FORBIDDEN_VERB`, no-shell spawn, a per-request merge token; every resource reads cleanly on a bare project |
| Cost ledger correctness | Dated rate table re-read from the pricing page; long-prompt pricing (MI-107); per-agent transcript attribution; usage-window stop (MI-109) |
| Behavioural harness against packed installs | `harness/` tiers 0–2 with a findings ledger (ADR-0047) |
| Documentation trust | Counts live in one file; doc-lint and model-version lints gate the suite; the doc audit's prompt sweeps found real code bugs |

### 1.2 Weaknesses, with evidence

| Weakness | Evidence | Roadmap answer |
|---|---|---|
| Invisible | 1,599 npm downloads in the last month; no official marketplace listing; no GitHub stars recorded since the repository went public | F3 |
| Some guarantees are prompt-only | The verifier's test gate (RC3); the `/pan:army` merge gate (README says so); the MCP caps use caller-supplied counts | F2, and honest wording (done) |
| UAT does not run | No command writes a UAT file; `diagnose-issues.md` is loaded by no command; the native diagnose script exists on Claude Code only | F4 |
| Behaviour proven on one host | The model tiers of the harness run on Claude Code only (MI-104 plumbing built, parsers missing) | H3 |
| OpenCode 2 plugin break | v2's loader needs `setup` or `effect` (RC1) | F1 |
| Plan quality depends on prose | No Review Focus, no executor concerns state, some spawns inherit the session model | M39, M41, M42 |

### 1.3 Runtime matrix today

| Runtime | Commands/skills | Agents | Hooks / observers | MCP | Native workflows | Behaviour proven |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ full set | ✅ `.mcp.json` (global: printed command) | ✅ | ✅ tier 2 |
| Codex | ✅ `.agents/skills` | ✅ `.toml` | ✅ (async observers) | printed TOML snippet by design | — | install and MCP listing only |
| Gemini CLI | ✅ `.toml` | ✅ | partial: no monitor or loggers (no matching event) | ✅ | — | install and MCP listing only; live model runs blocked on an API key |
| OpenCode | ✅ | ✅ | plugin (compaction only; breaks on v2) | ✅ (v1 shape, which v2 normalises) | — | install, discovery and MCP listing |
| Copilot CLI | ✅ | ✅ `.agent.md` | ✅ | ✅ `.github/mcp.json` | — | install, MCP, a live compaction check |

---

## Phase 2: Competitive Analysis

### 2.1 Positioning

| Project | Position in its own words (paraphrased) | Centre of gravity |
|---|---|---|
| **PAN Wizard** | A planning, state and verification layer installed into five host CLIs | Rigour and portability: durable state, gated loop, measured behaviour |
| **Superpowers** (`obra/superpowers`, v7.0.0 `2026-10-10`) | A skills plugin that changes how the agent works: brainstorm, plan, subagent-driven development, TDD, review | Behavioural discipline through always-loaded skills; widest marketplace presence |
| **gsd-core** (`open-gsd/gsd-core`, v1.16.0 `2026-10-05`) | Lightweight meta-prompting and context engineering; fresh-context subagents through discuss, plan, execute, verify, ship | The closest twin: same `.planning/` vocabulary, many gates, cross-AI reviewer lanes |
| **Spec Kit** (`github/spec-kit`, v1.1.3 `2026-10-09`) | Structured processes and templates for any agent: spec-driven development, bug fixing, idea assessment | Breadth: widest agent coverage, extension catalog, workflow engine |
| **BMAD** (`bmad-code-org/BMAD-METHOD`, v6.12.2 `2026-10-11`; v7 preview) | Agile AI-driven development with product, architecture, UX, dev and test perspectives | Planning depth through personas; v7 moves to skills-native distribution |
| **OpenSpec** (`Fission-AI/OpenSpec`, v1.14.1 `2026-10-06`) | A lightweight spec layer so human and agent agree before code is written | Simplicity and reach: delta specs, a strict validator, the largest install base |

### 2.2 Capability matrix

Y = shipped · P = partial or weaker · N = not found on `2026-10-11` · B = beta or preview. PAN's column is from the code; the others are from each project's own README, docs and releases.

| Capability | PAN | Superpowers | gsd-core | Spec Kit | BMAD | OpenSpec |
|---|---|---|---|---|---|---|
| Durable planning state | Y `.planning/` | P dated spec and plan files, ephemeral run ledger | Y `.planning/` + a JSON state contract with transactions | Y `.specify/` per feature | Y `_bmad-output/`; v7 initiatives | Y `openspec/specs` + delta changes |
| Research before planning | Y researcher agents | P brainstorming with optional recon | Y researchers, claim provenance | Y plan Phase 0; `assess` extension | Y deep-recon packs | N (reads code first) |
| Plan verification | Y plan-checker loop | Y self-review + user review of the plan | Y plan-checker and several gates; plans reviewed by other AIs | Y `analyze`, checklists | Y readiness gate | Y `validate --strict` |
| Fresh context per unit of work | Y | Y per task (SDD) | Y per executor, parallel waves | N (agent's own session) | P (`bmad-build-auto`; bmad-loop) | N |
| Parallel worktrees | P Claude-only army | N by design (one worktree per plan) | Y on by default, several runtimes | P community extension | P bmad-loop (beta), five CLIs | N |
| Post-execution verification | Y verifier + test gate (prompt-enforced) | Y verification before completion, final review | Y goal-backward verify, invalidation on change, API coverage | Y `converge` loop | Y coverage audit, re-verification | Y `verify` (skipped ≠ passed) |
| UAT that runs | N template only | N | Y in `verify-work`; live-DOM UAT (off by default) | P bug extension's verified/partial/failed | P walkthrough skill | N |
| Review agents | Y reviewer, hardener, meta-reviewer | Y task + final reviewer | Y review pipeline, disposition ledger | P community | Y multi-layer parallel review | N |
| Behavioural evals of the framework | Y harness vs packed installs, findings ledger | Y Quorum lab vs real CLIs (separate repo) | P mutation testing, conformance tiers | P `selftest` extension | B `bmad-eval` (v7) | N (QA smoke harness unshipped) |
| Cost ledger / model routing | Y ledger, dated rates, profiles, usage-window stop | P per-role model guidance in prose | P profiles, failure escalation; no rate table | P per-step model | P handoff routing | N |
| MCP server | Y read tools + gated merge | N | Y read and write state (no merge gate found) | B read-only, experimental | N | N |
| Hooks | Y four runtimes + OpenCode plugin | Y session-start bootstrap | Y monitor and several guards | Y extension and native hooks | P customization hooks | N |
| Deterministic orchestration | Y native scripts on Claude Code | N | B Workflow-tool capability, Claude-only | Y workflow engine (YAML) | P bmad-loop (Python) | N |
| Runtimes targeted | 5 (+ Antigravity via `.agents/`) | ~15 harnesses | 16 (dropped Gemini CLI in v1.15.0) | 42 integration keys | 48 install targets (v6) | ~44 tools |
| Official marketplace listings | none | Claude, Codex-curated, Grok | none (self-hosted) | none | none (own marketplace) | none |
| Telemetry | none (MI-056) | opt-out logo ping in one tool | none (a recorded non-goal) | none found | none found | on by default, opt-out |

### 2.3 Momentum (last 90 days, from `2026-07-13`)

| Project | Releases (GitHub API) | Downloads per month (primary registry unless marked) | Stars (secondary) |
|---|---|---|---|
| PAN Wizard | 6 | npm 1,599 | none recorded |
| Superpowers | 5 | (plugin installs: ~1.15M official-marketplace installs, a scrape of Anthropic's endpoint, secondary) | ~297k |
| gsd-core | 11 | npm ~46.5k (+ ~60k on the legacy package) | ~10k |
| Spec Kit | 44 | PyPI ~84k (pypistats, secondary) | ~141k |
| BMAD | 4 on v6 (v7 unreleased) | npm ~77.5k | ~54k |
| OpenSpec | 11 | npm ~2.9M; Homebrew ~1.7k | ~72k |

### 2.4 Where PAN stands

- **Ahead (protect):**
  - The harness against packed installs.
  - The MCP merge gate. gsd-core's MCP writes state with no merge gate found.
  - The dated cost ledger.
  - Deterministic plus portable orchestration with a measured parity oracle.
  - **Threat to these:** Superpowers' Quorum and BMAD's `bmad-eval` make "we test the framework itself" a contested claim within a quarter.
- **Parity:**
  - Durable state (gsd-core matches it file for file).
  - Plan verification.
  - Fresh-context execution (Superpowers, gsd-core).
  - Review agents (BMAD's layered review is richer on adversarial and intent layers).
- **Behind:**
  - Distribution and reach on every measure.
  - Running UAT (gsd-core).
  - Parallel worktrees beyond Claude Code (gsd-core, bmad-loop).
  - Cross-AI review (gsd-core reviewer lanes; MI-044 is WATCH).
  - Runtime breadth. This is by decision (MI-017); it is a positioning choice, not a gap to close.
- **Converging signals:**
  - Explicit model choice per dispatch (Superpowers).
  - Verification invalidated by change (gsd-core; PAN has MI-067).
  - Skipped is not passed (OpenSpec; PAN has MI-064).
  - Evals of the framework (three peers).
  - The read on `2026-09-10` holds: the market converged on PAN's thesis. The gap is publication, and now also proof of behaviour off Claude Code.

### 2.5 Differentiation statement

PAN is the planning, state and verification layer whose behaviour is measured against what users actually install, on every host it supports, with spend and merges under explicit control. The roadmap keeps every item inside that sentence. Anything that only widens reach (more runtimes, telemetry, marketplace spam) or only adds ceremony (personas, always-on bootstraps) is out.

---

## Phase 3: Design — the roadmap

### 3.1 Three strategic bets

1. **Get found (publication).** One official marketplace listing by year end, from a tracked artifact (F3). Every review since August names this gap. Two peers with smaller rigour have larger reach because of it.
2. **Make every guarantee true in code (trust).** The test gate (F2), UAT that runs (F4), the OpenCode 2 plugin (F1), explicit models on every spawn (M39). The audit this quarter showed the docs had drifted ahead of the code in exactly these places.
3. **Prove behaviour beyond one host (evidence).** The portable chain on a second host CLI (MI-104), a baseline arm before any prompt change (M43, MI-114), and live re-runs of the two open findings (R49). This keeps PAN's lead on evals while two peers build theirs.

### 3.2 Horizons

| Horizon | Window | Theme | Items | Exit |
|---|---|---|---|---|
| **H1** | `2026-10` | Correctness and trust | F1 (R45), F2 (R46), M39, R47, R48, the local-marketplace path (RC10) | SC-3, SC-4; no spawn inherits the session model |
| **H2** | `2026-11` | Publication and plan quality | F3 (MI-025, after the owner's decision), M41 Review Focus, M42 executor concerns, the Antigravity variant once `agy` confirms the manifest (MI-026) | SC-1 submitted; plans carry Review Focus |
| **H3** | `2026-12` | Measured behaviour | F4 UAT that runs, MI-104 second-host chain, M43 then M35, R49; F5 cross-AI review lane as a design spike | SC-5, SC-6; open harness findings resolved |

### 3.3 Decisions only the owner can make

| Decision | Blocks | Options | Recommendation |
|---|---|---|---|
| Plugin hosting | F3 | (a) a tracked plugin folder in this repo, committed by the release workflow, submitted through Anthropic's developer portal; (b) a second npm package with `source: npm` | (a): the portal tracks a public repo's folder or tag. It is the model the one listed peer uses (a pinned commit). It keeps a single package |
| Harness spend cap | MI-104, M43, M35, R49 | a per-run `--max-usd` | A standing monthly cap, recorded in `harness/README.md` **Decided `2026-10-12`: none** — per-run `--max-usd` (program §3.4) |
| Gemini API key | Gemini live checks (M33, MI-051) | a key in the environment for live gates only | Provide one, or accept "Gemini behaviour unproven" in COMPARISON |
| ADR-0049 acceptance | none in code; doc truth | accept or amend | Accept: M11 and M12 shipped on it in `3.32.0` **Accepted `2026-10-12`** |

### 3.4 What not to do (re-affirmed for the roadmap)

All the entries carried in the reality check hold. The roadmap adds four:
- **Do not chase runtime count.** Peers list 15 to 48 targets. PAN's answer is proven behaviour on its five (MI-017).
- **Do not add personas or an always-on bootstrap skill.** Both trade progressive disclosure for ceremony (MI-119).
- **Do not emit OpenCode v2 config shapes** while the published schema is v1.
- **Do not ship telemetry to measure reach.** Registry download counts and marketplace install counts are enough (MI-056).

---

## Phase 4: Specifications

### F1 — OpenCode plugin for v1 and v2 (R45, H1, P1, S)

**Problem:** OpenCode 2's loader requires a default export with `id` and `setup` (or `effect`) and throws "Plugin must export a default definition with an id and an effect or setup function". PAN exports `{ id, server }`, so the compaction hand-off is lost on v2. The documented fix (`opencode.ai/v2/docs/build/plugins`, migrate-v1 page) is one object carrying both: v1 calls `server()`, v2 calls `setup()`. It needs OpenCode ≥1.18.29.

**Files**
- `pan-wizard-core/opencode/pan-wizard.js`: add `setup(ctx)`.
- `tests/opencode-plugin.test.cjs`: the export-shape test changes from "`{ id, server }`, nothing else" to "`id`, `server`, `setup`", plus the cases below.
- `docs/HOOKS.md`, `docs/TROUBLESHOOTING.md`: one line each on v2.

**Implementation steps**
1. Factor the existing compaction body into `pushBlock(directory, target)`. It is fail-open and inert outside work in flight.
2. Add `function setup(ctx)`. It resolves the directory like `server` (`ctx.directory || ctx.worktree || process.cwd()`) and calls `ctx.session.hook('compaction', (e) => { … })`. The handler pushes the block onto `e.system` when that is an array. Otherwise it pushes onto `e.context` when that is an array, otherwise it does nothing. Wrap everything in try/catch.
3. Export `module.exports = { id: 'pan-wizard', server, setup }`. Keep CommonJS: the installer writes `{"type":"commonjs"}` above `plugins/`.
4. Live check on `@opencode/cli` 2.0.26 in a scratch home. Install PAN with `--opencode`, start a session with a phase in flight, and run `/compact`. The summary must carry PAN's block. Record the event's actual field names, because `system` was read from the binary, not the docs. If the field differs, change step 2 and its tests before shipping.

**Tests (at least 10)**
- Happy path:
  - (1) `setup` registers exactly one `compaction` hook on a fake `ctx.session`.
  - (2) Firing it with `{ system: [] }` pushes one block equal to the `server` path's block.
  - (3) `server` behaviour is unchanged (the existing parity tests still pass).
  - (4) `PAN_TRACK` routing works through `setup`.
- Edge cases:
  - (5) No `ctx.session` or no `hook` function: `setup` returns without throwing.
  - (6) An event with neither `system` nor `context`: no throw, no write.
  - (7) No phase in flight: nothing pushed.
  - (8) The block is truncated at the same cap.
- Error cases:
  - (9) A throwing `hook` does not escape `setup`.
  - (10) A `.planning/` read error inside the handler is swallowed.
- Runtime-specific:
  - (11) The installer still copies the file byte for byte for OpenCode only.
  - (12) Uninstall still removes it and keeps the user's plugins.

**Runtime matrix:** OpenCode 1.x (≥1.18.29) and 2.x ✅. The other four runtimes are unaffected (no plugin).

### F2 — The test gate enforced in code (R46, H1, P1, M)

**Problem:** The verifier's prompt says a failed or non-running suite means `gaps_found`. The recorder (`verdictFromVerificationFrontmatter` in `pan-wizard-core/bin/lib/verdict.cjs`) only warns `test_gate_failed_under_pass` and keeps `passed`. `workflows/exec-phase.md` routes on the word `findings record --raw` prints. A verifier that writes `status: passed` with `test_gate: failed` therefore completes the phase.

**Files**
- `pan-wizard-core/bin/lib/verdict.cjs`: the frontmatter adapter.
- The `findings record` command module (read `cmdFindingsRecord` first).
- `pan-wizard-core/bin/lib/verify-*.cjs`: the module behind `verify reconcile`.
- Tests: `tests/verdict*.test.cjs` and the reconcile tests.
- `README.md` (revert the interim wording to the stronger claim once true), `docs/CLI-REFERENCE.md`, `agents/pan-verifier.md` (unchanged rule, now backed).

**Implementation steps**
1. In the adapter, when `test_gate === 'failed'` and the outcome is pass, set the outcome to gaps. Add a finding of class `defect` ("the test gate failed under a passed status") and keep the warning text for the trace.
2. In `findings record --raw`, print the adjusted word. exec-phase's routing table then sends the phase to gaps without any prompt change.
3. In `verify reconcile`, treat the same case as a contradiction (exit 1). That covers the auto-advance gate in `transition.md`, which reads the file's own `status:`.
4. Leave `test_gate: skipped` alone. Skipped already surfaces through `not_checked` (MI-064). A missing `test_gate` stays a warning.

**Tests (at least 10)**
- Happy path:
  - (1) passed + gate passed → passed.
  - (2) gaps + gate failed → gaps.
  - (3) passed + gate skipped → passed with `not_checked` intact.
- Edge cases:
  - (4) passed + gate failed → gaps, plus one defect finding.
  - (5) A missing `test_gate` → passed with the existing warning.
  - (6) An unknown gate value → the existing warning, no downgrade.
  - (7) CRLF frontmatter gives the same result.
- Error cases:
  - (8) `reconcile` exits 1 on passed + gate failed and prints why.
  - (9) A verification file with no status → `no_verdict` as today.
- Runtime-specific:
  - (10) The exec-phase routing snippet, run in a sandbox, routes to gaps.
  - (11) The native `pan-exec-waves` script's verification read takes the same path (check how it reads the status).

**Runtime matrix:** all five ✅. The CLI is shared; the change is in the engine, not in host-specific text.

### F3 — Publication pipeline (MI-025, H2, P5, L; needs the hosting decision)

**Design (option a, recommended):**
- A release-workflow job runs `npm run build:plugin`, then commits the result to a tracked `plugins/pan-wizard/` folder (or a `plugin` branch), tagged with the release.
- A root `.claude-plugin/marketplace.json` lists it with a relative source, so `claude plugin marketplace add oharms/PanWizard` works from GitHub.
- The Codex (`.agents/plugins/marketplace.json`) and Copilot (`.github/plugin/marketplace.json`) manifests point at the tracked Agent Plugins bundle, not the untracked `./dist/`.
- Submission goes to Anthropic's developer portal, then the Codex and Copilot default-marketplace processes, and Grok's marketplace, which consumes the Claude format.

**Gates:**
- `claude plugin validate` on the tracked folder.
- A harness live gate that adds the marketplace from the GitHub URL in a scratch home and lists PAN's commands.
- Gate 8 extended: the tracked folder matches a fresh build.

**Risks:**
- A tracked build doubles the diff on each release: a dedicated folder plus a release-only job keeps it out of feature PRs.
- Review latency at each marketplace: start with the one already shown to list peers.

**Runtime matrix:**
- Claude Code: plugin.
- Codex and Copilot: Agent Plugins bundle.
- Gemini and OpenCode: unchanged (npm installer).
- Antigravity: after MI-026.

### F4 — UAT that runs (H3, P4, L)

**Problem:**
- The UAT template (`templates/uat.md`) exists.
- The diagnose workflow (`workflows/diagnose-issues.md`) reads a UAT file and spawns `pan-debugger` per gap.
- The native `pan-diagnose-issues` script does the same on Claude Code.
- But no command writes a UAT file, so the chain never starts. The COMPARISON row is "UAT only as a template no command runs". gsd-core runs UAT inside its verify step.

**Design:**
1. Add a `--uat` mode to `/pan:verify-phase`, as a markdown workflow so it works on all five runtimes.
2. It reads the phase's success criteria from the roadmap slice and the verification report.
3. It walks the user through them one at a time (one question per message, the user's verdict recorded verbatim).
4. It writes `{phase}-uat.md` from the template, with `status: complete` or `status: gaps`, then hands any gaps to `diagnose-issues`: markdown everywhere, the native script on Claude Code.
5. In auto mode it never runs: a human verdict is the point. It prints the command instead.

**Gates:**
- A template round-trip test with `extractFrontmatter`.
- A workflow text test that the mode loads `diagnose-issues.md`.
- A tier-2 harness scenario with a scripted user (the MI-049 driver pattern) that marks one criterion failed and asserts a diagnosed `uat.md` and a gaps plan.

**Runtime matrix:** all five ✅ (markdown). The native diagnosis is Claude Code only, as today.

### F5 — Cross-AI review lane (H3 spike, P5, M; MI-044 WATCH → design)

**Problem:** gsd-core sends plans to other AIs through declared reviewer lanes, and BMAD lets an external model take a review layer. PAN's reviewers are all one model family.

**Design (spike only this quarter):**
- A `review.lanes` config entry names a host CLI already installed (for example `codex exec` or `gemini -p`).
- `/pan:review-deep` runs that lane's prompt on the diff in a read-only mode, and its findings go through the same `findings record` path.

**Spike exit:** one lane runs on this machine with a captured cost, and its findings parse into the ledger.

**Hard constraints:**
- No shell interpolation of the diff.
- A foreign CLI's cost must be readable (the MI-104 parser rule) or the lane is refused.

**Runtime matrix:** a reviewer lane runs from any host. Lanes are opt-in.

---

## Phase 5: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| The v2 compaction event's fields differ from what was read in the binary | F1 ships a no-op on v2 | Medium | The live check in F1 step 4 gates the release; the handler tolerates both `system` and `context` |
| F2 turns a verifier's honest mistake into a stopped phase | Users see more `gaps_found` | Medium | That is the intended behaviour; the gap message names the failed gate and the fix path |
| Publication review rejects or delays the listing | SC-1 slips | Medium | Submit to the channel where a peer is already listed; keep the npm path working throughout |
| A tracked plugin build drifts from the source | Users install stale prompts | Low | Gate 8 extended to compare the tracked folder with a fresh build |
| Cross-host harness runs cost more than planned | H3 slips | Medium | Per-run `--max-usd` approvals; tier 0 stays free and green; cassette replay (program H2) keeps reruns free; model tiers run per release, not per commit |
| UAT mode stalls headless sessions | Auto runs hang | Low | `--uat` refuses auto mode and prints the command |
| Peers' eval labs out-pace PAN's harness | The "measured behaviour" claim weakens | Medium | H3 widens the harness to a second host; COMPARISON states dated, sourced verdicts only |
| OpenCode 1.x users break if PAN writes v2 shapes | Config rejected under the closed v1 schema | High if done | Recorded as a "What not to do" entry |

---

## Sources (read `2026-10-11`)

- Peers:
  - Each project's README, docs and GitHub releases API (`published_at`): `obra/superpowers`, `open-gsd/gsd-core` (default branch `next`), `github/spec-kit`, `bmad-code-org/BMAD-METHOD` (v6 on `V6.12`, v7 on `main`), `Fission-AI/OpenSpec`.
  - Contributor counts from the GitHub API link header.
- Registries:
  - `api.npmjs.org/downloads/point/last-month/<package>` for `pan-wizard`, `bmad-method`, `@opengsd/gsd-core`, `get-shit-done-cc` and `@fission-ai/openspec`.
  - `formulae.brew.sh` for OpenSpec.
  - pypistats for Spec Kit (secondary).
- Marketplaces, raw JSON parsed:
  - `anthropics/claude-plugins-official`
  - `openai/plugins`
  - `github/awesome-copilot`
  - `github/copilot-plugins`
  - `xai-org/plugin-marketplace`
  - `cursor/plugins`
- OpenCode 2:
  - `opencode.ai/v2/docs/{migrate-v1,build/plugins,permissions,config}`
  - `opencode.ai/config.json`
  - strings read (not run) from `@opencode/cli-linux-x64@2.0.26`
- PAN:
  - `docs/ECOSYSTEM-REVIEW-2026-08.md` §11
  - `docs/specs/market-ideas-ledger.md`
  - `docs/specs/market-ideas-2026-10.md` (Addendum)
  - `docs/COMPARISON.md`
  - the code paths cited above.
- Secondary figures: stars, the Superpowers install count, and PyPI downloads. Each is marked where it appears.
