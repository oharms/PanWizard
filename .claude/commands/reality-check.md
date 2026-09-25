---
description: Full reality check of PAN Wizard — claims vs code vs deployed installs, market and runtime delta, peer comparison, optimisation review, and a sized what's-next queue
---

# /reality-check — Product Reality & Market Check

Answer one question with evidence: **where does PAN Wizard actually stand today** — against its own claims, against the five runtimes it targets, against its peers, and against what it costs to run. Then say what is missing, what comes next, and where it can be optimised. $ARGUMENTS

This skill is the repeatable form of the reviews that produced `docs/ECOSYSTEM-REVIEW-2026-06.md`, `docs/ECOSYSTEM-REVIEW-2026-08.md` and `docs/specs/market-delta-2026-09-superplan.md`. Those documents are the format to match and the baseline to diff against.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Analysis and doc writing happen here.
Every install, harness run, or `pan-tools` invocation with `--cwd` goes to `d:\pantesting`. NEVER run `bin/install.js` from this directory. NEVER create `.planning/` here.

---

## MANDATORY: Complete All Phases Without Asking

Execute every phase that the flags leave enabled. Do NOT stop between phases. The only stop is a genuine blocker that needs information only the user has (for example, a spend cap for a model-tier harness run) — record it as **blocked with reason** and continue with everything else.

**Flags** (combine freely):

| Flag | Effect |
|---|---|
| `--quick` | No live web verification. Market phases use the last review + memory notes and mark every external claim **unverified**. Never write a review doc in this mode |
| `--internal` | Phases 0, 1, 4, 5 only — reality and optimisation, no market or peers |
| `--market` | Phases 0, 2, 3, 5 only — market, runtimes and peers, no install or optimisation measurement |
| `--since <YYYY-MM-DD>` | Delta mode: only what changed after this date. Default is the date of the newest `docs/ECOSYSTEM-REVIEW-*.md` (or its latest dated delta section). If that date is today, Phases 2–3 re-verify the day's claims against primary sources instead of scanning anew, and the report says so |
| `--peers <a,b,…>` | Override the default peer roster (see Appendix B) |
| `--no-install` | Skip the deployed-install verification in Phase 1.3 (report it as skipped, never as passed) |
| `--harness <tier>` | Also run the PAN Harness at this tier; tiers ≥1 need `--max-usd <n>` or they are recorded as blocked |
| `--write` | Emit the review document and the sized work plan (Phase 6). Without it, report to chat only |

**Default:** every phase, live verification, no install skipped, harness tier 0, chat report only.

---

## Doctrine (read before Phase 0 — these rules have all bitten before)

