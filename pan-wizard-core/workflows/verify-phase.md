<purpose>
Verify phase goal achievement through goal-backward analysis. Check that the codebase delivers what the phase promised, not just that tasks completed.

Executed by a verification subagent spawned from exec-phase.md.
</purpose>

<core_principle>
**Task completion ≠ Goal achievement**

A task "create chat component" can be marked complete when the component is a placeholder. The task was done — but the goal "working chat interface" was not achieved.

Goal-backward verification:
1. What must be TRUE for the goal to be achieved?
2. What must EXIST for those truths to hold?
3. What must be WIRED for those artifacts to function?

Then verify each level against the actual codebase.
</core_principle>

<required_reading>
@~/.claude/pan-wizard-core/references/verification-patterns.md
@~/.claude/pan-wizard-core/references/guardrails.md
@~/.claude/pan-wizard-core/templates/verification-report.md

> **Also see:** `~/.claude/pan-wizard-core/learnings/universal/` — AI-derived patterns from prior experiments. **Don't skim the whole folder.** Run `pan-tools learn topics-for --agent verifier --token-budget 5000 --raw` to load only the topics tagged relevant for verification at the configured budget. Per P-RES-002 (distractor-density research), reading every topic degrades reasoning even at modest token counts.
</required_reading>

## Re-Read Checkpoints

Context compaction may have dropped earlier sections. Re-read the relevant section *before* you begin each step — not after you hit a problem.

| Before this step | Re-read | Why |
|------------------|---------|-----|
| Running test suite | `references/guardrails.md` Stop-the-Line rule | Test regressions block phase completion — do not paper over |
| Verifying truths/artifacts | This workflow's `<core_principle>` | Goal-backward analysis is easy to skip under time pressure |
| Determining final status | This workflow's `<step name="determine_status">` | Status criteria (passed / gaps_found / human_needed) are precise |
| Writing verification report | `templates/verification-report.md` | Report shape is checked downstream |

<process>

<step name="load_context" priority="first">
Load phase operation context:

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "${PHASE_ARG}")
```

Extract from init JSON: `phase_dir`, `phase_number`, `phase_name`, `has_plans`, `plan_count`.

Then load phase details and list plans/summaries:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${phase_number}"
grep -E "^| ${phase_number}" .planning/requirements.md 2>/dev/null
ls "$phase_dir"/*-summary.md "$phase_dir"/*-plan.md 2>/dev/null
```

Extract **phase goal** from roadmap.md (the outcome to verify, not tasks) and **requirements** from requirements.md if it exists.
</step>

<step name="check_prior_verification">
**Check that previous phase (if any) has been verified.**

If `phase_number` > 1:
```bash
PREV=$((phase_number - 1))
PREV_VERIF=$(ls .planning/phase-${PREV}*/*-verification.md 2>/dev/null | head -1)
```

If `PREV_VERIF` is empty:
- Log: `⚠ Phase ${PREV} has no verification record`
- Continue (informational warning, not a blocker at verification time)

If `PREV_VERIF` exists, check its frontmatter `status:`:
- `passed` → OK, continue
- `gaps_found` → Log: `⚠ Phase ${PREV} has unresolved gaps` and continue
- `human_needed` → Log: `ℹ Phase ${PREV} awaiting human review` and continue

This step provides awareness; the hard gate is enforced by exec-phase.
</step>

<step name="run_test_suite">
**Run the project's test suite as a verification gate.**

This step catches test regressions that goal-backward analysis cannot detect.

1. Detect test command:
```bash
TEST_CMD=$(node -e "const p=require('./package.json'); console.log(p.scripts && p.scripts.test || 'echo no test')")
```

2. Run test suite and capture results:
```bash
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT=$?
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -E "^ℹ tests" | awk '{print $NF}')
TEST_PASS=$(echo "$TEST_OUTPUT" | grep -E "^ℹ pass" | awk '{print $NF}')
TEST_FAIL=$(echo "$TEST_OUTPUT" | grep -E "^ℹ fail" | awk '{print $NF}')
```

3. Evaluate results:

| Condition | Action |
|-----------|--------|
| All tests pass (`TEST_FAIL` = 0) | Record counts, continue to must-haves |
| Tests regress (failures exist) | Set `test_gate_status: failed`, include failure details in verification report |
| No test command found | Record as `test_gate_status: skipped`, continue |

4. Store test gate results for inclusion in verification.md:
```
TEST_GATE_STATUS: passed | failed | skipped
TEST_TOTAL: ${TEST_COUNT}
TEST_PASSED: ${TEST_PASS}
TEST_FAILED: ${TEST_FAIL}
```

