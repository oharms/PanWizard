<purpose>
Milestone retrospective — analyze historical .planning/ data for process improvement insights.

Run after milestone completion to reflect on estimation accuracy, verification patterns, and common gaps.
</purpose>

<core_principle>
**Process learning through quantitative analysis**

Retrospectives are not blame sessions. They identify systemic patterns that improve future planning:
- Were estimates accurate? (planned phases vs actual including gap closures)
- Did verification catch issues? (first-try pass rate)
- What gaps recur? (common patterns across phases)
</core_principle>

<process>

<step name="gather_data" priority="first">
Call pan-tools retro to gather all metrics:

```bash
RETRO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs retro)
```

Parse JSON for: `phases_planned`, `phases_completed`, `phases_decimal`, `estimation_accuracy_pct`, `verifications_total`, `verifications_passed_first_try`, `verifications_gaps_found`, `verifications_human_needed`, `first_try_rate_pct`, `common_gap_patterns`.

**If error:** Report "No roadmap found — run /pan:new-project first."
</step>

<step name="analyze_estimation">
**Estimation Accuracy Analysis**

```
Planned phases: {phases_planned}
Completed: {phases_completed}
Gap closure phases: {phases_decimal}
Estimation accuracy: {estimation_accuracy_pct}%
```

| Accuracy | Assessment | Recommendation |
|----------|-----------|----------------|
| ≥ 90% | Excellent estimation | Keep current approach |
| 70-89% | Good, some gaps expected | Minor calibration needed |
| 50-69% | Under-estimated scope | Add buffer phases or break work smaller |
| < 50% | Significant under-estimation | Review requirements gathering process |
</step>

<step name="analyze_verification">
**Verification Pattern Analysis**

```
Verifications: {verifications_total}
Passed first try: {verifications_passed_first_try} ({first_try_rate_pct}%)
Gaps found: {verifications_gaps_found}
Human needed: {verifications_human_needed}
```

| First-try rate | Assessment | Recommendation |
|---------------|-----------|----------------|
| ≥ 80% | Strong execution quality | Current workflow is effective |
| 60-79% | Moderate gap rate | Improve plan detail or must_haves quality |
| < 60% | High gap rate | Review plan-checker effectiveness, add more explicit must_haves |
</step>

<step name="analyze_patterns">
**Common Gap Patterns**

If `common_gap_patterns` is non-empty:

```
Top recurring gap types:
1. {pattern} — appeared {count} times
2. {pattern} — appeared {count} times
...
```

For each top pattern, suggest a preventive action:
- Missing wiring → "Add explicit key_links to must_haves"
- Stub detection → "Strengthen plan-checker substance checks"
- Test failures → "Add test gate earlier in verification"
- Missing files → "Require artifact existence in plan verify steps"
</step>

<step name="present_report">
**Retrospective Report**

```markdown
## Milestone Retrospective

### Estimation
- Phases: {completed}/{planned} ({decimal} gap closures)
- Accuracy: {accuracy}% — {assessment}
- Recommendation: {recommendation}

### Verification Quality
- First-try pass rate: {rate}% — {assessment}
- Gap phases needed: {gaps_found}
- Human verification: {human_needed}
- Recommendation: {recommendation}

### Common Gap Patterns
{pattern_list_with_recommendations}

### Key Takeaways
1. {takeaway based on data}
2. {takeaway based on data}
3. {takeaway based on data}

### Next Milestone Adjustments
- {specific adjustment for next milestone planning}
```
</step>

</process>

<constraints>
- Read-only: this workflow does not modify any files
- Data-driven: all assessments backed by quantitative metrics
- Actionable: every finding includes a concrete recommendation
- Non-judgmental: focus on systemic patterns, not individual decisions
</constraints>