1. **Counts live only in `CLAUDE.md`.** No filesystem-derived number (tests, commands, agents, modules, workflows, specs, ADRs, install file counts) goes into any doc this skill writes. State the **class and the command that enumerates it**. `tests/doc-lint.test.cjs` scans `docs/` and fails the suite on a violation. Backtick version-like dates in prose (`` `2026-07-28` `` spec) — the count lint reads "28 spec" as a count.
2. **Model names in live docs are written by capability, not version.** `tests/model-version-drift.test.cjs` rejects version-pinned model names in `docs/` and `README.md`. Dated `docs/ECOSYSTEM-REVIEW-YYYY-MM.md` files, `docs/specs/*`, ADRs and CHANGELOG are exempt — the review doc MAY name versions; the pointers you add to evergreen docs MAY NOT.
3. **A status column is a claim, not evidence.** Every "Done", "Shipped", "Closed" inherited from an older plan is re-verified by grep or by running the thing. The August review found two MCP resources dead since their first milestone because every test injected a fake spawn; a superplan item can be marked done and still be wrong.
4. **Primary sources only for market claims.** Official docs, changelogs, spec repos, pricing pages. Aggregators, blog posts and marketplace self-reported figures are **secondary** and flagged as such. Each external claim carries `source URL · date read`. A changelog line is a release note, **not a tested claim** — say which.
5. **Measure the emitted artifact, not the source.** Skill body sizes are measured on `.agents/skills/*/SKILL.md` after an install (the adapter header adds tokens). MCP resources are read through the **real engine**, not the protocol layer. Installed config paths are checked on disk in `d:\pantesting`, where a dead path looks exactly like a live one until you read it.
6. **Enumeration traps on record.** `grep "name: 'pan-…'"` over `bin/install-lib.cjs` also matches the plugin manifest; `sed`/`awk` ranges over `buildNativeWorkflowScripts` close early on a `}` inside a template literal — read by line number. `.planning/` gets created wherever a `pan-tools` verb runs with `--cwd .` — always `cd d:/pantesting` first.
7. **Never propose retiring what the "What not to do" list protects** without a new finding that overturns the recorded reason. The list is carried forward in Phase 5 and re-affirmed item by item.
8. **No secrets leave the machine.** This skill reads public docs; it never posts anything, never opens PRs, never pushes. `--write` writes files in the checkout and nothing else.
9. **Run the installed engine from the install directory.** `cd d:/pantesting/<run>` before any `node .claude/pan-wizard-core/...` call: the same relative path typed from the source root resolves against the source tree, fails, and looks like a product error. Measure footprints there too — a `cd` in the middle of a compound command silently re-roots every `find` after it. And `npm run harness` appends to the tracked `harness/ledger.jsonl`; that diff is expected, list it.
10. **A scout's number is a lead until a second read of the raw page agrees.** On `2026-09-22` a scout reported GPT-6 prices at double the page and a Codex default that moved the same day; both were caught only because the queue re-read the raw pricing arrays before writing a rate row. Before encoding any price, default model id or event name, re-read it from the raw primary text (curl the page, parse the table or the embedded JSON) on the day you write it.
11. **A runtime-integration test derived from PAN's own table agrees with PAN, not with the runtime.** Every Gemini hook test passed while Gemini skipped three of PAN's four hook keys, because the tests read their event names from `HOOK_EVENT_MAP`. Check emitted config against the runtime's documented vocabulary (`tests/fixtures/hook-vocabulary.json`) and emitted model ids against its documented defaults (`tests/fixtures/documented-default-models.json`), and add a fixture of the same kind for any new integration surface.

---

## Phase 0: Orientation & Baseline

### 0.1 Where the tree is

```bash
git rev-parse --short HEAD && git branch --show-current && git status --porcelain
node -e "console.log(require('./package.json').version)"
git log --oneline -15
```

### 0.2 What the last review said

Read, in this order, and note each one's **date** and **open items**:

- `CLAUDE.md` — rules, structure, counts table (the only numbers you may quote)
- the newest `docs/ECOSYSTEM-REVIEW-*.md` — its planned moves, "What not to do", verification caveats, cadence, and any dated delta sections (§7, §8 …)
- the newest `docs/specs/market-delta-*-superplan.md` — the item table with its Status column (to be re-verified in 1.5)
- `docs/IMPROVEMENT-TODO.md` — the standing backlog and its dated update notes
- `docs/COMPARISON.md` — the peer matrix and its "Last verified" date
- `docs/audits/OUTSTANDING-*.md` — the outstanding-work ledger
- the four most recent `docs/decisions/ADR-*.md` — what was decided since the last review
- `CHANGELOG.md` `[Unreleased]` — what is built but not released
- Memory notes if present: `market-fit-*`, `market-scan-*`, `mcp-first-class-*`, `plugin-distribution-*`, `pan-harness-*` under the project memory dir

Set the **delta window**: `--since` if given, else the newest dated review or delta section. Everything in Phases 2–3 is scoped to what changed inside that window; everything in Phase 1 is checked against the tree as it is now.

### 0.3 Baseline snapshot (chat only — never written to a doc)

```markdown
| Item | Value |
|---|---|
| Tree | <branch> @ <sha>, clean/dirty |
| Version | package.json |
| Last full review | docs/ECOSYSTEM-REVIEW-<date>.md (dated …) |
| Last delta | §N dated … / specs/market-delta-… |
| Delta window | <since> → today |
| Open planned moves (as claimed) | … |
| Rate table verified at | `RATES_VERIFIED_AT` in pan-wizard-core/bin/lib/cost.cjs |
| COMPARISON.md last verified | … |
| Harness ledger | open findings: `node -e "…count unresolved in harness/ledger.jsonl…"` (state the command, quote the count only in chat) |
```

