<purpose>
Execute a lean phase in this one session: you do the work the executor agent would do, then a verifier checks it. Autodev runs this for a phase the engine sized lean (its requirements say precisely what to build, and the engine wrote and checked its plan), so the full exec-phase orchestration (an orchestrating session, a separate executor, test generation, code review) is not needed. The phase gate still decides when autodev runs `phase complete`.
</purpose>

<rules>
- **The plan is the specification.** Do what each task's `<action>` says, nothing more. Do not widen scope; log anything else to `{phase_dir}/deferred-items.md`.
- **Tests are the spec.** Test files the plan does not list in `files_modified` are read-only. Never delete, rename or skip a test, remove an assertion, or add one that cannot fail. A plan's `supersedes_tests` are the exception it declares: update their expectations to what the named requirements now require, and record each change as a deviation. A test you cannot satisfy without weakening it means stop and reply `## BLOCKED_SPEC_CONFLICT` with the test, the requirement and why both cannot hold.
- **Commit each task** when its verify command passes: `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "feat({padded}-{plan}): <what the task did>" --files <the files it changed>`.
- **Unattended:** do not ask questions; take the recommended default and record what you assumed in the summary. Do not start another phase or command.
</rules>

<process>
1. **Load the phase:**
   ```bash
   INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init execute-phase "{phase}")
   ```
   Read `phase_dir`, `phase_number`, `incomplete_plans`, `plan_check` and `verifier_enabled`. When `plan_check.status` is not `ok` or `disabled`, stop and reply `EXECUTION HALTED: plan check {status}`.

2. **Record the test baseline** (what the suite does before this phase):
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs test run --phase "{phase_number}" --baseline > /dev/null
   ```

3. **Execute each incomplete plan, in order.** Read the plan. For each task: make the change, write or update the tests its action names, run its `<verify>` command until it passes (at most three fix attempts, then record the task as an issue and continue), and commit it. Then write `{phase_dir}/{padded}-{plan}-summary.md` from `~/.claude/pan-wizard-core/templates/summary.md`: what was built, the files, every deviation (including each superseded test expectation: file, what it asserted, what it asserts now, which requirement) and every assumption. Then record progress and commit the summary:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state advance-plan
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update-progress
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap update-plan-progress "{phase_number}"
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs requirements mark-complete {the plan's requirements}
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs({padded}-{plan}): complete plan" --files {phase_dir}/{padded}-{plan}-summary.md .planning/state.md .planning/roadmap.md .planning/requirements.md
   ```

4. **Verify** (skip only when `verifier_enabled` is false, and say so). Spawn the verifier; it is a second pair of eyes, so give it paths, not your conclusions:
   ```
   Task(
     subagent_type="pan-verifier",
     model="{verifier_model from: node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-verifier --raw}",
     prompt="Verify phase {phase_number} goal achievement. Phase directory: {phase_dir}. Check the plans' must_haves and requirement IDs against the code. Run the project's test suite as the test gate and record test_gate in the frontmatter. Create verification.md."
   )
   ```
   Then record its verdict:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings record --phase "{phase_number}" --file "$(ls {phase_dir}/*-verification.md | head -1)" --raw
   ```

5. **Reply** in a few lines: the plans executed, the commits, the verification status, and any deviation, assumption or issue. Do not run `phase complete`: autodev runs it next and the phase gate decides.
</process>
