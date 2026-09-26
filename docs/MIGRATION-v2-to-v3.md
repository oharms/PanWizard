# Migration Guide: PAN Wizard v2.x → v3.x

**Target release:** v3.5.0
**Upgrade difficulty:** Low — zero breaking changes, additive only.
**Expected time:** ~5 minutes (install + verify).

This guide covers upgrading from any v2.x release (v2.10.0 is the most common starting point) to v3.5.0. Every v3.x release is fully backwards-compatible with v2.x project state — your existing `.planning/` directory, phase files, state, and workflows continue working unchanged.

## TL;DR

```bash
cd <your-project>
node <path-to-PanWizard>/bin/install.js --claude --local
# (or --codex, --gemini, --opencode, --copilot, --all)
```

That's it. Your project keeps working. You now have access to several new commands if you want them.

## What Changed

### New commands

| Command | Release | Purpose |
|---------|---------|---------|
| `/pan:cost` | v3.0 | Token usage + cost aggregation (json/table/chart output) |
| `/pan:preview` | v3.1 | Foresight: phase blast radius / cross-phase graph / milestone ETA |
| `/pan:review-deep` | v3.2 | Security audit (OWASP + STRIDE) + cross-check review |
| `/pan:knowledge` | v3.2 | Grounded Q&A / multi-turn discussion / playbook generation |
| `/pan:what-if` | v3.3 | Counterfactual phase replay in isolated git worktree |
| `/pan:mcp-bridge` | v3.3 | Discover available MCP tools + recommend for a phase |
| `/pan:learn` | v3.5 | Analyze trace events, generate optimization report |
| `/pan:optimize` | v3.5 | Apply optimizer recommendations, manage trace sessions, view stats |
| `/pan:git` | v3.5 | Phase-aware git workflow with safety guardrails (multiple subcommands) |

All are opt-in. Default PAN workflow (`/pan:new-project`, `/pan:plan-phase`, `/pan:exec-phase`, `/pan:verify-phase`, etc.) is unchanged.

### New focus-auto categories (v3.5)

- `security` — OWASP Top 10 + STRIDE audit campaigns (P0–P2)
- `distill` — AI code-bloat optimizer with 5-pass pipeline (P1–P5)

### Two new flags on existing commands

- `/pan:exec-phase <N> --hierarchical` (v3.4) — spawn `pan-conductor` as top-level orchestrator. Claude Code only, because it needs native sub-agent spawning; that is a runtime constraint, not a model one — the conductor runs on whatever model you launched the session with. On the other four runtimes the flag is a no-op that warns and falls back to flat exec.
- `/pan:exec-phase <N> --deep-review` (v3.4) — auto-invoke `/pan:review-deep` after the normal reviewer step.
- `/pan:focus-exec --deep-review` (v3.4) — same integration for focus campaigns.

### New agents

- `pan-previewer` (v3.1) — foresight synthesis
- `pan-hardener` (v3.2) — OWASP + STRIDE security audit
- `pan-meta-reviewer` (v3.2) — cross-check of reviewer + hardener
- `pan-knowledge` (v3.2) — retrieval + multi-turn + playbook (3 modes)
- `pan-counterfactual` (v3.3) — worktree replay
- `pan-conductor` (v3.4) — hierarchical orchestrator
- `pan-optimizer` (v3.5) — circular optimization analyst
- `pan-distiller` (v3.5) — AI code-bloat judgment (span-only contract)

### New `.planning/` subdirectories

The following are auto-created on first use. **None of them conflict with existing v2.x data.** You don't need to create them manually.

| Path | Created by | Purpose |
|------|-----------|---------|
| `.planning/metrics/` | cost hook + `/pan:cost append` | Token usage log (`tokens.jsonl`) |
| `.planning/bus/` | `pan-tools bus publish` + agent audit trails | Message channels (one file per channel) |
| `.planning/bridge/` | `pan-tools bridge cache` + host runtime | MCP tool discovery cache |
| `.planning/counterfactuals/` | `/pan:what-if` | Counterfactual comparison reports |
| `.planning/conversations/` | `/pan:knowledge discuss` | Multi-turn session state per phase |
| `.planning/memory/` | `/pan:retro --write-memory` (v2.10+), agent workflows | Cross-phase agent memory (also a v2.10 addition) |
| `.planning/architecture/` | `/pan:preview phases` | Generated dependency graph |
| `.planning/orchestration/` | `/pan:exec-phase --hierarchical` | Conductor trace + abort kill-switch |
| `.planning/reviews/` | `/pan:review-deep` | Consolidated deep-review reports |

