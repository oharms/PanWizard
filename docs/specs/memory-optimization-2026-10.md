# Memory optimisation review — `2026-10-04`

**Question:** are PAN's memory techniques optimal? What does the market ship, and what does PAN's memory do in practice?

**Method:**
- **Market sweep.** Three research scouts ran in parallel: host tools, peers and memory tools, and research and standards.
- **PAN's design.** A read of PAN's memory modules, workflows and ADRs.
- **Field measurement.** Read-only measurements on the projects where PAN is installed for real work. Only sizes, counts and dates were recorded, never content. Client projects appear under codenames.
- **Live measurement.** One Claude Code `-p` call measured the session-start footprint.

The ledger rows are MI-091 onward in `market-ideas-ledger.md`.

## Verdict

**PAN's memory *design* is right.** The evidence and the market have converged on what PAN already does:
- Markdown files on disk.
- A small always-loaded layer.
- Fresh-context subagents that hand off through files.
- State re-injected after compaction.
- Gated promotion of learnings.
- Quarantine for injected directives.
- Load-time budgets, and no vector store.

None of PAN's recorded memory decisions is overturned. MI-010, MI-057 and ADR-0036's "no index-everything store" all hold.

**In operation, PAN's memory is not optimal.** It has eight problems:
1. The largest re-read cost is unbounded. The planner loads the whole roadmap and requirements, and the roadmap grows without limit.
2. A CRLF bug silently disables the `state.md` bound on every Windows project measured.
3. The per-agent memory layer has an elaborate read path but almost no writes.
4. Learnings are chosen by file size, not by the task.
5. Stored facts carry no citations or expiry. That is the one technique with a real A/B result behind it.
6. The context monitor's countdown contradicts current vendor guidance and can be bypassed.
7. The host memory where cross-session memory actually accumulates is invisible to PAN.
8. Copilot may load PAN's AGENTS.md section twice.

**The lever is per-turn re-read context.** Across the field cost ledgers, cache-read tokens outnumber output tokens by 245–365 to 1. Anthropic reports the same shape for its newest coding model, where the input-to-output ratio rose from 189:1 to 324:1.

## Baseline — PAN's memory today

| Layer | Where | Written by | Read by | Bound |
|---|---|---|---|---|
| Durable state | `.planning/` (project, requirements, roadmap, state, standards, phases) | workflows, `pan-tools` | every spawn reads a subset: an executor the plan, state.md, config and CLAUDE.md; a planner also the whole roadmap.md and requirements.md | `state compact` and `memory optimize` for state.md only (ADR-0044); nothing for the roadmap or requirements |
| Per-agent memory | `.planning/memory/<agent>.md` | `verify retro` lessons, `optimize apply` | exec-phase `load_phase_memory` → `MEMORY_RULES` | budget plus cue-scoped `memory select` (ADR-0036) |
| Shipped learnings | `pan-wizard-core/learnings/{universal,internal}` | PAN, through the promote gate | `learn topics-for --agent <role>` | 5,000-token budget, static role relevance |
| Session learnings | `.planning/learnings.md` (LEARN-NNN) | `commands-learnings` extraction | — | — |
| Instructions | AGENTS.md marker section; CLAUDE.md `@AGENTS.md` bridge | installer, `memory rebuild` | host at session start | fixed template |
| Compaction survival | `pan-state-reinject.js` | — | host after compaction (Claude and Codex SessionStart `compact`; Gemini and Copilot marker + tool result) | 2,000-character block |
| Context pressure | `pan-context-monitor.js` | — | injected at ≤35% / ≤25% remaining | debounce |
| Injection defense | `quarantine.md` (ADR-0040) | `memory optimize` | humans | — |

## What the field shows

Every measurement below is read-only, taken on `2026-10-04`.

