# Project Memory Routing — Feature Investigation & Spec

**Date:** `2026-10-31` · **Status:** Implemented `2026-10-31`, decision in `docs/decisions/ADR-0050-project-memory-routing.md`. Not built yet: the tier-0 live-gate assertions and the paid tier-1 `routing-plain-words` scenario (§3.8), Gemini's private memory in H-12 (its path is unverified), and the OpenCode 2 `instructions.entry` copy (WATCH). `/pan:settings` names the host memory switches but does not offer to write the Claude key.

In a project that uses PAN, the host tool (Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI) should reach for PAN's commands for the work PAN owns (planning, running a phase, a quick fix, debugging, verifying, resuming), not improvise. Today PAN tells each host *that* the project uses PAN, never *when* to use which command. In three cases it tells the host nothing: Gemini CLI, any global install, and a project set up before the first local install. Each host also keeps a memory of its own that can teach it a different way of working, and PAN neither steers that memory nor sees it.

---

## Phase 0: Problem framing

### 0.1 Problem statement

Every host loads per-project instructions at session start and, on most hosts, its own self-written memory too. PAN embeds itself through one marker-fenced section in `AGENTS.md`, plus a `CLAUDE.md` bridge for Claude Code. That section describes PAN and lists command naming. It has no routing: nothing maps "fix this bug" to `/pan:debug` or "add a small feature" to `/pan:quick`. So a user who asks in plain words gets ad-hoc work. That work bypasses state, gates, atomic commits and the ledger PAN exists to keep. Then the host's own memory records how that ad-hoc session went, for example "to run tests use `npm test`" or "commit after each edit". The next session follows that habit instead of PAN. The more a team wants PAN to be *the* way work happens in a repository, the more these gaps cost. The hosts have also just changed the ground:
- Claude Code reads `AGENTS.md` natively only when no `CLAUDE.md` exists.
- Copilot reads `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` together.
- Codex made memory v2 the default for fresh profiles.
- OpenCode 2 dropped the `CLAUDE.md` fallback.