New top-level files: `.planning/playbook.md` (from `/pan:knowledge playbook`), `.planning/milestones/preview-*.md` (from `/pan:preview milestone`).

If you ever want to reset: these directories are safe to delete — they rebuild on next use. If you've been logging cost for billing reconciliation, back up `.planning/metrics/tokens.jsonl` before deleting.

### New hook registration

The installer adds `SubagentStop` entries for `pan-cost-logger.js` and `pan-trace-logger.js`, and (since v3.24) a `Stop` entry for `pan-stop-guard.js`, to `.claude/settings.json`. The v3.4 cost-logger entry looked like this:

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pan-cost-logger.js"
          }
        ]
      }
    ]
  }
}
```

The hook is non-blocking and is registered on Claude Code, Codex and Copilot CLI; Gemini CLI (no subagent-completion event) and OpenCode (no PAN hooks) get no cost logger. Today's installer also writes the trace-logger and stop-guard entries described above, plus a `SessionStart` entry with the `compact` matcher for `pan-state-reinject.js`; nothing else in settings.json changes.

### Shipped hooks

- `pan-statusline.js` (unchanged)
- `pan-context-monitor.js` (unchanged)
- `pan-check-update.js` (unchanged)
- `pan-cost-logger.js` (new in v3.4)
- `pan-trace-logger.js` (new in v3.5 — circular optimization tracing)
- `pan-stop-guard.js` (Stop hook — `AfterAgent` on Gemini CLI — added in v3.24; blocks the auto-advance boundary drop once)
- `pan-state-reinject.js` (`SessionStart` hook with the `compact` matcher, Claude Code and Codex only; after a context compaction it re-injects the current phase and plan from `.planning/state.md`)

### New core modules

New modules in `pan-wizard-core/bin/lib/`. See [ARCHITECTURE.md](ARCHITECTURE.md#layer-4-core-library) for per-module descriptions:

- `bus.cjs` (v3.0)
- `cost.cjs` (v3.0)
- `preview.cjs` (v3.1)
- `review-deep.cjs` (v3.2)
- `knowledge.cjs` (v3.2)
- `whatif.cjs` (v3.3)
- `bridge.cjs` (v3.3)
- `optimize.cjs` (v3.5 — circular optimization loop)
- `git.cjs` (v3.5 — phase-aware git workflow)
- `distill.cjs` (v3.5 — AI code-bloat 5-pass optimizer)

## What Didn't Change

- `.planning/state.md` schema
- `.planning/roadmap.md` format
- `.planning/project.md` format
- `.planning/requirements.md` format
- Phase directory structure (`.planning/phases/NN-slug/`)
- Milestone archival flow (`/pan:milestone-done` → `.planning/milestones/vX.Y-roadmap.md` + `vX.Y-requirements.md`)
- Focus system commands (`/pan:focus-scan`, `/pan:focus-plan`, `/pan:focus-exec`, `/pan:focus-auto`, `/pan:focus-design`, `/pan:focus-doc-audit`, `/pan:focus-drift-walking`, `/pan:focus-sync`) — all behave identically
- Workflow command behavior (`/pan:new-project`, `/pan:plan-phase`, `/pan:exec-phase`, `/pan:verify-phase`, `/pan:debug`)
- Install CLI contracts (flags, runtimes, uninstall)

## Upgrade Steps

### 1. Back up your `.planning/` directory (optional but recommended)

```bash
cp -r .planning .planning.backup-$(date +%F)
```

v3.x doesn't touch existing `.planning/` files, but a backup is cheap insurance.

### 2. Re-run the installer

For each runtime you use:

```bash
node <PanWizard-repo>/bin/install.js --claude --local
# repeat with --codex --gemini --opencode --copilot for other runtimes
```

The installer:
- Removes the old `pan-wizard-core/` and re-copies the updated core modules, agents, commands, and hooks
- Updates `pan-file-manifest.json` with the new file hashes
- Adds `SubagentStop` hook entry to settings.json (if absent)

### 3. Verify

```bash
# Check version
cat .claude/pan-wizard-core/VERSION
# Should show the v3.5 version