**If test gate FAILED:** Continue verification (gather full picture) but set overall status to `gaps_found` regardless of goal-backward results. Include test failures as gaps in the report.
</step>

<step name="establish_must_haves">
**Option A: Must-haves in PLAN frontmatter**

Use pan-tools to extract must_haves from each PLAN:

```bash
for plan in "$PHASE_DIR"/*-plan.md; do
  MUST_HAVES=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs frontmatter get "$plan" --field must_haves)
  echo "=== $plan ===" && echo "$MUST_HAVES"
done
```

Returns JSON: `{ truths: [...], artifacts: [...], key_links: [...] }`

Aggregate all must_haves across plans for phase-level verification.

**Option B: Use Success Criteria from roadmap.md**

If no must_haves in frontmatter (MUST_HAVES returns error or empty), check for Success Criteria:

```bash
PHASE_DATA=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${phase_number}" --raw)
```

Parse the `success_criteria` array from the JSON output. If non-empty:
1. Use each Success Criterion directly as a **truth** (they are already written as observable, testable behaviors)
2. Derive **artifacts** (concrete file paths for each truth)
3. Derive **key links** (critical wiring where stubs hide)
4. Document the must-haves before proceeding

Success Criteria from roadmap.md are the contract — they override PLAN-level must_haves when both exist.

**Option C: Derive from phase goal (fallback)**

If no must_haves in frontmatter AND no Success Criteria in ROADMAP:
1. State the goal from roadmap.md
2. Derive **truths** (3-7 observable behaviors, each testable)
3. Derive **artifacts** (concrete file paths for each truth)
4. Derive **key links** (critical wiring where stubs hide)
5. Document derived must-haves before proceeding
</step>

<step name="verify_truths">
For each observable truth, determine if the codebase enables it.

**Status:** ✓ VERIFIED (all supporting artifacts pass) | ✗ FAILED (artifact missing/stub/unwired) | ? UNCERTAIN (needs human)

For each truth: identify supporting artifacts → check artifact status → check wiring → determine truth status.

**Example:** Truth "User can see existing messages" depends on Chat.tsx (renders), /api/chat GET (provides), Message model (schema). If Chat.tsx is a stub or API returns hardcoded [] → FAILED. If all exist, are substantive, and connected → VERIFIED.
</step>

<step name="verify_artifacts">
Use pan-tools for artifact verification against must_haves in each PLAN:

```bash
for plan in "$PHASE_DIR"/*-plan.md; do
  ARTIFACT_RESULT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify artifacts "$plan")
  echo "=== $plan ===" && echo "$ARTIFACT_RESULT"
done
```

Parse JSON result: `{ all_passed, passed, total, artifacts: [{path, exists, issues, passed}] }`

**Artifact status from result:**
- `exists=false` → MISSING
- `issues` not empty → STUB (check issues for "Only N lines" or "Missing pattern")
- `passed=true` → VERIFIED (Levels 1-2 pass)

**Level 3 — Wired (manual check for artifacts that pass Levels 1-2):**
```bash
grep -r "import.*$artifact_name" src/ --include="*.ts" --include="*.tsx"  # IMPORTED
grep -r "$artifact_name" src/ --include="*.ts" --include="*.tsx" | grep -v "import"  # USED
```
WIRED = imported AND used. ORPHANED = exists but not imported/used.

| Exists | Substantive | Wired | Status |
|--------|-------------|-------|--------|
| ✓ | ✓ | ✓ | ✓ VERIFIED |
| ✓ | ✓ | ✗ | ⚠️ ORPHANED |
| ✓ | ✗ | - | ✗ STUB |
| ✗ | - | - | ✗ MISSING |
</step>

<step name="verify_wiring">
Use pan-tools for key link verification against must_haves in each PLAN:

```bash
for plan in "$PHASE_DIR"/*-plan.md; do
  LINKS_RESULT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify key-links "$plan")
  echo "=== $plan ===" && echo "$LINKS_RESULT"
done
```

Parse JSON result: `{ all_verified, verified, total, links: [{from, to, via, verified, detail}] }`

**Link status from result:**
- `verified=true` → WIRED
- `verified=false` with "not found" → NOT_WIRED
- `verified=false` with "Pattern not found" → PARTIAL

**Fallback patterns (if key_links not in must_haves):**

| Pattern | Check | Status |
|---------|-------|--------|
| Component → API | fetch/axios call to API path, response used (await/.then/setState) | WIRED / PARTIAL (call but unused response) / NOT_WIRED |
| API → Database | Prisma/DB query on model, result returned via res.json() | WIRED / PARTIAL (query but not returned) / NOT_WIRED |
| Form → Handler | onSubmit with real implementation (fetch/axios/mutate/dispatch), not console.log/empty | WIRED / STUB (log-only/empty) / NOT_WIRED |
| State → Render | useState variable appears in JSX (`{stateVar}` or `{stateVar.property}`) | WIRED / NOT_WIRED |

