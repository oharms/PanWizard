---
name: focus-drift-walking
group: Focus
description: Deep documentation-code drift detection, CLAUDE.md alignment, and auto-repair across all project directories
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
---

# /pan:focus-drift-walking — Documentation-Code Drift Detection & Alignment

Walk every directory in the project, detect drift between documentation and code reality, create missing documentation, repair drifted files, and synchronize the truth hierarchy. $ARGUMENTS

**Goal:** Eliminate the #1 cause of AI assistant hallucination — stale documentation. Walk the entire project tree, compare what documentation *claims* against what code *does*, score drift severity, and produce a complete alignment report with optional auto-repair. Every finding is evidence-based with file paths and line numbers.

**Methodology:** Combines directory-walking inventory, content fingerprinting, cross-reference validation, semantic drift scoring, and layered truth reconciliation into a single automated pipeline.

---

## CRITICAL: Project Scope Boundary

This command walks the **host project's directories and documentation** — NOT PAN Wizard's own infrastructure.

**ALWAYS EXCLUDE these directories from walking:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- `.planning/` — PAN planning state (read for context, never report as drift)
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories
- Build output directories: `build/`, `dist/`, `out/`, `target/`, `bin/`, `obj/`, `node_modules/`, `.git/`, `__pycache__/`, `.next/`, `.nuxt/`

**ALSO EXCLUDE:** Any directory listed in the project's `.gitignore` that represents generated output.

If a drift finding points to a file inside a PAN or build directory — DROP IT.

---

## MANDATORY: Execute ALL Phases Automatically

When `/pan:focus-drift-walking` is invoked, execute ALL phases for the selected mode without stopping. Do NOT ask questions between phases. Do NOT skip phases beyond what the mode specifies. Produce a complete drift report at the end.

**Flags:**
- `--create` — Create missing documentation files in directories that lack them
- `--audit` — Audit all existing documentation files for drift against code
- `--repair` — Auto-fix drifted documentation (update counts, paths, versions)
- `--report` — Dry run: detect and report drift without modifying anything
- `--dir <path>` — Target a specific directory subtree only
- `--depth <n>` — Limit walk depth (default: unlimited)
- `--severity <level>` — Filter report: `critical`, `warning`, `info` (default: all)
- `--format <type>` — Output format: `markdown` (default), `json`, `checklist`
- `--quick` — Skip Phase 4 (deep semantic analysis) and Phase 7 (cross-project sync)

**Default mode (no flags):** `--audit --report` — full audit with report, no modifications.

---

## Truth Hierarchy

Documentation has layers. Drift detection must understand which layer is the source of truth for what:

```
Layer 0: CODE (absolute truth)
  │  Source files, config files, build scripts — what the project actually IS
  │
Layer 1: PROJECT ROOT DOCS (primary documentation)
  │  README.md, CLAUDE.md, package.json, Cargo.toml, CMakeLists.txt
  │  Source of truth for: version, project name, top-level architecture, build commands
  │
Layer 2: DIRECTORY-LEVEL DOCS (local documentation)
  │  Per-directory README.md, CLAUDE.md, or equivalent
  │  Source of truth for: directory purpose, local conventions, key files
  │
Layer 3: INLINE DOCS (code-level documentation)
  │  Comments, docstrings, JSDoc, XML docs
  │  Source of truth for: function behavior, parameter semantics
  │
Layer 4: EXTERNAL DOCS (generated/published documentation)
     docs/, wiki/, guides, API references
     Source of truth for: NOTHING (must be derived from Layers 0-3)
```

**Drift direction rule:** Higher layers NEVER override lower layers. If code says X and docs say Y, the docs are wrong.

---

## Phase 0: Initialization & Project Discovery

### 0.1 Detect Project Type
Automatically detect the project's technology stack and structure:

