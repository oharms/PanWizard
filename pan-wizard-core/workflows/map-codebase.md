<purpose>
Orchestrate parallel codebase mapper agents to analyze codebase and produce structured documents in .planning/codebase/

Each agent has fresh context, explores a specific focus area, and **writes documents directly**. The orchestrator only receives confirmation + line counts, then writes a summary.

Output: .planning/codebase/ folder with 9 structured documents about the codebase state.
</purpose>

<philosophy>
**Why dedicated mapper agents:**
- Fresh context per domain (no token contamination)
- Agents write documents directly (no context transfer back to orchestrator)
- Orchestrator only summarizes what was created (minimal context usage)
- Faster execution (agents run simultaneously)

**Pre-computed analysis:**
Before spawning agents, run `codebase analyze-imports` and `codebase detect-languages` to provide structured data to relationship and practices agents. This avoids expensive LLM re-scanning.

**Document quality over length:**
Include enough detail to be useful as reference. Prioritize practical examples (especially code patterns) over arbitrary brevity.

**Always include file paths:**
Documents are reference material for Claude when planning/executing. Always include actual file paths formatted with backticks: `src/services/user.ts`.

**Lowercase filenames:**
All output documents use lowercase filenames (stack.md, not STACK.md) to align with PAN's .planning/ convention.
</philosophy>

<process>

<step name="init_context" priority="first">
Load codebase mapping context:

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init map-codebase)
```

Extract from init JSON: `mapper_model`, `commit_docs`, `codebase_dir`, `existing_maps`, `has_maps`, `codebase_dir_exists`, `supported_languages`, `file_count`, `focus_areas`.
</step>

<step name="pre_compute">
Run pre-computed analysis for relationship and practices agents:

```bash
LANG_DATA=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs codebase detect-languages)
IMPORT_DATA=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs codebase analyze-imports)
PRACTICES_DATA=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs codebase best-practices)
```

These JSON results will be embedded in agent prompts to avoid redundant scanning.
</step>

<step name="check_existing">
Check if .planning/codebase/ already exists using `has_maps` from init context.

If `codebase_dir_exists` is true:
```bash
ls -la .planning/codebase/
```

**If exists:**

```
.planning/codebase/ already exists with these documents:
[List files found]

What's next?
1. Refresh - Delete existing and remap codebase
2. Update - Keep existing, only update specific documents
3. Skip - Use existing codebase map as-is
```

Wait for user response.

If "Refresh": Delete .planning/codebase/, continue to create_structure
If "Update": Ask which documents to update, continue to spawn_agents (filtered)
If "Skip": Exit workflow

**If doesn't exist:**
Continue to create_structure.
</step>

<step name="create_structure">
Create .planning/codebase/ directory:

```bash
mkdir -p .planning/codebase
```

**Expected output files (all lowercase):**
- stack.md (from tech mapper)
- integrations.md (from tech mapper)
- architecture.md (from arch mapper)
- structure.md (from arch mapper)
- conventions.md (from quality mapper)
- testing.md (from quality mapper)
- concerns.md (from concerns mapper)
- relationships.md (from relationships mapper)
- best-practices.md (from practices mapper)

Continue to spawn_agents.
</step>

<step name="spawn_agents">
Spawn 6 parallel pan-document_code agents.

Use Task tool with `subagent_type="pan-document_code"`, `model="{mapper_model}"`, and `run_in_background=true` for parallel execution.

**CRITICAL:** Use the dedicated `pan-document_code` agent, NOT `Explore`. The mapper agent writes documents directly.

**CRITICAL: Project Scope Boundary — include this line in EVERY agent prompt:**
> SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

**Agent 1: Tech Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map codebase tech stack",
  prompt="Focus: tech
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Analyze this codebase for technology stack and external integrations.

Write these documents to .planning/codebase/:
- stack.md - Technology Architecture: languages, runtime, frameworks, dependencies, deployment topology diagram
- integrations.md - Data Architecture: external APIs, databases, auth providers, webhooks, service map and ER diagrams

Include Mermaid diagrams where the template specifies them. Fill TOGAF sections based on findings.
Explore thoroughly. Write documents directly using templates. Return confirmation only."
)
```

**Agent 2: Architecture Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map codebase architecture",
  prompt="Focus: arch
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Analyze this codebase architecture and directory structure.

Write these documents to .planning/codebase/:
- architecture.md - Business & Application Architecture: pattern, layers, component relationship diagram, request lifecycle sequence diagram, data flow
- structure.md - Directory layout with visual hierarchy diagram, key locations, naming conventions

Include Mermaid diagrams where the template specifies them. Fill TOGAF sections based on findings.
Explore thoroughly. Write documents directly using templates. Return confirmation only."
)
```

**Agent 3: Quality Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map codebase conventions",
  prompt="Focus: quality
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Analyze this codebase for coding conventions and testing patterns.

Write these documents to .planning/codebase/:
- conventions.md - Code style, naming, patterns, error handling
- testing.md - Framework, structure, mocking, coverage

Explore thoroughly. Write documents directly using templates. Return confirmation only."
)
```

**Agent 4: Concerns Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map codebase concerns",
  prompt="Focus: concerns
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Analyze this codebase for technical debt, known issues, and areas of concern.

Write this document to .planning/codebase/:
- concerns.md - Risk overview with quadrant chart, tech debt, bugs, security, performance, fragile areas