Record status and evidence for each key link.
</step>

<step name="verify_requirements">
If requirements.md exists:
```bash
grep -E "Phase ${PHASE_NUM}" .planning/requirements.md 2>/dev/null
```

For each requirement: parse description → identify supporting truths/artifacts → status: ✓ SATISFIED / ✗ BLOCKED / ? NEEDS HUMAN.
</step>

<step name="scan_antipatterns">
Extract files modified in this phase from summary.md, scan each:

| Pattern | Search | Severity |
|---------|--------|----------|
| TODO/FIXME/XXX/HACK | `grep -n -E "TODO\|FIXME\|XXX\|HACK"` | ⚠️ Warning |
| Placeholder content | `grep -n -iE "placeholder\|coming soon\|will be here"` | 🛑 Blocker |
| Empty returns | `grep -n -E "return null\|return \{\}\|return \[\]\|=> \{\}"` | ⚠️ Warning |
| Log-only functions | Functions containing only console.log | ⚠️ Warning |

Categorize: 🛑 Blocker (prevents goal) | ⚠️ Warning (incomplete) | ℹ️ Info (notable).
</step>

<step name="identify_human_verification">
**Always needs human:** Visual appearance, user flow completion, real-time behavior (WebSocket/SSE), external service integration, performance feel, error message clarity.

**Needs human if uncertain:** Complex wiring grep can't trace, dynamic state-dependent behavior, edge cases.

Format each as: Test Name → What to do → Expected result → Why can't verify programmatically.
</step>

<step name="determine_status">
**passed:** All truths VERIFIED, all artifacts pass levels 1-3, all key links WIRED, no blocker anti-patterns, AND test gate passed or skipped.

**gaps_found:** Any truth FAILED, artifact MISSING/STUB, key link NOT_WIRED, blocker found, OR test gate FAILED (test regressions detected).

**human_needed:** All automated checks pass and test gate passed, but human verification items remain.

**Score:** `verified_truths / total_truths` + test gate status
</step>

<step name="generate_fix_plans">
If gaps_found:

1. **Cluster related gaps:** API stub + component unwired → "Wire frontend to backend". Multiple missing → "Complete core implementation". Wiring only → "Connect existing components".

2. **Generate plan per cluster:** Objective, 2-3 tasks (files/action/verify each), re-verify step. Keep focused: single concern per plan.

3. **Order by dependency:** Fix missing → fix stubs → fix wiring → verify.
</step>

<step name="create_report">
```bash
REPORT_PATH="$PHASE_DIR/${PHASE_NUM}-verification.md"
```

Fill template sections: frontmatter (phase/timestamp/status/score), **test gate results** (status/total/passed/failed), goal achievement, artifact table, wiring table, requirements coverage, anti-patterns, human verification, gaps summary, fix plans (if gaps_found), metadata.

See ~/.claude/pan-wizard-core/templates/verification-report.md for complete template.
</step>

<step name="return_to_orchestrator">
Return status (`passed` | `gaps_found` | `human_needed`), score (N/M must-haves), report path.

If gaps_found: list gaps + recommended fix plan names.
If human_needed: list items requiring human testing.

Orchestrator routes: `passed` → update_roadmap | `gaps_found` → create/execute fixes, re-verify | `human_needed` → present to user.

**Circular optimization — log verification outcome:**
```bash
# Map status to impact and event type
if [ "${STATUS}" = "passed" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category verification_passed \
    --description "Phase ${PHASE_NUMBER} verification passed (score: ${SCORE})" \
    --agent pan-verifier --impact minor 2>/dev/null || true
elif [ "${STATUS}" = "gaps_found" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type error --category verification_gaps \
    --description "Phase ${PHASE_NUMBER} verification found gaps (score: ${SCORE})" \
    --agent pan-verifier --impact major 2>/dev/null || true
fi
```
</step>

</process>

<success_criteria>
- [ ] Must-haves established (from frontmatter or derived)
- [ ] All truths verified with status and evidence
- [ ] All artifacts checked at all three levels
- [ ] All key links verified
- [ ] Requirements coverage assessed (if applicable)
- [ ] Anti-patterns scanned and categorized
- [ ] Human verification items identified
- [ ] Overall status determined
- [ ] Fix plans generated (if gaps_found)
- [ ] verification.md created with complete report
- [ ] Results returned to orchestrator
</success_criteria>
