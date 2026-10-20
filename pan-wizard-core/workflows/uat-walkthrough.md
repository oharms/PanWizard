<purpose>
Walk the user through user acceptance testing for one phase, one test at a time, on any runtime. Record each answer through the engine, so every runtime leaves the same `{phase_num}-uat.md`. When the walkthrough finds issues, diagnose them, then hand the gaps to `/pan:plan-phase {phase_num} --gaps`.
</purpose>

<core_principle>
The user is the oracle here. You present what they should be able to observe, they say whether they observed it, and the engine writes it down. Never mark a test passed on their behalf, and never rephrase their report: an issue is recorded in their words.
</core_principle>

<process>

<step name="initialize">
```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "${PHASE_ARG}")
```
Take `phase_dir`, `phase_number` and `phase_name` from the JSON. Look for an existing session:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs uat status "${PHASE_NUMBER}"
```

- **A session exists with tests pending:** resume at the first pending test.
- **A session exists and is complete:** show its summary. If it has gaps, go to `diagnose`; otherwise go to `done`.
- **No session (`uat_not_found`):** go to `build_tests`.
</step>

<step name="build_tests">
Create the file, then fill in its tests:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs scaffold uat --phase "${PHASE_NUMBER}"
```

Read the phase's summaries (`{phase_dir}/*-summary.md`) and its plans' `must_haves`. Write one test per user-observable truth into the file's `## Tests` section, each as:

```markdown
### N. <short name>
expected: <what the user should be able to see or do, concretely: the command, the screen, the output>
result: [pending]
```

Keep to what a person can observe without reading the code. Write the test list once, in full, then leave every result to the engine.
</step>

<step name="walk">
For each pending test, in order:

1. Show the test: its name and its `expected` behaviour, with the exact steps to observe it.
2. Ask for the result:
   ```
   AskUserQuestion([
     { question: "Test N: <name>. Did you observe the expected behaviour?", header: "UAT", multiSelect: false, options: [
       { label: "Pass", description: "It behaves as expected" },
       { label: "Issue", description: "Something differs; describe what you saw" },
       { label: "Skip", description: "Cannot test this now" }
     ] }
   ])
   ```
   Runtimes without AskUserQuestion ask the same question in plain text and take the answer from the reply.
3. Record it, in the user's own words for an issue:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs uat record "${PHASE_NUMBER}" --test N --result pass
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs uat record "${PHASE_NUMBER}" --test N --result issue --reported "<their words>" --severity major
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs uat record "${PHASE_NUMBER}" --test N --result skipped --reason "<why>"
   ```
   Severity: `blocker` (cannot use the feature), `major` (wrong behaviour), `minor` (works, but rough), `cosmetic`.

When no test is pending, the engine marks the session `complete`.
</step>

<step name="diagnose">
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs uat status "${PHASE_NUMBER}"
```

If `gaps` is empty, go to `done`. Otherwise follow the diagnose-issues workflow (@~/.claude/pan-wizard-core/workflows/diagnose-issues.md). On Claude Code the native `/pan-diagnose-issues {phase_num}` script does the same in parallel. Diagnosis fills each gap's `root_cause`, `artifacts`, `missing` and `debug_session`, and the engine keeps those fields across any later re-record.
</step>

<step name="done">
Report the summary (`passed`, `issues`, `skipped`). With gaps:

```
UAT found {issues} issue(s), diagnosed in {phase_num}-uat.md.

Next: /pan:plan-phase {phase_num} --gaps
```

Without gaps: "UAT passed. Continue with `/pan:exec-phase {phase_num}` (transition) or the next phase."
</step>

</process>
