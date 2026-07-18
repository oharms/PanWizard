---
name: focus-doc-audit
group: Focus
description: Multi-dimensional document audit — accuracy, freshness, links, cross-consistency, and structural quality
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - WebFetch
---

# /pan:focus-doc-audit — Deep Document Audit & Quality Assessment

Audit project documentation for accuracy, freshness, broken links, structural quality, cross-document consistency, and code alignment. $ARGUMENTS

**Goal:** Produce a confidence-scored audit of every documentation file in the project. Every claim in every document is verified against the actual codebase. Broken links are found. Stale counts are flagged. Contradictions between documents are exposed. The output is a per-file quality score with actionable fix lists, optionally auto-repaired.

**Methodology:** Combines claim extraction, fact verification, link validation, cross-reference consistency checking, structural linting, freshness dating, and readability scoring into a comprehensive audit pipeline. Inspired by financial audit methodology — every material claim requires supporting evidence.

---

## CRITICAL: Project Scope Boundary

This command audits the **host project's documentation** — NOT PAN Wizard's own infrastructure files.

**NEVER audit, modify, or report issues in these PAN directories:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- `.planning/` — PAN planning state (read for context, never audit as project docs)
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

**These directories are PAN's own tooling.** Documentation audit applies to the project's README, guides, API docs, architecture docs, and code comments — not to PAN's installed agents or command definitions.

If you find yourself auditing a PAN command file — STOP. Refocus on the project's actual documentation.

---

## MANDATORY: Execute ALL Phases Automatically

When `/pan:focus-doc-audit` is invoked, execute ALL phases for the selected mode without stopping. Do NOT ask questions between phases. Do NOT skip phases beyond what the mode specifies. Produce a complete audit report at the end.

**Usage:**
```
/pan:focus-doc-audit                     # Audit core docs (README, main docs)
/pan:focus-doc-audit <file>              # Audit a specific file
/pan:focus-doc-audit <directory>         # Audit all markdown files in directory
/pan:focus-doc-audit --deep              # Deep audit: verify every claim against code
/pan:focus-doc-audit --links             # Link validation pass only
/pan:focus-doc-audit --fix               # Auto-fix simple issues (counts, versions, dates, links)
/pan:focus-doc-audit --all               # Audit ALL documentation files project-wide
/pan:focus-doc-audit --score-only        # Skip fix suggestions, just output scores
/pan:focus-doc-audit --min-score <N>     # Only report files scoring below N% (default: 100 = report all)
/pan:focus-doc-audit --format <type>     # Output: markdown (default), json, checklist
```

---

## Audit Dimensions

Every document is scored across 8 independent dimensions. The final score is a weighted average.

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| **Accuracy** | 25% | Do factual claims match the codebase? |
| **Freshness** | 15% | Are versions, dates, and counts current? |
| **Completeness** | 15% | Does it cover all features/files it should? |
| **Link Integrity** | 15% | Do all internal and external links resolve? |
| **Cross-Consistency** | 10% | Does it agree with other project docs? |
| **Structural Quality** | 10% | Proper markdown, tables, code blocks, headings? |
| **Actionability** | 5% | Are instructions executable? Can a user follow them? |
| **Readability** | 5% | Clear language, logical flow, appropriate length? |

---

## Phase 0: Target Discovery & Truth Extraction

### 0.1 Identify Audit Targets
If no file/directory argument provided, auto-discover core documentation:

**Priority 1 — Always audit:**
- `README.md` — Primary project documentation
- `CLAUDE.md` — AI assistant instructions (if exists)
- `CONTRIBUTING.md` — Contributor guide (if exists)
- `CHANGELOG.md` — Version history (if exists)

**Priority 2 — Audit if present:**
- `docs/` or `Docs/` — Documentation directory
- `INSTALL.md` or `SETUP.md` — Installation guide
- `ARCHITECTURE.md` or `docs/ARCHITECTURE.md` — Architecture docs
- `API.md` or `docs/API.md` — API reference
- `SECURITY.md` — Security documentation
- `FAQ.md` — Frequently asked questions