| Signal File | Indicates |
|------------|-----------|
| `package.json` | Node.js / JavaScript / TypeScript |
| `Cargo.toml` | Rust |
| `CMakeLists.txt` | C / C++ (CMake) |
| `*.csproj` / `*.sln` | .NET / C# |
| `go.mod` | Go |
| `pyproject.toml` / `setup.py` / `requirements.txt` | Python |
| `pom.xml` / `build.gradle` | Java / Kotlin |
| `pubspec.yaml` | Dart / Flutter |
| `Makefile` | Generic build system |
| `Dockerfile` | Containerized application |
| `terraform/` / `*.tf` | Infrastructure as Code |

Record all detected stacks — projects can be polyglot.

### 0.2 Extract Root Truth
Read the project's root-level documentation and extract canonical facts:

**From build/config files:**
- Project name and version
- Entry points and main modules
- Dependencies (count and key ones)
- Build commands
- Test commands

**From README.md / CLAUDE.md:**
- Stated architecture and component list
- Stated feature list
- Stated test counts
- Stated build/run instructions
- Stated directory structure

### 0.3 Build Directory Manifest
Walk the project tree and build a complete manifest:

```markdown
| Directory | Depth | Files | Has Docs | Doc Type | Key Content |
|-----------|-------|-------|----------|----------|-------------|
| src/ | 1 | 42 | ✅ | README.md | Application source |
| src/api/ | 2 | 18 | ❌ | — | API endpoints |
| tests/ | 1 | 31 | ✅ | README.md | Test suites |
| ... | | | | | |
```

### 0.4 Establish Baseline Snapshot

```markdown
| Metric | Value | Source |
|--------|-------|--------|
| Project version | X.Y.Z | {config file} |
| Total source files | N | Directory walk |
| Total test files | N | Directory walk |
| Directories with docs | N/M | Directory walk |
| Documentation coverage | N% | Dirs with docs / total dirs |
| Root doc files | N | README, CLAUDE, etc. |
```

---

## Phase 1: Directory-Level Analysis

For each directory in the manifest, perform deep content analysis.

### 1.1 Content Fingerprinting
For each directory, extract:

| Artifact | How to Extract |
|----------|---------------|
| **Purpose** | Infer from filenames, imports, exports, README |
| **Key files** | Files with most imports/references, entry points |
| **Public API** | Exported functions, classes, endpoints, commands |
| **Dependencies** | Import statements, require calls, use declarations |
| **Dependents** | What imports/references this directory |
| **Tech stack** | File extensions, framework imports |
| **Test coverage** | Corresponding test directory or test files |
| **Conventions** | Naming patterns, file organization, code style |

### 1.2 Documentation Inventory
For each directory that HAS documentation, catalog:

| Field | Extract From Doc |
|-------|-----------------|
| Stated purpose | First paragraph / "Purpose" section |
| Stated key files | "Key Files" table or list |
| Stated dependencies | "Dependencies" section |
| Stated conventions | "Conventions" / "Rules" section |
| Stated build commands | "Build" / "Usage" section |
| Version references | Any version numbers mentioned |
| File paths mentioned | All `path/to/file` references |
| Counts mentioned | Any numeric claims (N files, N tests, N endpoints) |

### 1.3 Importance Classification
Classify each directory for documentation priority:

| Tier | Criteria | Documentation Requirement |
|------|----------|--------------------------|
| **Tier 1: Core** | Contains primary application logic, public API, or critical infrastructure | MUST have comprehensive docs |
| **Tier 2: Supporting** | Contains utilities, helpers, internal services, tests | SHOULD have docs |
| **Tier 3: Config/Infra** | Contains configuration, CI/CD, build scripts | MAY have docs |
| **Tier 4: Generated/Vendored** | Contains generated code, vendored deps, build output | SKIP — no docs needed |

---

## Phase 2: Drift Detection Engine

For each directory with existing documentation, run ALL drift checks.

### 2.1 Structural Drift Checks

