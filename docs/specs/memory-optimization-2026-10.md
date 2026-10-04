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