**Priority 3 — Audit with `--all`:**
- All `*.md` files in the project (excluding PAN directories and `node_modules/`)
- All `*.rst`, `*.adoc` files (if project uses those formats)
- Per-directory `README.md` files

### 0.2 Extract Ground Truth
Before auditing any document, establish facts from code:

**Version Truth:**
| Source | How to Extract |
|--------|---------------|
| `package.json` | `version` field |
| `Cargo.toml` | `version` under `[package]` |
| `CMakeLists.txt` | `project(... VERSION X.Y.Z)` |
| `*.csproj` | `<Version>` or `<PackageVersion>` |
| `pyproject.toml` | `version` under `[project]` or `[tool.poetry]` |
| `pubspec.yaml` | `version` field |
| `build.gradle` | `version` property |
| `go.mod` | Module path version suffix |

**Count Truth:**
| Metric | How to Count |
|--------|-------------|
| Source files | `find` / `Get-ChildItem` by extension, excluding generated/vendored |
| Test files | Count test files by project convention (`*.test.*`, `*_test.*`, `test_*.*`, `*Spec.*`) |
| Test count | Parse test runner output or count `test(` / `it(` / `[Fact]` / `#[test]` / `def test_` |
| Commands/endpoints | Count route definitions, CLI command registrations |
| Components/modules | Count directories with source files in `src/` or equivalent |
| Dependencies | Count entries in lockfile or dependency sections |

**Build Command Truth:**
- Extract from `Makefile`, `package.json` scripts, `Taskfile`, CI config, or README build section
- Validate syntax (do commands reference existing scripts/tools?)

### 0.3 Build Truth Cache
Store extracted truth for cross-reference during audit:

```markdown
| Fact | Value | Source |
|------|-------|--------|
| Project name | {name} | {config file} |
| Version | {version} | {config file} |
| Source file count | {N} | Directory scan |
| Test file count | {N} | Directory scan |
| Test case count | {N} | Source scan / test runner |
| Module count | {N} | Directory scan |
| Dependency count | {N} | Lockfile |
| Build command | {cmd} | {source} |
| Test command | {cmd} | {source} |
```

---

## Phase 1: Claim Extraction

For each target document, extract every verifiable claim.

### 1.1 Claim Categories

| Category | Pattern | Example |
|----------|---------|---------|
| **Version claim** | `v1.2.3`, `version 1.2`, `Version: X` | "Currently at v3.1.0" |
| **Count claim** | Number + noun | "42 database tables", "15 API endpoints" |
| **File path claim** | Path-like strings | "`src/core/handler.ts`" |
| **Command claim** | Code block with shell prefix or instruction | "`npm run build`" |
| **Feature claim** | "supports X", "includes Y", "provides Z" | "Supports hot reloading" |
| **Architecture claim** | Component relationships, data flow | "The API layer calls the service layer" |
| **Status claim** | "complete", "in progress", "planned", emoji status | "✅ Authentication complete" |
| **Date claim** | Dates or relative time references | "Last updated March 2026" |
| **Link claim** | Markdown links, URLs | `[API docs](./docs/api.md)` |
| **Dependency claim** | Named dependencies or requirements | "Requires Node.js 18+" |

### 1.2 Extraction Protocol
For each document:

1. Read the entire document
2. Parse every paragraph, table cell, list item, and code block
3. Tag each verifiable claim with: `{category, text, line_number, verification_method}`
4. Count total claims — this becomes the denominator for accuracy scoring

---

## Phase 2: Fact Verification

Verify each extracted claim against ground truth.

### 2.1 Version Verification
```
For each version claim:
  1. Find the canonical version source (Phase 0.2)
  2. Compare: exact match required
  3. Score: PASS (match) / FAIL (mismatch) / SKIP (no canonical source)
```

### 2.2 Count Verification
```
For each count claim:
  1. Identify what's being counted
  2. Run the actual count (Phase 0.2 methods)
  3. Compare:
     - Exact match → PASS
     - Within 10% → WARNING (acceptable drift)
     - Off by > 10% → FAIL
     - Cannot verify → SKIP (note why)
```

