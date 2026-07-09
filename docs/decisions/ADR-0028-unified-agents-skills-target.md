# ADR-0028: Unified `.agents/skills/` Build Target

## Status
Accepted — Phase 1 shipped 2026-06-10 (`--unified-skills` opt-in: runtime-neutral compiler `convertClaudeCommandToUnifiedSkill()`, all five runtimes wired, proprietary-surface sweep, manifest + uninstall integration). Phase 2 substantially shipped same day: shared runtime-neutral core at `.agents/pan-wizard-core/` (skills no longer depend on which runtime installed last) and ref-counted shared-tree uninstall (last tracker removes and prunes). Agent-ref canonicalization shipped 2026-06-11: shared content references canonical agent-definition copies at `.agents/pan-wizard-core/agents/` instead of the installing runtime's agents dir — shared-tree content is now runtime-neutral end to end. Still open before default-on: per-runtime live discovery gates. Phase 3 first half (AGENTS.md universal rules layer) shipped 2026-06-11: local installs contribute a marker-fenced PAN section to the project's AGENTS.md with a CLAUDE.md `@AGENTS.md` bridge and ref-counted uninstall; plugin/marketplace packaging remains. (Promotes item 10 of `docs/ECOSYSTEM-REVIEW-2026-06.md` §4 out of proposal status; supersedes the per-runtime command-tree strategy for command-shaped content.)

## Context

PAN Wizard ships the same command/workflow/reference content to five runtimes by converting it five times into five proprietary layouts (`.claude/commands/`, `.codex/`, `.gemini/`, `.opencode/commands/`, `.github/skills/`). The installer carries a converter, a sweep path, and a manifest section per runtime, and every runtime format change (three of which landed in v3.9.0 alone — Codex, Copilot, OpenCode) is a PAN maintenance event.

Between January and June 2026 the ecosystem converged on the **Agent Skills standard**: a `SKILL.md`-per-directory tree under `.agents/skills/` (project) or `~/.agents/skills/` (user), read natively by all five PAN target runtimes. Two additional facts sharpen the opportunity:

- **PAN already writes the tree.** The v3.9.0 Codex migration (ecosystem review item 7) moved Codex skills to `.agents/skills/` after live verification that the old `$CODEX_HOME/skills` location was dead. The compile-to-skills path exists and is tested; it is simply only wired to one runtime.
- **Antigravity CLI** (Gemini CLI's successor for individual accounts, effective 2026-06-18) reads `.agents/skills/` natively. The recorded decision (review item 1, 2026-06-10) is to serve Antigravity through this tree rather than build a bespoke sixth runtime — which makes the unified target the *only* planned delivery path for an entire user population, not merely a simplification.

The cost of the status quo is structural: five copies of identical content drift independently, the installer is the largest unfactored surface in the codebase, and each new runtime (Antigravity will not be the last) multiplies the work instead of adding a consumer.

## Decision

Compile command-shaped content — `commands/pan/*.md`, workflow protocols, and agent-loaded references — **once**, into a standard `.agents/skills/` tree, and make that tree the canonical install surface for every runtime. Keep per-runtime conversion only for artifacts that are genuinely runtime-specific:

| Artifact | Strategy |
|---|---|
| Commands / workflows / references | **Unified:** one compile pass → `.agents/skills/pan-*/SKILL.md` (project root for `--local`, `~/.agents/skills/` for global) |
| Agents (subagent definitions) | Per-runtime (formats genuinely differ: Claude markdown, Codex TOML, Copilot `.agent.md`, OpenCode `permission` maps) |
| Hooks | Per-runtime (event names and schemas differ; see review item 13 for the mapping-table follow-up) |
| Settings / config / statusline | Per-runtime (documented read paths differ) |

### Rollout gates

1. **Per-runtime verification gate.** A runtime flips from its proprietary command tree to the shared tree only after a live discovery smoke test on that runtime (the standard's adoption claims were corroborated during the June 2026 review, but PAN verifies before building — the Codex migration caught a dead install location exactly this way).
2. **Opt-in first.** Phase 1 ships behind `--unified-skills`; fresh installs default to it only once all five runtimes pass the gate. Upgrades sweep the legacy per-runtime trees the same way the v3.9.0 Codex migration swept `.codex/skills/pan-*`.
3. **Frontmatter adapter, not lowest common denominator.** Runtime-specific frontmatter (e.g. Claude's `context: fork`, `allowed-tools`) is emitted into SKILL.md and relied on being ignored by runtimes that don't consume it; anything that *breaks* a runtime's parser is handled by the compile pass, not by forking the content.

### Phasing

- **Phase 1 (v4.0-alpha):** extract the Codex skills-compile path into a runtime-neutral compiler (pure functions, unit-tested); wire all runtimes behind `--unified-skills`; per-runtime live gates.
- **Phase 2 (v4.0):** default-on for fresh installs; upgrade sweep; manifest consolidation (single `../.agents/skills/` key space — the out-of-tree manifest convention from the Codex migration generalizes).
- **Phase 3 (v4.x):** the tree becomes the substrate for plugin/marketplace packaging (review item 11) and the `AGENTS.md` universal rules layer (item 14).

## Consequences

**Positive.** One source of truth for command content ends the five-way drift class permanently. The installer's largest conversion surface collapses into one compiler plus thin per-runtime adapters. New runtimes (Antigravity first) become consumers of an existing tree — near-zero marginal cost. Gemini-individual users displaced on 2026-06-18 get full PAN command coverage without a sixth runtime.

**Negative / risks.** A shared tree is a shared failure domain: a compiler bug ships to every runtime at once (mitigated by the per-runtime live gates and the existing scenario-test matrix). Discovery semantics may differ subtly between runtimes (precedence vs. proprietary trees during the transition; the sweep ordering matters). Users who hand-edited installed command files lose those edits in the sweep (same trade accepted in the v3.9.0 Codex migration; patch-backup machinery already skips out-of-tree keys by design and needs extension rather than invention).

**Explicitly out of scope.** Hooks unification (item 13), agent-format unification (no standard exists), MCP-server delivery (item 16).
