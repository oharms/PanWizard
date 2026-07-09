# Best Practices Template

Template for `.planning/codebase/best-practices.md` - assesses coding practices across categories.

**Purpose:** Score and document which best practices the codebase follows, with prescriptive recommendations for improvement.

---

## File Template

```markdown
# Best Practices Assessment

**Analysis Date:** [YYYY-MM-DD]
**Overall Score:** [N]/10

## Score Summary

| Category | Score | Status |
|----------|-------|--------|
| Error Handling | [N]/10 | [Good/Needs Work/Critical] |
| Testing | [N]/10 | [Good/Needs Work/Critical] |
| Naming Conventions | [N]/10 | [Good/Needs Work/Critical] |
| Security | [N]/10 | [Good/Needs Work/Critical] |
| Performance | [N]/10 | [Good/Needs Work/Critical] |

## Error Handling ([N]/10)

**Detected patterns:**
- [Pattern description with percentage or count]
- [Example: "try-catch in async functions: 85% coverage"]

**Code examples:**
```[language]
// Pattern found in `[file path]`
[Show actual pattern from codebase]
```

**Recommendations:**
- [Specific, actionable recommendation with file path]

## Testing ([N]/10)

**Detected patterns:**
- [Test framework and runner]
- [Test file count and location]
- [Coverage configuration status]
- [Test types present: unit, integration, e2e]

**Recommendations:**
- [Specific, actionable recommendation]

## Naming Conventions ([N]/10)

**Detected patterns:**
- Files: [Pattern observed — kebab-case, camelCase, PascalCase, snake_case]
- Functions: [Pattern observed]
- Variables: [Pattern observed]
- Constants: [Pattern observed]

**Violations:**
- `[file path]` — [What's wrong and what it should be]

**Recommendations:**
- [Standardization suggestion]

## Security ([N]/10)

**Detected patterns:**
- [.env handling]
- [Secret management]
- [Input validation approach]
- [Dependency security]

**Recommendations:**
- [Specific security improvement with file path]

## Performance ([N]/10)

**Detected patterns:**
- [Memoization usage]
- [Lazy loading patterns]
- [Bundle optimization]
- [Caching strategies]

**Recommendations:**
- [Specific performance improvement with file path]

## Priority Actions

Top 3 improvements ranked by impact:

1. **[Category]:** [Action] — Impact: [High/Medium]
2. **[Category]:** [Action] — Impact: [High/Medium]
3. **[Category]:** [Action] — Impact: [High/Medium]

---

*Best practices assessment: [date]*
*Update after significant codebase changes*
```

<guidelines>
**What belongs in best-practices.md:**
- Scored assessment across 5 categories (0-10 each)
- Detected patterns with evidence (file paths, counts, percentages)
- Code examples showing actual patterns found
- Specific, actionable recommendations
- Priority actions ranked by impact

**What does NOT belong here:**
- Detailed code style rules (that's CONVENTIONS.md)
- Bug reports (that's CONCERNS.md)
- Architecture decisions (that's ARCHITECTURE.md)

**Scoring guide:**
- 9-10: Excellent — consistent, well-established practices
- 7-8: Good — mostly consistent with minor gaps
- 5-6: Needs Work — inconsistent or missing in areas
- 3-4: Poor — significant gaps
- 0-2: Critical — practices largely absent

**Status thresholds:**
- Good: score >= 7
- Needs Work: score 4-6
- Critical: score <= 3

**When filling this template:**
- Use pre-computed best-practices data if provided in the prompt
- Always include file paths as evidence
- Recommendations must be specific ("Add try-catch to X") not vague ("Improve error handling")
- Priority actions should be the highest-impact, lowest-effort improvements
</guidelines>