| Check ID | Check | How |
|----------|-------|-----|
| SD-01 | **File existence** | Every file path in docs → verify file exists |
| SD-02 | **File absence** | Important files in directory → verify mentioned in docs |
| SD-03 | **Directory structure** | Stated structure → compare to actual `ls` output |
| SD-04 | **Dead references** | File paths in docs that point to deleted/moved files |
| SD-05 | **Orphan files** | Key files not mentioned in any documentation |

### 2.2 Semantic Drift Checks

| Check ID | Check | How |
|----------|-------|-----|
| SM-01 | **Purpose drift** | Stated purpose vs. actual content — does the description match? |
| SM-02 | **API drift** | Documented exports/functions vs. actual code exports |
| SM-03 | **Dependency drift** | Stated deps vs. actual import/require statements |
| SM-04 | **Convention drift** | Stated patterns vs. actual code patterns |
| SM-05 | **Architecture drift** | Stated architecture vs. actual file organization |

### 2.3 Numeric Drift Checks

| Check ID | Check | How |
|----------|-------|-----|
| ND-01 | **Version drift** | Version in docs vs. version in config files |
| ND-02 | **Count drift** | Stated file/test/endpoint counts vs. actual counts |
| ND-03 | **Metric drift** | Stated performance/size claims vs. verifiable reality |

### 2.4 Command Drift Checks

| Check ID | Check | How |
|----------|-------|-----|
| CD-01 | **Build command drift** | Documented build commands → attempt to validate syntax |
| CD-02 | **Test command drift** | Documented test commands → attempt to validate syntax |
| CD-03 | **CLI usage drift** | Documented CLI flags → verify against actual CLI help/source |

### 2.5 Cross-Reference Drift Checks

| Check ID | Check | How |
|----------|-------|-----|
| XR-01 | **Root alignment** | Sub-directory docs contradict root docs |
| XR-02 | **Sibling alignment** | Directory A's docs claim about directory B → verify with B |
| XR-03 | **Circular contradiction** | A says X depends on Y, Y says it doesn't export to A |
| XR-04 | **Stale link targets** | Internal markdown links → verify targets exist and anchors resolve |

---

## Phase 3: Drift Severity Scoring

### 3.1 Severity Classification

| Level | Code | Meaning | Impact |
|-------|------|---------|--------|
| **CRITICAL** | `C` | Documentation will cause wrong code generation | AI assistants will hallucinate, developers will write bugs |
| **HIGH** | `H` | Documentation is significantly misleading | Developers waste significant time following wrong instructions |
| **MEDIUM** | `M` | Documentation is incomplete or partially wrong | Developers eventually figure it out but waste time |
| **LOW** | `L` | Documentation is stale but not actively misleading | Cosmetic / completeness issue |
| **INFO** | `I` | Suggestion for improvement, not actual drift | Nice-to-have |

### 3.2 Severity Assignment Rules

| Condition | Severity |
|-----------|----------|
| Wrong version number for a tool, SDK, or framework | CRITICAL |
| Wrong build command | CRITICAL |
| Referenced file does not exist | HIGH |
| Stated API/export that doesn't exist in code | HIGH |
| Wrong dependency direction | HIGH |
| Count off by > 20% | MEDIUM |
| Missing newly added key file from docs | MEDIUM |
| Convention described but code uses different pattern | MEDIUM |
| Count off by < 20% | LOW |
| Purpose statement is vaguely correct but imprecise | LOW |
| Missing optional section in docs | INFO |

### 3.3 Drift Score Formula

```
Directory Drift Score = Σ(severity_weight × check_count) / total_checks

Weights: CRITICAL=10, HIGH=5, MEDIUM=2, LOW=1, INFO=0
```

| Score | Rating | Action |
|-------|--------|--------|
| 0 | ALIGNED | No action needed |
| 0.1 - 1.0 | MINOR DRIFT | Low priority updates |
| 1.1 - 3.0 | MODERATE DRIFT | Schedule updates this session |
| 3.1 - 5.0 | SIGNIFICANT DRIFT | Update before next feature work |
| 5.1+ | SEVERE DRIFT | STOP — update immediately, docs are dangerous |