---

## Phase 1: Internal Reality Check (skip with `--market`)

**The question:** does the product do what the docs, the README and the last plan say it does — in the source tree, in the test suite, and in a deployed install?

### 1.1 Suite and gates

```bash
npm run test:all 2>&1 | grep -E '^ℹ (tests|suites|pass|fail|skipped)'
node scripts/release-check.js 2>&1 | tail -20     # all gates; note which one is red, if any
gh run list --limit 5 2>/dev/null                  # CI on the default branch, if gh is authed
```

Record pass/fail per gate. If the suite is not green, everything downstream is provisional — say so at the top of the report.

### 1.2 Claims audit — the README and COMPARISON promises

Extract every capability claim from:

- `README.md` feature list and install section
- `docs/COMPARISON.md` "Where PAN Wizard Leads" and "Where PAN Wizard Matches"
- the last review's §2 mapping table (PAN construct → market primitive → verdict)

For each claim produce one row:

```markdown
| Claim | Where made | Evidence (file:line / test / command) | Verdict |
|---|---|---|---|
| "Every plan executes in a fresh context window" | COMPARISON.md | agents/pan-executor.md frontmatter; workflows/exec-phase.md step … | HOLDS |
| … | … | … | HOLDS / WEAKENED (explain) / FALSE (explain) / UNVERIFIABLE (say what would verify it) |
```

Rules: read the source the claim points at, do not infer from the doc. A claim that only a live model run could verify (behavioural claims like "the verifier catches …") is **UNVERIFIABLE here** unless a harness scenario covers it — name the scenario or its absence.

### 1.3 Deployed-install reality (skip with `--no-install` — then report SKIPPED)

Mirror the harness's artifact-first rule: install from a **packed** tarball, never from the source tree.

```bash
cd d:/pantesting && rm -rf reality-check && mkdir reality-check && cd reality-check
npm pack d:/PanWizard --pack-destination . >/dev/null && tar -xzf pan-wizard-*.tgz
git init -q . && node package/bin/install.js --claude --codex --gemini --opencode --copilot --local
```

Then verify **on disk**, per runtime, the surfaces PAN claims to write (the registration table lives in `bin/install-lib.cjs` — `MCP_REGISTRATION`, `HOOK_EVENT_MAP`, and the skills/agents target dirs):

```markdown
| Runtime | Commands/skills dir | Agents dir | Hooks file + shape | MCP registration file + key | Verdict |
|---|---|---|---|---|---|
| Claude | .claude/commands/pan/ | .claude/agents/ | .claude/settings.json hooks | .mcp.json mcpServers | … |
| Codex | .agents/skills/ | … | .codex/hooks.json | (TOML — snippet only, by design) | … |
| Gemini | … | … | .gemini/settings.json | .gemini/settings.json mcpServers | … |
| OpenCode | … | .opencode/agents/ | … | opencode.json `mcp` (array command, `environment`) | … |
| Copilot | … | … | .github/hooks/… | .github/mcp.json | … |
```

Then exercise the engine and the bridge through the **installed** copies:

```bash
node .claude/pan-wizard-core/bin/pan-tools.cjs models check --cwd .
node .claude/pan-wizard-core/bin/pan-tools.cjs validate health --cwd . ; echo "exit $?"
# bridge: list tools and read every advertised resource through the real engine
node -e "…spawn .claude/pan-wizard-core/mcp/server.cjs, send tools/list + resources/list, then resources/read for each URI, print status per URI…"
```

A resource that returns an engine error on a bare project is a **finding** (it should have been a tool — the rule is written in `tool-registry.cjs`).

Also run the harness at the requested tier (default 0) and read its report:

```bash
cd d:/PanWizard && npm run harness            # tier 0, free
# --harness 1|2 adds: node harness/src/run.cjs --tier <n> --max-usd <cap>   (blocked without a cap)
```

Skipped scenarios (missing CLIs) are listed as **skipped with reason** — they are never green.

### 1.4 Freshness ledger

Everything in the repo that carries a "verified at" or a date, checked against today:

