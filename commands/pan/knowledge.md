---
name: pan:knowledge
group: Knowledge
description: Grounded Q&A, multi-turn design discussion, and playbook generation. Three modes in one command.
argument-hint: "ask <question> | discuss <phase> <topic> | playbook"
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - Task
---

<objective>
Retrieve, refine, or consolidate project knowledge. Three modes:

- **ask** — answer a natural-language question with inline citations grounded in `.planning/` + `docs/`.
- **discuss** — multi-turn refinement of a phase's context. Session state persists across invocations.
- **playbook** — aggregate all agents' memory (E-4 layer) into `.planning/playbook.md`, organized by category (Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps).

Consolidates Spec B v1's X-3 converse + X-6 teach + X-10 explain into one command.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/knowledge.cjs
@~/.claude/agents/pan-knowledge.md
@~/.claude/pan-wizard-core/templates/playbook.md
</execution_context>

<modes>

### `ask <question>`

```
/pan:knowledge ask "why does phase 4 have a race condition fix?"
```

**Flow:**
1. `pan-tools knowledge ask "<question>"` returns a ranked list of candidate files.
2. Spawn `pan-knowledge` with `<mode>ask</mode>`, the question, and the top sources as `<files_to_read>`.
3. Agent reads sources, answers with citations, returns the answer to stdout. No file is written.

**Output:** inline markdown answer with `[file.md:LINE]` and `[ADR-NNNN]` citations.

### `discuss <phase> <topic-or-question>`

```
/pan:knowledge discuss 12 "should we use Redis or Memcached?"
```

**Flow:**
1. `pan-tools knowledge discuss <phase> --subcmd read` loads session state from `.planning/conversations/<phase>/session.json` (empty for new phase).
2. `pan-tools knowledge discuss <phase> --subcmd append --role user --content "<topic>"` persists the user turn.
3. Spawn `pan-knowledge` with `<mode>discuss</mode>`, session history, phase context, and the new turn.
4. Agent responds.
5. Write the agent's response to a file, then `pan-tools knowledge discuss <phase> --subcmd append --role agent --content "$(cat <response-file>)" --cites "a.md,b.md"` persists it — a reply pasted between the quotes breaks the shell line at its first `"`, `$` or backtick.
6. If after ≥3 substantive turns the agent offered to emit `context.md`, the user accepts in another `/pan:knowledge discuss <phase>` turn and the agent writes it (there is no commit subcommand).

**Session persistence:** `.planning/conversations/<phase>/session.json` — `{phase, turns: [...], created, last_updated}`, each turn with ts/role/content/cites.

### `playbook`

```
/pan:knowledge playbook
```

**Flow:**
1. `pan-tools knowledge playbook` reads every agent log that `memory list` names in `.planning/memory/`, clusters entries by category, writes `.planning/playbook.md` directly.
2. Optionally spawn `pan-knowledge` with `<mode>playbook</mode>` to polish (dedupe contradictions, consolidate similar entries). Skip the polish step if the draft looks clean.

**Output:** `.planning/playbook.md` — team-readable summary of accumulated lessons.

**Auto-invocation:** none — no workflow runs it (`/pan:milestone-done` has no playbook step). Run it by hand any time.

</modes>

<workflow>

**Onboarding a new team member:** have them run `/pan:knowledge playbook` then `/pan:knowledge ask "what conventions matter in this codebase?"`.

**Design debate:** run `/pan:knowledge discuss <phase> "<question>"` iteratively. The agent refines as the debate narrows. After convergence, accept the proposed `context.md` update.

**Bug investigation:** `/pan:knowledge ask "why did we add the retry in phase 4?"` — faster than grepping for historical context.

**Before milestone-done:** run `/pan:knowledge playbook` to collect the lessons the agent logs hold. PAN no longer writes those logs on its own (ADR-0036, amended `2026-10-04`): they hold what someone recorded with `memory append`, `memory record` or `/pan:retro` with `--write-memory`, or an older report applied, so on a project without such entries the playbook is empty.

</workflow>

<citation_format>

Agent output uses bracketed citations that link to files. Supported forms:

| Form | Example | Renders as |
|------|---------|-----------|
| Plain file | `[README.md]` | markdown link to the file |
| File + line | `[docs/ARCHITECTURE.md:200]` | link to line 200 |
| ADR | `[ADR-0015]` | link to ADR file |
| Phase artifact | `[phase-4/summary.md]` | link to phase summary |

The agent should NEVER fabricate citations. The retrieval layer's `sources` list is the allowlist.

</citation_format>

<runtime_compatibility>

| Runtime | ask | discuss | playbook |
|---------|-----|---------|----------|
| Claude Code | Full, thinking enabled | Full | Full |
| OpenCode | Full | Full | Full |
| Gemini | Full | Full | Full |
| Codex | Full | Full | Full |
| Copilot | Full | Full | Full |

The data layer (retrieval, session state, playbook clustering) is pure Node.js and runtime-agnostic. Only answer synthesis quality varies with model capability.

</runtime_compatibility>

<privacy_note>

`session.json` is persisted to disk and committed unless `.planning/conversations/` is gitignored. For sensitive design discussions, consider:

```
echo '.planning/conversations/' >> .gitignore
```

before starting a `discuss` session. Session turns are not auto-encrypted.

</privacy_note>