So the embedding needs a deliberate review now.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| A **routing contract**: a short intent → command table PAN owns, generated from command frontmatter, written into every host's per-project instructions | Rewriting the host's own memory store (PAN reads it at most, never writes it: H-11's rule holds) |
| An `instructions.routing` setting: `advisory` (default), `exclusive`, `off` | Blocking the user from working without PAN in `advisory` mode |
| Closing the coverage gaps: Gemini CLI, global installs, projects initialised after install | A new always-on hook that injects text on every prompt (cost, and a pillar conflict with progressive disclosure) |
| Steering host self-written memory from the instructions file, and a read-only hygiene check for memories that contradict the routing | Server-side Copilot Memory administration (a repository-settings action the owner takes; PAN documents it) |
| An `exclusive`-mode guard rule that reports (and with `hooks.guard: enforce`, denies) a source write made outside any PAN unit of work | Denying anything by default |
| Harness gates: the table reaches each host's loaded instructions (tier 0), and a plain-words request routes to a PAN command (tier 1, paid) | Model-specific prompt tuning |

### 0.3 Success criteria

```
SC-1: On all 5 runtimes, a local install puts the routing table into instructions the host loads at session start;
      the tier-0 live gate for each runtime proves it from the host's own CLI (not by reading the file).
SC-2: Gemini CLI loads PAN's section (today it loads none), without writing GEMINI.md, so Copilot does not load it a third time.
SC-3: A project with only a global install gets the section the first time PAN initialises or rebuilds it (new-project, memory rebuild --apply).
SC-4: In exclusive mode, a paid tier-1 scenario asks in plain words ("the login test fails, fix it") and the session runs a PAN command
      (debug or quick) in at least 4 of 5 reps on Claude Code; advisory mode is measured too and reported, not gated.
SC-5: Hygiene reports a Claude Code auto-memory entry that contradicts the routing (read-only, info level), with the file name, never the text.
SC-6: The table is generated from command frontmatter; a test fails when a routed command is renamed or removed, or the table exceeds its byte budget.
SC-7: Uninstall removes every byte PAN added (section, settings key, guard rule registration); user content is untouched; suite and gates pass.
```

### 0.4 User stories

```
As a team lead, I want every session in this repository to use PAN's commands for planning, fixes and verification,
so that state, gates and commits stay consistent, instead of reminding each developer to type /pan:quick.

As a developer, I want to say "fix the failing login test" and have the agent pick /pan:debug itself,
so that I do not need to know the command names, instead of learning PAN's catalogue first.

As a Gemini CLI user, I want the agent to know this project uses PAN at all,
so that it does not edit .planning/ by hand, instead of today, where Gemini loads none of PAN's section.

As a user with a global install, I want my new project to carry PAN's routing,
so that a teammate on a local install and I get the same behaviour, instead of the section appearing only on local installs.

As a user, I want to know when my tool's own memory teaches it to work around PAN,
so that I can delete that note, instead of discovering it from a run that skipped the gate.
```

---

## Phase 1: Internal reconnaissance

### 1.1 How PAN embeds today (code read `2026-10-31`)

| Surface | What PAN writes | Where | Evidence |
|---|---|---|---|
| `AGENTS.md` | One `<!-- BEGIN PAN WIZARD -->` section: "this project uses PAN", `.planning/` changed only through PAN, command naming per runtime, where `pan-tools` lives | Project root, **local installs only** | `pan-wizard-core/bin/lib/agents-md.cjs` `buildAgentsMdSection`; `bin/install.js` (the `if (!isGlobal)` block after the manifest) |
| `CLAUDE.md` | The same markers around `@AGENTS.md` plus "Compact instructions" | Claude runtime, local only | `buildClaudeMdBridge`, `ensureClaudeMdImport` |
| Edited sections | Kept: a section whose hash is not one PAN generated is left alone | — | `sectionState`, `PRIOR_AGENTS_SECTIONS` |
| Rebuild | `pan-tools memory rebuild [--apply]` regenerates the section and bridge, warns on directive-shaped lines (ADR-0040) | — | `memory-rebuild.cjs` |
| Gemini CLI | **Nothing it loads.** Gemini reads `GEMINI.md` by default; PAN never writes it and never sets `context.fileName` | — | grep: no `fileName`/`GEMINI.md` writer in `bin/` |
| Global installs | **Nothing in any project.** No workflow writes the section later (`new-project` does not call `memory rebuild`) | — | grep of `workflows/` and `commands/` |
| After compaction | `pan-state-reinject` hook re-injects position (Claude/Codex SessionStart `compact`; Gemini/Copilot mark-then-inject); OpenCode plugin | — | `hooks/pan-state-reinject.js`, `pan-wizard-core/opencode/pan-wizard.js` |
| Host self-written memory | Read-only H-11 check of Claude Code's auto-memory **index size**; nothing about its content | — | `hygiene.cjs` `checkHostMemory` |
| Guard | `pan-guard` pre-tool hook: `secret_write`, `state_write`, `judge_write`, `undeclared_test_edit`; `hooks.guard` off/report/enforce | Claude, Codex, Gemini, Copilot | `hooks/pan-guard.js` |
| Command triggers | Command `description:` says what a command does, not when to use it ("Systematic debugging with persistent state…") | — | `commands/pan/*.md` frontmatter |

### 1.2 Code to reuse

- `agents-md.cjs`: the section builder, the marker functions, `sectionState` and the prior-hash list. The routing table becomes part of the section, so its hash joins the prior-hash list when it changes.
- `memory-rebuild.cjs`: `cmdMemoryRebuild` already regenerates `AGENTS.md` and the bridge. It becomes the one writer the installer, `new-project` and a global-install project all go through.
- `scripts/build-help.cjs`: already generates `/pan:help` from command frontmatter. The routing table uses the same parse.
- `hygiene.cjs` `hostMemoryDir`: already finds Claude Code's auto-memory directory, including `autoMemoryDirectory`.
- `pan-guard.js`: already knows the phase in flight (`undeclared_test_edit`). The new rule reuses that read.
- `install-lib.cjs` Gemini settings merge (hooks): the same read-merge-write and strip pattern serves `context.fileName`.
- `memory-optimize.cjs` `DIRECTIVE_PATTERNS`: the routing text must not match them. A test enforces this.

### 1.3 Runtime facts (primary sources, read `2026-10-31`)

| Runtime | Loads at session start | Survives compaction | Self-written memory | Steering a project can do |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` (root → cwd), `CLAUDE.local.md`, unscoped `.claude/rules/*.md`; `AGENTS.md` **only when no CLAUDE.md is on the path** (2.1.277+); `@imports` 4 hops | Root `CLAUDE.md`, unscoped rules and auto memory are re-read from disk | **Auto memory**, on by default: `~/.claude/projects/<repo>/memory/`, index first 200 lines / 25 KB. It "skips anything your CLAUDE.md files already say". No precedence with CLAUDE.md: on conflict the model "may pick one arbitrarily" | `autoMemoryEnabled: false` in project settings; `claudeMdExcludes` |
| Codex | `AGENTS.override.md` / `AGENTS.md` per directory root → cwd, **32 KiB combined** (`project_doc_max_bytes`) | Re-read every run | **Memories**: off by default, machine-wide (`~/.codex/memories/`), summary injected (2,500 tokens); memory v2 default for fresh profiles from v0.165.0 (`2026-10-27`). No per-project opt-out; docs say must-apply rules belong in AGENTS.md | None per project |
| Gemini CLI | `GEMINI.md` hierarchy; `context.fileName` string or array (`["AGENTS.md","GEMINI.md"]`) in project `.gemini/settings.json`; `@imports` depth 5 | — | No `save_memory` tool; on "remember" the model edits GEMINI.md or a private `MEMORY.md`. `experimental.autoMemory` (off; approval inbox; cannot touch project GEMINI.md) | `context.fileName`; project settings override user |
| Antigravity | `AGENTS.md`, `GEMINI.md`, `.agents/AGENTS.md`, `.agents/rules/*.md` (rules need `trigger:` frontmatter); 24,000 bytes per file; always-on rules share a 20,000-token budget | — | None documented | — |
| OpenCode 1 | `AGENTS.md` up from cwd, falls back to `CLAUDE.md`; `instructions` array | — | None | `instructions` |
| OpenCode 2 | `AGENTS.md` only (no CLAUDE.md fallback); plugin `ctx.session.instructions.entry.put` entries survive compaction and keep the prompt cache | Entries survive | None | `OPENCODE_DISABLE_PROJECT_CONFIG` |
| Copilot CLI | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (`applyTo`, auto-applied on read/edit since 1.0.100), **and** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/rules` combined, identical copies de-duplicated, no precedence | — | **Copilot Memory** (server-side, repository facts on by default, citations checked, 90-day expiry; root agent writes; `/memory off`; repo admin can disable) | `/instructions` toggles; custom agents need `include-custom-instructions: true` (PAN sets it) |

Three consequences:
1. **`AGENTS.md` is the right single home.** Codex, OpenCode (both versions), Copilot and Antigravity read it natively, and Claude Code reads it through the bridge. Only Gemini CLI needs a pointer.
2. **The pointer for Gemini must not be a `GEMINI.md` file.** Copilot loads `GEMINI.md` too, which would put PAN's section in front of Copilot a third time (MI-098 already records the double load). Setting `context.fileName` in `.gemini/settings.json` touches only Gemini.
3. **Host memory loses to nothing by rule.** No host documents a precedence between its own memory and the instructions file. Two things work: say the routing in the always-loaded file, which Claude's auto memory then skips recording, and find the contradicting notes, which hygiene can do read-only.

---

## Phase 2: Competitive analysis (primary sources, read `2026-10-31`)

| Peer | How it embeds | Routing? | Enforcement | Uninstall |
|---|---|---|---|---|
| GSD (archived `2026-05-31`) | Managed blocks in CLAUDE.md / AGENTS.md (`GSD:{name}-start` markers) via `generate-claude-md`; Copilot block in copilot-instructions.md | **Yes**: a "Workflow Enforcement" section routes edits to `/gsd:quick`, `/gsd:debug`, `/gsd:execute-phase` | Optional `gsd-workflow-guard.js` PreToolUse hook, off by default, advisory | Copilot block stripped; CLAUDE.md sections not |
| BMAD v7 | AGENTS.md block written only when the user runs its project-context skill; proposes reducing CLAUDE.md to `@AGENTS.md` | Context, not routing | None | Undocumented for v7 |
| spec-kit | Opt-in `agent-context` extension, markers in each runtime's file, refreshed by hooks | Context | None | No removal code |
| OpenSpec 1.16 | **Stopped writing instruction files** in `2026-02`; skills and commands only | Via skill descriptions | None | Legacy cleanup asks first |
| superpowers 7.0 | No files: a SessionStart hook injects a routing skill ("even a 1% chance a skill might apply") on startup, clear and compact; Gemini via extension `contextFileName` | **Yes, aggressive** | None | Clean (plugin) |

**Read.** The market split two ways. Some peers write marked blocks into instruction files: GSD, spec-kit and BMAD. Others inject at session start or rely on skill descriptions: superpowers and OpenSpec. Only GSD and superpowers route intent to commands, and only GSD offers an enforcement hook (advisory, off by default). PAN would differ in four ways:
1. **one** section in AGENTS.md with a measured routing table, generated and kept within a byte budget;
2. a Gemini pointer that does not triple-load Copilot;
3. a read-only audit of host memory for contradictions, which no peer has;
4. an opt-in mode whose enforcement goes through the guard PAN already ships.

superpowers' always-inject approach is the counter-example: it costs context on every session start, and PAN's thesis (progressive disclosure) rejects that as a default.

---

## Phase 3: Design

### 3.1 The routing contract

Each command that owns an intent gets a `route:` line in its frontmatter: one clause that says when to use it, in the user's words. The section builder renders the routed commands as a short table. The table is not the help index, and it stays small enough to be always loaded:

```markdown
### When to use PAN in this project

| When the user wants to … | Run |
|---|---|
| fix a bug or a failing test | debug |
| make a small change or add a small feature | quick |
| plan the next phase | plan-phase |
| build the planned phase | exec-phase |
| check finished work against its goal | verify-phase |
| see where the project stands, or pick up where it stopped | progress / resume |
| start a new piece of work from an idea | new-project / add-phase |

Command names carry each runtime's prefix (`/pan:debug`, `/pan-debug`, `$pan-debug`; see above).
```

Rules for the table:
- **Generated.** The table is built from `route:` frontmatter in `commands/pan/*.md`, using the same parse as `build-help.cjs`. A routed command that is renamed or removed fails a test.
- **Budget.** At most 10 rows and about 1.2 KB. Codex shares 32 KiB across every `AGENTS.md`, and Antigravity caps a file at 24,000 bytes. A test fails when the section passes 2 KB.
- **No directive shapes.** The ADR-0040 `DIRECTIVE_PATTERNS` must not match any line, and a test asserts it. The wording describes the project ("in this project, X is done with Y") rather than ordering the agent around.
- **Runtime-neutral.** One section serves every runtime in the project, so the table names commands bare and the line above it explains each runtime's prefix (the M34 lesson).

### 3.2 Modes (`instructions.routing` in `.planning/config.json`)

The key lives under `instructions`, not `routing`: `routing.*` already holds model routing (`routing.strategy`, `routing.provider`).

| Mode | Section text | Guard | Default |
|---|---|---|---|
| `off` | Today's section, no table | — | — |
| `advisory` | The section plus the table, and one line: "Plain-language requests for these actions are handled with the PAN command." | — | **yes** |
| `exclusive` | As advisory, plus "This project does this work only through PAN: when a request matches a row, run that command; if none fits, say so and ask before changing source files." | New rule `unrouted_write` (§3.5) | — |

`/pan:settings` sets the mode and runs `memory rebuild --apply`. Each mode's text has its own hash in `PRIOR_AGENTS_SECTIONS`, so a project that switches mode or upgrades PAN keeps the "PAN wrote this" recognition. A project that edited the section keeps its own text, as today.

### 3.3 Coverage gaps

1. **Gemini CLI.** On a Gemini install (local), merge `context.fileName` into the project's `.gemini/settings.json`:
   - absent → `["AGENTS.md", "GEMINI.md"]`;
   - a string → `[thatString, "AGENTS.md"]`;
   - an array without `AGENTS.md` → append it.

   Record that PAN added it in the manifest's config-edits list, so uninstall removes exactly PAN's entry. On a global Gemini install, merge into `~/.gemini/settings.json` with the same rules: the user scope reads `AGENTS.md` in every project, which only matters where one exists.
2. **Global installs and later projects.** `/pan:new-project` (and `pan-tools init` where it creates `.planning/`) ends with `memory rebuild --apply --only agents-md`, which writes the section and, when a Claude install is visible (local or global), the bridge. `memory rebuild` learns to detect global installs (the engine's own location), so the bridge is written for a global Claude install too.
3. **Claude Code with no CLAUDE.md.** Claude Code 2.1.277+ reads `AGENTS.md` natively when no `CLAUDE.md` exists. PAN keeps writing the bridge anyway: it carries the compact instructions, and it is what makes `AGENTS.md` load once a user adds their own `CLAUDE.md` later. No change.
4. **OpenCode 2.** `AGENTS.md` is read natively. **Optional, later:** the plugin could put the routing table in an `instructions.entry`. That survives compaction and keeps the prompt cache, but it duplicates the file, so it is WATCH until a harness run shows routing lost after compaction on OpenCode 2.

### 3.4 Host self-written memory

PAN never writes a host's memory store; this is H-11's rule and it stands. Three moves instead:

1. **Say it where the host looks first.** The section gets one line: "How this project plans, builds, checks and commits work is recorded here and in `.planning/`; a saved memory that describes another way is out of date." Claude's auto memory "skips anything your CLAUDE.md files already say", which covers `AGENTS.md` through the import. Codex's docs put must-apply rules in AGENTS.md. Copilot's docs say custom instructions are for rules that must always apply.
2. **Find the contradictions (read-only).** A new hygiene check, H-12 `host-memory-routing`, scans these memory files line by line for phrases that route a PAN-owned action elsewhere:
   - Claude Code's auto-memory topic files (`hostMemoryDir`);
   - Gemini CLI's private project `MEMORY.md` (`~/.gemini/tmp/<id>/memory/`).

   Examples of such phrases: "edit `.planning/…`", "update state.md", "commit after each", "skip the plan", "run without PAN". It reports the file name and a rule id, never the text, at info level. Codex memories are machine-wide and span every project, so PAN does not read them: reading other projects' notes would break the privacy line `/pan:feedback` holds. Copilot Memory is server-side and not readable locally.
3. **Offer the switch, never flip it.** In `exclusive` mode, `/pan:settings` mentions, once, the host switches a project can set:
   - Claude Code: `autoMemoryEnabled: false` in `.claude/settings.json`.
   - Copilot: `/memory off`, or the repository setting.

   It asks before writing the Claude key; Copilot's is the user's own action. Neither is ever default.

### 3.5 Enforcement in exclusive mode: `unrouted_write`

`pan-guard` gains the rule `unrouted_write`. It fires on a write to a file outside the planning tree when **no PAN unit of work is in flight**. In flight means one of these:
- `state.md` names a current phase whose roadmap entry is unticked;
- a quick-task or debug session marker under `.planning/` is open;
- the write comes from a PAN agent (`agent_type` is `pan-*`, on hosts that send it).

How it behaves:
- `instructions.routing` not `exclusive` → the rule is off.
- `hooks.guard: report` → the rule appends to `guard.jsonl`.
- `hooks.guard: enforce` → the rule **denies**, with a message that names the matching command.
- It fails open on anything it cannot read, like every guard rule. OpenCode has no pre-tool hook, so the rule does not apply there; the runtime matrix says so.

GSD's equivalent shipped advisory only and off by default. PAN's is opt-in twice: `exclusive` mode plus `enforce`.

### 3.6 Architecture decision

- **New:** `route:` frontmatter on the routed commands; `buildRoutingTable(commands)` in `agents-md.cjs`; H-12 in `hygiene.cjs`; `unrouted_write` in `pan-guard.js`; `mergeGeminiContextFileName()` / `stripGeminiContextFileName()` in `install-lib.cjs`. These are pure merge and strip helpers that edit the object they are given, which matches the file's contract.
- **Changed:**
  - `buildAgentsMdSection(opts)` takes the mode and the routed commands;
  - `memory rebuild` knows global installs and takes `--only agents-md`;
  - `new-project` calls it;
  - `/pan:settings` sets `instructions.routing`;
  - `config.cjs` defaults `instructions.routing: 'advisory'`.
- **Manifest:** unchanged for files. The Gemini `context.fileName` entry is a config edit, recorded where PAN records its other settings merges so uninstall can strip it.
- **Installer:** the existing `AGENTS.md` step passes the mode, read from the project's config when one exists, else `advisory`. The Gemini step merges `context.fileName`.
- **Upgrade path:** projects whose section matches a prior hash get the new text on their next install or rebuild. Edited sections are untouched. The new section's hash joins `PRIOR_AGENTS_SECTIONS` when it next changes.

### 3.7 Implementation plan

```
1.  commands/pan/{debug,quick,plan-phase,exec-phase,verify-phase,progress,resume,new-project,add-phase}.md — add `route:`
2.  scripts/build-help.cjs — export its frontmatter parse; pan-wizard-core/bin/lib/agents-md.cjs — buildRoutingTable, modes, budget
3.  pan-wizard-core/bin/lib/config.cjs — instructions.routing default + enum; commands/pan/settings.md + workflow — set it, rebuild
4.  pan-wizard-core/bin/lib/memory-rebuild.cjs — global-install detection, --only agents-md; pan-tools.cjs dispatcher flag
5.  pan-wizard-core/workflows/new-project.md — final step runs memory rebuild --apply --only agents-md
6.  bin/install-lib.cjs + bin/install.js — Gemini context.fileName merge/strip; pass the mode to the AGENTS.md step
7.  pan-wizard-core/bin/lib/hygiene.cjs — H-12 host-memory-routing (Claude topic files, Gemini private MEMORY.md)
8.  hooks/pan-guard.js — unrouted_write (exclusive + report/enforce), message names the command
9.  harness/scenarios — extend each live-gate-* (tier 0) to assert the table is in the host's loaded instructions;
    new tier-1 routing-plain-words (advisory + exclusive arms) on Claude Code
10. tests — see 3.8; docs — see Phase 4
```

### 3.8 Test plan

Unit tests live in `tests/project-memory-routing.test.cjs` unless noted. Installer tests go in `tests/scenarios/`.

**Happy path**
1. The table is generated from frontmatter: every `route:` command appears once, and in no other order than the frontmatter sort.
2. Advisory and exclusive sections render; their hashes are recognised by `sectionState` as PAN's.
3. A local Gemini install adds `AGENTS.md` to `context.fileName` and leaves other settings keys byte-identical.
4. `new-project` in a project with only a global Claude install writes `AGENTS.md` and the `CLAUDE.md` bridge.

**Edge cases**
5. `context.fileName` is a string (`"CONTEXT.md"`): the merge produces `["CONTEXT.md","AGENTS.md"]`, and uninstall restores the string.
6. `context.fileName` already lists `AGENTS.md`: there is no change, and uninstall removes nothing (PAN did not add it).
7. A project edited the section: switching mode leaves it alone, and `memory rebuild` reports `edited`.
8. Every routed command renamed: the build fails naming the missing command. An unknown `route:` command name fails.
9. The section stays under 2 KB in every mode, and a test asserts the budget.

**Error cases**
10. An unparseable `.gemini/settings.json` is left alone, with a warning (the existing null-vs-{} contract).
11. `unrouted_write` with a malformed `state.md` fails open (allow, report `guard_error`).
12. A host memory directory that cannot be read gives no H-12 finding and no throw.

**Runtime-specific**
13. Copilot: the section reaches Copilot exactly as today. No `GEMINI.md` is written, and the live gate lists no new source.
14. Codex: the section plus a 30 KiB user `AGENTS.md` stays inside 32 KiB with the user's content first in the file, or the installer warns.
15. OpenCode: `unrouted_write` is not registered, and the matrix test asserts it.
16. The routing text matches no `DIRECTIVE_PATTERNS` line in any mode.
17. The guard denies only in `exclusive` + `enforce`, and only when nothing is in flight, on Claude, Codex, Gemini and Copilot payload shapes.

**Harness**
- Tier 0: each `live-gate-*` asks the host CLI what it loaded (for example Gemini `/memory show`, Copilot instructions listing, Codex debug prompt) and finds the table's heading.
- Tier 1 (paid, owner-approved): `routing-plain-words`, 5 reps per arm, Claude Code. Each rep sends "the login test fails, fix it" to a seeded PAN project, and the trace must show `debug` or `quick` was run. Advisory is reported; exclusive is gated at 4 of 5 reps. A prompt-rule `covers:` claim ties the scenario to the new section's lines, so `--prompt-mutant` can show whether the line matters.

---

## Phase 4: Specification

## Feature: Project memory routing

### Files to create/modify

- **Create:** `tests/project-memory-routing.test.cjs`, `harness/scenarios/routing-plain-words.json`, an ADR for the decision.
- **Modify:**
  - `pan-wizard-core/bin/lib/agents-md.cjs`, `memory-rebuild.cjs`, `config.cjs`, `hygiene.cjs`;
  - `pan-wizard-core/bin/pan-tools.cjs`;
  - `hooks/pan-guard.js`;
  - `bin/install-lib.cjs`, `bin/install.js`;
  - the routed `commands/pan/*.md` and `commands/pan/settings.md`;
  - `pan-wizard-core/workflows/new-project.md` and the settings workflow;
  - the `harness/scenarios/live-gate-*.json` files;
  - `scripts/build-help.cjs` (shared parse);
  - `tests/fixtures/surface.json`, `prompt-rules.json` (regenerate).

### Implementation steps

1. Add the frontmatter and the table builder, with the budget and directive tests (no behaviour change yet; `off` renders today's text).
2. Add the `instructions.routing` config key and its default, and render advisory as the default. Run `memory rebuild` against the fixtures. Add the new hash.
3. Gemini `context.fileName` merge and strip, with installer scenario tests on all 5 runtimes (no `GEMINI.md` anywhere).
4. `memory rebuild` for global installs; `new-project` calls it.
5. H-12 read-only check.
6. `unrouted_write` guard rule behind `exclusive`.
7. Harness tier-0 assertions; then, with the owner's approval, the tier-1 scenario. Ship advisory as the default only if tier 1 shows it does not make routing worse than today.

### Tests required

Section 3.8: 17 unit and scenario cases, tier-0 live-gate assertions on every runtime, and one tier-1 scenario.

### Documentation updates

- `docs/USER-GUIDE.md`: a "How PAN tells your tool to use it" section covering the modes, what each host loads, and how to turn host memory off.
- the config-key table in `docs/USER-GUIDE.md`: `instructions.routing`.
- `docs/ARCHITECTURE.md`: the embedding table from §1.3, condensed.
- `docs/CLI-REFERENCE.md`: `memory rebuild --only`.
- `docs/SECURITY-HARDENING.md`: `unrouted_write`.
- `CHANGELOG.md`.
- Regenerate `docs/SKILLS-*.md`.

### Runtime matrix

| Runtime | Table loaded via | Survives compaction | Host memory steering | `unrouted_write` | Notes |
|---|---|---|---|---|---|
| Claude | `CLAUDE.md` → `@AGENTS.md` | ✅ re-read from disk | Section line; H-12 reads auto memory; optional `autoMemoryEnabled:false` | ✅ | Bridge kept even though 2.1.277+ reads AGENTS.md natively |
| Codex | `AGENTS.md` | ✅ re-read every run | Section line (memories are machine-wide; not read) | ✅ | 32 KiB shared budget: section ≤ 2 KB |
| Gemini | `AGENTS.md` via `context.fileName` (**new**) | ✅ (context file) | Section line; H-12 reads private MEMORY.md | ✅ | No GEMINI.md written; Antigravity reads AGENTS.md natively |
| OpenCode | `AGENTS.md` (v1 and v2) | v1 ✅; v2 ✅ (file) | Section line (no host memory) | ❌ (no pre-tool hook) | v2 `instructions.entry` is WATCH |
| Copilot | `AGENTS.md` (+ `CLAUDE.md` import, MI-098) | per Copilot | Section line; `/memory off` documented | ✅ | `include-custom-instructions: true` already set |

---

## Phase 5: Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| A routing table makes the agent run heavy PAN commands for trivial asks (over-routing) | High: cost, user annoyance | Rows describe real intents only; the "small change → quick" row sits first among change rows; tier 1 measures cost per rep, not only routing rate; `off` remains |
| Always-loaded text grows every session's context | Medium | A test-enforced 2 KB budget; no per-prompt hook; no skill bodies injected (the superpowers approach is rejected) |
| `exclusive` + `enforce` blocks legitimate work (a docs typo, a config tweak) | High in that mode | Opt-in twice; the deny message names the command to use; `quick` is cheap; rule fails open on any read error; a project can list exempt globs (`instructions.routing_exempt`) |
| Upgrading rewrites a section the user relies on | Medium | Unchanged contract: only a section whose hash PAN generated is replaced; edited sections are kept and reported |
| Gemini settings merge clobbers user config | High | Merge helper is pure and tested on string, array and absent cases; unparseable settings are never rewritten; uninstall strips only PAN's own entry |
| H-12 reads private host memory | Medium (privacy) | Read-only, reports file and rule only, never the text, project-scoped dirs only; never Codex's machine-wide store |
| Directive-shaped routing text trips ADR-0040's scanner or reads as injection | Medium | A test asserts no `DIRECTIVE_PATTERNS` match; wording describes the project rather than commanding the agent |
| Hosts change discovery again (Claude's AGENTS.md rule, OpenCode 2's fallback removal) | Medium | Tier-0 live gates assert from the host CLI itself on every runtime, so drift fails a gate instead of a user |
| The routing has no measurable effect (decorative) | Medium | Tier-1 scenario plus `--prompt-mutant` on the section's lines; ship `exclusive` only with a measured lift |

---

## Sources (read `2026-10-31`)

- Claude Code: code.claude.com/docs/en/memory, /context-window, /hooks, /output-styles
- Codex: learn.chatgpt.com/docs (agent-configuration/agents-md, customization/memories, config-reference); `openai/codex` releases v0.165.0 (`2026-10-27`), v0.166.0 (`2026-10-29`); `codex-rs/memories/README.md`
- Gemini CLI: geminicli.com/docs (cli/gemini-md, reference/configuration, reference/memport, cli/auto-memory, hooks/reference); `packages/core/src/prompts/snippets.ts`
- Antigravity: antigravity.google/docs/rules, /cli/gcli-migration
- OpenCode: opencode.ai/docs/rules; opencode.ai/v2/docs/instructions; v2.2.0 release (`2026-10-27`)
- Copilot CLI: docs.github.com/en/copilot (add-custom-instructions, CLI command reference, hooks reference, concepts/agents/copilot-memory); copilot-cli releases 1.0.86, 1.0.89, 1.0.100
- Peers: GSD `templates/claude-md.md` and `bin/install.js`; BMAD `skills/bmad-project-context/`; spec-kit `extensions/agent-context/`; OpenSpec `openspec/specs/legacy-cleanup` (v1.16.0, `2026-10-30`); obra/superpowers `hooks/` and `.opencode/plugins/superpowers.js` (v7.0.1)