Include Mermaid risk quadrant chart where the template specifies it.
Explore thoroughly. Write document directly using template. Return confirmation only."
)
```

**Agent 5: Relationships Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map module relationships",
  prompt="Focus: relationships
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Analyze module dependencies using pre-computed import analysis.

Pre-computed data (from `codebase analyze-imports`):
{IMPORT_DATA}

Write this document to .planning/codebase/:
- relationships.md - Module dependency graph (Mermaid), circular dependencies, high-coupling modules, orphan modules, entry points, layer boundaries and violations, import patterns

Use the pre-computed dependency graph and circular dependency data. Enrich with your own exploration of the codebase to understand architectural layers and coupling patterns.
Write document directly using template. Return confirmation only."
)
```

**Agent 6: Practices Focus**

```
Task(
  subagent_type="pan-document_code",
  model="{mapper_model}",
  run_in_background=true,
  description="Map best practices",
  prompt="Focus: practices
SCOPE: Only analyze project source code. EXCLUDE these PAN infrastructure directories: .claude/, .github/copilot-instructions.md, .opencode/, .gemini/, .codex/, .planning/

Assess codebase best practices using pre-computed analysis.

Pre-computed language data (from `codebase detect-languages`):
{LANG_DATA}

Pre-computed best practices scores (from `codebase best-practices`):
{PRACTICES_DATA}

Write this document to .planning/codebase/:
- best-practices.md - Scored assessment across 5 categories (Error Handling, Testing, Naming Conventions, Security, Performance), detected patterns with code examples, recommendations

Use the pre-computed scores as a starting point. Explore the codebase to find specific code examples for each category and provide actionable recommendations.
Write document directly using template. Return confirmation only."
)
```

Continue to collect_confirmations.
</step>

<step name="collect_confirmations">
Wait for all 6 agents to complete.

Read each agent's output file to collect confirmations.

**Expected confirmation format from each agent:**
```
## Mapping Complete

**Focus:** {focus}
**Documents written:**
- `.planning/codebase/{doc1}.md` ({N} lines)
- `.planning/codebase/{doc2}.md` ({N} lines)

Ready for orchestrator summary.
```

**What you receive:** Just file paths and line counts. NOT document contents.

If any agent failed, note the failure and continue with successful documents.

Continue to verify_output.
</step>

<step name="verify_output">
Verify all documents created successfully:

```bash
ls -la .planning/codebase/
wc -l .planning/codebase/*.md
```

**Verification checklist:**
- All 9 documents exist (lowercase filenames)
- No empty documents (each should have >20 lines)

If any documents missing or empty, note which agents may have failed.

Continue to scan_for_secrets.
</step>

<step name="scan_for_secrets">
**CRITICAL SECURITY CHECK:** Scan output files for accidentally leaked secrets before committing.

Run secret pattern detection:

```bash
# Check for common API key patterns in generated docs
grep -E '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]+|AKIA[A-Z0-9]{16}|xox[baprs]-[a-zA-Z0-9-]+|-----BEGIN.*PRIVATE KEY|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.)' .planning/codebase/*.md 2>/dev/null && SECRETS_FOUND=true || SECRETS_FOUND=false
```

**If SECRETS_FOUND=true:**

```
SECURITY ALERT: Potential secrets detected in codebase documents!

Found patterns that look like API keys or tokens in:
[show grep output]

This would expose credentials if committed.

**Action required:**
1. Review the flagged content above
2. If these are real secrets, they must be removed before committing
3. Consider adding sensitive files to Claude Code "Deny" permissions

Pausing before commit. Reply "safe to proceed" if the flagged content is not actually sensitive, or edit the files first.
```

Wait for user confirmation before continuing to commit_codebase_map.

**If SECRETS_FOUND=false:**

Continue to commit_codebase_map.
</step>

<step name="commit_codebase_map">
Commit the codebase map:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: map existing codebase" --files .planning/codebase/*.md
```

Continue to offer_next.
</step>

<step name="offer_next">
Present completion summary and next steps.

**Get line counts:**
```bash
wc -l .planning/codebase/*.md
```

**Output format:**

```
Codebase mapping complete.

Created .planning/codebase/:
- stack.md ([N] lines) - Technologies and dependencies
- architecture.md ([N] lines) - System design and patterns
- structure.md ([N] lines) - Directory layout and organization
- conventions.md ([N] lines) - Code style and patterns
- testing.md ([N] lines) - Test structure and practices
- integrations.md ([N] lines) - External services and APIs
- concerns.md ([N] lines) - Technical debt and issues
- relationships.md ([N] lines) - Module dependencies and coupling
- best-practices.md ([N] lines) - Best practices assessment and scores


---

## Next Up

**Initialize project** — use codebase context for planning

`/pan:new-project`

<sub>`/clear` first - fresh context window</sub>

---

**Also available:**
- Re-run mapping: `/pan:map-codebase`
- Review specific file: `cat .planning/codebase/stack.md`
- Edit any document before proceeding

---
```

End workflow.
</step>

</process>

<success_criteria>
- .planning/codebase/ directory created
- Pre-computed analysis run before agents spawn (detect-languages, analyze-imports, best-practices)
- 6 parallel pan-document_code agents spawned with run_in_background=true
- Agents write documents directly (orchestrator doesn't receive document contents)
- Relationships agent receives pre-computed import/dependency data
- Practices agent receives pre-computed language and best-practices data
- Read agent output files to collect confirmations
- All 9 codebase documents exist (lowercase filenames)
- Clear completion summary with line counts
- User offered clear next steps in PAN style
</success_criteria>
