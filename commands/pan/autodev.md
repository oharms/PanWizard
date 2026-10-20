---
name: pan:autodev
group: Phase Lifecycle
description: Run the roadmap unattended — a deterministic loop that plans, executes, verifies and completes phase after phase, each step in a fresh host session, and stops in code
argument-hint: "[run | resume | status] [--host claude|codex|gemini|opencode] [--max-usd N] [--max-turns N] [--run <id>]"
allowed-tools:
  - Read
  - Bash
---

<objective>
Drive the project's roadmap with no model in the control loop. `pan-tools autodev` is a foreground Node process: each turn it reads `.planning/` from disk, asks the next-action router for the next unit (plan, execute or verify a phase, or complete a verified one), and runs it. Plan, execute and verify units each get a fresh headless session on the host; `phase complete` runs in the engine, so the phase gate decides.

It stops in code, with one of these reasons:

| Stop | Meaning |
|------|---------|
| `done` | Every phase is finished; the milestone audit is next |
| `human_needed` | A verifier asked for a human check, or there is no roadmap |
| `gate_failed` | The phase gate refused to complete a phase |
| `budget_usd` | Spend reached `--max-usd` |
| `turns` | `--max-turns` units have run (20 when not given) |
| `no_progress` | A unit ran and changed nothing on disk |
</objective>

<process>
1. **Check the subcommand** in `$ARGUMENTS`: `run` (the default), `resume` or `status`.

2. **Status** only reports the latest run (or `--run <id>`):

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev status
   ```

3. **Run or resume.** Say what will happen first: which host runs the sessions (`--host`, Claude Code by default; Copilot CLI has no unattended adapter yet), and the spend and unit caps. Each session spends on that host. Then run it in the foreground and wait; a run can take hours:

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev run --host claude --max-usd 20 --max-turns 12
   ```

   After an interrupted run, resume it: the unit that was in flight runs again first.

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev resume
   ```

4. **Report** the result: `stop.reason` and `stop.detail`, the units run, `spent_usd`, and the ledger path (`.planning/autodev/<run>/ledger.jsonl`, one `started` and one `finished` row per unit with its argv, exit, cost and commits). Then route on the reason:
   - `done` → `/pan:milestone-audit`
   - `human_needed` → show the phase's verification and the human checks it lists
   - `gate_failed` → show the gate's reasons (`pan-tools phase gate <N>`), then `/pan:plan-phase <N> --gaps`
   - `budget_usd`, `turns` → offer `autodev resume` with a higher cap
   - `no_progress` → show the last unit's `stderr_tail` from the ledger; the session likely could not run the command
</process>
