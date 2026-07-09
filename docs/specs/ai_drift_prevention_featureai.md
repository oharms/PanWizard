# AI Drift Prevention System — Feature Specification

**Generated:** 2026-03-07
**Version:** 1.0
**Status:** Proposed
**ADR:** ADR-0020

---

## Problem Statement

AI drift occurs when an AI coding assistant gradually deviates from a project's plan, conventions, coding standards, and architectural decisions during extended sessions or across session boundaries. This manifests as: using wrong patterns (e.g., `console.log` instead of `output()`), forgetting file naming conventions, straying from planned task scope, inventing unplanned features, or losing track of project state. For PAN Wizard's target users — developers using AI assistants for complex multi-session projects — drift is the #1 cause of wasted context tokens, rework, and subtle bugs.

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| Personal pain (user-stated) | This conversation | User explicitly asked for drift prevention analysis |
| Community pattern | Reddit, HN, Dev.to | Universal complaint: "AI forgets conventions mid-session" |
| PAN Wizard's own CLAUDE.md | Project conventions | Extensive convention docs = evidence drift is actively managed |
| Competitor parity | Cursor (.cursorrules), Aider (CONVENTIONS.md) | Every major tool has SOME drift prevention |
| Industry trend | 2026 guardrails movement | Shift from speed to quality — drift prevention is table-stakes |

## Success Criteria

```
SC-1: AI sessions produce code matching project conventions >=95% of the time (measurable via drift score)
SC-2: Cross-session context loss reduced — AI can resume with conventions in <2 commands
SC-3: Drift detection runs in <200ms on typical projects
SC-4: Works across Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI (all 5 runtimes)
SC-5: No regression in existing 1510+ tests
SC-6: Zero runtime dependencies maintained
```

## Competitive Landscape

### Current State (March 2026)