| # | Finding | Evidence |
|---|---|---|
| F1 | **The planner loads the whole roadmap and requirements.** `plan-phase` passes both full files to the planner and the checker. A phase slice (the phase's section from `roadmap get-phase`, plus the requirement lines it names) is **89–98% smaller**. | Averaged over every phase of each project: 54-phase project ~145,980 → ~3,028 tokens; forecasting client ~14,246 → ~799; compliance client ~7,630 → ~675; lending client ~7,483 → ~554; PAN's benchmark projects ~7,464 → ~818 and ~4,450 → ~313 |
| F2 | **The roadmap is what grows in a long project, and nothing bounds it.** hygiene's `cache-context` check flags it CRITICAL with `fix: null`. Its "re-read on every agent call" model is also wrong per role (see F1). | 54-phase project: roadmap.md 476 KB, requirements.md 94 KB; check reports ~157,620 tokens. Forecasting client: ~26,727 |
| F3 | **Bug: `memory optimize` and auto-optimize change nothing on CRLF files.** Every Windows field project measured is CRLF throughout. Other parsers (`state compact`, `roadmap get-phase`, hygiene) handle CRLF. | 7 of 7 projects: state, roadmap and requirements 100% CRLF lines. Forecasting client state.md as-is: no change; normalised to LF: Decisions reconciled, 145 entries archived, 35,424 → 10,324 bytes |
| F4 | **Agent memory has a read path but almost no writes.** | 2 of 23 installs have entries (42 and 10; last written `2026-08-17` and `2026-08-21`) |
| F5 | **Session learnings are unused.** | `.planning/learnings.md` is empty in all 23 |
| F6 | **Learnings are chosen by size, not by task.** Topics are ranked by static role relevance, then filled smallest-first into 5,000 tokens. Most relevant topics drop out whatever the task is. | executor: 24 dropped (test-integrity, concurrency, migration-safety…); planner 22; verifier 21. The cue-aware scorer in `memory select` is not used here |
| F7 | **Cross-session memory accumulates in the host, not in PAN.** | Claude Code auto-memory: lending client 33 files / 274 KB, index 19.6 KB with lines up to 1,457 characters; a benchmark project 70 files / 281 KB; policies client index line 3,542 characters. PAN neither reads nor checks it |
| F8 | **The session-start footprint is modest.** | Claude Code 2.1.288, haiku, `-p`, no MCP: empty folder 32,183 prompt tokens; fresh PAN install 36,692. PAN adds ~4.5k |
| F9 | **Re-read context dominates spend.** | Cache-read to output 245–365 : 1 across field ledgers; executor spawns ~1–3.4M cache-read tokens each (median) |
| F10 | **The live bloat in `state.md` sits in a protected section.** | Forecasting client: Decisions 28 KB / 157 bullets, 80% of the file. `state compact` protects the section; `memory optimize` would cap it but for F3 |

## What the market ships

Full scout tables are kept with the run; the rows below are the ones that bear on PAN.

| Technique | Who | Evidence | PAN status |
|---|---|---|---|
| Keep working context small and focused | research | Chroma "Context Rot" (one distractor already hurts; ~300 focused tokens beat ~113k on LongMemEval); Du et al. 13.9–85% drop with length; lost-in-the-middle | **PARTIAL.** Principle in ADR-0036; violated by F1/F2 |
| Small always-on index, detail on demand | Claude Code (200 lines / 25 KB index), Windsurf, Cursor, Kiro, Letta, Serena | Vercel: compressed 8 KB index 100% vs skill 53–79% | **HAVE** for instructions; **MISSING** for planning files (F1) |
| Don't store what the code already says | BMAD, Claude Code, Serena, Codex | Gloaguen et al. (arXiv 2602.11988, v3 `2026-09-29`): context files gave no significant success gain and cost +19–23%; overviews didn't help | **PARTIAL.** The promote gate has no explicit admission rule; codebase-map overviews are read by agents |
| Cited facts, verified before use, expiring when unused | Copilot Memory | **GitHub A/B (`2026-01-15`): PR merge rate 90% vs 83%, p < 0.00001.** The only outcome A/B in the field | **MISSING** |
| Lessons from observed failures, not traces | BMAD `record`, SuperClaude reflexion, research | Memory transfer: high-level insights generalise, raw traces transfer negatively; subtask memory +4.7 pp on SWE-bench Verified | **PARTIAL.** Design yes; write path starved (F4) |
| Gate writes; supersede instead of overwrite | mem0, Graphiti, BMAD; research | Experience-following spreads errors; MINJA 98.2% injection success via queries alone | **HAVE.** Promote gate, ADR-0040 quarantine, archive-not-delete |
| Deterministic itemised updates, never an LLM rewrite of the whole file | research (ACE) | "Context collapse": an 18k-token context rewritten to 122 tokens fell below the no-memory baseline | **HAVE.** `memory optimize` is deterministic (F3 aside) |
| Restart from files with a handoff rather than carry long sessions | Anthropic harness guidance; research | Multi-turn −39% (15 LLMs); restating in one turn recovers 95.1% | **HAVE.** Fresh-context subagents, `.planning/` |
| Re-inject state after compaction | Claude/Codex SessionStart `compact`, planning-with-files, agentmemory, Cognee | — | **HAVE** on four hosts (M10, M33); OpenCode open (MI-038) |
| Steer the compaction summary | Claude Code "Compact Instructions" in CLAUDE.md; Codex `compact_prompt`; OpenCode `experimental.session.compacting` | vendor docs | **MISSING** |
| Don't show the model a token countdown | Anthropic prompting guidance (Fable 5) | Countdowns trigger premature wrap-up and hand-off suggestions | **CONFLICT.** The context monitor injects remaining-% warnings |
| Telemetry on whether injected memory was used | Cognee ("12/40 turns had hits"), claude-mem | — | **PARTIAL.** `memory_primed` trace events count loads, not use |
| Measure resume cost | planning-with-files benchmark | stop halfway; fresh session told "continue"; count turns | **MISSING** in the harness |
| Vector or graph memory stores | claude-mem, mem0, Zep, Cognee, Ruflo, MemPalace, Hindsight | Vendor-run benchmarks only; LoCoMo audit: 6.4% wrong gold answers, judge accepts 62.81% of wrong answers; files + grep scored 74.0% (Letta) | **DECLINED** (ADR-0036 D4); holds |
| A cross-runtime memory format | IETF individual drafts (SAIHM, AIMEM bundle, infantado), W3C community group | No host adoption; four hosts ship four formats | **DECLINED** (MI-010); trigger unmet |

Host facts that change PAN's work:
- **Gemini CLI removed `save_memory`** in v0.44.0 (`2026-05-27`). PAN never used it.
- **Claude Code reads AGENTS.md natively** (2.1.277), but only when no CLAUDE.md exists.
- **Copilot reads `.claude/rules`** since 1.0.89.
- **Copilot lists AGENTS.md and CLAUDE.md as separate enabled sources.** A local probe on 1.0.91 showed this, so PAN's section may load twice there. This is unconfirmed.
- **Claude Code measures its status-line context percentages against the full window, not the auto-compact window.**
- **Hook output caps:** Codex spills hook output above ~2.5k tokens to a file, and Claude caps hook output at 10,000 characters. PAN's re-injection block fits both.

## Proposal — the queue

The work is ordered by the size of the lever (F9) and by risk. Correctness comes first, then the large re-read cut, then quality. Points use the usual scale: S 2, M 4.

| ID | Pri | Size | Pts | Title | Evidence | Gate |
|---|---|---|---|---|---|---|
| O1 | P1 | S | 2 | **Fix `memory optimize` and auto-optimize on CRLF files.** Parse line endings with `\r?\n`, then write back in the file's own style. Add a CRLF-parity test that runs every planning-file parser on LF and CRLF copies of the same fixture and expects equal results | F3, F10 | The parity test fails before the fix. A dry run on a copy of a CRLF field state.md shows the reduction |
| O2 | P1 | M | 4 | **Load only the current phase's slice of the planning files.** A `pan-tools` verb returns the phase's roadmap section, a one-line index of every phase, the requirement lines the phase names, and its dependencies' goals. plan-phase (planner, checker), research-phase and verify-phase read that instead of the whole `roadmap.md` and `requirements.md` | F1; context-rot evidence; ADR-0036's own principle | Unit tests. Field dry-run sizes match F1. Harness `plan-phase-checker-loop` and `markdown-exec-phase-chain` pass on the slice |
| O3 | P2 | M | 4 | **Bound the roadmap and requirements as ADR-0044 bounds state.md.** `roadmap compact` moves shipped phases' detail to `roadmap-history.md` and keeps each checklist line plus a one-line goal; requirements of shipped milestones get the same treatment. hygiene's `cache-context` check offers these fixes and reports loads per role | F2 | A dry run on a copy of the 54-phase project. A hygiene test with fixes present. A planner still finds a shipped phase through the history file |
| O4 | P2 | M | 4 | **Cited, verified, expiring memory** (the Copilot Memory pattern, without dependencies). Agent-memory entries and promoted learnings may carry `cites: path[#symbol]`. `memory select` checks the citations against the working tree and drops or flags an entry whose evidence is gone. Entries record when they were last used; unused ones are archived after a window; hygiene reports stale entries | GitHub A/B 90% vs 83%; MemoryAgentBench ≤28% on fact updates | Unit tests. A harness rep where a seeded stale memory is filtered out before injection |
| O5 | P2 | S | 2 | **Choose learnings by the task.** `learn topics-for --cue "<phase objective; files>"` reuses `selectMemory`'s lexical scorer and ranks by cue match, then relevance, then size. The workflows pass the phase cue | F6; ADR-0036 ("selected by cue") | A golden set of phase objectives with expected topics; the cue ranking beats size-greedy on precision and recall |
| O6 | P2 | M | 4 | **Give agent memory a gated write path, or retire it.** Record a lesson only from an observed failure (a verifier gap, a failed test gate, a retry), with the correction, evidence and a citation. Admission rule: nothing the code already says. Add telemetry for injected entries that were used | F4, F5; lessons-over-traces evidence | A harness chain: a seeded failure produces one entry, and the next phase's executor receives it. If two reps show no effect, retire the layer and record why |
| O7 | P2 | S | 2 | **Context monitor without a countdown.** The injected message asks the agent to checkpoint `state.md` (the stopping point) rather than reporting a remaining percentage. Where the host exposes it, measure against the auto-compact window, not the model window | Anthropic guidance on countdowns; Claude `autoCompactWindow` | Unit tests. A harness A/B at forced low context: completion without premature wrap-up |
| O8 | P2 | S | 2 | **Steer the compaction summary.** A short "Compact Instructions" section in PAN's CLAUDE.md block, and a Codex `compact_prompt` hint, naming what must survive: the current phase, plan and stopping point, and the path to `state.md` | Claude and Codex docs | Install tests. A live `/compact` whose PostCompact `compact_summary` names the position |
| O9 | P3 | S | 2 | **Load PAN's instructions once on Copilot.** Confirm with `/context` whether AGENTS.md plus CLAUDE.md (`@AGENTS.md`) load the section twice, and if so emit the bridge so Copilot de-duplicates it | Copilot local probe (unconfirmed) | A live `/context` on Copilot. A test pinning the emitted shape |
| O10 | P3 | S | 2 | **Observe the host's memory without owning it.** hygiene reads Claude Code's per-project memory store, read-only. It reports the index against the host's 200-line / 25 KB load limit, and index lines that hold content instead of a pointer. MI-010 is unchanged | F7 | A unit test with a fake home. A field scan flags the oversized indexes |
| O11 | P3 | M | 4 | **Harness scenario for resume cost** (planning-with-files' protocol). Stop mid-phase, start a fresh session told only to continue, and count turns and cost to finish. This is the baseline that measures O2, O6, O7 and O8 | planning-with-files evals | The scenario runs at tier 2 with `--repeat` |
| O12 | P3 | S | 2 | **OpenCode: the last host without state re-injection.** Use the `experimental.session.compacting` plugin hook (MI-038), and the `instructions` array, which can load `.planning/memory/*.md` | OpenCode docs | A live compaction check on OpenCode |

**Sessions:**
- **Session A — correctness and the big cut:** O1, O2, O3 (10 points).
- **Session B — memory quality:** O4, O5, O6 (10 points).
- **Session C — host integration and measurement:** O7, O8, O9, O10, O11, O12 (14 points). O11 should land early in C, since it measures the rest.

**Expected effect:**
- **O1** restores the `state.md` bound on Windows projects: 71% smaller on the measured client file.
- **O2 and O3** cut the planner's planning-file load by roughly 90% or more. They also let a long project's planner fit in a 200k window at all: today the 54-phase project hands it ~146k tokens before any code.
- **O7 and O8** reduce the two ways compaction loses PAN's position.
- **O4, O5 and O6** improve what little memory PAN injects; O6 proves its effect or retires it.

## Results — `2026-10-04`, branch `feat/memory-optimization-2026-10`

Every item was built, with tests that fail when its rule is undone, and every rule was revert-proofed one at a time. The harness gates ran against packed builds of the branch. Spend on paid checks this run: the harness reps listed below and three short live probes (under $0.30 together).

| ID | Status | What landed | Gate result |
|---|---|---|---|
| O1 | DONE — `6f6e198` | Every planning-file parser reads on LF and writes back in the file's own line ending (`toLf`, `dominantEol`, `withEol`). | CRLF-parity test over every parser fails before the fix. Field dry run: the forecasting client's state.md goes 35,424 → 10,484 bytes. |
| O2 | DONE — `79667bb`, `49b8425`, `86aa9c2`, `8c3e848` | `roadmap slice <phase> [--write]`. The planner, checker, researcher, executor and verifier read it instead of the whole roadmap.md and requirements.md. Two prompts that still loaded the whole set were found and fixed along the way: the "prime the cache" step (ADR-0023 amended) and the verifier (found by the harness). | Field slices are 75–98% smaller. Harness `markdown-exec-phase-chain` PASSED with zero whole-file reads by phase agents, counted from their own transcripts (`context-reads.cjs`). `plan-phase-checker-loop`: the researcher and checker read only the slice in all three reps, and the planner in two. In the third, the planner's roadmap edit read the seed's 30-line roadmap whole after `wc -l` showed it tiny, so the seed now carries a long project's roadmap (see O2-final below). |
| O3 | DONE — `fc29af6`, `49b8425` | `roadmap compact [--apply] [--keep N]` moves shipped phases to `roadmap-history.md` and leaves a stub. `get-phase`, `report phase` and slices read a compacted phase back from the history. hygiene offers `compact-roadmap`. | Dry run on the 54-phase project: 40 sections move, ~121k → ~39k tokens. 17 rules revert-proofed. **Requirements:** no compactor of its own. No field project has shipped a milestone through PAN, phase agents now read only their requirement lines, and `/pan:milestone-done` already archives a shipped milestone's requirements. |
| O4 | DONE — `86aa9c2` | Cited, verified, expiring entries (`--cites`, `memory select` drops stale and expired entries, `--mark-used`, `memory prune`, hygiene `memory-stale`); `learn promote --cites` with lint L-007. **Security fix found on the way:** exec-phase loaded every file in `.planning/memory/`, the ADR-0040 quarantine and a 114 KB state archive included, into every executor prompt. Memory then loaded only from agent logs; since the O6 decision nothing loads it at all. | 18 rules revert-proofed. Harness `memory-citations` PASSED: only the valid cited entry reached the executors; the stale entry, the quarantined directive and the state archive did not; the entry's use was recorded. The scenario is now `memory-not-loaded`, which expects none of them. |
| O5 | DONE — `fc28b6b` | `learn topics-for --cue`: topics matched to the task, keeping those scoring at least half the best match. The four workflows that load learnings pass the cue. | Golden set of 18 labelled objectives: precision 0.06 → 0.37, recall 0.45 → 0.76, ~13 → ~4.7 topics loaded. |
| O6 | RETIRED on the owner's decision — built `e41cb55`, `f00655b`; retired `506d1fb` | Built: `memory record`, the gated write path (a fixed finding or a trace session as evidence, a citation that holds, no directive, no duplicate); exec-phase `record_lessons`; the planner's memory in plan-phase; the optimizer's `memory_entry`; use telemetry. **Retired:** every load of agent memory into an agent and every automatic writer (`record_lessons`, army's `retro --write-memory`, the optimizer's memory entries), plus `validate health`'s `MEM_BUDGET`. `memory record` stays as a command. | 12 + 5 rules revert-proofed when built. Harness, 16 reps: the write path and routing work; no behavioural effect over the controls. The retirement: 15 mutations caught by the new class test; harness `memory-not-loaded` checks the deployed chain. |
| O7 | DONE — `610b054` | The context note carries no figure and asks for a checkpoint. The room left is measured against the auto-compact point (env, settings per model and for all, the 1M default, the percentage override). | Unit and e2e tests. `claude -p` renders no status line (checked with a `statusLine` command that never ran), so no bridge file was written and the monitor was silent in headless runs. **Follow-up done:** with no fresh bridge the monitor now reads the session transcript, and a subagent's call reads the subagent's own. Harness `context-note-headless` is the gate (see Follow-up below). |
| O8 | DONE — `c4580f3` | A "Compact instructions" section in PAN's CLAUDE.md block. An old bridge is upgraded in place. Codex `compact_prompt` deliberately left out: it replaces the built-in prompt and the default provider ignores it. | Live `/compact` per arm with a PostCompact hook: the summary with the section followed it (no code blocks, 24% shorter); the one without carried two code blocks; both kept phase, plan and stopping point in a session that short. |
| O9 | CONFIRMED, documented — `b570895` | Copilot loads PAN's section twice in a dual Claude + Copilot project. No project-side layout fixes it: Copilot dedupes only identical files, and Claude Code needs the import. TROUBLESHOOTING gives the user-side fix (`/instructions`). | `copilot instruction list --json` on 1.0.91 lists AGENTS.md and CLAUDE.md as two enabled sources; recorded 1.0.88 sessions show the section twice (~630 bytes per request). A test keeps PAN from adding a third copy. |
| O10 | DONE — `b560fd5` | hygiene `host-memory`, read-only: Claude Code's MEMORY.md against its 200-line / 25 KB load limit, and index lines that hold content. MI-010 unchanged. | Fake-home unit tests; 8 rules revert-proofed. Field scan flagged two client indexes for content-heavy lines; none over the limit. |
| O11 | DONE — `7995acd`, `fddae65` | Harness `resume-cost`: the seed stopped halfway, a fresh session told only "continue", turns and cost read from the step's own record. | Baseline, 2 reps: finished both times in 12 and 17 turns, $0.44 and $0.62, 67 s and 98 s. |
| O12 | DONE — `1e23b86` | An OpenCode plugin (`.opencode/plugins/pan-wizard.js`, CommonJS `{ id, server }`) pushes PAN's position onto the compaction prompt. Installed, manifest-tracked and uninstalled for OpenCode only. | OpenCode 1.18.32, no model call: `debug config` lists it (now a `live-gate-opencode` step); an instrumented copy showed OpenCode importing it and calling `server()`, which returned the compaction hook. |

### Harness runs (`d:\pantesting\harness-runs\`, all against packed builds of the branch)

| Run | Scenario × reps | Result | Notes |
|---|---|---|---|
| `run-20261004-115435-7Q1od0` | `plan-phase-checker-loop` ×2, `markdown-exec-phase-chain` ×2 | 0 / 4 on their checks; the chains themselves worked | First O2 gate. The planner's reps failed only on a `phases list` assertion that never matched (the scenario had never been run). The exec chain's reps found the verifier and an executor reading the whole files, which led to the O2 follow-up. $11.46 |
| `run-20261004-123606-yj08Rs` | `markdown-exec-phase-chain`, `memory-citations`, `plan-phase-checker-loop` ×1 | 2 / 3 | The exec chain read zero whole files after the fix. The O4 gate passed. The planner read the 30-line seed roadmap whole once, which led to the grown seed. $8.42 |
| `run-20261004-130834-iwUDhB` | `plan-phase-checker-loop` ×2 (grown seed), `resume-cost` ×2 | 3 / 4 | **O2-final:** on a long project's roadmap, the researcher, planner and checker read only the slice in both reps. **O11 baseline:** a fresh session told only "continue" finished the half-done phase both times, in 12 and 17 turns, $0.44 and $0.62, 67 s and 98 s. Rep 1 failed its measurement step on a script bug (it read claude's JSON instead of the harness step record), since fixed and re-measured from the record. $7.88 |
| `run-20261004-130155-pAwKuq` | `memory-lesson-chain` ×2, `memory-lesson-control` ×2 | 4 / 4 | O6 mechanism, below. $12.83 |
| `run-20261004-133439-25lZk5` | `memory-convention-chain` ×2, `memory-convention-control` ×2 | 4 / 4 | O6 effect, below. $11.37 |
| `run-20261004-173408-7PFC09` | `memory-not-loaded` ×1 (the retirement, built from `7430625`) | 0 / 1 as run; passes re-measured | No executor prompt carried memory, the orchestrator ran no memory command, and nothing the run wrote followed a seeded entry. It failed one expectation: no agent may open the folder. The orchestrator had listed `.planning/` on its own and run `head` on every memory file, the quarantine included. It obeyed none of them. The counter had also counted a `git reset -- .planning/memory` as a read. The gate now asserts what PAN controls and what would do harm (no seeded marker in anything the run wrote). It reports reads per agent without failing on them, and judges each segment of a shell command. Re-measured on the same workspace and transcripts: passes, with one read reported. $2.19 |
| `run-20261004-181357-v3GL7Y` | `context-note-headless` ×1 (built from `fb9faac`) | 1 / 1 | O7's gate. A `claude -p` session on Opus 5.5 with a 100K compaction window read three files. Its calls measured 41.7K, 54.4K and 67.0K tokens. After the third, the transcript recorded PAN's warning note with no bridge for the session, and the host compacted right after. That located the compaction point: 33K short of the window, as on the 1M default, where O7 had assumed the window itself. With the margin, the same calls give the critical note one call earlier. $0.62 |
| `run-20261004-182101-95QZoA` | `context-note-headless` ×1 (built from `2b80915`, the margin) | 1 / 1 | With the 33K margin the critical note fired after the second read's call (54,356 tokens), one call earlier. The host compacted after the call that measured 67,149, the margin's point again, and the note was recorded before it. No bridge for the session. $0.65 |

The four O6 scenarios, their scripts and their seeds were retired with the step they measured (`506d1fb`; last present at `715d83e`). `memory-citations` became `memory-not-loaded`.

### O6 — what the lesson-chain runs showed

The four runs use the same seed and the same fix round (the gap: `greet` does not reject a bad name). They split by arm only at phase 2.

- **The gate is used with judgement.** In both chain reps the orchestrator recorded one lesson through `memory record`, with `evidence: finding:` and a citation. Both lessons were conditional: "when a requirement says a function rejects bad input, build the guard and its tests in the same plan". In both control reps it recorded none, and said why. The gap was a planning slip: no plan was assigned REQ-02, so the executor was not at fault, and a general "validate arguments" rule would push phase 2 into work its requirement does not ask for. That is the admission rule ("not a phase-specific slip; not what the code already says") working as written.
- **Injection works.** Both recorded lessons reached phase 2's executor prompt, read from the orchestrator's transcript.
- **No behavioural effect, and none was possible in this design.** Phase 2 has no validation requirement, so the conditional lesson correctly did not apply. `farewell` validated in 0 of 2 chain reps and 0 of 2 control reps. The seed tests what the write path does, not what a lesson is worth.
- **A real gap it exposed, now fixed (`f00655b`).** PAN injected memory only into executors, so the planning lessons the fix round naturally produces, and `verify retro`'s recurring plan gaps, reached no planner. plan-phase now gives `pan-planner`'s log to the planner and the plan checker. `record_lessons` files each lesson with the agent that would have prevented the failure.

**The effect experiment** (`memory-convention-chain` / `-control`, run `run-20261004-133439-25lZk5`, 4 / 4, $11.37) uses a project quirk. `npm test` runs only the test files `test/manifest.json` lists. Phase 1 wrote a test and never listed it, and phase 2's plan never mentions the manifest. The measurement is whether phase 2 lists its new test, with and without the lesson.

| Rep | Lesson recorded by the fix round | Lesson in phase 2's executor `<project_memory>` | Phase 2 listed its test |
|---|---|---|---|
| chain 1 | yes, filed for `pan-planner` | no (a planning lesson; phase 2 came pre-planned) | yes |
| chain 2 | yes, filed for `pan-planner` | no | yes |
| control 1 | yes, then removed with `.planning/memory/` | no | yes |
| control 2 | yes, then removed | no | yes |

The transcripts say how phase 2 knew without memory:
- The orchestrator ran the `npm test` baseline, saw "running 2 test file(s) from test/manifest.json", and told its executor to check that the new test actually runs.
- The executors read `scripts/test.cjs` and the manifest themselves.
- One executor `cat`-ed the planner's memory file on its own. The "never read a memory file into a prompt" rule binds the orchestrator, not the subagents it spawns.

The lesson was also something the code already says (the runner states the rule), which the admission rule forbids recording. The gate cannot judge that.

**Verdict on O6.** The write path works: 6 of 8 fix rounds recorded a lesson through the gate, the other 2 declined with a correct reason, and every recorded lesson was routed to the right agent once routing existed. Recorded lessons reach their agents.

**What the runs did not show** is any behavioural effect: 8 reps of phase 2 across two designs, and every control behaved the same without memory. Within a two-phase horizon, PAN's other channels already carry what a fix round learns: `state.md` decisions, summaries, the orchestrator's own prompt, and executors that read the repository.

That meets this queue's own rule ("if two reps show no effect, retire the layer"). But the layer's claimed value is the long horizon, after `memory optimize` and `state compact` have moved a decision out of `state.md`, and no run tested that. The owner was offered two options: retire the injection, or keep the layer and run one long-horizon experiment (a lesson recorded in phase 1, `state.md` compacted, measured in phase 4).

**Decision (`2026-10-04`, the owner): retire the injection** (`506d1fb`, ADR-0036 amended).
- **The injection:** exec-phase's `load_phase_memory`, the executors' `<project_memory>` block and `record_lessons` are gone, and so are plan-phase's planner memory step and both of its blocks.
- **The writers that fed only the injection** were listed before any change. The owner chose to stop the automatic ones:
  - `/pan:army` and `pan-conductor` no longer pass `retro --write-memory`. Mission Control carries retro's patterns into the next mission's plan.
  - `pan-optimizer` proposes notes that name where a lesson belongs (the project's instructions, a test, or the code), and no longer reads the store.
  - `optimize apply` warns on any write into `.planning/memory/`.
- **What stays:** the store, every `memory` command, hygiene, the quarantine and `/pan:knowledge`.
- **Also removed:** `validate health --full`'s `MEM_BUDGET`, which measured a cost that is gone.
- **Gates:** a class test forbids any shipped prompt from loading or writing agent memory (15 mutations caught). Harness `memory-not-loaded` checks the deployed chain. It is not yet run against a model.
- **Revisit when** a long-horizon run shows an effect.

**Found while retiring (`5f6f077`):** `docs/CLI-REFERENCE.md` had held a second copy of its first 3,400 lines since `86aa9c2`. An O4 edit script passed `String.replace` a replacement holding a regex ending in `+$` followed by a backtick. In a replacement string, `` $` `` inserts everything before the match. The paste went through five commits unseen. A doc-lint test now fails on any markdown file whose opening appears twice.

**Follow-up (done):** the context monitor reads context size from the session transcript when no status-line bridge exists, so the note reaches headless runs. Built from payloads and transcripts captured from Claude Code 2.1.288 on `2026-10-04` in a scratch `claude -p` probe:
- The assistant record that issued a tool call is in the file when PostToolUse fires, so its usage is the call's context.
- A subagent's payload names the main transcript and carries `agent_id`; the subagent's records are in `<session>/subagents/agent-<id>.jsonl`.
- A hook's `additionalContext` is recorded as a `hook_additional_context` attachment.

21 rules were mutated: 20 were caught, and the 21st (dropping a tail's partial first line) is an equivalent mutant on well-formed JSONL. Harness `context-note-headless` gives a `claude -p` session a 100K compaction window and reads past the warning line, then checks that the transcript recorded the note before the host compacted, with no bridge present. Its first run located the compaction point at 33K short of the window, and the monitor now measures against that.

## On watch

- **Codebase-map overviews as agent input.** The ETH study found repository overviews don't help, while developer-written specifics do. The verifier reads `conventions.md` (specifics) and `structure.md` (an overview). Measure in the harness before dropping either.
- **Masking old tool output** halves cost with no accuracy loss in the research. It's a host transcript concern, reachable only through Claude Mods (MI-074, WATCH).
- **Claude's AGENTS.md native mode.** If PAN's bridge creates a CLAUDE.md where none existed, nested AGENTS.md files may stop loading. This comes from the docs; verify live.
- **Codex `/import`** may copy PAN's Claude hooks, commands and bridge next to PAN's own Codex install. Untested.

## What not to do — re-affirmed with this run's evidence

- **No vector or graph store** (ADR-0036 D4):
  - Every such tool brings a native or server dependency.
  - Grep and BM25 came close on coding-shaped data.
  - The published benchmarks are vendor-run, and LoCoMo itself is flawed.
  - One tool's own audit caught it silently falling back to mock embeddings.
- **No ownership of host-native memory** (MI-010). No interchange format has a host adopter.
- **No automatic copying of learnings to a global store** (MI-057).
- **No LLM rewrite of a whole memory file.** ACE's "context collapse" fell below the no-memory baseline; keep reconcile deterministic.
- **No always-on transcript-capture daemon.** It brings dependencies, privacy exposure and no outcome evidence.
- **No repository overviews added to the always-loaded layer.** In the ETH study they cost about 20% more for no success gain.

## Sources (read `2026-10-04` unless dated)

**Research:**
- https://arxiv.org/abs/2602.11988
- https://www.trychroma.com/research/context-rot
- https://arxiv.org/abs/2510.05381
- https://arxiv.org/abs/2307.03172
- https://arxiv.org/abs/2508.21433
- https://arxiv.org/abs/2505.06120
- https://arxiv.org/abs/2510.04618
- https://arxiv.org/abs/2505.16067
- https://arxiv.org/abs/2503.03704
- https://arxiv.org/abs/2507.05257
- https://arxiv.org/abs/2410.10813
- https://arxiv.org/abs/2604.14004
- https://arxiv.org/abs/2602.21611

**Vendor:**
- https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
- https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- https://claude.com/blog/context-management
- https://claude.com/blog/claude-opus-5-5-built-for-coding-sessions-that-use-more-context
- https://www.anthropic.com/engineering/harness-design-long-running-apps
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
- https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals

**Host docs:**
- https://code.claude.com/docs/en/memory.md
- https://code.claude.com/docs/en/context-window.md
- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/model-config
- https://learn.chatgpt.com/docs/customization/memories.md
- https://learn.chatgpt.com/docs/hooks.md
- https://geminicli.com/docs/tools/memory
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management
- https://opencode.ai/docs/plugins.md
- https://opencode.ai/docs/rules.md

**Peers:**
- github.com/open-gsd/gsd-core
- github.com/OthmanAdi/planning-with-files (docs/evals.md)
- github.com/bmad-code-org/BMAD-METHOD
- github.com/oraios/serena
- github.com/mem0ai/mem0
- github.com/letta-ai/letta-code
- github.com/getzep/graphiti
- github.com/dial481/locomo-audit

**Standards:**
- https://agents.md
- https://agentskills.io/specification
- https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/
- https://www.w3.org/community/ai-agent-memory-interop/
