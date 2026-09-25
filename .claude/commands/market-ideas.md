---
description: Market idea scan for PAN Wizard — what shipped in the agent-tooling market (host tools, direct peers, new entrants, standards) since the last scan, triaged against the code and the ideas ledger into adopt / adapt / watch / skip, with a sized queue
---

# /market-ideas — Market Idea Scan

Answer one question with evidence: **what has the market shipped that PAN Wizard should take, adapt, watch or deliberately skip?** Then hand the "take" and "adapt" rows to `/execplan` as a sized queue. $ARGUMENTS

This skill is the sibling of `/reality-check`. That one asks *where does PAN stand* (claims vs code vs installs vs peers) and writes review documents. This one asks *what should PAN steal*, and its output is an **ideas ledger** that grows across runs so no idea is proposed twice and no rejected idea comes back without a new fact. Run it between reality checks; hand anything it finds about a **path PAN writes** that changed (a deprecation, a moved config file) to `/reality-check` rather than triaging it here.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Reading, triage and doc writing happen here.
NEVER run `bin/install.js` from this directory. NEVER create `.planning/` here. Any `pan-tools` call with `--cwd` goes to `d:\pantesting`. This skill needs no install at all — if you find yourself installing, you have drifted into `/reality-check`'s job.

---

## MANDATORY: Complete All Phases Without Asking

Execute every phase the flags leave enabled. Do NOT stop between phases. The only legal stop is a blocker that needs information only the user has; record it as **blocked with reason** and continue with everything else. The scouts run in the background — write the ledger seed, prepare the triage commands and read the local state while they run; never idle.

**Flags** (combine freely):

| Flag | Effect |
|---|---|
| `--since <YYYY-MM-DD>` | Delta window start. Default: the newest dated scan in the ledger's run log, else the newest dated section of the newest `docs/ECOSYSTEM-REVIEW-*.md` |
| `--full` | Landscape sweep, not only the delta: scouts also report features peers have had for a while that PAN lacks. Use on the first run and roughly quarterly |
| `--quick` | No web. Triage from memory notes and the ledger only; every external row is marked **UNVERIFIED**; never write with this flag |
| `--peers <a,b,…>` | Override the direct-peer roster (canonical roster: `/reality-check` Appendix B — keep the two in sync, do not fork it) |
| `--topics <a,b,…>` | Extra search themes for the entrants scout (for example `memory,evals,teams`) |
| `--max-ideas <n>` | Cap the triaged table (default 40; scouts may return more, triage the rest as one "not triaged" line) |
| `--write` | Update the ledger, write the dated queue file, the memory note and the pointer (Phase 3.2). Without it, chat report only |

**Default:** delta window from the last scan, live verification, chat report only.

---

## Doctrine (read before Phase 0 — every rule here has bitten before)