| Tool | Convention Docs | Active Enforcement | Drift Scoring | Cross-Session |
|---|---|---|---|---|
| **PAN Wizard** | Standards + CONVENTIONS.md | None (passive) | **None** | State + Resume + Memory |
| **Aider** | CONVENTIONS.md | None | None | Git log |
| **Cursor** | .cursor/rules/*.mdc | None | None | None |
| **Cline** | .clinerules | Human review | None | None |
| **Windsurf** | Rules files | None | None | Memory |
| **Copilot WS** | Spec files | None | None | None |
| **CodeScene** | External | CI quality gates | Quality score | External |
| **Codacy** | External | Real-time | Quality score | External |

**Key Finding:** No tool has built-in, zero-dependency drift scoring. PAN is already the leader in drift prevention infrastructure. The gap is measurement and active enforcement.

### Novel Approaches from Industry Research

1. **Structured protocols** — Output structured summaries with rationale
2. **Guardrail + Validation pairs** — Rules + automated checks working together
3. **Circuit breakers** — Warning threshold + hard threshold
4. **Multi-agent layered validation** — Writer -> Critic -> Tester -> Compliance
5. **Git-based isolation** — Every action reversible via worktrees
6. **Spec-driven development** — Specs as primary artifacts

## Strategic Analysis

### Blue Ocean Framework

| Action | Decision |
|---|---|
| **ELIMINATE** | External tool dependencies, IDE-specific monitoring |
| **REDUCE** | Manual convention checking, human-in-the-loop friction |
| **RAISE** | Convention enforcement: passive -> active. Drift detection: post-hoc -> during-execution |
| **CREATE** | **Drift Score** (quantitative, nobody has this). Convention Checker (zero-dep). Drift Report. Pre-commit gate. |

### Moat Score: 28/30

| Moat Type | Score |
|---|---|
| Context Engineering | 5/5 |
| Cross-Platform | 4/5 |
| Developer Experience | 5/5 |
| Zero Dependencies | 5/5 |
| State Persistence | 4/5 |
| Verification Quality | 5/5 |

### Recommendation

**Build** — PAN Wizard already has the strongest drift prevention infrastructure. Add quantitative Drift Score and automated convention checking to become the only tool answering "how much did the AI drift?" No other tool can answer this today. This is a Blue Ocean opportunity at Genesis stage in the Wardley map.

## Design

### Architecture

```
pan-tools.cjs → 'drift-check' case
  → verify.cjs: cmdDriftCheck(cwd, raw, args)
    → parseConventionRules(content)     -- from CONVENTIONS.md
    → getChangedFiles(cwd, sinceRef)    -- git diff --name-only
    → checkFileConventions(path, content, rules)  -- per file
    → calculateDriftScore(violations, filesChecked)
    → output(result, raw, summary)
```

### Convention Rule Format

Rules extracted from CONVENTIONS.md markdown code blocks:

```markdown
## Error Handling
- Use `safeReadFile()` instead of `existsSync()` + `readFileSync()`
- Wrap all `writeFileSync` calls in try-catch

## Output
- Use `output(data, raw, label)` — never `console.log` for JSON output
- Use `error(message)` — never `console.error` or `throw` to user
```

Parsed into:
```json
[
  {"id": "safe-read", "antiPattern": "existsSync", "message": "Use safeReadFile() instead of existsSync+readFileSync", "severity": "warning"},
  {"id": "output-fn", "antiPattern": "console\\.log", "message": "Use output() instead of console.log", "severity": "error"},
  {"id": "error-fn", "antiPattern": "console\\.error", "message": "Use error() instead of console.error", "severity": "error"}
]
```

### Built-in PAN Convention Rules

```javascript
const BUILTIN_CONVENTION_RULES = [
  { id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output() instead of console.log', severity: 'error', fileGlob: '*.cjs' },
  { id: 'no-console-error', antiPattern: /\bconsole\.error\b/, message: 'Use error() instead of console.error', severity: 'error', fileGlob: '*.cjs' },
  { id: 'no-existsSync', antiPattern: /\bexistsSync\b/, message: 'Use safeReadFile() or fileAccessible() instead of existsSync', severity: 'warning', fileGlob: '*.cjs' },
  { id: 'no-throw-to-user', antiPattern: /\bthrow new Error\b/, message: 'Use error() function instead of throw', severity: 'warning', fileGlob: '*.cjs' },
  { id: 'cmd-naming', antiPattern: /^function\s+(?!cmd)[a-z]+\w*\(cwd,\s*raw/, message: 'Public command functions should be named cmd*', severity: 'info', fileGlob: 'lib/*.cjs' },
  { id: 'toPosix-paths', antiPattern: /output\([^)]*path\.join/, message: 'Wrap path.join() in toPosix() for output', severity: 'warning', fileGlob: '*.cjs' },
  { id: 'write-try-catch', antiPattern: /writeFileSync\b(?![^]*catch)/, message: 'Wrap writeFileSync in try-catch', severity: 'warning', fileGlob: '*.cjs' },
];
```

### Drift Score Formula

```
drift_score = min(1.0, weighted_violations / (files_checked * max_rules_per_file))

where:
  weighted_violations = sum(3 for errors, 1 for warnings, 0.5 for info)
  max_rules_per_file = total_rules * 0.3 (30% expected violation ceiling)
```

Score interpretation:
- 0.0 - 0.2: **Clean** — minimal or no drift
- 0.2 - 0.5: **Low** — some convention deviations, review recommended
- 0.5 - 0.8: **Medium** — significant drift, action recommended
- 0.8 - 1.0: **High** — severe drift, conventions being ignored

### Command Interface

```
pan-tools drift-check [--since <ref>] [--threshold <0.0-1.0>] [--files <path,...>]

Arguments:
  --since <ref>      Git ref to diff against (default: HEAD)
  --threshold <n>    Pass/fail threshold (default: 0.5)
  --files <paths>    Comma-separated specific files to check

Output (JSON):
{
  "drift_score": 0.35,
  "verdict": "low",
  "violations": [
    {"file": "lib/verify.cjs", "line": 45, "rule": "no-console-log", "message": "Use output() instead of console.log", "severity": "error"}
  ],
  "violation_count": 3,
  "files_checked": 8,
  "conventions_loaded": 12,
  "summary": "drift: 0.35 (low) — 3 violations in 8 files"
}

Exit codes: 0 = pass, 1 = fail (above threshold)
```

### Error Handling

| Condition | Output | Behavior |
|---|---|---|
| No CONVENTIONS.md | `{"drift_score": 0, "violations": [], "summary": "no conventions loaded"}` | Graceful pass |
| Not a git repo | `{"error": "git repository not found"}` | Clean error |
| Invalid --threshold | `{"error": "threshold must be 0.0-1.0"}` | Arg validation |
| No changed files | `{"drift_score": 0, "violations": [], "summary": "no files changed"}` | Clean pass |
| Invalid regex in convention | Skip rule, add warning | Degraded but functional |

## Feature Ladder

| Version | Scope | Value | Effort |
|---|---|---|---|
| **v0 (MVP)** | `drift-check` command + rule parser + git diff + built-in rules + score | Quantitative drift measurement | S-M (18 pts) |
| **v1** | Pre-commit hook + drift-report.md + health --drift + verify integration | Automated prevention in workflow | M (16 pts) |
| **v2** | Cross-session trends + auto-discovery + custom rule DSL + per-runtime profiles | Drift analytics and learning | L (30 pts) |

## Implementation Tasks

| # | ID | Title | Files | Effort | Pts | Priority |
|---|---|---|---|---|---|---|
| 1 | D.1 | Convention rule parser | verify.cjs | S | 2 | P2 |
| 2 | D.2 | File convention checker | verify.cjs | S | 2 | P2 |
| 3 | D.3 | Drift score calculator | verify.cjs | XS | 1 | P2 |
| 4 | D.4 | cmdDriftCheck orchestrator | verify.cjs | M | 4 | P2 |
| 5 | D.5 | CLI dispatcher routing | pan-tools.cjs | XS | 1 | P2 |
| 6 | D.6 | Health check --drift | verify.cjs | S | 2 | P3 |
| 7 | D.7 | Built-in convention rules | constants.cjs | S | 2 | P3 |
| 8 | D.8 | Test suite (20+ tests) | tests/drift-check.test.cjs | M | 4 | P2 |
| 9 | D.9 | Documentation | README, USER-GUIDE, CHANGELOG | S | 2 | P4 |

**Total: 20 points (v0 MVP)**

### Dependency Graph

```
D.7 (Constants) ──> D.1 (Parser) ──> D.2 (Checker) ──> D.3 (Score) ──> D.4 (Command)
                                                                           ├──> D.5 (Dispatch)
                                                                           ├──> D.6 (Health)
                                                                           └──> D.8 (Tests) ──> D.9 (Docs)
```

## Test Plan

### Test Pyramid (enforced)

| Level | Count | What It Catches |
|---|---|---|
| Unit | 8+ | Rule parsing, file checking, score calculation |
| Integration | 6+ | Git diff, arg parsing, JSON output, thresholds |
| E2E | 2+ | Full workflow with real conventions |

### Key Test Cases

1. parseConventionRules: empty content -> []
2. parseConventionRules: markdown with code blocks -> extracted rules
3. parseConventionRules: invalid regex -> skipped, no crash
4. checkFileConventions: clean file -> 0 violations
5. checkFileConventions: console.log in .cjs -> violation
6. checkFileConventions: existsSync usage -> warning
7. calculateDriftScore: 0 violations -> 0.0
8. calculateDriftScore: errors weighted 3x
9. calculateDriftScore: capped at 1.0
10. cmdDriftCheck: no conventions -> score 0
11. cmdDriftCheck: with violations -> correct JSON
12. cmdDriftCheck: --threshold exceeded -> exit 1
13. cmdDriftCheck: --files specific path
14. cmdDriftCheck: non-git dir -> error
15. cmdDriftCheck: --since HEAD~3
16. cmdDriftCheck: --raw output format
17. Built-in rules match PAN patterns
18. CRLF line endings handled
19. Binary files skipped
20. Large file (>100KB) skipped

## Security

- **Attack surface:** Read-only analysis. No code modification. No external calls.
- **Path safety:** Applied via execFileSync (no shell injection) + path.resolve + project root check.
- **Output sanitization:** toPosix paths, no absolute paths, no env vars, no stack traces.
- **Content validation:** Regex try-catch for convention rules. No eval/Function.

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| False positive violations | Medium | Medium | Severity levels + configurable threshold |
| Convention format variations | Medium | Low | Built-in rules as fallback |
| Cross-platform paths | Medium | Medium | toPosix(), CRLF-safe patterns |
| Performance on large repos | Low | Low | File count limit (100), size limit (100KB) |

## Sources

- [Guardrails for Agentic Coding](https://jvaneyck.wordpress.com/2026/02/22/guardrails-for-agentic-coding-how-to-move-up-the-ladder-without-lowering-your-bar/)
- [AI Code Quality in 2026](https://tfir.io/ai-code-quality-2026-guardrails/)
- [8 Tactics to Reduce Context Drift](https://lumenalta.com/insights/8-tactics-to-reduce-context-drift-with-parallel-ai-agents)
- [AI Coding Agents: Coherence Through Orchestration](https://mikemason.ca/writing/ai-coding-agents-jan-2026/)
- [Codified Context (arxiv)](https://arxiv.org/html/2602.20478v1)
- [Cursor Rules Guide 2026](https://www.agentrulegen.com/guides/cursor-rules-guide)
- [Aider Conventions](https://aider.chat/docs/usage/conventions.html)
- [How We Prevent AI Agent Drift](https://dev.to/singhdevhub/how-we-prevent-ai-agents-drift-code-slop-generation-2eb7)
- [CodeScene AI Guardrails](https://codescene.com/resources/use-cases/prevent-ai-generated-technical-debt)

---

*Generated by /featureAI — 2026-03-07*
