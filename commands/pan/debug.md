---
name: pan:debug
group: System
description: Systematic debugging with persistent state across context resets
argument-hint: "[issue description]"
allowed-tools:
  - Read
  - Bash
  - Task
  - AskUserQuestion
---

<objective>
Debug issues using scientific method with subagent isolation.

**Orchestrator role:** Gather symptoms, spawn pan-debugger agent, handle checkpoints, spawn continuations.

**Why subagent:** Investigation burns context fast (reading files, forming hypotheses, testing). Fresh 200k context per investigation. Main context stays lean for user interaction.
</objective>

<context>
User's issue: $ARGUMENTS

Check for active sessions:
```bash
ls .planning/debug/*.md 2>/dev/null | grep -v resolved | head -5
```
</context>

<process>

## 0. Initialize Context

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state load)
```

Extract `commit_docs` from init JSON. Resolve debugger model:
```bash
DEBUGGER_MODEL=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-debugger --raw)
```

## 1. Check Active Sessions

If active sessions exist AND no $ARGUMENTS:
- List sessions with status, hypothesis, next action
- User picks number to resume OR describes new issue

If $ARGUMENTS provided OR user describes new issue:
- Continue to symptom gathering

## Reasoning Protocol

For each debugging step, follow the observe-think-act pattern:
1. **OBSERVE** — State what you see (error message, unexpected output, file contents)
2. **THINK** — Reason about what this means and what to investigate next
3. **ACT** — Execute one targeted tool call based on the reasoning
This prevents random exploration and keeps investigation systematic.

## Meta-Prompting: Self-Generated Debug Strategy

After gathering symptoms (step 2), generate your own investigation plan before spawning the debugger:

```
Given symptoms: "{summary}"
My debug strategy:
1. Most likely cause: {hypothesis} → Test by: {specific check}
2. Second most likely: {hypothesis} → Test by: {specific check}
3. Long shot: {hypothesis} → Test by: {specific check}
4. Files to read first: {ordered list, most relevant first}
5. What would DISPROVE each hypothesis: {falsification criteria}
```

This self-generated strategy is passed to the pan-debugger agent as part of the prompt, giving it a targeted investigation plan rather than open-ended exploration. The falsification criteria are critical — they prevent the agent from confirming a hypothesis by only looking for supporting evidence.

## 2. Gather Symptoms (if new issue)

Use AskUserQuestion for each:

1. **Expected behavior** - What should happen?
2. **Actual behavior** - What happens instead?
3. **Error messages** - Any errors? (paste or describe)
4. **Timeline** - When did this start? Ever worked?
5. **Reproduction** - How do you trigger it?

After all gathered, confirm ready to investigate.

## 3. Spawn pan-debugger Agent

Fill prompt and spawn:

```markdown
<objective>
Investigate issue: {slug}

**Summary:** {trigger}
</objective>

<symptoms>
expected: {expected}
actual: {actual}
errors: {errors}
reproduction: {reproduction}
timeline: {timeline}
</symptoms>

<mode>
symptoms_prefilled: true
goal: find_and_fix
</mode>

<debug_file>
Create: .planning/debug/{slug}.md
</debug_file>
```

```
Task(
  prompt=filled_prompt,
  subagent_type="pan-debugger",
  model="{debugger_model}",
  description="Debug {slug}"
)
```

## 4. Handle Agent Return

**If `## ROOT CAUSE FOUND`:**
- Display root cause and evidence summary
- Offer options:
  - "Fix now" - spawn fix subagent
  - "Plan fix" - suggest /pan:plan-phase --gaps
  - "Manual fix" - done

**If `## CHECKPOINT REACHED`:**
- Present checkpoint details to user
- Get user response
- If checkpoint type is `human-verify`:
  - If user confirms fixed: continue so agent can finalize/resolve/archive
  - If user reports issues: continue so agent returns to investigation/fixing
- Spawn continuation agent (see step 5)

**If `## INVESTIGATION INCONCLUSIVE`:**
- Show what was checked and eliminated
- Offer options:
  - "Continue investigating" - spawn new agent with additional context
  - "Manual investigation" - done
  - "Add more context" - gather more symptoms, spawn again

<debug_handoff_schema>
Debug session files (`.planning/debug/{slug}.md`) MUST contain structured state for cross-agent handoff:

```yaml
# Required sections in debug session file
session: "{slug}"
status: "investigating | root-cause-found | fix-applied | resolved"
created: "{ISO-8601}"
updated: "{ISO-8601}"

symptoms:
  expected: "{what should happen}"
  actual: "{what happens instead}"
  errors: "{error messages}"
  reproduction: "{steps to reproduce}"

investigation:
  hypotheses_tested:
    - hypothesis: "{what we thought}"
      result: "confirmed | eliminated"
      evidence: "{file:line or command output}"
  hypotheses_remaining:
    - "{what still needs checking}"

root_cause:                          # Populated when found
  description: "{what's actually wrong}"
  evidence: "{file:line proof}"
  confidence: "high | medium | low"

fix:                                 # Populated when applied
  files_changed: ["{paths}"]
  approach: "{what was done}"
  tests_added: ["{test paths}"]
```

**Why structured:** Each continuation agent starts with 0 context. Without structured state, it re-reads the entire investigation log and may re-test eliminated hypotheses. With structured state, it reads `hypotheses_tested` (skip these), checks `hypotheses_remaining` (do these next), and picks up exactly where the previous agent stopped.
</debug_handoff_schema>

## 5. Spawn Continuation Agent (After Checkpoint)

When user responds to checkpoint, spawn fresh agent with the structured debug state:

```markdown
<objective>
Continue debugging {slug}. Evidence is in the debug file.
</objective>

<prior_state>
<files_to_read>
- .planning/debug/{slug}.md (Debug session state — parse structured sections)
</files_to_read>
</prior_state>

<checkpoint_response>
**Type:** {checkpoint_type}
**Response:** {user_response}
</checkpoint_response>

<mode>
goal: find_and_fix
</mode>

<handoff_instructions>
1. Parse the debug file's structured sections (symptoms, investigation, root_cause, fix)
2. Do NOT re-test hypotheses marked "eliminated" — they are dead ends
3. Start from hypotheses_remaining or the checkpoint's next action
4. Update the debug file's structured sections as you progress
</handoff_instructions>
```

```
Task(
  prompt=continuation_prompt,
  subagent_type="pan-debugger",
  model="{debugger_model}",
  description="Continue debug {slug}"
)
```

</process>

<success_criteria>
- [ ] Active sessions checked
- [ ] Symptoms gathered (if new)
- [ ] pan-debugger spawned with context
- [ ] Checkpoints handled correctly
- [ ] Root cause confirmed before fixing
</success_criteria>