### 2.3 File Path Verification
```
For each file path claim:
  1. Resolve path relative to document location
  2. Check: file/directory exists?
     - Exists → PASS
     - Exists at different location → FAIL + suggest correct path
     - Doesn't exist → FAIL (dead reference)
```

### 2.4 Command Verification
```
For each command claim:
  1. Parse the command
  2. Check: referenced tool/script exists? (e.g., does `npm` script exist in package.json?)
  3. Check: referenced files/paths in command exist?
  4. If --deep: attempt dry-run validation (syntax check, --help, etc.)
  5. Score: PASS / WARNING (tool exists but can't validate) / FAIL (tool/path missing)
```

### 2.5 Feature Verification
```
For each feature claim:
  1. Search codebase for implementation evidence
  2. Grep for feature keywords, class names, function names
  3. Score:
     - Implementation found → PASS
     - Partial implementation → WARNING
     - No evidence found → FAIL (aspirational documentation)
```

### 2.6 Architecture Verification
```
For each architecture claim:
  1. Verify stated components exist as directories/modules
  2. Verify stated relationships via import/dependency analysis
  3. Score:
     - All components exist and relationships hold → PASS
     - Components exist but relationships differ → WARNING
     - Components missing → FAIL
```

### 2.7 Status Verification
```
For each status claim:
  1. Check "complete" claims → verify implementation exists
  2. Check "in progress" claims → verify partial implementation
  3. Check "planned" claims → verify NOT implemented (avoid stale "planned" for shipped features)
  4. Score: PASS / FAIL (wrong status)
```

### 2.8 Link Verification
```
For each link:
  Internal markdown links:
    1. Resolve relative to document
    2. Check file exists
    3. If anchor (#heading), verify heading exists in target
    4. Score: PASS / FAIL (broken)

  External URLs (with --deep):
    1. HTTP HEAD request
    2. Score: PASS (2xx) / WARNING (3xx redirect) / FAIL (4xx/5xx)

  Without --deep:
    External URLs scored as SKIP
```

### 2.9 Date Verification
```
For each date claim:
  1. Calculate age from current date
  2. Score:
     - < 30 days → PASS (fresh)
     - 30-90 days → WARNING (aging)
     - > 90 days → FAIL (stale, unless historically accurate)
  3. Exception: changelog dates, historical references → always PASS
```

### 2.10 Dependency Verification
```
For each dependency claim:
  1. Check if named dependency exists in lockfile/config
  2. Check if stated version constraint matches actual
  3. Score: PASS / FAIL (missing or wrong version)
```

---

## Phase 3: Cross-Document Consistency

### 3.1 Build Cross-Reference Matrix
For all audited documents, extract overlapping claims and check for contradictions:

```markdown
| Claim | Doc A says | Doc B says | Match? |
|-------|-----------|-----------|--------|
| Version | 2.3.1 (README L5) | 2.3.0 (INSTALL L12) | ❌ CONFLICT |
| Build cmd | npm run build (README L42) | npm run build (CONTRIBUTING L8) | ✅ |
| Test count | 150 (README L30) | 142 (CLAUDE.md L18) | ⚠️ INCONSISTENT |
```

### 3.2 Consistency Rules

| Rule | Description |
|------|-------------|
| **Version unanimity** | ALL docs must state the same version |
| **Command unanimity** | Build/test/run commands must be identical across docs |
| **Count consistency** | Same metric should have same value everywhere |
| **Feature consistency** | A feature listed as "supported" in one doc can't be "planned" in another |
| **Architecture consistency** | Component names and relationships must agree |

### 3.3 Source of Truth Resolution
When documents disagree, determine which is correct:

```
Config files > README > CLAUDE.md > docs/ > CHANGELOG > inline comments
```

The document closer to code is more likely correct.

---

## Phase 4: Structural & Readability Analysis

### 4.1 Structural Quality Checks