# Smoke-test a new command
node .claude/pan-wizard-core/bin/pan-tools.cjs cost report --format table

# Smoke-test focus system still works (prints the command list — no side effects)
node .claude/pan-wizard-core/bin/pan-tools.cjs
```

### 4. Optional: enable the auto cost logger

It's enabled by default on a fresh install. If you're upgrading a long-lived project, verify:

```bash
grep -A2 SubagentStop .claude/settings.json
```

If missing, re-run the installer — the idempotent flow adds the entry.

## Rollback

Every v3.x feature is additive. Rollback options:

### Full rollback (uninstall)

Rolling back means uninstalling PAN — there is no public v2.x to reinstall. The public release history begins at v3.13.1; v2.x was never published, so its artifacts are not publicly available.

```bash
# Uninstall PAN entirely
node <PanWizard-repo>/bin/install.js --uninstall --claude --local
```

Your `.planning/` data survives the uninstall. New directories (`metrics/`, `bus/`, etc.) remain on disk but are inert once PAN is removed.

### Partial rollback (keep v3.5 but disable specific features)

- **Disable auto cost logging:** remove the SubagentStop entry from `.claude/settings.json`
- **Disable `--hierarchical`:** simply don't pass the flag; there's no global setting
- **Disable `--deep-review`:** same — flag-controlled
- **Stop using a specific command:** just don't invoke it; no uninstall needed

### Clean up new `.planning/` subdirectories

Safe to delete if you don't use the features:

```bash
rm -rf .planning/metrics .planning/bus .planning/bridge .planning/counterfactuals .planning/conversations .planning/orchestration .planning/reviews .planning/architecture
```

(Don't delete `.planning/memory/` without understanding — it has cross-phase lessons written by the retro command since v2.10.)

## FAQ

### Do I need to migrate my phase files?

No. Phase directories, plan.md, summary.md, state.md — all unchanged.

### Will my focus-auto campaigns break?

No. `/pan:focus-*` commands are identical. They may opportunistically integrate with new v3.x features via flags (e.g. `--deep-review`), but default behavior is unchanged.

### Does `/pan:cost` see historical data?

No — the log is append-only from the moment you upgrade. Historical cost data must come from your provider's billing API (Anthropic console, etc.). Going forward, the auto hook captures every sub-agent spawn.

### Can I use Spec B v2 features on runtimes other than Claude Code?

Partially:
- `/pan:cost`, `/pan:preview` (phase/milestone modes), `/pan:knowledge`, `/pan:what-if`, `/pan:review-deep`: **yes** on all 5 runtimes (`/pan:cost` has data only where the cost logger runs — Claude Code, Codex, Copilot CLI). Agent quality varies with model capability.
- `/pan:preview phases` (single-shot whole-repo pass): the fast path needs a model with a 1M-context window; smaller-context models skip the cross-reference bonus and rely on the data-layer output alone.
- `/pan:mcp-bridge`: runs on all five runtimes as a cache reader (the host runtime populates the cache); Claude Code is the primary target.
- `/pan:exec-phase --hierarchical`: Claude Code only — it needs native sub-agent spawning, which is a runtime limit rather than a model one. Elsewhere the flag is a no-op that warns and falls back to flat exec.

### What if I want to skip v3.0-v3.4 and go straight to v3.5?

Each release is additive, so installing v3.5.0 directly is fine — you get all prior waves' functionality too. There's no staged migration path.

### My installer didn't print "Configured cost logger hook". Is that bad?

No. On Claude Code the installer is idempotent: an entry left by a previous install is kept and nothing is printed for it. Codex and Copilot CLI report all their hooks on one `Configured hooks (…)` line, and Gemini CLI and OpenCode get no cost logger.

## Related

- [CHANGELOG.md](../CHANGELOG.md) — per-release changelog with every new file + test count
- [ADR-0024](decisions/ADR-0024-spec-b-v2-completion.md) — design decisions behind Spec B v2
- [ARCHITECTURE.md](ARCHITECTURE.md) — full system design
- [CLI-REFERENCE.md](CLI-REFERENCE.md) — every new CLI subcommand with examples
- [USER-GUIDE.md](USER-GUIDE.md) — Spec B v2 user-facing features walkthrough