1. **An idea is a shipped capability with a primary source.** Official docs, changelogs, GitHub releases API, spec repos, a project's own README. Blog posts, aggregators, star counts and "used by" figures are **secondary** — a row may cite them to *locate* the idea, never as the fact. A changelog line is a release note, not a tested claim; say which. Dates come from the releases API `published_at` — the rendered GitHub page hides the year and has produced wrong-year readings.
2. **Dedupe by concept, not by wording.** Before triaging a candidate, search the ledger (`docs/specs/market-ideas-ledger.md`) for the *concept*: `maxTurns` and "turn caps on subagents" are one idea. A ledger row with status SKIP or DECLINED is re-opened only by a **new fact** that overturns the recorded reason — name the fact in the row. A row with WATCH is re-checked against its recorded trigger every run.
3. **PAN status comes from grep, not from memory.** Memory said "zero MCP in install.js" once and it was true; a month later it was false. For every candidate run the triage grep in Phase 2.2 and cite the file. HAVE / PARTIAL / MISSING are code verdicts; DECLINED cites the ADR or list entry.
4. **The thesis is the filter.** PAN's five pillars — progressive disclosure, isolated-context subagents (fresh context per unit of work), state discipline in `.planning/`, deterministic orchestration where control flow is knowable pre-run, behavioural evals against deployed installs — plus its constraints: zero runtime dependencies, five runtimes with markdown as the portable path, Claude-only features are additive and never a migration. An idea that trades a pillar for convenience is a SKIP however popular it is (ADR-0046 is six worked examples). A host-tool primitive that makes a PAN feature redundant is an **ADAPT** (use the primitive, retire the duplicate), not a SKIP.
5. **Counts live only in `CLAUDE.md`.** No filesystem-derived number goes into anything this skill writes. Name the class and the command that enumerates it. `tests/doc-lint.test.cjs` fails the suite on a violation. Backtick version-like dates in prose.
6. **Model names by version are legal only under `docs/specs/`, `docs/decisions/`, `CHANGELOG.md` and dated review files.** The ledger and the queue file live under `docs/specs/` for exactly this reason. The pointer you add to `docs/IMPROVEMENT-TODO.md` is evergreen: capability phrasing only ("the newest Fable-tier model"). `tests/model-version-drift.test.cjs` enforces it.
7. **Never write "no competitor does this" or "nobody else".** You only see what you read. Say "not found in the roster on `<date>`".
8. **A same-window re-run re-verifies, it does not re-scan.** If the window is under a week, the scouts' job is to confirm or refute the last run's rows against the same sources, and the report says so.
9. **No secrets leave the machine and nothing is published.** This skill reads public pages; it never posts, opens PRs, pushes or commits. `--write` writes files in the checkout and nothing else; the user commits with `/commit`.
10. **The scouts return tables; the main session owns every verdict.** A scout may say which PAN feature an idea touches; it may not say ADOPT or SKIP. Three scouts, in parallel, in the background — the September run finished in about twenty minutes that way; serial fetching took hours.
11. **Bash-tool traps on record.** Heredocs halve backslashes and choke on long content — write files with the Write tool. `node -p require('/d/...')` fails on Windows; use `D:/...`. A `cd` mid-chain re-roots every later command **and moves the session's working directory** — prefix every command with `cd D:/PanWizard &&` rather than relying on state.
12. **A WATCH trigger can be fired by PAN's own releases, not only by the market.** The `maxTurns` row waited for "a native workflow owning the executor spawns"; `pan-exec-waves` shipped and nobody re-read the row. Re-check every WATCH trigger against `CHANGELOG.md` as well as the scouts' tables.

### Method notes on record (from the runs so far)

- **WebFetch's summariser invents list entries on large JSON or long tables.** Three reads of the official plugin `marketplace.json` returned three different totals and fabricated names. Parse raw JSON with `curl … | node -e` (or `gh api … --jq`) and never quote a summary of a list.
- **`raw.githubusercontent.com/<owner>/<repo>/main/…` 404s when the default branch is `master`.** Read `default_branch` first (`gh api repos/<o>/<r> --jq .default_branch`) or fetch the README with `gh api repos/<o>/<r>/readme -H "Accept: application/vnd.github.raw"`.
- **The GitHub releases API defaults to 30 items** — on a busy repo (Codex) that does not reach a two-week window start. Use `per_page=100`.
- **The Claude Code changelog carries no dates.** Date a version from the npm registry: `npm view @anthropic-ai/claude-code time --json`. The `stable` dist-tag lags `latest` by a dozen versions; WATCH triggers should name which one.
- **Big docs pages overflow WebFetch** (settings, memory, plugin-evals) — the tool persists the page to a file; grep that file instead of re-fetching.
- **Re-read before encoding.** A scout's number is a lead: on `2026-09-22` one reported GPT-6 prices at double the page. Any price, default id or event name an item will write into the tree is re-read from the raw primary text on the day it is written.
- **Timing:** three scouts in parallel took 12–20 minutes each (85–134 fetches apiece); the peers scout is the slow one. Launch them before reading anything local.

---

## Phase 0: Orientation & Baseline

### 0.1 Where the tree is

```bash
git rev-parse --short HEAD && git branch --show-current && git status --porcelain
node -e "console.log(require('./package.json').version)"
git log --oneline -10
git tag --sort=-creatordate | head -3
```

### 0.2 What is already decided

Read, in this order, and note each one's date:

- `docs/specs/market-ideas-ledger.md` — **the dedupe record.** Every row's id, status and trigger. Its run log sets the default window
- the newest `docs/ECOSYSTEM-REVIEW-*.md` — the planned moves, "What not to do", and every dated delta section
- the newest `docs/specs/market-delta-*-superplan.md` and `docs/specs/market-ideas-*.md` — item tables with Status columns (a status is a claim; the ledger row is what you trust after Phase 2.2 verifies it)
- `docs/COMPARISON.md` "Direct Peers" table and its checked date — the dimension-level read this skill goes beneath
- the four newest `docs/decisions/ADR-*.md` — decisions since the last scan, each a potential SKIP reason or a revisit trigger
- `CHANGELOG.md` `[Unreleased]` — built but not shipped; a candidate that is already there is HAVE
- memory notes `market-scan-*`, `market-fit-*`, `market-ideas-*` under the project memory directory — refuted claims and traps, so the scouts' prompts carry them

