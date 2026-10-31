# ADR-0050: Project memory routing

## Status

Proposed — 2026-10-31. Designed in `/featureAI` (spec `docs/specs/project_memory_routing_featureai.md`) and built the same day on the maintainer's instruction. The maintainer accepts or amends it at release review. The tier-1 measurement the spec asks for (`routing-plain-words`, paid) has not run; until it does, the default mode is a design choice, not a measured one.

## Context

Every host PAN installs into loads a project instructions file at session start, and several keep a memory of their own. PAN's marker-fenced section in `AGENTS.md` said the project uses PAN and how commands are named, but nothing about which command a plain request belongs to. A user who wrote "fix the failing test" got the host's default behaviour, not `/pan:debug`. Three gaps sat beside that:

- Gemini CLI loaded none of PAN's section: it reads `GEMINI.md` by default, and PAN neither wrote one nor set `context.fileName`.
- A global install wrote nothing into any project, and no workflow wrote the section later.
- No host defines a precedence between its own memory and the instructions file. A saved note such as "skip the plan for small fixes" can outweigh PAN's text without anyone seeing it.

Peers split two ways (spec Phase 2). GSD writes a routing section into instruction files and offers an advisory guard, off by default. superpowers injects a routing skill at every session start. PAN's thesis, progressive disclosure, rules out the always-inject approach as a default.

## Decision

1. **One routing table, in the section PAN already owns.** The routed commands carry a `route:` frontmatter line; `agents-md.cjs` `ROUTES` holds the same pairs and a test fails when the two disagree. The table names commands bare, and the line under it gives each runtime's form. The whole section stays under 2 KB in every mode (Codex shares one byte budget across every `AGENTS.md`), and no line may match the ADR-0040 directive patterns.
2. **Three modes in `instructions.routing`:** `off`, `advisory` (default) and `exclusive`. The key is not under `routing.*`, which is model routing. Every mode's text is recognised as PAN's, so switching mode or upgrading replaces it, and a section the project edited is kept as before.
3. **Gemini gets a pointer, not a file.** The installer adds `AGENTS.md` to `context.fileName` and records what it found in `pan-config-edits.json` in the config directory, so uninstall restores exactly that. A `GEMINI.md` would be loaded by Copilot CLI too, a third copy of the section.
4. **The section reaches global-install projects through `memory rebuild --only agents-md`,** which `/pan:new-project` runs and which writes the Claude bridge when a global Claude install is visible.
5. **Host memory is read, never written.** The section says a saved memory describing another way is out of date. Hygiene's `host-memory-routing` reports Claude Code memory notes that route PAN's work elsewhere, by file and rule id, never by text. Codex's memories are machine-wide and not read; Gemini's private memory path is not read until it is verified; Copilot's is on a server. `/pan:settings` names the host switches in exclusive mode and leaves them to the user.
6. **Enforcement is opt-in twice.** The guard's `unrouted_write` rule exists only in `exclusive` mode and denies only under `hooks.guard: enforce`. It fails open on anything it cannot read.

## Consequences

- Every local install, and every project `new-project` sets up, carries the table by default: roughly 850 more bytes always loaded.
- Over-routing (a heavy command for a trivial ask) is the main risk. The table lists `quick` before the phase commands, and `off` remains.
- The routing's effect is unmeasured until the paid tier-1 scenario runs; `--prompt-mutant` on the section's lines can then show whether it matters.
- Not done: the OpenCode 2 `instructions.entry` copy (WATCH, spec §3.3), the tier-0 live-gate assertions that read what each host CLI loaded, and Gemini's private memory in H-12.