| Check | Verification | Severity |
|-------|-------------|----------|
| **Heading hierarchy** | H1 → H2 → H3 (no skipped levels) | LOW |
| **Table formatting** | All tables render correctly in standard markdown | MEDIUM |
| **Code block language tags** | Every code block has a language identifier | LOW |
| **Orphan TOC entries** | Table of contents links resolve to headings | HIGH |
| **Duplicate headings** | No two headings at same level with identical text | LOW |
| **Empty sections** | No heading followed immediately by another heading | MEDIUM |
| **Consistent list style** | All lists use same marker (`-` vs `*` vs `1.`) | LOW |
| **Line length** | No lines > 200 chars (breaks some renderers) | LOW |
| **Trailing whitespace** | Trailing spaces except intentional line breaks | INFO |
| **Missing blank lines** | Blank line before/after headings, code blocks, tables | LOW |

### 4.2 Readability Assessment

| Metric | Assessment Method |
|--------|-----------------|
| **Logical flow** | Do sections follow a natural reading order? (intro → concepts → usage → reference → troubleshooting) |
| **First-contact clarity** | Can someone unfamiliar with the project understand the first 3 paragraphs? |
| **Instruction completeness** | Do "how to" sections have ALL steps? No assumed knowledge gaps? |
| **Example quality** | Are code examples complete, copy-pasteable, and correct? |
| **Jargon density** | Are project-specific terms explained on first use? |

Score each as: GOOD / ACCEPTABLE / POOR

---

## Phase 5: Auto-Fix (requires --fix)

### 5.1 Auto-Fixable Issues

| Issue Type | Fix Strategy | Risk |
|-----------|-------------|------|
| Wrong version number | Replace with canonical version from config | LOW — version is factual |
| Wrong count (> 10% drift) | Replace with actual count | LOW — count is factual |
| Stale date | Update to current date | LOW — date is factual |
| Broken internal link (file moved) | Update to new path if unambiguous | LOW — path is factual |
| Broken internal link (file deleted) | Remove link, keep text | MEDIUM — loses reference |
| Missing language tag on code block | Infer from content, add tag | LOW — cosmetic |
| Wrong command (script name changed) | Update to current script name | MEDIUM — verify first |

### 5.2 Manual-Review Issues (flagged but NOT auto-fixed)

| Issue Type | Why Not Auto-Fix |
|-----------|-----------------|
| Feature accuracy | Requires understanding intent |
| Architecture descriptions | Complex, may need restructuring |
| Purpose statements | Subjective |
| Status claims | May need product owner input |
| External broken links | May be temporary outage |
| Cross-document conflicts | Need to determine which doc is authoritative |
| Command semantics | Syntax correct but intent may differ |

### 5.3 Fix Safety Protocol
1. Record every change: file, line, before, after
2. Only modify documentation files (`.md`, `.rst`, `.adoc`) — NEVER source code
3. Make minimal changes — don't rewrite paragraphs
4. If a fix is ambiguous, flag for manual review instead
5. Report all fixes in the audit output

---

## Phase 6: Scoring & Report Generation

### 6.1 Per-File Scoring

For each audited file, compute dimension scores:

```
Accuracy    = (verified_claims_passed / total_verifiable_claims) × 100
Freshness   = (fresh_items / total_dated_items) × 100
Completeness = (documented_features / total_features_in_scope) × 100
Link Integrity = (valid_links / total_links) × 100
Cross-Consistency = (consistent_claims / total_overlapping_claims) × 100
Structural Quality = (passed_structural_checks / total_structural_checks) × 100
Actionability = (executable_instructions / total_instructions) × 100
Readability = average(flow_score, clarity_score, example_score) as percentage
```

**Overall File Score:**
```
Score = (Accuracy × 0.25) + (Freshness × 0.15) + (Completeness × 0.15) +
        (Link Integrity × 0.15) + (Cross-Consistency × 0.10) +
        (Structural Quality × 0.10) + (Actionability × 0.05) + (Readability × 0.05)
```

### 6.2 Score Interpretation

| Score | Grade | Meaning |
|-------|-------|---------|
| 95-100% | A+ | Excellent — documentation is trustworthy |
| 85-94% | A | Good — minor issues only |
| 75-84% | B | Acceptable — some claims need updating |
| 60-74% | C | Below standard — multiple stale/wrong claims |
| 40-59% | D | Poor — documentation is unreliable |
| 0-39% | F | Failing — documentation is actively harmful |