```markdown
| Surface | Date on record | Age | Stale? | Source |
|---|---|---|---|---|
| Rate table | `RATES_VERIFIED_AT` | … | `pan-tools models check` says … | cost.cjs |
| COMPARISON.md | "Last verified" | … | … | |
| Last ecosystem review | … | … | past its own cadence? | |
| Newest ADR | … | … | | |
| Harness ledger | last run id / last resolved | … | | harness/ledger.jsonl |
| TODO/FIXME in shipped source | `grep -rn "TODO\|FIXME\|HACK" bin pan-wizard-core/bin --include=*.js --include=*.cjs` | | | |
| CHANGELOG [Unreleased] | since tag `git describe --tags --abbrev=0` | | built-but-unshipped work | |
```

### 1.5 Open-move ledger — re-verify every inherited status

Take every planned move and item from the newest review and superplan. For each one marked Done/Closed/Shipped, **prove it** with a grep, a test name, or a file on disk. For each Blocked/Parked, re-check whether the blocker still exists (a missing CLI, a missing harness, a missing spend cap).

```markdown
| Source | Item | Claimed status | Evidence now | Verified status |
|---|---|---|---|---|
| ECOSYSTEM-REVIEW-2026-08 §3.2 | native workflows | open → S4 done | `grep -oE "^  name: 'pan-[a-z-]+'," bin/install-lib.cjs`; tests/native-workflows-drift.test.cjs | … |
| market-delta-2026-09 item 5c | behavioural gate | blocked (harness gone) | harness/scenarios/native-exec-waves-chain.json exists; tier 2 needs `--max-usd` | still blocked on spend / now runnable |
```

A status that does not survive verification is a **P1 finding** in its own right (the doc is wrong), separate from whatever the code does.

---

## Phase 2: Market & Runtime Delta (skip with `--internal`; `--quick` = from memory, all rows UNVERIFIED)

**The question:** since the delta window opened, what changed in the surfaces PAN writes to, the standards PAN implements, and the models PAN prices — and which of PAN's assumptions did each change break or confirm?

Use `WebFetch` on the primary sources in Appendix A and `WebSearch` only to *locate* a primary source, never as the source itself. Read changelogs from the window start forward.

### 2.1 Per-runtime surface check (the installer's assumptions)

For each of the five runtimes, plus Antigravity as a consumer of the shared `.agents/` tree:

```markdown
| Runtime | Surface PAN writes | Still documented as live? | Changed how? | Source · date | Bearing on PAN |
|---|---|---|---|---|---|
| Claude Code | .claude/commands, agents frontmatter fields, settings.json hooks, .mcp.json, plugin manifest, workflows/ | … | … | code.claude.com/docs/… · … | … |
| Codex | .agents/skills, .codex/hooks.json shape, config.toml mcp_servers, .agents/plugins/marketplace.json | … | … | … | … |
| Gemini CLI | .gemini/ commands/agents, settings.json hooks + mcpServers, extension manifest, trust filtering | … | … | … | … |
| OpenCode | .opencode/agents, opencode.json `mcp` shape, skills from .agents/skills | … | … | … | … |
| Copilot CLI | .github/ agents, hooks, mcp.json, plugin namespace, marketplace.json | … | … | … | … |
| Antigravity | .agents/plugins/<name>/ discovery, plugin.json variant | … | … | … | … |
```