Set the **delta window**: `--since` if given, else the newest run in the ledger's run log, else the newest dated section of the newest review. Under seven days ⇒ doctrine 8 applies.

### 0.3 Baseline snapshot (chat only)

```markdown
| Item | Value |
|---|---|
| Tree | <branch> @ <sha>, clean/dirty |
| Version | package.json; newest tag |
| Ledger | rows by status (state the command: `grep -cE "^\| MI-" docs/specs/market-ideas-ledger.md` — quote the number only in chat) |
| Last scan | ledger run log / newest dated section |
| Delta window | <since> → today; landscape sweep yes/no |
| Rate table verified at | `RATES_VERIFIED_AT` in pan-wizard-core/bin/lib/cost.cjs |
| Host-tool versions on this machine | `claude --version`; the others "absent" if not installed |
```

---

## Phase 1: Source Sweep (skip with `--quick`)

Launch **three background scouts in one message** (general-purpose agents with web tools), then continue with Phase 2.1 while they run. Each scout gets: today's date, the window, the `--full` flag's meaning, the **PAN capability blurb** (Appendix A), the **already-decided list** (the ledger's SKIP/DECLINED/WATCH rows, so a scout can flag "new fact" instead of re-finding), the rules (doctrine 1, 7, 10), and the exact output table it must return. Do not let a scout write to the repository.

| Scout | Question | Sources (canonical list: `/reality-check` Appendix A) | Returns |
|---|---|---|---|
| **A — Host-tool natives** | What did Claude Code, Codex, Gemini CLI / Antigravity, OpenCode and Copilot CLI ship that PAN could USE, that makes a PAN feature REDUNDANT, or that CHANGES a path PAN writes? | raw Claude Code CHANGELOG + `code.claude.com/docs`; Codex releases API + docs; Gemini CLI releases API + `geminicli.com/docs` + `antigravity.google/docs`; OpenCode releases API + `opencode.ai/docs`; Copilot CLI releases API + `github.blog/changelog` + `docs.github.com/en/copilot` | `| # | Runtime | Candidate (version/date) | What it does | Kind USE/REDUNDANT/PATH-CHANGE/MODEL | PAN surface touched | Source · date · primary/secondary |` + a path-risk summary per runtime + default models seen |
| **B — Direct peers** | What do the roster peers ship that PAN lacks or does differently, and what did they release in the window? (`--full`: feature-level landscape, not only the delta) | releases API + README/docs for each peer in `/reality-check` Appendix B, plus the official Claude plugin catalogue | `| Peer | Version | published_at | What shipped | Source |` then `| # | Peer | Candidate feature | What it does | PAN feature/gap touched | Source · date · primary/secondary |` + roadmap signals marked as unshipped |
| **C — New entrants, standards, patterns** | Which frameworks that install into coding agents appeared or rose since the last scan (not in the roster)? What changed in Agent Skills, Agent Plugins, MCP, AGENTS.md? What did the vendors publish on context engineering, memory, multi-agent, evals, cost? | WebSearch to locate (`--topics` adds themes), then each repo's README + releases API; `agentskills.io`, `agent-plugins.org` + spec repo, `modelcontextprotocol.io` + blog, `agents.md`; vendor engineering blogs in the window | entrants table (project, what, runtimes, delivery, last release date, stars **secondary**, idea for PAN, source); standards delta table; patterns table |

Scout rules to paste verbatim: *WebSearch only to locate, WebFetch to read. Every row carries `source URL · date read · primary/secondary`. Pin dates from the GitHub releases API `published_at`. Do not assign PAN verdicts. Prefer shipped capabilities over roadmap talk. Cap rows; quality over quantity. Report dead ends (failed URLs, redirects, nav-only pages).*

Method notes on record for the scouts: the official Claude Code changelog skips version ranges the docs still cite; `developers.openai.com/codex/*` 308-redirects to `learn.chatgpt.com/docs/*`; the Codex plugins landing page fetches nav-only — use the format doc; Anthropic's model-config page is the only source for "default model" claims (a Fable model has never been a plan default).

---

## Phase 2: Triage (the main session's job)

### 2.1 Prepare while the scouts run

Build the **already-decided index** from the ledger (id → concept → status → reason/trigger) and the **PAN surface index** — the lists that make the grep in 2.2 fast:

```bash
ls commands/pan agents pan-wizard-core/workflows pan-wizard-core/bin/lib pan-wizard-core/mcp hooks
grep -nE "^  '(claude|gpt|gemini)[a-z0-9.-]*'" pan-wizard-core/bin/lib/cost.cjs      # priced ids
grep -nE "^const (MCP_REGISTRATION|HOOK_EVENT_MAP)" bin/install-lib.cjs             # per-runtime surfaces
grep -oE "^  name: 'pan-[a-z-]+'," bin/install-lib.cjs                             # native workflow scripts (the recorded enumeration trap: this form, not a loose grep)
```

### 2.2 One row per candidate

Merge the three scout tables, dedupe by concept (doctrine 2), then for **each** candidate:

1. **Ledger check** — existing id? If SKIP/DECLINED: is there a new fact? If none, the row is `SEEN — MI-nnn SKIP holds` and stops here. If WATCH: has the trigger fired?
2. **PAN status by grep** — search the shipped surface for the concept and its synonyms; cite the file or say "no hit":
   ```bash
   grep -rilE "<kw1>|<kw2>" commands/pan agents pan-wizard-core/workflows pan-wizard-core/bin/lib pan-wizard-core/mcp hooks bin/install-lib.cjs bin/install.js docs/decisions | head
   ```
   HAVE (shipped, cite) · PARTIAL (a weaker or Claude-only form, say which) · MISSING (no hit) · DECLINED (ADR / list entry).
3. **Fit** — which pillar it serves or threatens (doctrine 4); portability (all five runtimes / Claude-only additive / not applicable).
4. **Size** — XS 1 · S 2 · M 4 · L 10 · XL 20 points, and the **gate** that would prove it landed (a test, a harness scenario, a measurement).
5. **Verdict** — **ADOPT** (take it as is) · **ADAPT** (take the primitive, drop the duplicate; or take the idea in PAN's idiom) · **WATCH** (not yet — record the trigger: a CLI on this machine, a spec leaving draft, a peer's feature stabilising, a live-check per ADR-0028) · **SKIP** (record the reason; a thesis conflict or a "What not to do" entry is a complete reason).

```markdown
| # | Idea (concept) | Who ships it (version · date) | PAN status (evidence) | Fit / portability | Verdict | Size | Gate | Source |
|---|---|---|---|---|---|---|---|---|
```

Verdict rules: ADOPT and ADAPT need a MISSING or PARTIAL status **and** a named gate. A REDUNDANT-kind row from scout A is ADAPT by default. A candidate resting only on secondary sources is WATCH with trigger "primary source". Anything a "What not to do" entry covers is SKIP unless a new fact is named. Any PATH-CHANGE row is not triaged here — list it under **Hand-offs to `/reality-check`**.

### 2.3 Convergence line

One paragraph: did the window's ideas move the market **onto** PAN's thesis or **away**? Name the releases that argue each way. The last recorded read ("converged on the thesis; the gap is publication and positioning", `2026-09-10`) either holds or is amended, with the evidence.

---

## Phase 3: Report and Write-back

### 3.1 Chat report (always)

Lead with three sentences: how many ideas were triaged and how many are ADOPT/ADAPT (numbers are fine in chat), the single highest-leverage idea, and whether the convergence read holds. Then: the baseline table · the triaged table (ADOPT/ADAPT first, then WATCH, then SKIP, then SEEN) · hand-offs to `/reality-check` · the session queue (below) · the scouts' dead ends and every secondary-only claim.

**Session queue** — ADOPT/ADAPT rows in the `/superplan` shape so `/execplan` can consume them:

```markdown
| ID | Pri | Size | Pts | Title | Files | Gate / verify | Status |
```

Roughly forty points per session; correctness before packaging before behaviour (the recorded rationale: behavioural moves carry the only real risk and should ship inside packaging that already exists).

### 3.2 Written artifacts (only with `--write`)

| Artifact | Rules |
|---|---|
| `docs/specs/market-ideas-ledger.md` | **Append**, never delete. New ideas get the next `MI-nnn`. Existing rows: update Status, Decision, Revisit trigger; a status change names the run date. Add one line to the **Run log** (date, window, scouts, tree @ sha, counts of new/changed rows stated as a command). Version-pinned model names allowed (it lives under `docs/specs/`) |
| `docs/specs/market-ideas-<YYYY-MM>.md` | The sized queue for this run's ADOPT/ADAPT rows in the `/superplan` shape (Baseline · Findings · Items · Session queue · What not to do re-affirmed · Sources read). If the month's file exists, append a dated **Addendum** instead. A **new** file bumps the **Specs** row in `CLAUDE.md`'s counts table (refresh with the snippet at the top of `CLAUDE.md`) |
| `docs/IMPROVEMENT-TODO.md` | One dated update note pointing at the queue file. Evergreen: no counts, no version-pinned model names |
| Memory note `market-ideas-<YYYY-MM>` (or update the existing) | Facts not derivable from the repo: refuted claims, traps hit, blockers with reasons, scouts' dead ends worth avoiding next time |

Never edit `CHANGELOG.md`; never touch `docs/SKILLS-*.md` by hand — they are generated (`python scripts/generate-skills-docs.py`), and adding or editing a dev command means re-running that generator.

### 3.3 Post-write gate (mandatory after any write)

```bash
node --test tests/doc-lint.test.cjs tests/model-version-drift.test.cjs tests/claude-md-counts.test.cjs 2>&1 | grep -E '^ℹ (pass|fail)'
git status --porcelain
```

Red means a count or a version-pinned model name leaked into an evergreen doc, or the specs row was not bumped — fix the doc, not the test. List every file touched. Do **not** commit; the user decides (`/commit`).

---

## Appendix A — PAN capability blurb (paste into every scout prompt; keep it current)

> PAN Wizard is a planning/state/verification layer installed into Claude Code, Codex CLI, Gemini CLI (and Antigravity via the shared `.agents/` tree), OpenCode and Copilot CLI. It has: `.planning/` durable state (project/roadmap/state/phases/plans/summaries, milestones, todos, assumptions, memory rules); research → plan → plan-checker → execute (fresh-context subagents, per-task commits) → verify (+UAT) → diagnose loop; quick mode; pause/resume; focus mode for small projects; a cost ledger with a dated rate table and cache-read economics, model profiles quality/balanced/budget, context-budget and cache-TTL advice, phase budgets; hooks per runtime (check-update, context-monitor, cost-logger, trace-logger, stop-guard, session-start); an MCP server exposing engine verbs with a forbidden-verb list and a nonce-bound human merge gate; a learnings store with a promote gate; Agent Skills emission into `.agents/skills/`; a Claude Code plugin and an Agent Plugins bundle (both built; published only to npm); native Claude Code workflow scripts (map-codebase, review-pipeline, exec-waves, diagnose-issues) beside portable markdown workflows; a behavioural harness that installs from a packed artifact and keeps a findings ledger; a Claude-only bot army of parallel worktree agents; hygiene scan/clean (version drift, poisoned ledgers, foreign `.planning/` layouts); codebase mapping for brownfield projects; what-if/counterfactual; experiment runner; optimize; knowledge; retro; dashboard/HUD; Discord notifications; patches.

Refresh this blurb when a release adds a capability class — a stale blurb makes scouts report ideas PAN already has.

## Appendix B — Roster and sources

The direct-peer roster, the host-tool list and the primary-source table are **owned by `/reality-check`** (its Appendices A and B). Read them from there at run time; do not copy them here. This skill adds only:

- **Entrant discovery queries** (scout C): "spec-driven development" framework 2026 · "Claude Code plugin" planning orchestration · "agent skills" workflow pack · awesome-claude-code / awesome-agent-skills lists · "Codex plugin" planning · "Copilot CLI plugin" workflow · "context engineering" framework coding agent · "agentic workflow" markdown CLI · plus `--topics`.
- **Official catalogues**: Anthropic's official Claude plugin marketplace repository; the Codex and Copilot plugin marketplaces' featured lists — a planning plugin listed there is a peer even if it is not on the roster yet.
- **Vendor engineering blogs** (patterns, scout C): Anthropic engineering, OpenAI Codex, Google Gemini CLI / Antigravity, GitHub blog. A vendor post is primary for "the vendor recommends X" and is never evidence that X works.

## Appendix C — Ledger statuses

| Status | Meaning | Required field |
|---|---|---|
| **OPEN** | Triaged ADOPT/ADAPT, queued, not built | queue item id |
| **ADOPTED** | Shipped as found | version or commit |
| **ADAPTED** | Shipped in PAN's idiom (or the runtime primitive replaced a PAN duplicate) | version or commit + what changed |
| **WATCH** | Not yet | the trigger that re-opens it |
| **SKIP** | Not for PAN | the reason (thesis pillar, "What not to do" entry, measurement) |
| **DECLINED** | A written decision says no | the ADR |
| **BLOCKED** | Wanted, cannot proceed | what is missing (a CLI, a pricing page, a spend cap) |