### 6.3 Audit Report Structure

```markdown
## Document Audit Report

**Project:** {name} v{version}
**Date:** {date}
**Files audited:** {N}
**Total claims verified:** {N}
**Overall project documentation score:** {N}%

---

### File Scores

| File | Score | Grade | Accuracy | Freshness | Links | Top Issue |
|------|-------|-------|----------|-----------|-------|-----------|
| README.md | 87% | A | 92% | 80% | 100% | Version stale by 1 minor |
| CONTRIBUTING.md | 71% | C | 65% | 90% | 85% | 7 dead file references |
| docs/API.md | 43% | D | 30% | 20% | 60% | Major feature undocumented |

---

### Critical Findings (must fix)

| ID | File | Line | Category | Finding | Correct Value |
|----|------|------|----------|---------|---------------|
| A-01 | README.md | 5 | Version | States v2.1.0 | Actual: v2.3.1 |
| A-02 | README.md | 42 | Command | `npm run deploy` | Script removed in v2.2 |
| A-03 | docs/API.md | 15 | Feature | "OAuth support" documented | Not implemented |

---

### Warnings (should fix)

| ID | File | Line | Category | Finding |
|----|------|------|----------|---------|
| W-01 | README.md | 30 | Count | Test count 150, actual 163 (8.7% drift) |
| W-02 | CLAUDE.md | 18 | Date | "Last updated Jan 2026" — 79 days old |

---

### Cross-Document Conflicts

| Claim | Documents | Values | Resolution |
|-------|-----------|--------|------------|
| Version | README vs INSTALL | v2.3.1 vs v2.3.0 | Update INSTALL to v2.3.1 |
| Build cmd | README vs CONTRIBUTING | `npm build` vs `npm run build` | Verify which works |

---

### Fixes Applied (if --fix)

| File | Line | Change | Before | After |
|------|------|--------|--------|-------|
| README.md | 5 | Version update | v2.1.0 | v2.3.1 |
| README.md | 30 | Test count | 150 tests | 163 tests |
```

### 6.4 Project-Wide Summary

```markdown
### Documentation Health Summary

| Dimension | Project Average | Worst File | Best File |
|-----------|----------------|-----------|-----------|
| Accuracy | 78% | docs/API.md (30%) | CHANGELOG.md (100%) |
| Freshness | 85% | INSTALL.md (60%) | README.md (95%) |
| Completeness | 72% | docs/API.md (40%) | README.md (90%) |
| Link Integrity | 91% | CONTRIBUTING.md (85%) | README.md (100%) |
| Cross-Consistency | 88% | — | — |
| Structural Quality | 95% | docs/API.md (80%) | README.md (100%) |
| Actionability | 82% | INSTALL.md (70%) | CONTRIBUTING.md (95%) |
| Readability | 88% | — | — |

**Recommended priority:** Fix docs/API.md (Grade F) → Fix CONTRIBUTING.md (Grade C) → Update INSTALL.md freshness
```

---

## NEVER DO

- Audit PAN infrastructure files (`.claude/`, `.planning/`, `pan-wizard-core/`)
- Modify source code files — only documentation files
- Auto-fix ambiguous issues (purpose statements, architecture descriptions)
- Report claims as FAIL without checking against actual code first
- Count external link failures during outages as permanent failures
- Invent ground truth — always extract from actual config/code files
- Skip the claim extraction step — every finding must trace to a specific claim
- Give a file 100% score without verifying at least the version, counts, and links
- Report findings without file path and line number

## ALWAYS DO

- Extract ground truth from config/code BEFORE auditing documents
- Verify every factual claim against the codebase
- Include line numbers for every finding
- Score every file across all 8 dimensions
- Sort critical findings first
- Check cross-document consistency when auditing multiple files
- Provide the correct value alongside every FAIL finding
- Distinguish between "wrong" (FAIL) and "stale" (WARNING) and "missing" (INFO)
- Report total claims verified — this gives confidence in audit thoroughness
- Produce a project-wide health summary when auditing multiple files
