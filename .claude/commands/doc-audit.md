# /doc-audit - Deep Document Audit

Audit documents for accuracy, freshness, broken links, cross-doc consistency, and content truth.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. This skill audits source docs only.
NEVER install PAN here. NEVER modify installed runtime directories.

---

**Usage:**
- `/doc-audit` — Audit CLAUDE.md, README.md, and docs/*.md (default)
- `/doc-audit [file]` — Audit a specific file
- `/doc-audit [directory]` — Audit all markdown files in directory
- `/doc-audit --deep` — Deep audit with full code verification and content accuracy
- `/doc-audit --links` — Focus on link validation only
- `/doc-audit --content` — Focus on content accuracy (prose matches code)
- `/doc-audit --counts` — Focus on count consistency across docs
- `/doc-audit --fix` — Auto-fix simple issues (counts, versions, dates)

**IMPORTANT:** Execute immediately without asking for confirmation.

---

## Audit Checklist

### 1. Counts — single source of truth (v3.7.9+)

**The rule:** **Counts live ONLY in `CLAUDE.md`.** All other docs (README.md, docs/*.md, comments) MUST NOT embed test counts, command counts, agent counts, module counts, etc. Count drift was 39 stale numbers across 9 docs in a single audit cycle (2026-04-27); the cure is centralization, not chasing.

**Source of truth hierarchy:**
```
package.json     ← version number (AUTHORITATIVE)
CLAUDE.md        ← drift-prone counts (THE ONLY place these live)
filesystem (`ls commands/pan/*.md | wc -l` etc.) ← always re-derivable
README.md, docs/*.md ← MUST NOT embed numeric counts at all
CHANGELOG.md     ← historical record (frozen-in-time, never update past entries)
```

- [ ] `package.json` version matches CLAUDE.md header and CHANGELOG.md latest entry
- [ ] CLAUDE.md "Counts" table reflects current filesystem state. Refresh via the snippet at the top of CLAUDE.md.
- [ ] **No other doc embeds a count.** If you find a numeric count in README.md, docs/*.md, or comments, **delete the number** (replace with qualitative phrasing like "specialized agents", "extensive command set", "the shipped commands"). Do NOT chase the drift across files.

**Stable identities are still allowed** in any doc:
- "5 target runtimes" (claude/codex/gemini/opencode/copilot — fundamental design, doesn't drift)
- "5 hooks" (named individually: check-update / context-monitor / statusline / cost-logger / trace-logger)
- Specific file paths (e.g., `bin/install.js`, `agents/pan-planner.md`)
- Architecture layer numbers ("Layer 1", "Layer 2") — these are labels, not counts

**Drift-prone counts** (NEVER embed in any doc except CLAUDE.md): tests, suites, test files, commands, agents, modules, workflows, templates, references, specs, ADRs, install.js LOC, install-lib.cjs export count, dispatcher subcommand count, dispatch path count.

### 2. Code Reference Accuracy
- [ ] File paths mentioned in docs actually exist in workspace
- [ ] Function/export names match actual definitions in code
- [ ] CLI flag examples are valid (grep the argument parser in pan-tools.cjs and install.js)
- [ ] `npm` script names match package.json scripts section
- [ ] Runtime directory names are correct (.claude, .codex, .gemini, .opencode, .github)

### 3. Link Validation
- [ ] Internal markdown links resolve (`[text](./other.md)`, `[text](docs/FILE.md)`)
- [ ] Anchor links point to existing headings (`[text](#heading-name)`)
- [ ] Relative paths from each doc's location are correct
- [ ] No broken cross-references between docs/*.md files
- [ ] External URLs are accessible (if --deep, fetch and check status)

### 4. Cross-Document Consistency
- [ ] Version number identical in: package.json, CLAUDE.md, README.md, CHANGELOG.md
- [ ] Test count identical in: CLAUDE.md (3 places), README.md, DEVELOPMENT.md
- [ ] Command count identical in: CLAUDE.md, README.md, ARCHITECTURE.md, DEVELOPMENT.md, USER-GUIDE.md
- [ ] Agent count identical in: CLAUDE.md, README.md, ARCHITECTURE.md, DEVELOPMENT.md, AGENTS.md
- [ ] Module count identical in: CLAUDE.md, ARCHITECTURE.md, DEVELOPMENT.md
- [ ] Runtime list (5 runtimes) consistent across: CLAUDE.md, README.md, USER-GUIDE.md, install.js
- [ ] CLI flag names consistent between: install.js arg parser, CLI-REFERENCE.md, README.md

### 5. Structural Validity
- [ ] Tables properly formatted (columns align, no missing pipes)
- [ ] Code blocks have language tags (```bash, ```javascript, etc.)
- [ ] No orphaned TOC entries (if doc has a table of contents)
- [ ] Frontmatter (if any) is valid YAML
- [ ] No duplicate headings at the same level

### 6. Substance Claims Verification (CRITICAL)
When auditing docs that claim features are "implemented", "supported", "available":
- [ ] **Read the actual source file** referenced by the claim — don't trust the doc
- [ ] Verify CLI flags actually exist in the argument parser
- [ ] Verify exported functions are actually called somewhere
- [ ] Verify workflow steps reference real tools/commands
- [ ] If a non-CLAUDE.md doc has a count claim ("42 commands"), **delete the number** — counts only live in CLAUDE.md (see section 1).
- [ ] If claim says "supports 5 runtimes" — verify all 5 install paths exist in install.js (5 runtimes is a stable identity, not a drift-prone count)

**Key documents with substance claims:**
- `README.md` — Feature list, install instructions, runtime support
- `docs/ARCHITECTURE.md` — Layer descriptions, component counts, tool access matrices
- `docs/CLI-REFERENCE.md` — Every subcommand and flag
- `docs/AGENTS.md` — Agent inventory, model profiles, tool access

### 7. Content Accuracy Verification (CRITICAL — catches factually wrong descriptions)
The most important check: does the document's **prose actually describe what the code does?**

**What to verify:**
- [ ] **Architecture descriptions match code** — if doc says "16 core CJS modules", count them
- [ ] **Installer behavior claims** — if doc says "--all installs 5 runtimes", read the install code
- [ ] **Hook behavior descriptions** — if doc says hooks fire on SessionStart, verify in settings.json schema
- [ ] **Command descriptions** — spot-check 5 command docs against their actual implementations
- [ ] **Agent tool access claims** — if AGENTS.md says pan-reviewer has "Read, Grep, Glob, Bash", verify the agent markdown
- [ ] **Model profile table** — verify MODEL_PROFILES in core.cjs matches what docs/AGENTS.md shows
- [ ] **Test patterns described in CLAUDE.md** — verify they match actual test helper implementations
- [ ] **Configuration options** — verify config keys in docs match loadConfig() in config.cjs

**Sampling strategy:**
1. **Always verify**: CLAUDE.md entirely, README.md install section, CLI-REFERENCE.md flags
2. **Spot-check**: 5 random rows from any table with technical data
3. **Skip**: Marketing copy, license text, historical ADRs (frozen in time)

**Severity:**
- Doc describes behavior that contradicts code → **ERROR: factually wrong**
- Command example uses non-existent flags → **ERROR: misleading instruction**
- Numeric count appears in any doc except CLAUDE.md → **WARNING: violates count-SSoT rule — delete the number, don't update it**
- CLAUDE.md count is stale vs filesystem → **WARNING: refresh CLAUDE.md only**
- Workflow description roughly correct but missing a new step → **WARNING: incomplete**
- Old terminology but meaning is still clear → **INFO: outdated terminology**

---

## Execution Steps

### Step 1: Identify Target Documents
If no argument provided, audit these core docs:
```
CLAUDE.md
README.md
CHANGELOG.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
docs/CLI-REFERENCE.md
docs/USER-GUIDE.md
docs/AGENTS.md
```

### Step 2: Get Current Truth
```bash
# Version
node -e "console.log(require('./package.json').version)"

# Test counts
npm run test:all 2>&1 | grep -E "^ℹ (tests|suites|pass|fail)"

# File counts
echo "Commands: $(ls commands/pan/*.md | wc -l)"
echo "Agents: $(ls agents/*.md | wc -l)"
echo "Core modules: $(ls pan-wizard-core/bin/lib/*.cjs | wc -l)"
echo "Workflows: $(ls pan-wizard-core/workflows/*.md | wc -l)"
echo "Templates: $(find pan-wizard-core/templates -name '*.md' | wc -l)"
echo "References: $(ls pan-wizard-core/references/*.md | wc -l)"
echo "Specs: $(ls docs/specs/*.md | wc -l)"
echo "ADRs: $(ls docs/decisions/ADR-*.md | wc -l)"
echo "Test files: $(ls tests/*.test.cjs tests/scenarios/*.test.cjs | wc -l)"
echo "Hooks: $(ls hooks/dist/*.js 2>/dev/null | wc -l)"

# Dispatcher subcommands (approximate)
grep -c "case '" pan-wizard-core/bin/pan-tools.cjs
```

### Step 3: Verify Each Document
For each target document:

1. **Read the document** completely
2. **Scan for forbidden numeric counts** — find any number that looks like a tests/commands/agents/modules/workflows/templates/refs/specs/ADRs count.
   - In `CLAUDE.md`: cross-check against filesystem; refresh if drifted.
   - In **any other doc**: this is a violation of the count-SSoT rule. **Delete the number** (replace with qualitative phrasing or remove entirely). Do NOT update it.
3. **Extract all version references** — patterns like `3.7.0`, `v3.X`. Only `CLAUDE.md` and `CHANGELOG.md` should carry a version; CHANGELOG entries are frozen-in-time.
4. **Extract all file paths** — verify each exists
5. **Extract all CLI examples** — verify flags exist in argument parsers

### Step 3.5: Content Accuracy Verification (if --deep or --content)
For each target document, verify prose descriptions match the code:

1. **Extract verifiable claims** — scan for:
   - Architecture statements ("16 core modules", "3-layer architecture")
   - Runtime support claims ("5 AI coding tool runtimes")
   - Feature descriptions ("manifest-based tracking", "pure functions in install-lib.cjs")
   - Configuration references (config keys, defaults, flags)
   - Command/subcommand listings
2. **Read actual source files** for each claim:
   - For counts: actually count the files/functions
   - For CLI flags: read the argument parser in install.js and pan-tools.cjs
   - For config: read loadConfig() in config.cjs
   - For architecture claims: trace the actual module structure
3. **Verdict each claim:**
   - Matches code → ✅ verified
   - Contradicts code → ❌ ERROR: factually wrong (include what code actually shows)
   - Partially correct → ⚠️ WARNING: incomplete/misleading
   - Cannot verify quickly → ℹ️ INFO: unverified

### Step 4: Report Findings

Use this format:
```markdown
## Document Audit Report

**Truth baseline:**
- Version: X.Y.Z (from package.json)
- CLAUDE.md counts table: refreshed / drifted (refresh in CLAUDE.md only)

### CLAUDE.md (Score: XX%)
✅ Version 3.7.X matches package.json
✅ Counts table values match filesystem (or drift list with refresh)
⚠️ Test count says 1972 but actual is 1976
❌ Claims "31 workflow definitions" but actual count is 30

### README.md (Score: XX%)
...

### Summary
| Document | Score | Errors | Warnings | Info |
|----------|-------|--------|----------|------|
| CLAUDE.md | 95% | 0 | 2 | 1 |
| README.md | 88% | 1 | 3 | 0 |
| ... | | | | |
```

### Step 5: Auto-Fix (if --fix)
For issues that can be auto-fixed:
- **In CLAUDE.md only:** refresh the counts table to match filesystem; bump version reference to match `package.json`.
- **In every other doc:** if a numeric count is found, **delete the number** (replace with qualitative phrasing). Never propagate a number into a non-CLAUDE.md doc.
- Fix internal link case sensitivity.

**Never auto-fix:**
- Architecture descriptions (require understanding)
- Feature claims (require code reading)
- External links (require network)
- Historical content in CHANGELOG.md or ADRs

Report what was fixed and what requires manual attention.

---

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| ❌ ERROR | Must fix | Document is misleading — blocks trust |
| ⚠️ WARNING | Should fix | Causes confusion, stale data |
| ℹ️ INFO | Optional | Nice-to-have improvements |

---

## Common Issues in This Project

1. **Count-SSoT violations (v3.7.9+)** — Counts are only allowed in `CLAUDE.md`. If you find a numeric count of tests/commands/agents/modules/etc. in any other doc, **delete the number** rather than chasing the drift. The count-SSoT rule was introduced after a single audit cycle found 39 stale numbers across 9 docs.
2. **CLAUDE.md counts table drift** — The one place numbers are allowed will still drift. Refresh from filesystem when needed (snippet at top of CLAUDE.md regenerates the values).
3. **Stale installer flag docs** — New CLI flags added to install.js but not documented in CLI-REFERENCE.md or README.md.
4. **Runtime-specific claims** — "Hooks supported by all runtimes" but actually only Claude/Gemini/Copilot support hooks.
5. **Model profile table drift** — MODEL_PROFILES in core.cjs changes but `docs/AGENTS.md` model profiles table goes stale. (The model profile table is qualitative metadata, not a count, so it's allowed in AGENTS.md.)
6. **Dead internal links** — File renames (especially the lowercase migration) leave orphan links in docs.
7. **Workflow step accuracy** — Workflows reference tools or agents that have been renamed or restructured.
8. **Historical ADR counts** — ADRs contain numbers from when they were written. These are frozen-in-time historical snapshots — never update them.
9. **Historical CHANGELOG numbers** — Same as ADRs. Frozen at write-time. Never update past entries.