---

## Phase 4: Deep Semantic Analysis (skip with --quick)

For directories with MODERATE+ drift, perform deeper investigation.

### 4.1 Code-to-Doc Alignment Scan
For each public function/class/endpoint in the directory:

1. Read the implementation
2. Read the corresponding documentation
3. Compare: parameter names, return types, side effects, error conditions
4. Flag any semantic mismatch

### 4.2 Convention Archaeology
When docs claim a convention but code doesn't follow it:

1. `git log` the directory — did the convention change recently?
2. Count files following vs. not following the convention
3. Determine: is the doc wrong, or is the code drifting from convention?

### 4.3 Dependency Graph Verification
Build an actual dependency graph from import statements and compare to documented dependencies:

```
Actual: A → B → C → D
Stated: A → B → D (missing C in the chain)
```

---

## Phase 5: Missing Documentation Creation (requires --create)

For Tier 1 and Tier 2 directories without documentation:

### 5.1 Generic Documentation Template

```markdown
# {Directory Name}

> Part of [{Project Name}]({relative path to root README or CLAUDE.md})

## Purpose
{1-3 sentences derived from actual file contents and directory name}

## Tech Stack
| Component | Value |
|-----------|-------|
| Language | {detected from file extensions} |
| Framework | {detected from imports/config} |
| Build | {detected from build files} |

## Key Files
| File | Purpose |
|------|---------|
| {entry point or main file} | {description} |
| {config file if present} | {description} |
| {most-imported file} | {description} |

## Architecture
{How code is organized — inferred from file structure and imports}

## Dependencies
- **Depends on:** {extracted from import statements}
- **Depended on by:** {extracted from reverse import search}

## Conventions
{Observed patterns: naming, file organization, code style}

## Build & Test
{Commands specific to this directory, if any}
```

### 5.2 Creation Rules
- NEVER create docs in build output or generated directories
- NEVER create docs in directories with < 3 source files (too trivial)
- NEVER include secrets, credentials, or API keys
- ALWAYS derive content from actual code — never guess
- ALWAYS include relative path back to root docs

---

## Phase 6: Drift Repair (requires --repair)

### 6.1 Auto-Fixable Drift
These can be repaired automatically:

| Drift Type | Fix |
|-----------|-----|
| Wrong version number | Update to match config file |
| Wrong file count | Update to match actual count |
| Dead file reference | Remove reference or update path |
| Missing key file | Add to "Key Files" table |
| Wrong test count | Update to match actual count |
| Stale "last updated" date | Update to today |
| Broken internal link | Fix path or remove link |

### 6.2 Manual-Review Drift
These are flagged but NOT auto-fixed:

| Drift Type | Why |
|-----------|-----|
| Purpose statement drift | Subjective — needs human judgment |
| Architecture description | Complex — may need redesign of docs |
| Convention changes | Need team consensus on which is right |
| Dependency direction disputes | Need architectural review |
| Build command changes | Could break if wrong — verify first |

### 6.3 Repair Safety Protocol
Before modifying any file:
1. Record the original content of lines being changed
2. Make only minimal, targeted changes
3. Never rewrite entire files — patch specific sections
4. Add a comment or note indicating the drift repair date

---

## Phase 7: Cross-Project Synchronization (skip with --quick)

### 7.1 Root Document Sync
After all directories are walked, sync findings back to root documentation:

1. **README.md** — Verify component/module counts, feature lists, directory descriptions
2. **CLAUDE.md** — Verify architecture claims, test counts, build commands, conventions
3. **CHANGELOG.md** — Verify latest version entry matches actual version

### 7.2 Truth Cascade
When root docs and sub-docs disagree:

| Disagreement Type | Resolution |
|-------------------|-----------|
| Root says version X, sub says version Y | Root wins — update sub |
| Root says build cmd X, sub says build cmd Y | Verify which works — update loser |
| Root says A depends on B, sub-B says no | Check actual imports — update wrong doc |
| Root lists N modules, actual count is M | Update root to M |
| Sub has local convention not in root | Keep in sub — local conventions are sub's truth |

---

## Phase 8: Report Generation

### 8.1 Executive Summary

```markdown
## Drift Walking Report

**Project:** {name} v{version}
**Date:** {date}
**Directories walked:** {N}
**Documentation coverage:** {N}% ({dirs with docs} / {total meaningful dirs})

### Overall Health
| Rating | Count | % |
|--------|-------|---|
| ALIGNED | N | N% |
| MINOR DRIFT | N | N% |
| MODERATE DRIFT | N | N% |
| SIGNIFICANT DRIFT | N | N% |
| SEVERE DRIFT | N | N% |
| NO DOCS (Tier 1-2) | N | N% |
```

### 8.2 Directory Detail Table

```markdown
| Directory | Tier | Has Docs | Drift Score | Rating | Top Issue |
|-----------|------|----------|-------------|--------|-----------|
| src/core/ | 1 | ✅ | 0.5 | MINOR | Count drift (tests: 42 → 48) |
| src/api/ | 1 | ❌ | — | NO DOCS | Tier 1 directory needs documentation |
| src/utils/ | 2 | ✅ | 3.2 | SIGNIFICANT | 4 dead file references |
| tests/ | 2 | ✅ | 0 | ALIGNED | — |
```

### 8.3 Critical Findings (CRITICAL + HIGH severity)

```markdown
### Critical Findings

| ID | Directory | Check | Finding | Fix |
|----|-----------|-------|---------|-----|
| CF-01 | src/core/ | SD-01 | `handler.ts` referenced but was renamed to `router.ts` | Update reference |
| CF-02 | README.md | ND-01 | States v2.1.0, actual is v2.3.1 | Update version |
```

### 8.4 Repair Log (if --repair was used)

```markdown
### Repairs Made

| File | Change | Before | After |
|------|--------|--------|-------|
| src/core/README.md | Version update | v2.1.0 | v2.3.1 |
| src/core/README.md | File count | 12 files | 15 files |
| README.md | Module count | 8 modules | 10 modules |
```

### 8.5 Recommendations

```markdown
### Recommended Actions (by priority)

1. **IMMEDIATE:** Fix {N} CRITICAL findings — these cause wrong AI output
2. **THIS SESSION:** Fix {N} HIGH findings — these waste developer time
3. **NEXT SESSION:** Create docs for {N} Tier 1 directories without documentation
4. **BACKLOG:** Address {N} MEDIUM findings, {N} LOW findings
```

---

## NEVER DO

- Walk build output directories (`build/`, `dist/`, `node_modules/`, `target/`, `obj/`, `__pycache__/`, `.git/`)
- Report PAN infrastructure files as project drift
- Auto-fix purpose statements, architecture descriptions, or conventions without `--repair`
- Create documentation for trivial directories (< 3 source files)
- Include secrets, credentials, or API keys in any generated documentation
- Guess at file contents — always read and verify
- Modify code files — this command only touches documentation files
- Override root documentation truth based on sub-directory claims (root is source of truth for project-wide facts)
- Report drift without evidence (file path + line number for every finding)

## ALWAYS DO

- Read actual source files before claiming drift — evidence-based only
- Include file paths and line numbers for every finding
- Score every drifted directory with the drift score formula
- Sort critical findings first in the report
- Respect the truth hierarchy (code > root docs > directory docs > inline docs > external docs)
- Walk ALL directories at the specified depth unless `--dir` constrains scope
- Report documentation coverage percentage
- Distinguish between "docs are wrong" and "docs are missing"
- Provide specific, actionable fix guidance for every finding
- Record repairs made if `--repair` is active
