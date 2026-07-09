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

That's it. Your project keeps working. You now have access to nine new commands if you want them.

## What Changed

### Nine new commands

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
| `/pan:git` | v3.5 | Phase-aware git workflow with safety guardrails (10 subcommands) |

All are opt-in. Default PAN workflow (`/pan:new-project`, `/pan:plan-phase`, `/pan:exec-phase`, `/pan:verify-phase`, etc.) is unchanged.

### New focus-auto categories (v3.5)

- `security` — OWASP Top 10 + STRIDE audit campaigns (P0–P2)
- `distill` — AI code-bloat optimizer with 5-pass pipeline (P1–P5)

### Two new flags on existing commands

- `/pan:exec-phase <N> --hierarchical` (v3.4) — spawn `pan-conductor` as top-level orchestrator. Claude + Opus 4.7 only; silently falls back to flat exec elsewhere.
- `/pan:exec-phase <N> --deep-review` (v3.4) — auto-invoke `/pan:review-deep` after the normal reviewer step.
- `/pan:focus-exec --deep-review` (v3.4) — same integration for focus campaigns.

### Eight new agents

- `pan-previewer` (v3.1) — foresight synthesis
- `pan-hardener` (v3.2) — OWASP + STRIDE security audit
- `pan-meta-reviewer` (v3.2) — cross-check of reviewer + hardener
- `pan-knowledge` (v3.2) — retrieval + multi-turn + playbook (3 modes)
- `pan-counterfactual` (v3.3) — worktree replay
- `pan-conductor` (v3.4) — hierarchical orchestrator
- `pan-optimizer` (v3.5) — circular optimization analyst
- `pan-distiller` (v3.5) — AI code-bloat judgment (span-only contract)

Total agent count: 12 → 20.

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

The installer adds one new entry to `.claude/settings.json` under `hooks.SubagentStop`:

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

The hook is non-blocking and silently no-ops on runtimes that don't fire SubagentStop. Nothing else in settings.json changes.

### Shipped hook count: 3 → 5

- `pan-statusline.js` (unchanged)
- `pan-context-monitor.js` (unchanged)
- `pan-check-update.js` (unchanged)
- `pan-cost-logger.js` (new in v3.4)
- `pan-trace-logger.js` (new in v3.5 — circular optimization tracing)

### Core module count: 17 → 27

Ten new modules in `pan-wizard-core/bin/lib/`. See [ARCHITECTURE.md](ARCHITECTURE.md#layer-4-core-library) for per-module descriptions:

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
- Milestone archival flow (`/pan:milestone-done` → `.planning/milestones/vX.Y/`)
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
- Removes the old `pan-wizard-core/` and re-copies the v3.4 version
- Re-copies agent files (now 18, was 12)
- Re-copies command files (now 48, was 42)
- Re-copies hook files (now 4, was 3)
- Updates `pan-file-manifest.json` with the new file hashes
- Adds `SubagentStop` hook entry to settings.json (if absent)

### 3. Verify

```bash
# Check version
cat .claude/pan-wizard-core/VERSION
# Should show: 3.4.0

# Smoke-test a new command
node .claude/pan-wizard-core/bin/pan-tools.cjs cost report --format table

# Smoke-test focus system still works
node .claude/pan-wizard-core/bin/pan-tools.cjs focus scan --help
```

### 4. Optional: enable the auto cost logger

It's enabled by default on a fresh install. If you're upgrading a long-lived project, verify:

```bash
grep -A2 SubagentStop .claude/settings.json
```

If missing, re-run the installer — the idempotent flow adds the entry.

## Rollback

Every v3.x feature is additive. Rollback options:

### Full rollback to v2.10.0

```bash
# Uninstall PAN entirely
node <PanWizard-repo>/bin/install.js --uninstall --claude --local

# Check out v2.10.0 tag or commit, then re-install
git checkout v2.10.0
node bin/install.js --claude --local
```

Your `.planning/` data survives. New directories (`metrics/`, `bus/`, etc.) remain on disk but are ignored by v2.x.

### Partial rollback (keep v3.4 but disable specific features)

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
- `/pan:cost`, `/pan:preview` (phase/milestone modes), `/pan:knowledge`, `/pan:what-if`, `/pan:review-deep`: **yes** on all 5 runtimes. Agent quality varies with model capability.
- `/pan:preview phases` (1M-context single-shot): Opus 4.7 only for the fast path; other models take sharded fallback.
- `/pan:mcp-bridge`: Claude Code only (MCP is a Claude-first protocol).
- `/pan:exec-phase --hierarchical`: Claude + Opus 4.7 only; falls back to flat exec silently elsewhere.

### What if I want to skip v3.0-v3.3 and go straight to v3.4?

Each release is additive, so installing v3.4.0 directly is fine — you get all prior waves' functionality too. There's no staged migration path.

### My installer says "SubagentStop hook already configured." Is that bad?

No — the installer is idempotent. If the hook entry already exists (from a previous install), it's left alone.

## Related

- [CHANGELOG.md](../CHANGELOG.md) — per-release changelog with every new file + test count
- [ADR-0024](decisions/ADR-0024-spec-b-v2-completion.md) — design decisions behind Spec B v2
- [ARCHITECTURE.md](ARCHITECTURE.md) — full v3.4 system design
- [CLI-REFERENCE.md](CLI-REFERENCE.md) — every new CLI subcommand with examples
- [USER-GUIDE.md](USER-GUIDE.md) — Spec B v2 user-facing features walkthrough