Also record per runtime: new frontmatter fields PAN could emit (and ADR-0028's rule that unverified frontmatter waits for a live check), deprecations affecting anything PAN emits, and new **hook events / handler types** PAN's observers could use.

### 2.2 Standards PAN implements

| Standard | What PAN emits | Spec revision at window start | Now | Delta | Source |
|---|---|---|---|---|---|
| Agent Skills (`SKILL.md`) | unified skills via `convertClaudeCommandToUnifiedSkill` | | | fields / rules / body budget | agentskills.io |
| Agent Plugins | `dist/pan-agent-plugin/` (ADR-0045) | | | plugin.json closed key set, mcp.json shape, vendor dirs | agentplugins spec repo |
| MCP | `pan-wizard-core/mcp/` dual-era (ADR-0041) | | | revision, deprecations, extensions | modelcontextprotocol.io |
| AGENTS.md | installer's AGENTS.md section | | | | |
| Claude Code plugins / marketplaces | `dist/pan-wizard-plugin/`, `marketplace/` | | | manifest keys, source kinds, `mode` support per OS | |

### 2.3 Models and pricing (the ledger's correctness)

```bash
node pan-wizard-core/bin/pan-tools.cjs models check          # staleness flag; safe from the source root (no --cwd)
grep -nE "^\s+'claude-[a-z0-9.-]+'" pan-wizard-core/bin/lib/cost.cjs   # rows present
```

Compare each row against the **provider pricing page** read today. Rules from the last plan: **never add a rate without a primary pricing citation**; cache multipliers are per family and one current family departs from the convention — check the multiplier, not just base rates. Note new model ids seen in the runtimes' defaults that the table lacks, as "unpriced — do not add without a source". Note changes to the default model each runtime ships with (PAN's installer recommends a flagship; it must follow the host tool's default).

### 2.4 Distribution channels

Where does PAN reach a user today, and where could it: npm (`latest`, provenance), Claude plugin via `command`-source marketplace, Agent Plugins bundle via Copilot/Codex marketplaces, skills marketplaces (indexed, uncertified — the recorded reason not to chase them). For each channel: present / built-not-published / absent, and what changed in the window.

---

## Phase 3: Peer Comparison (skip with `--internal`)

**The question:** against its peers, where is PAN ahead, at parity, behind, or absent — and did the market move toward or away from PAN's thesis in the window?

### 3.1 Roster

Two tiers, because they answer different questions:

- **Direct peers — spec-driven / orchestration layers** (the category PAN competes in): default roster in Appendix B. Check each one's release feed inside the window: last release date, what shipped, delivery channel (CLI, MCP, plugin, skills), which of PAN's dimensions it now touches.
- **Host-tool natives** (the runtimes' own orchestration: Claude Code workflows/subagents/plugins, Codex plugins/hooks, Copilot agents, Gemini/Antigravity extensions): these are not competitors — they are the substrate PAN layers on, and each native feature that lands is either something PAN should **use** or something that makes a PAN feature **redundant**. Classify each.
- **IDE/agent peers** in `docs/COMPARISON.md` (Aider, Cursor, Cline, Continue, Windsurf, Copilot, Devin): refresh only the rows that changed; these define the matrix's columns, not PAN's roadmap.

### 3.2 The dimension matrix

Rows come from two places and must stay stable across runs so the reviews diff cleanly: the `docs/COMPARISON.md` dimensions and the last review's §2 construct mapping. Add a row only for a **new** market primitive.

```markdown
| Dimension | PAN today (evidence) | Best peer + how | Verdict | Trend in window |
|---|---|---|---|---|
| Durable planning state (`.planning/`) | … | none standardises it | AHEAD — moat | unchanged |
| Deterministic orchestration | native workflows on Claude; markdown elsewhere | Claude Code workflows | PARITY on Claude / AHEAD on portability | converging |
| Behavioural evals against deployed installs | harness/ tier 0–2 | rare in category | AHEAD | … |
| Plugin distribution | built; Claude marketplace via command source; Agent Plugins bundle | Spec Kit extensions, Taskmaster MCP | BEHIND — published nowhere | … |
| … | | | AHEAD / PARITY / BEHIND / MISSING / OUT-OF-SCOPE (by decision — cite the doc) | |
```

Verdict rules: **AHEAD** needs evidence that no listed peer has it. **MISSING** means PAN has nothing on the row; **BEHIND** means PAN has something weaker. **OUT-OF-SCOPE** is legal only when a recorded decision says so (COMPARISON.md "Intentionally Doesn't Compete" or a "What not to do" entry) — otherwise it is MISSING.

### 3.3 Convergence check

One paragraph, with evidence: did the window's changes move the market **onto** PAN's thesis (progressive disclosure, isolated-context subagents, state discipline, deterministic orchestration, behavioural evals) or **away** from it? Name the concrete releases that argue each way. The August verdict was "converged on it; the gap is packaging". State whether that still holds.

---

## Phase 4: Optimisation Review (skip with `--market`)

**The question:** what does PAN cost to run, install and maintain, and where is the waste? Every row is a measurement with its command; numbers appear in chat, never in the written docs (state the command there).

### 4.1 Context and token footprint (the user's cost)

```bash
# description budget: what every session loads before doing anything
node -e "…sum chars of the description: line across commands/pan/*.md and agents/*.md, /4 → tokens…"
# body budget offenders — measure the EMITTED skill after an install in d:/pantesting with --unified-skills
for f in d:/pantesting/reality-check/.agents/skills/*/SKILL.md; do t=$(( $(wc -c < "$f") / 4 )); [ $t -gt 5000 ] && printf "%6d  %s\n" "$t" "$f"; done | sort -rn
```

Cross-check with `/skill-doctor` if a live Claude Code session is available (it reports unused loaded skills and their context cost). Read ADR-0044 and the `context-budget` verb's `cache` section: is the cache posture PAN recommends still the right one for the current default model's cache pricing and the runtime's per-bucket TTL controls?

### 4.2 Install footprint and duplication

```bash
cd d:/pantesting/reality-check && for d in .claude .codex .gemini .opencode .github .agents; do [ -d $d ] && echo "$d: $(find $d -type f | wc -l) files, $(du -sk $d | cut -f1) KB"; done
node -e "…read the pan-file-manifest.json(s), group by extension and by top-level dir, print shares…"
```

Look for: the same content copied per runtime where the shared `.agents/` tree could serve it (ADR-0028's direction), dead config paths (a file the runtime no longer reads — cross-reference 2.1), files installed for a runtime that was not selected.

### 4.3 Engine and ledger accuracy

- Rate table vs pricing pages (from 2.3) → the size of the error on the **default** model, in words ("cache reads over-billed by roughly N×").
- Model profiles (`MODEL_PROFILES` in `pan-wizard-core/bin/lib/core.cjs`) vs the current lineup each runtime defaults to: any tier alias pointing at a superseded model?
- `pan-tools cost` / `context-budget` outputs on the harness seeds: do they run clean on a bare project (the resource/tool rule)?

### 4.4 Suite and build health (the maintainer's cost)

```bash
time npm run test:all >/dev/null 2>&1          # wall time; note it in chat only
grep -rn "skip(\|todo(" tests/*.test.cjs tests/scenarios/*.test.cjs | wc -l   # skipped/todo tests — list them
node scripts/release-check.js 2>&1 | grep -iE "gate|passed|failed" | head    # gate count + time if printed
```

Known classes to check for: files that rebuild `dist/` in place and race under `node --test` parallelism (the plugin-build race), temp-dir cleanup retries, tests that inject fakes for a path with no real-engine coverage (the dead-resource class).

### 4.5 Developer and user experience

- Install time for all five runtimes (from 1.3, wall clock).
- Onboarding path: does `README.md`'s first command still work verbatim on the packed install?
- Troubleshooting coverage: does `docs/TROUBLESHOOTING.md` mention each runtime-side change found in 2.1 that a user would hit (trust filtering, ignored frontmatter on older builds, etc.)?

Each optimisation candidate gets a row: `| Waste observed | Measurement (command) | Likely fix | Size |`.

---

## Phase 5: What's Missing, What's Next

Synthesis. Everything above feeds one findings table and one sized queue in the `/superplan` shape so `/execplan` can consume it.

### 5.1 Findings table

```markdown
| # | Finding (verified <date>) | Phase | Bearing on PAN | Class |
|---|---|---|---|---|
| F1 | … | 1.5 | a Done status that is not done | P1 WRONG |
| F2 | … | 2.1 | a config path a runtime stopped reading | P4 FEATURE GAP |
| … | | | | |
```

Classes (from `/superplan`): **P0 BROKEN** · **P1 WRONG** (silent incorrect output, false docs) · **P2 STABILITY** · **P3 MISSING TESTS** · **P4 FEATURE GAPS** (runtime coverage) · **P5 NEW FEATURES** · **P6 DOCUMENTATION** · **P7 POLISH**. Sizes XS 1 · S 2 · M 4 · L 10 · XL 20.

### 5.2 Gap verdicts

From the Phase 3 matrix, three short lists with one line of evidence each:

- **Missing** — rows with no PAN answer and no recorded out-of-scope decision.
- **Behind** — rows where a peer or a host-tool native does it better, and what "better" concretely is.
- **Ahead / moat** — what to protect, and the specific market move that would threaten it.

### 5.3 Planned moves

At most three, ordered by leverage per unit of effort, each with: finding as evidence · decision · phasing · **gate** (the test or measurement that proves it landed) · risk. Completions before new architecture. If a move from the previous review is still open, it stays first unless a new finding outranks it — say why.

### 5.4 Sized item queue

```markdown
| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
```

Then a session queue at roughly forty points each, P0/P1 first, packaging before behaviour (the recorded rationale: behavioural moves carry the only real risk and should ship inside packaging that already exists).

### 5.5 What not to do — carried forward and re-affirmed

List every entry from the previous review's "What not to do" and the superplan's additions. For each: **still holds (reason unchanged)** or **overturned by finding F#**. Add new entries only with a reason. Current inherited entries include: do not derive a runtime-integration test from the installer's own table alone (`2026-09-22`) · do not retire the markdown workflows · do not chase a sixth runtime · do not standardise `.planning/` · do not soften the behavioural harness · do not list on a skills marketplace on quality grounds alone · do not fork the skills compiler · do not emit frontmatter a runtime has not been seen to read · do not add a model rate without a primary citation.

### 5.6 Verification caveats and cadence

- Every claim that rests on a secondary source or a changelog line only — list them; each is a gate before building.
- What could not be run here (missing CLIs, no spend cap, no live session) — list with the exact command that would run it elsewhere.
- **Cadence**: the previous reviews aged usefully in about two months. Set the next re-run date and say what would trigger an earlier one (a spec revision, a runtime dropping a path PAN writes, a default-model change).

---

## Phase 6: Report and Write-back

### 6.1 Chat report (always)

Lead with the verdict in three sentences: suite/gates state, the one-line convergence read, and the single highest-leverage move. Then the baseline table, the findings table, the gap verdicts, the session queue, and the caveats. Numbers are fine here.

### 6.2 Written artifacts (only with `--write`)

| Artifact | When | Rules |
|---|---|---|
| `docs/ECOSYSTEM-REVIEW-<YYYY-MM>.md` | a full run (not `--quick`, not `--internal`) whose window spans ≥ the previous review's cadence | Header: Date · Tree @ sha (version, clean/dirty) · Predecessor link. Sections mirror the August review: What changed · The mapping · Planned moves · What not to do · Verification caveats · Recommended sequence. **No counts** — name the class and the command. Version-pinned model names are allowed here (dated file, exempt). Link every source |
| a new dated `§N` delta section appended to the newest review | a delta run inside the cadence | Same rules; one table plus a pointer to the queue file |
| `docs/specs/market-delta-<YYYY-MM>-superplan.md` | whenever Phase 5 produced items | The `/superplan` shape (Baseline · Findings · Priority classes · Items · Session queue · What not to do · Sources). Bump the **Specs** row in `CLAUDE.md`'s counts table by the snippet at the top of that file. If the month's file already exists, append a dated **Addendum** section to it instead of creating a second file: prefix finding ids `RC` and item ids `R`, continue the session numbering, add a "Corrections to this plan" list for every inherited row the run refuted, and skip the counts-table bump |
| `docs/IMPROVEMENT-TODO.md` dated update note + a pointer from the previous review | when a new review or queue file was written | Evergreen docs: **no counts, no version-pinned model names** |
| `docs/COMPARISON.md` "Last verified" | only for rows actually re-verified in Phase 3 | Update the rows and the date together, never the date alone |
| Memory note `market-scan-<YYYY-MM>` (or update the existing one) | always on a `--write` run | Facts that are not derivable from the repo: what was refuted, traps hit, blockers and their reasons |

Never edit `CHANGELOG.md` past entries; never touch `docs/SKILLS-*.md` by hand (generated by `python scripts/generate-skills-docs.py`).

### 6.3 Post-write gate (mandatory after any write)

```bash
node --test tests/doc-lint.test.cjs tests/model-version-drift.test.cjs tests/claude-md-counts.test.cjs 2>&1 | grep -E '^ℹ (pass|fail)'
```

A red result means a count or a version-pinned model name leaked into an evergreen doc, or the `CLAUDE.md` specs row was not bumped — fix the doc, not the test. Then `git status --porcelain` and list every file touched. Do **not** commit; the user decides (use `/commit`).

---

## Appendix A — Primary sources (locate with WebSearch, read with WebFetch)

| Area | Sources |
|---|---|
| Claude Code | `code.claude.com/docs/en/changelog`, `/sub-agents`, `/skills`, `/plugins`, `/plugin-marketplaces`, `/workflows`, `/hooks`, `/mcp`, `/settings`, `/prompt-caching` |
| Anthropic pricing | `platform.claude.com/docs/en/about-claude/pricing` (the page, not a blog) |
| Codex | `developers.openai.com/codex/*` (may redirect to `learn.chatgpt.com/docs/*`), `developers.openai.com/plugins/build/plugins`, Codex GitHub releases |
| Gemini CLI / Antigravity | Gemini CLI GitHub releases + docs; Antigravity plugin docs |
| OpenCode | `opencode.ai/docs/*` (config, agents, skills, mcp) |
| Copilot CLI | `docs.github.com/en/copilot/*` (CLI, custom agents, hooks, plugins), `github.blog/changelog` |
| Agent Skills | `agentskills.io` spec |
| Agent Plugins | `agent-plugins.org`, `github.com/agentplugins/agent-plugins-spec` (schemas + `/specification`) |
| MCP | `modelcontextprotocol.io/specification/*`, `blog.modelcontextprotocol.io` |
| AGENTS.md | `agents.md` |
| Peers | each project's GitHub releases page (Appendix B) |

Method notes on record: the official Claude Code changelog has skipped version ranges the docs still cite — a gap is editorial, not missing features; some Codex doc paths 308-redirect; the Codex plugins landing page fetches nav-only — use the format doc path above.

## Appendix B — Default peer roster

**Direct (spec-driven / orchestration):** GitHub Spec Kit (`github/spec-kit`) · BMAD Method (`bmad-code-org/BMAD-METHOD`) · gsd-core (`open-gsd/gsd-core`, the continuation of Get Shit Done — the original `gsd-build/get-shit-done` was archived on `2026-06-26`, so a release check against it reads as dormant) · Superpowers (`obra/superpowers`) · OpenSpec (`Fission-AI/OpenSpec`, added `2026-09-10`) · Taskmaster (`eyaltoledano/claude-task-master`, dormant since `2026-03-31`; drop after a year without a release) · any new entrant found in the window that lists in the same category. Pin release dates from the GitHub releases API (`published_at`): the rendered releases page hides the year on current-year releases and has produced wrong-year readings.

**Host-tool natives (substrate, not competitors):** Claude Code workflows + subagents + plugins · Codex plugins + hooks · Copilot custom agents + plugins · Gemini CLI extensions / Antigravity plugins · OpenCode agents + skills.

**IDE/agent peers (COMPARISON.md columns):** Aider · Cursor · Continue.dev · Cline · Windsurf · GitHub Copilot · Devin.

Override with `--peers a,b,c`. A peer is worth a row only if it shipped inside the window or touches a dimension where PAN's verdict could change.

## Appendix C — Dimensions (stable row set)

Durable planning state · Research-before-planning · Plan verification · Post-execution verification + UAT · Context-rot prevention (fresh context per unit) · Deterministic orchestration · Multi-agent fan-out · Session persistence / resume · Cross-runtime portability · Model routing + cost control · Cost ledger accuracy · Progressive disclosure (skills tiers) · Plugin/marketplace distribution · MCP exposure of the engine · Behavioural evals against deployed installs · Hooks coverage per runtime · Zero runtime dependencies · Security posture (allowlists, no-shell spawn, forbidden verbs) · Documentation trust (counts SSoT, lint gates).

Add a row only for a genuinely new market primitive; note the addition in the review so the next diff is honest.
