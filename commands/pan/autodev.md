---
name: pan:autodev
group: Phase Lifecycle
description: Run the roadmap unattended — a deterministic loop that plans, executes, verifies and completes phase after phase, each step in a fresh host session, and stops in code
argument-hint: "[run | resume | status | report | replay] [--host claude|codex|gemini|opencode] [--max-usd N] [--max-usd-day N] [--max-turns N] [--run <id>]"
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
| `forecast_exceeded` | An execute unit cost more than the project's p90 forecast for it |
| `budget_usd` | Spend reached `--max-usd` (the run) or `--max-usd-day` (today, across runs) |
| `turns` | `--max-turns` units have run (20 when not given) |
| `no_progress` | A unit ran and changed nothing on disk |

A failed session is classified before anything else happens: a compile or assertion failure is retried with its error in the prompt, then once more at a higher tier; a timeout or an unknown failure is restarted once; a missing CLI or login, a merge conflict, the guard's deny or an undeclared file stops for a human.
</objective>

<process>
1. **Check the subcommand** in `$ARGUMENTS`: `run` (the default), `resume`, `status`, `report` or `replay`.

2. **Status** only reports the latest run (or `--run <id>`):

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev status
   ```

3. **Run or resume.** Say what will happen first: which host runs the sessions (`--host`, Claude Code by default; Copilot CLI has no unattended adapter yet), and the spend and unit caps. Each session spends on that host, so a run needs a spend cap: `--max-usd`, or `budget.max_usd_run` in `.planning/config.json` (and optionally a day cap, `--max-usd-day` or `budget.max_usd_day`). Ask the user for the cap if neither is set; it is their approval. Then run it in the foreground and wait; a run can take hours:

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev run --host claude --max-usd 20 --max-turns 12
   ```

   After an interrupted run, resume it: the unit that was in flight runs again first.

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev resume
   ```

4. **Write the dossier** and check the record:

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev report
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs autodev replay
   ```

   `report` writes `dossier.md` (a PR body) and `dossier.html` beside the ledger: per phase, the requirements, plans, units and commits, test gate, verdict, findings and cost. `replay` re-runs the stop logic over the recorded decisions and says whether it decides the same; `identical: false` means the record and the code disagree, so say so.

5. **Report** the result: `stop.reason` and `stop.detail`, the units run, `spent_usd`, and the ledger path (`.planning/autodev/<run>/ledger.jsonl`, one `started` and one `finished` row per unit with its argv, exit, cost and commits). Then route on the reason:
   - `done` → `/pan:milestone-audit`
   - `human_needed` → show the phase's verification and the human checks it lists
   - `gate_failed` → show the gate's reasons (`pan-tools phase gate <N>`), then `/pan:plan-phase <N> --gaps`
   - `budget_usd`, `turns` → offer `autodev resume` with a higher cap
   - `forecast_exceeded` → show the unit's cost and forecast from the ledger; offer `autodev resume` once the user has looked
   - `no_progress` → show the last unit's `stderr_tail` from the ledger; the session likely could not run the command
</process>
