# The `pan-verdict` block

A judging agent ends its report with one fenced `pan-verdict` block. The block is the machine-readable form of the verdict the report already gives in prose. The orchestrator records it with `pan-tools findings record`, and that record is what the workflow branches on. It also feeds the findings ledger that milestone audits read for tech debt. The prose stays for people, and the block states the same verdict for code.

## Rules

1. **Place it last.** The block is the final element of your return. When a report holds more than one block, the recorder reads the last one.
2. **Valid JSON only.** No comments and no trailing commas. One line or pretty-printed are both fine.
3. **Same verdict as the prose.** `verdict` is the word your report already uses, and `outcome` is what that word means (see the table below). The block never disagrees with the report.
4. **One finding per issue.** List the findings the report lists, each as its own entry, most severe first. A clean pass has `"findings": []`.
5. **Plain summaries.** State each finding in one sentence of 300 characters or fewer. Put the location in `where`, not in `summary`.

````markdown
```pan-verdict
{"contract":"1.0","agent":"pan-reviewer","phase":"03","verdict":"NEEDS_FIXES","outcome":"fail","findings":[{"class":"defect","severity":"high","where":"src/utils/parser.ts:42","summary":"parse() drops the final token of every line"}]}
```
````

## Fields

| Field | Required | Value |
|---|---|---|
| `contract` | yes | `"1.0"` |
| `agent` | yes | your agent name, e.g. `pan-reviewer` |
| `phase` | when you know it | the phase number you were asked about, e.g. `"03"` |
| `verdict` | yes | your own verdict word (table below) |
| `outcome` | yes | `pass`, `fail` or `needs_human` |
| `findings` | yes (may be empty) | a list of `{class, severity, where, summary}` |

| Agent | `verdict` → `outcome` |
|---|---|
| pan-plan-checker | `passed` → `pass` · `issues_found` → `fail` |
| pan-reviewer | `PASS` → `pass` · `PASS_WITH_WARNINGS` → `pass` · `NEEDS_FIXES` → `fail` |
| pan-design-checker | `PASS` → `pass` · `GAPS` → `fail` |

The verifier does not emit this block. Its verification.md frontmatter (`status`, `gaps`, `human_verification`, `unrequested`) is its machine contract, and the recorder reads that directly.

## `class`: what kind of finding

| Class | Use when |
|---|---|
| `missing` | Something required is absent: a requirement with no task, a must-have not built, an unplanned key link |
| `partial` | Present but incomplete: a task missing its verify/done fields, a stub, a half-derived criterion |
| `contradicts` | It conflicts with a requirement, a locked decision (context.md) or the codebase's established architecture |
| `unrequested` | Work, a file or a behaviour that no plan or requirement asked for (scope creep) |
| `defect` | Incorrect behaviour or a code error; a broken dependency order in a plan |
| `risk` | A security, reliability or scale exposure; a plan whose scope will not fit its budget |
| `quality` | Convention, naming, style or maintainability, with no correctness impact |
| `human` | Cannot be settled by a check, so a person must look |

## `severity`: how much it matters

`critical` · `high` · `medium` · `low` · `info`. This is the same ladder `/pan:review-deep` uses.

## Mapping for each judge

**pan-plan-checker.**
- Classes by dimension:
  - Requirement coverage, key links, test coverage, Nyquist → `missing`
  - Task completeness, verification derivation, spec sufficiency, decision trace → `partial`
  - Dependency correctness → `defect`
  - Scope sanity → `risk`
  - Context compliance → `contradicts`
  - Standards → `quality`
- Severity: blocker → `high`, warning → `medium`, info → `info`.
- `where`: `NN-MM-plan.md` or `NN-MM-plan.md#task-N`.

**pan-reviewer.**
- Classes by category: Convention → `quality`, Security → `risk`, Code Quality → `defect`, work no plan asked for → `unrequested`.
- Severity: ERROR → `high`, WARNING → `medium`, INFO → `info`.
- `where`: `path:line`.

**pan-design-checker.**
- Classes by dimension:
  - Requirement coverage → `missing`
  - Architecture conformance → `contradicts`
  - Threat coverage → `risk`
  - Scope discipline → `unrequested`
  - Every other dimension → `partial`
- Severity: each gap is `high`. A gap you report as a caveat on the final iteration is `medium`.
- `where`: the design section, e.g. `03-design.md#interfaces`.

## Examples

A plan check that passes:

````markdown
```pan-verdict
{"contract":"1.0","agent":"pan-plan-checker","phase":"05","verdict":"passed","outcome":"pass","findings":[]}
```
````

A design check with two gaps:

````markdown
```pan-verdict
{"contract":"1.0","agent":"pan-design-checker","phase":"05","verdict":"GAPS","outcome":"fail","findings":[
  {"class":"missing","severity":"high","where":"05-design.md#requirements","summary":"REQ-12 (export to CSV) maps to no design element"},
  {"class":"risk","severity":"high","where":"05-design.md#threats","summary":"the upload endpoint accepts any file type and no threat entry covers it"}]}
```
````
