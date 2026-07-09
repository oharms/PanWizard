# Skill-Aligned Decomposition (SAD pass)

**Status:** Shipped (v3.13.0)
**Decision record:** ADR-0038 (builds on ADR-0036's distill-and-select principle)
**External trigger:** Alibaba **SkillWeaver** (arXiv 2606.18051) — "Compositional Skill Routing for LLM Agents: Decompose, Retrieve, and Compose"

---

## 1. Problem

PAN's planning workflow decomposes a phase in **one shot**: `pan-planner` reads context/research/requirements, drafts a task list, and immediately groups tasks into plans. Nothing checks that the decomposition's *vocabulary and granularity* line up with the machinery that actually exists in the install:

- **Learnings topics** (`pan-wizard-core/learnings/`) — distilled patterns executors should follow. A task worded "handle file writes robustly" never surfaces `universal/atomic-state.md`; a task worded "atomic state writes" does.
- **Templates** (`pan-wizard-core/templates/`) — scaffolding that already exists. Plans occasionally re-describe artifacts a template already defines.
- **References** (`pan-wizard-core/references/`) — conventions (tdd.md, checkpoints.md, guardrails.md) that specific task wordings would anchor to.
- **Commands** (`commands/pan/*.md`) — capabilities (e.g. `/pan:phase-tests`) plans can lean on instead of re-inventing.

SkillWeaver measured exactly this failure mode at scale: one-shot decomposition against a 2,209-tool MCP library hit **51%** decomposition accuracy; adding a *Skill-Aware Decomposition* feedback loop — draft → retrieve loosely-matching skills → feed matches back → rewrite the decomposition to match the granularity/vocabulary of skills that exist — reached **92%** (with a larger model). PAN's skill surface is ~140 files, not 2,209, so the *token* savings headline does not apply — but the *alignment accuracy* mechanism does.

## 2. What we are building (and not building)

**Build:** a dependency-free, advisory alignment pass:

1. Planner drafts its task list (existing `break_into_tasks` step — unchanged).
2. Planner runs `pan-tools skills align --draft-file <draft>`; the tool scores each draft task against an on-the-fly index of commands, templates, references, and learnings topics using the shipped keyword scorer (`scoreRelevance` from `knowledge.cjs`).
3. The tool returns per-task matches plus a deduplicated, **token-budgeted** vocabulary hint list.
4. Planner realigns task wording/granularity to the matched skill names and cites matched learnings topics in task `<action>` blocks. Unmatched tasks are a signal to reconsider wording or splitting — **never** to add scope.

**Do not build** (ADR-0036 guardrails hold):

- No embeddings, no FAISS, no vector store — SkillWeaver's retrieval layer is the index-everything shape ADR-0036 forbids, and at ~140 skills a keyword scorer is sufficient.
- No persisted index file — the walk is ~140 small files (<50 ms); building on the fly avoids staleness, installer/manifest changes, and a rebuild step. (Deviation from both SkillWeaver's FAISS index and `learn-index.cjs`'s `index.json`, justified by scale.)
- No blocking gate — the pass is advisory and fail-open. If `skills align` errors (partial install, non-Claude runtime layout), the planner proceeds exactly as today.
- No LLM calls inside the tool — the "rewrite" half of the feedback loop stays where it belongs: in the planner agent, which is already an LLM.

## 3. Architecture

```
pan-planner (LLM)                          pan-tools (deterministic)
─────────────────                          ─────────────────────────
break_into_tasks                            skills align
  │  draft task list (one per line)           │
  ├────────────── --draft-file ──────────────▶│ buildSkillIndex(root)
  │                                           │   commands/pan/*.md      → kind: command
  │                                           │   pan-wizard-core/templates/**  → kind: template
  │                                           │   pan-wizard-core/references/*  → kind: reference
  │                                           │   learnings index topics → kind: learning
  │                                           │ alignTasks(tasks, index)
  │                                           │   scoreRelevance(task, skill head)
  │                                           │   top-k per task, min-score filter
  │                                           │   dedupe → budget-packed vocabulary
  │◀───────────── JSON hints ─────────────────┘
skill_alignment (NEW step)
  realign wording/granularity; cite matched
  topics in <action>; unmatched → reconsider
  │
build_dependency_graph … (unchanged)
```

### 3.1 Module: `pan-wizard-core/bin/lib/skill-align.cjs`

New core module (the learn-index analog for the whole skill surface). Exports:

| Export | Purpose |
|---|---|
| `resolveSkillRoot()` | Default root = `path.resolve(__dirname, '..', '..', '..')` — the install root (`~/.claude/`) or the source repo root; same relative layout in both (mirrors `experiment.cjs` `PAN_SOURCE_ROOT`). |
| `buildSkillIndex(root)` | Walk the four skill roots; return `{entries, stats}`. Missing roots are skipped and reported in `stats.skipped_roots`, never thrown. |
| `parseDraftTasks(text)` | Split a draft blob into task strings: strips bullets (`-`, `*`, `+`), numbering (`1.`/`1)`), checkboxes (`[ ]`/`[x]`), drops headings/blank/short lines. |
| `alignTasks(root, tasks, opts)` | The SAD pass. Returns the result object in §3.3. |
| `cmdSkillsIndex(root, raw)` / `cmdSkillsAlign(root, opts, raw)` | CLI wrappers. |

**Index entry shape:** `{kind, name, description, file, tokens_est}` plus an internal scoring head (not serialized): frontmatter `name` + `description` + the first `SKILL_ALIGN_CONTENT_CAP` (700) chars of body. Scoring against a capped head instead of full bodies keeps precision up — every command body mentions "plan"/"phase"/"file", and full-body scoring would match everything.

**Learnings integration:** topics come from `learn-index.cjs` `readIndex(root)` (name = `scope/topic`); content for scoring is the topic file body (same cap). No duplication of the relevance table — SAD is cue-based, not role-based, and complements `learn topics-for`.

**Cue hygiene:** before scoring, the task cue drops a small curated stop-list of planning glue words (`create`, `add`, `implement`, `update`, `write`, `make`, `setup`, `ensure`, …) so "Create the API" doesn't match everything containing "create". `scoreRelevance` already drops words < 3 chars.

### 3.2 CLI

```
pan-tools skills index [--source-root <path>] [--raw]
pan-tools skills align (--draft "<text>" | --draft-file <path>)
                       [--top <k=3>] [--min-score <n=1>]
                       [--token-budget <n=1500>] [--source-root <path>] [--raw]
```

`--source-root` exists for tests and unusual layouts; the default resolution needs no flag in any shipped runtime. On runtimes whose command files are converted formats (Codex/Gemini TOML etc.), the `command` kind simply indexes zero entries and the other three kinds still work — `pan-wizard-core/` ships to every runtime.

### 3.3 Output contract (`skills align`)

```json
{
  "tasks": [
    { "task": "Add atomic write for state.md",
      "matches": [ {"kind": "learning", "name": "universal/atomic-state", "file": "pan-wizard-core/learnings/universal/atomic-state.md", "score": 9} ],
      "matched": true }
  ],
  "coverage": { "matched": 4, "total": 5, "ratio": 0.8 },
  "vocabulary": [ {"kind": "learning", "name": "universal/atomic-state", "description": "…one line…", "file": "…", "tokens": 14} ],
  "vocabulary_tokens": 220,
  "dropped": [ {"kind": "reference", "name": "checkpoints", "tokens": 30} ],
  "index_stats": { "entries": 137, "by_kind": {"command": 56, "template": 41, "reference": 15, "learning": 25}, "skipped_roots": [] },
  "top_k": 3, "min_score": 1, "token_budget": 1500
}
```

- Per-task `matches` carry **no descriptions** (names only) — they stay tiny regardless of task count.
- `vocabulary` is the payload the planner actually re-reads: matches deduped across tasks (by kind+name), ranked by aggregate score, greedy-packed into `--token-budget` (name + description at `CHARS_PER_TOKEN`); overflow goes to `dropped` so truncation is never silent (ADR-0036 "no silent caps").
- Errors return `{error}` JSON: empty/blank draft, no parseable tasks, more than `SKILL_ALIGN_MAX_TASKS` (50) tasks, unreadable `--draft-file`.

### 3.4 Constants (`constants.cjs`)

| Constant | Value | Why |
|---|---|---|
| `SKILL_ALIGN_TOP_K` | 3 | SkillWeaver retrieves small top-k candidate sets per sub-task; 3 keeps per-task hints readable. |
| `SKILL_ALIGN_MIN_SCORE` | 1 | Any real keyword overlap qualifies; the stop-list handles glue-word noise. |
| `SKILL_ALIGN_VOCAB_BUDGET_TOKENS` | 1500 | Same order as `MEMORY_SELECT_BUDGET_TOKENS` (2000); hints must stay a fraction of the planner's learnings budget (5000). |
| `SKILL_ALIGN_MAX_TASKS` | 50 | A phase draft beyond 50 tasks is itself a planning smell; also bounds worst-case scoring work. |
| `SKILL_ALIGN_CONTENT_CAP` | 700 chars | ≈ first paragraph/objective — the high-signal head of every skill file. |

### 3.5 Workflow wiring

**`agents/pan-planner.md`** — new `<step name="skill_alignment">` between `break_into_tasks` and `build_dependency_graph`:

- Write draft task names (one per line) to a temp file, run `skills align --draft-file … --raw`, read hints.
- Realign: rename/re-split tasks so `<action>` blocks reference real template/command/pattern names; cite matched learnings topics where they apply.
- Unmatched task ⇒ reconsider wording or granularity — explicitly **not** a license to add tasks/scope.
- Fail-open: on any error, skip the step and continue (`2>/dev/null || true` semantics).

**`pan-wizard-core/workflows/plan-phase.md`** — one added planner-prompt quality-gate line: task vocabulary aligned via `skills align` (or the pass consciously skipped). The orchestrator flow is otherwise untouched.

## 4. Why this fits ADR-0036's yardstick

| Yardstick | SAD pass |
|---|---|
| Distilled, not raw | Hints are names + one-line descriptions, never file bodies. |
| Cue-selected, not top-k-over-everything | Cue = the draft task text; selection is per-task top-k over a ~140-entry surface, then deduped. |
| Budget-bounded at load time | `SKILL_ALIGN_VOCAB_BUDGET_TOKENS` with explicit `dropped` reporting. |
| No index-everything store | No persisted index at all; rebuilt per call from the filesystem. |
| Zero runtime dependencies | Reuses `scoreRelevance`, `fs`, `path`. |

## 5. Acceptance & rollback

- **Advisory-only invariant:** no orchestrator step, checker dimension, or exit code depends on the pass having run. Removing the planner step reverts behavior fully; the CLI command remains harmless.
- **Field signal to watch** (same telemetry channel as ADR-0036's acceptance signal): plan-checker `requirement_coverage` / `task_completeness` iteration counts and `optimize trace` `plan_checker_issues` events. If revision-loop iterations drop on projects with learnings installed, the pass is earning its keep; if hints are consistently empty/ignored, delete the planner step (one-line revert).
- **Non-goals stay non-goals:** no auto-rewriting of tasks by the tool, no execution-graph (DAG) composition — PAN's wave assignment already does that downstream.

## 6. Test plan

Unit (`tests/skill-align.test.cjs`):
- `parseDraftTasks` — bullets, numbering, checkboxes, headings dropped, blank/short lines dropped.
- `buildSkillIndex` — counts per kind on a temp fixture root; missing roots → `skipped_roots`, no throw; frontmatter name/description extraction.
- `alignTasks` — match ranking, top-k cap, min-score filter, unmatched task shape, coverage math, vocabulary dedupe + budget packing + `dropped`, stop-list (glue-word-only task matches nothing), error cases (empty, >50 tasks).
- CLI dispatch via `runPanTools('skills align --draft … --source-root <tmp>')` — JSON shape, `--raw` human output, unknown-subcommand error, `--draft-file` missing file error.
- Module surface pinned in `tests/fixtures/module-surface.json` (regenerated).
