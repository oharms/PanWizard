# Feature Specification: Copilot CLI Interactive Experience Optimization

**Feature:** Enhance PAN Wizard's Copilot CLI runtime to provide structured user interaction via text-based patterns
**Generated:** 2026-03-01
**Status:** Proposed
**ADR:** ADR-0004

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

When PAN Wizard workflows run on GitHub Copilot CLI, every `AskUserQuestion` invocation degrades from a structured selection experience (numbered options with headers, descriptions, single-select, multi-select) into an unstructured prose question. The user sees a wall of text like *"A few quick questions to nail down the scope: Search type... What comes back... Tech stack..."* instead of clean, numbered option lists with clear selection instructions. This happens because the current install-time converter strips `AskUserQuestion` tool references (`AskUserQuestion: null`) and does a naive text replacement (`AskUserQuestion` → `question`) without rewriting the interaction instructions to teach the model how to simulate structured choices in plain text. The cost of NOT fixing this: Copilot CLI becomes a second-class runtime where PAN's carefully-designed questioning workflows (41 `AskUserQuestion` invocations across 15 workflow files) produce a confusing, unguided user experience that undermines PAN's core value proposition of structured project orchestration.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| User-stated pain | This conversation | User reported: "On copilot the options are not coming up for select — you get a question sheet" with example of unstructured prose output |
| Architecture gap | `bin/install.js` line 429 | `AskUserQuestion: null` — tool stripped with no replacement behavior, leaving 41 interaction points unaddressed |
| Competitor parity | Claude Code AskUserQuestion | Claude Code provides structured single-select with headers, descriptions, "Other" fallback; Copilot CLI users get none of this |
| Market timing | Copilot CLI GA 2026-02-25 | Fresh runtime — establishing good UX patterns now prevents bad habits from calcifying |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Enhance skill adapter header with interaction guidance | Adding new tools to Copilot CLI (no API for custom tools) |
| Rewrite `AskUserQuestion` references in workflow content to text-based patterns | Modifying Copilot CLI itself (external dependency) |
| Add multi-select simulation via comma-separated numbers | Building a TUI framework (over-engineering for text patterns) |
| Teach model to present numbered options and parse responses | VS Code Copilot Chat integration (different product) |
| Converter improvements in `convertClaudeToCopilotMarkdown()` | Runtime user input validation (model responsibility) |
| Update `getCopilotSkillAdapterHeader()` with interaction section | Changes to other runtimes (Claude Code, OpenCode, Gemini, Codex) |
| Test coverage for new converter behavior | Copilot Extensions marketplace support |

### 0.4 Success Criteria

```
SC-1: Copilot CLI skills present numbered choice lists instead of prose questions for all AskUserQuestion patterns
SC-2: Multi-select scenarios include "type numbers separated by commas" instruction
SC-3: Single-select scenarios include "type number or label" instruction
SC-4: Recommended options are visually marked (bold or ★) in text output
SC-5: No regression in existing 790+ tests
SC-6: Converter changes work identically on Windows, Mac, and Linux
SC-7: All 15 affected workflow files produce improved Copilot CLI output after install
```

### 0.5 User Stories

```
As a developer using PAN Wizard on Copilot CLI, I want to see numbered options
when the workflow asks me a question, so that I can quickly type "1" or "2"
instead of composing a free-text answer to a vague prose question.

As a developer using discuss-phase on Copilot CLI, I want multi-select areas
presented as a numbered checklist with "type 1,3,4" instructions,
so that I can select multiple discussion topics as easily as on Claude Code.

As a developer switching between Claude Code and Copilot CLI, I want the same
logical workflow experience on both runtimes, so that PAN feels consistent
regardless of which AI tool I'm using.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `bin/install.js` converters | Partial | Enhancement to existing converter functions — no new command |
| `getCopilotSkillAdapterHeader()` | Partial | Enhancement to existing function — adds interaction section |
| `convertClaudeToCopilotMarkdown()` | Partial | Enhancement to existing function — adds AskUserQuestion rewriting |

**No Full overlap.** This enhances existing converter infrastructure, not creating a new command.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 32 | 32 | +0 |
| New concepts introduced | 0 | 0 | +0 |
| Score | — | — | simplifies (-1) |

This feature **reduces** cognitive load for Copilot CLI users by replacing confusing prose with clear numbered options.

---

## Phase 1: Internal Reconnaissance

### 1.1 Architecture Scan

**Existing capabilities inventory:**

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Claude→Copilot tool mapping | Working | `bin/install.js:419-432` | `AskUserQuestion: null` — strips tool, needs replacement |
| Copilot markdown converter | Working | `bin/install.js:554-564` | Converts Task/Agent refs, missing AskUserQuestion rewrite |
| Copilot skill adapter header | Working | `bin/install.js:571-583` | Generic header, no interaction guidance |
| Copilot skill converter | Working | `bin/install.js:590-604` | Assembles YAML + adapter + body |
| Copilot agent converter | Working | `bin/install.js:611-642` | Agent frontmatter + body conversion |
| AskUserQuestion patterns | 41 occurrences | 15 workflow files in `pan-wizard-core/workflows/` | All lost on Copilot CLI |
| multiSelect patterns | 3 occurrences | discuss-phase, new-project, new-milestone workflows | Checkbox-style selection impossible in text |
| Questioning guide | Reference doc | `pan-wizard-core/references/questioning.md` | 2-4 options ideal, max 12 char headers |
| OpenCode AskUserQuestion handling | Working | `bin/install.js:745` | `AskUserQuestion` → `question` text replacement |
| Gemini AskUserQuestion mapping | Working | `bin/install.js:372` | `AskUserQuestion: 'ask_user'` — Gemini has a tool |

### 1.2 Codebase Search

| Search Target | Where Found | What Extracted |
|---------------|-------------|----------------|
| Copilot converter functions | `bin/install.js:531-642` | 6 functions: slash commands, markdown, adapter, skill, agent, tool name |
| AskUserQuestion usage | 15 workflow files, 41 occurrences | Single-select (38), multiSelect (3), headers (12 char limit), descriptions |
| Workflow files affected | `discuss-phase` (6), `new-project` (12), `new-milestone` (5), `settings` (3), `verify-work` (1), `plan-phase` (1), `execute-plan` (1), `add-tests` (3), `check-todos` (2), `complete-milestone` (2), `add-todo` (1), `cleanup` (1), `discovery-phase` (1), `update` (1), `quick` (1) | Heavy users: new-project (12), discuss-phase (6), new-milestone (5) |
| Test patterns | `tests/copilot-install.test.cjs` | 30 tests, uses `runInstaller()` + fs checks |
| Converter tests | `tests/copilot-install.test.cjs` | Tests skill structure, agent structure, uninstall, tool mapping |

### 1.3 Convention Enforcement Checklist

- [x] No new `cmd*` function needed — changes are to converter helpers
- [x] File reads use appropriate patterns — converters process in-memory strings
- [x] File writes wrapped in try-catch — existing installer write paths already hardened
- [x] JSON output via `output()` — N/A (installer, not CLI command)
- [x] Paths through `toPosix()` — N/A (file content conversion, not path output)
- [x] Module exports at bottom — existing pattern maintained
- [x] CommonJS only — existing `.js` installer file
- [x] Zero runtime dependencies — pure string manipulation, no new deps

### 1.4 Dependency & Integration Map

```
[Copilot CLI Interaction Enhancement]
    ├── modifies: bin/install.js (convertClaudeToCopilotMarkdown, getCopilotSkillAdapterHeader)
    ├── depends on: existing Copilot converter infrastructure
    ├── depends on: AskUserQuestion patterns in workflow .md files (read-only)
    ├── conflicts with: nothing
    └── enables: better UX for all 32 PAN commands on Copilot CLI
```

**require() chain:** No new modules. Changes are within `bin/install.js` which is a standalone installer script.

---

## Phase 2: Competitive Intelligence

### 2.1 Deep-Dive Research (6 Tools)

#### Aider
- **UX:** Terminal-based with `confirm_ask()` (yes/no/skip/all/don't-ask-again) and `prompt_ask()` (free text with default)
- **Behavior:** `--yes` flag auto-approves all confirmations. Group preference persistence across prompts.
- **Structured input:** Yes/No confirmations only. No numbered choice menus. No multi-select.
- **Ergonomics:** Users love the simplicity. Hate that complex choices require free-text typing.
- **Evolution:** Started with bare `input()`, evolved to `confirm_ask()` with group preferences. Still no structured selection.

#### Cursor
- **UX:** IDE-native with rich UI widgets (buttons, inline diffs, Accept/Reject).
- **Behavior:** Agent mode uses tool approval flow — user sees diff and clicks Accept/Reject.
- **Structured input:** Full IDE widget set (quick picks, dropdowns, inline buttons). Not applicable to CLI.
- **Ergonomics:** Beautiful in IDE. No CLI equivalent exists.
- **Evolution:** Moved from simple chat to agent mode with approval workflows.

#### Continue.dev
- **UX:** IDE extension with slash commands and context providers.
- **Behavior:** Uses VS Code quick picks for model selection, file selection.
- **Structured input:** Relies on VS Code's native `showQuickPick` API.
- **Ergonomics:** Clean integration with IDE. No standalone CLI interaction model.
- **Evolution:** Started as simple chat, added context providers and tools.

#### Cline
- **UX:** VS Code sidebar with option buttons (styled to theme).
- **Behavior:** Single-select only — "all other buttons become unselectable" after one click.
- **Structured input:** Yes — dedicated `OptionsButtons.tsx` component with clickable buttons.
- **Ergonomics:** Users love the clean approval flow. Hate that there's no multi-select.
- **Evolution:** Started with text-only, added UI buttons for tool approvals.

#### Windsurf
- **UX:** IDE-based Cascade flow with step-by-step execution.
- **Behavior:** AI proceeds autonomously unless tool use requires approval.
- **Structured input:** IDE-native approval buttons (Accept/Reject per tool use).
- **Ergonomics:** Smooth flow. No equivalent for multi-choice questions — AI decides.
- **Evolution:** Lean towards autonomous execution, less user interaction.

#### GitHub Copilot Workspace
- **UX:** Web-based with plan → implement → review flow.
- **Behavior:** Presents a plan as editable text. User modifies plan before execution.
- **Structured input:** Plan is a structured checklist that users can edit. No runtime choice prompts.
- **Ergonomics:** Good for planning. No real-time interaction during execution.
- **Evolution:** Focused on plan approval over real-time choices.

### 2.2 Prior Art: Text-Based Structured Input

The problem of simulating structured input in text-only interfaces is well-established:

- **UNIX dialog/whiptail:** TUI widgets (checklist, radiolist, menu) over ncurses — too heavy for AI agent responses
- **Inquirer.js / prompts:** Node.js libraries with arrow-key selection — requires terminal control
- **Numbered menu pattern:** Decades-old, used in BBS, IVR systems, CLI tools — **the proven pattern for text-only structured selection**
- **IRC/Discord bots:** Use numbered reactions or "reply with 1/2/3" — closest analogue to our use case

### 2.3 Competitive Matrix

| Aspect | PAN (Current Copilot) | PAN (Proposed) | Aider | Cline | Cursor | Copilot WS |
|--------|----------------------|----------------|-------|-------|--------|------------|
| Structured choices | ❌ Prose | ✅ Numbered lists | ⚠️ Y/N only | ✅ Buttons | ✅ Widgets | ⚠️ Plan edit |
| Multi-select | ❌ Lost | ✅ Comma-separated | ❌ None | ❌ Single only | ✅ Checkboxes | ❌ None |
| Recommended option | ❌ Lost | ✅ Bold/★ marker | ❌ None | ❌ No marker | ✅ Highlighted | ❌ None |
| "Other" fallback | ❌ Lost | ✅ "Or type your own" | ✅ Free text | ❌ Fixed options | ✅ Free text | ✅ Edit plan |
| One-at-a-time | ❌ All at once | ✅ Sequential | ✅ Sequential | ✅ Sequential | ✅ Sequential | N/A |
| CLI-native | ✅ | ✅ | ✅ | ❌ IDE | ❌ IDE | ❌ Web |
| Cross-platform | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Complex widget simulation (arrows, cursor control) — terminal-agnostic text only |
| **REDUCE** | What should be reduced? | Ambiguity in Copilot CLI user interactions — prose questions → clear numbered options |
| **RAISE** | What should be raised? | Copilot CLI to first-class runtime parity — same logical UX as Claude Code |
| **CREATE** | What should we create? | Text-based structured interaction protocol — the "numbered menu" pattern encoded in converter + adapter |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                   ↑
                            Text-based structured
                            interaction in AI CLIs
```

- **Industry position:** Custom-Built → Product. Every AI CLI tool that interacts with users faces this problem. No standard solution exists yet.
- **PAN Wizard position:** Should be Product-stage — codify the pattern once, apply everywhere.
- **Evolution (2-3 years):** CLI tools will likely adopt standard interaction protocols (like LSP for editors). PAN should establish the pattern now and be ready to adopt standards when they emerge.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Ensures AI model presents choices correctly regardless of runtime | 4 |
| **Cross-Platform** | Closes the Copilot CLI quality gap — all 5 runtimes equivalent | 5 |
| **Developer Experience** | Transforms confusing prose into clean numbered selections | 5 |
| **Zero Dependencies** | Pure string manipulation in converter — no new deps | 5 |
| **State Persistence** | No direct impact | 0 |
| **Verification Quality** | No direct impact | 0 |
| **Total** | | **19/30** |

### 3.4 Strategic Recommendation

**Build.** The evidence is direct (user reported the exact problem in this conversation), the fix is bounded (converter enhancement + adapter header update, no new commands), and the strategic value is high (Copilot CLI is the largest commercial AI CLI — PAN must be first-class there). Our unique angle: we're the only workflow orchestration tool that explicitly teaches AI models how to simulate structured interactions across different runtimes. We should NOT copy IDE-based widget approaches (Cline, Cursor) — those don't work in terminals. Instead, codify the decades-old "numbered menu" pattern into our converter, making PAN the reference implementation for text-based structured interaction in AI CLIs. Strategic timing: immediate — Copilot CLI is 4 days old and patterns are being established now.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Type | Description | Template |
|------|-------------|----------|
| **Core Enhancement** | Modify existing converter functions in `bin/install.js` | Edit `convertClaudeToCopilotMarkdown()`, `getCopilotSkillAdapterHeader()` |
| **Installer** | Changes to install.js converter output | Modify installer, test with existing e2e patterns |

### 3.5.2 Layer Violation Check

- [x] No command .md files call lib modules directly — N/A (installer changes)
- [x] No upward dependencies — installer is standalone
- [x] No `output()` calls from helpers — N/A (installer uses console.log)
- [x] No layer violations — changes are within the installer's converter layer

### 3.5.3 Output Contract Design

No new JSON output schema. The converter functions return strings (converted markdown content). The contract change is in the **content** of the converted output:

**Before (current):**
```markdown
Use AskUserQuestion:
- header: "Context"
- question: "Phase [X] already has context. What do you want to do?"
- options:
  - "Update it" — Review and revise existing context
  - "View it" — Show me what's there
  - "Skip" — Use existing context as-is
```

**After (proposed):**
```markdown
Ask the user with numbered options:

**Phase [X] already has context. What do you want to do?**

1. **Update it** — Review and revise existing context
2. **View it** — Show me what's there
3. **Skip** — Use existing context as-is

Present these as a numbered list. The user will type a number, label, or their own answer.
Wait for the user's response before continuing.
```

### 3.5.4 State Transition Modeling

N/A — this feature is read-only at runtime. It modifies files at install time but does not mutate state.md, roadmap.md, or phase directories.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's JSON output schema? | No |
| Changes file formats (state.md, roadmap.md, config.json)? | No |
| Changes directory structure (.planning/, phases/)? | No |
| Changes installer output? | **Yes** — Copilot CLI skills will contain rewritten interaction patterns. Users who reinstall will get improved skills. Existing installs are unaffected until reinstall. |

**Migration:** No migration needed. Users run `npx pan-wizard --copilot --local` to get updated skills.

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command's input | N/A | Converter output is installed files, not piped |
| Callable from an agent .md | No | Converter runs at install time, not runtime |
| Usable in a hook pipeline | No | Not a hook |
| Works in --raw mode for humans | N/A | Installer, not CLI command |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Regex replacements in converter | ~1ms per file | 32 command files + 11 agent files + 15 workflow files |
| Adapter header generation | ~0.1ms | String template |
| **Total per install** | **< 50ms** | Negligible overhead on install |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | No path concerns — pure string manipulation. CRLF handled by existing converter. |
| Mac/Linux | No platform-specific concerns |
| All | Regex patterns must handle both `\n` and `\r\n` line endings |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**PAN Wizard on Copilot CLI: Structured Interaction**

When you install PAN Wizard for Copilot CLI (`npx pan-wizard --copilot --local`), all workflow commands that involve user choices are automatically converted to use numbered text menus. Here's what this looks like in practice:

**Example 1: discuss-phase**

On Claude Code, you'd see a structured select widget. On Copilot CLI, you'll see:

```
Which areas do you want to discuss for "User Authentication"?

1. **Login flow** — Email/password vs OAuth? Remember me?
2. **Session handling** — JWT vs cookies? Expiry policy?
3. **Error states** — Lock after N failures? Reset flow?
4. **Profile access** — Who can view? Edit permissions?

Type the numbers you want to discuss, separated by commas (e.g., 1,3).
Or type your own area to explore.
```

**Example 2: new-project**

```
Research the domain ecosystem before defining requirements?

1. **Research first** (recommended) — 4 parallel researchers explore the domain
2. **Skip research** — Jump straight to requirements

Type a number or your own answer.
```

**Example 3: Error message if you type something unexpected**

The model will interpret your response. If it can't match your answer to an option, it'll ask again:

```
I didn't catch that. Please type a number (1-4), an option label, or describe what you'd like.
```

### 4.2 Reference-Level Explanation

#### 4.2.1 Converter Interface Changes

**Function: `convertClaudeToCopilotMarkdown(content)`**

Current behavior: Converts slash commands and Task() references.

New behavior: Additionally rewrites `AskUserQuestion` blocks into text-based numbered menu instructions.

**Function: `getCopilotSkillAdapterHeader(skillName)`**

Current behavior: Generic skill integration and agent orchestration instructions.

New behavior: Adds a `User interaction:` section teaching the model how to present choices.

**New function: `rewriteAskUserQuestionForCopilot(content)`**

Transforms `AskUserQuestion` patterns in markdown into Copilot CLI text-based interaction instructions. Handles:
- Simple `Use AskUserQuestion:` blocks with header/question/options
- `AskUserQuestion (multiSelect: true):` blocks
- Inline `AskUserQuestion` text references

#### 4.2.2 Rewrite Rules

**Rule 1: `AskUserQuestion` block → numbered menu**

Input pattern:
```
Use AskUserQuestion:
- header: "Header"
- question: "Question text?"
- options:
  - "Option A" — Description A
  - "Option B" — Description B
```

Output pattern:
```
Ask the user:

**Question text?**

1. **Option A** — Description A
2. **Option B** — Description B

Type a number or label to choose. Or type your own answer.
Wait for the user's response before continuing.
```

**Rule 2: `AskUserQuestion (multiSelect: true):` → comma-separated menu**

Input pattern:
```
Use AskUserQuestion (multiSelect: true):
- header: "Header"
- question: "Which areas?"
- options:
  - "Area 1" — Description
  - "Area 2" — Description
```

Output pattern:
```
Ask the user (select one or more):

**Which areas?**

1. **Area 1** — Description
2. **Area 2** — Description

Type the numbers you want, separated by commas (e.g., 1,3).
Or type your own answer.
Wait for the user's response before continuing.
```

**Rule 3: Inline `AskUserQuestion` reference → plain instruction**

Input: `Use AskUserQuestion to ask...`
Output: `Ask the user with numbered options...`

**Rule 4: Adapter header interaction guidance**

Added to every Copilot skill:
```
User interaction:
- When presenting choices, use numbered lists (1. **Option** — description).
- For single-select: "Type a number or label."
- For multi-select: "Type numbers separated by commas (e.g., 1,3)."
- Always include "Or type your own answer" as a fallback.
- Ask one question at a time. Wait for the user's response before continuing.
- Accept numbers ("1"), labels ("Option A"), or free-text descriptions as valid answers.
```

#### 4.2.3 Error Handling

| Condition | Handling | Impact |
|-----------|----------|--------|
| Regex doesn't match a variant | Content passes through unchanged | Graceful degradation — some blocks may not be rewritten |
| Malformed AskUserQuestion block | Skip rewrite for that block | No crash, partial improvement |
| Empty options list | Skip rewrite, leave as prose | Rare edge case |

### 4.3 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|
| Numbered menu pattern | BBS/IVR/UNIX tradition | Decades of proven text-UI pattern | Cline's button widgets (require GUI) |
| Comma-separated multi-select | Survey tools, Google Forms | Familiar pattern, works in text | Checkbox simulation (can't render in plain text) |
| "Or type your own" fallback | PAN's existing "Other" option | Preserves the escape hatch for freeform input | Strict number-only input (too rigid) |
| Install-time conversion | PAN's existing converter pattern | No runtime overhead, model sees clean instructions | Runtime interception (would need Copilot CLI hook support) |
| Bold option labels | Markdown in terminal | Most terminals render **bold**, improves scanability | Color codes (not portable across terminals) |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Install-time rewrite | Regex conversion in installer | Runtime prompt engineering | Can't modify Copilot CLI runtime | Must reinstall to get updates |
| Adapter header guidance | Static text block | Per-command dynamic guidance | Over-engineering — one block covers all patterns | Generic, not command-specific |
| Regex-based block parsing | Regex with multi-line capture | Full markdown AST parsing | Too complex for the pattern variety | Fragile if AskUserQuestion format changes significantly |
| Bold for recommended option | `**Option (recommended)**` | Stars/arrows/emoji | Bold is universal markdown | Not all terminals render bold identically |

### 4.5 Feature Ladder (Incremental Delivery)

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Adapter header + simple text replace of `AskUserQuestion` references | 60% improvement — model gets interaction guidance, references cleaned up | S (2 pts) |
| **v1 (Complete)** | Full regex block rewrite of `AskUserQuestion:` patterns → numbered menus | 95% improvement — all 41 invocations produce structured text menus | M (4 pts) |
| **v2 (Enhanced)** | Per-command interaction metadata + dynamic adapter header customization | 100% — adapter header tailored to each command's specific interaction needs | M (4 pts) |

**v0 is the target for the first superplan/execplan cycle.** v1 follows immediately. v2 is deferred.

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | Automatic — reinstall PAN for Copilot CLI and interaction improves |
| What's the learning curve? | Zero — users already know how to type numbers |
| Does it require changing existing workflows? | No — changes are install-time converter improvements |
| What's the "aha moment"? | First time `discuss-phase` shows numbered options instead of a wall of text |

---

## Phase 5: Architecture Decision Record

```markdown
# ADR-0004: Copilot CLI Interactive Experience Optimization

## Status
Proposed

## Context
PAN Wizard supports 5 AI CLI runtimes. Four of them (Claude Code, OpenCode, Gemini CLI, Codex)
have either native structured input tools or adequate text-based equivalents. The 5th runtime,
GitHub Copilot CLI (GA 2026-02-25), has no structured input tool — `ask_user` does not exist
in the documented API, and the CLI is purely text-in/text-out.

PAN's 32 commands contain 41 `AskUserQuestion` invocations across 15 workflow files. When
installed for Copilot CLI, these invocations are stripped (`AskUserQuestion: null` in tool
mapping) and naively text-replaced, producing unstructured prose questions that confuse users.

## Decision
Enhance the install-time Copilot CLI converter to:
1. Add an "interaction guidance" section to the skill adapter header that teaches the model
   how to present structured choices as numbered text menus
2. Rewrite `AskUserQuestion` block patterns in workflow content into explicit numbered-menu
   instructions with response format guidance (numbers, labels, or free text)
3. Handle multiSelect patterns with comma-separated number instructions

This is an install-time conversion, not a runtime change. The model receives clear instructions
in the skill content about how to present choices, rather than relying on implicit behavior.

## Consequences

### Positive
- Copilot CLI users get structured interaction matching other runtimes
- No runtime dependencies or hooks needed
- Leverages the decades-old "numbered menu" pattern familiar to all developers
- All 41 interaction points across 15 workflows improved
- Zero new commands, zero new concepts — transparent enhancement

### Negative
- Regex-based block rewriting is somewhat fragile — new AskUserQuestion patterns in future
  workflows must follow the existing format or the regex won't match
- Users must reinstall to get improvements (no auto-update for installed skills)
- Model still has to interpret user responses (no programmatic validation)

### Neutral
- Install time increases by ~50ms (negligible)
- Installed skill files become slightly larger (adapter header + rewritten blocks)

## Options Considered
1. **Do nothing** — Accept Copilot CLI as a degraded runtime. Rejected: user reported the
   problem directly, and Copilot CLI is the largest commercial AI CLI.
2. **Runtime prompt engineering via hooks** — Copilot CLI hooks can only deny/allow tool use,
   not modify prompts. Rejected: technically impossible.
3. **Install-time converter enhancement (chosen)** — Modify existing converter functions to
   produce better output. Best fit for PAN's install-time architecture.
4. **Custom TUI framework** — Build ncurses-style widgets for Copilot CLI. Rejected:
   over-engineering, not portable, Copilot CLI doesn't support custom TUI.

## Links
- Related to: ADR-0002 (Copilot CLI runtime support)
- Affects: `bin/install.js` (converter functions)
- Test file: `tests/copilot-install.test.cjs`
```

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------:|
| Regex doesn't match AskUserQuestion block variant | Code limitation | Block passes through unchanged | Graceful degradation — original text preserved | Slightly less structured but still functional |
| Workflow file has malformed AskUserQuestion syntax | Data quality | Regex capture group returns empty | Skip rewrite for that block, continue processing | Unchanged text for that interaction |
| Very long options list (>4 options) | Edge case | Count of captured options | Rewrite all options regardless of count | Long numbered list (still better than prose) |
| Nested AskUserQuestion blocks | Edge case | Nested regex match | Process outermost block only | Outer block rewritten, inner may not match |
| Empty content string | Input validation | Check `content.length === 0` | Return empty string immediately | No change |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--dry-run` (installer) | Not currently supported | Future enhancement |
| Manual inspection | Read installed `SKILL.md` files | After install, verify with `cat .github/skills/pan-discuss-phase/SKILL.md` |
| Test coverage | Unit tests verify converter output | Development and CI |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| Workflow .md files (source) | Read at install time | System-generated (trusted) |
| SKILL.md files (output) | Written at install time | System-generated |
| .agent.md files (output) | Written at install time | System-generated |
| Regex patterns | Hardcoded in converter | Developer-controlled |

| Input Vector | Source | Validation Required |
|-------------|--------|---------------------|
| Workflow file content | Disk (PAN package) | Structure validation via regex — only matching blocks rewritten |
| Skill name | Derived from filename | Already validated by existing converter |

### 7.2 Path Safety Protocol

N/A — this feature does not accept user-supplied path input. All paths are derived from the installer's internal logic.

### 7.3 Output Sanitization

- [x] No absolute filesystem paths in output — SKILL.md contains relative paths only
- [x] No environment variable values in output
- [x] No stack traces in error messages — N/A (no error output to users)
- [x] No internal function names in user-facing content

### 7.4 Content Validation

- Workflow files are read from the PAN package directory — trusted source
- Regex-based content transformation — no `eval()`, no `Function()`, no template interpolation
- Malformed input is handled by regex non-match — graceful pass-through

### 7.5 Privilege Scope Declaration

```
Reads from: pan-wizard-core/workflows/*.md, commands/pan/*.md, agents/*.md (package directory)
Writes to: .github/skills/*/SKILL.md, .github/agents/*.agent.md (user project or global dir)
Executes shell: No
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definition

N/A — this feature does not add a new command. It enhances the installer's converter functions.

### 8.2 Implementation Tasks (Ordered)

```
### Task 1: Add interaction guidance to getCopilotSkillAdapterHeader()
Files: bin/install.js (line 571-583)
Change: Add "User interaction:" section to the adapter header template
Test: Verify adapter header contains interaction guidance text
Estimate: XS (1 pt)
Priority: P1

### Task 2: Add AskUserQuestion text rewrite to convertClaudeToCopilotMarkdown()
Files: bin/install.js (line 554-564)
Change: Add regex replacement that converts "AskUserQuestion" references to
        "Ask the user with numbered options" and similar conversational patterns
Test: Verify AskUserQuestion references are replaced in converter output
Estimate: S (2 pts)
Priority: P1

### Task 3: Add rewriteAskUserQuestionForCopilot() function
Files: bin/install.js (new function, ~40 lines)
Change: Regex-based block rewriter that converts AskUserQuestion blocks
        (with header/question/options) into numbered menu text
Test: Unit tests with sample blocks → verify numbered output
Estimate: M (4 pts)
Priority: P2

### Task 4: Integrate rewriter into convertClaudeToCopilotMarkdown()
Files: bin/install.js (line 554-564)
Change: Call rewriteAskUserQuestionForCopilot() from the markdown converter
Test: End-to-end: install → read SKILL.md → verify numbered menus present
Estimate: XS (1 pt)
Priority: P2

### Task 5: Handle multiSelect: true patterns
Files: bin/install.js (within rewriteAskUserQuestionForCopilot)
Change: Detect multiSelect and add "comma-separated numbers" instruction
Test: Verify discuss-phase SKILL.md has comma-separated instruction
Estimate: S (2 pts)
Priority: P2

### Task 6: Tests — unit and integration
Files: tests/copilot-install.test.cjs (extend existing)
Tests to add:
  - Adapter header contains "User interaction:" section
  - AskUserQuestion text references rewritten
  - Simple AskUserQuestion block → numbered menu
  - multiSelect block → comma-separated instruction
  - Nested/malformed blocks → graceful pass-through
  - E2E: install --copilot → read discuss-phase SKILL.md → verify numbered options
Estimate: S (2 pts)
Priority: P2

### Task 7: Documentation
Files: CHANGELOG.md, docs/USER-GUIDE.md
Change: Add entry for Copilot CLI interaction improvements
Estimate: XS (1 pt)
Priority: P3
```

**Total: 13 points (XS+S+M+XS+S+S+XS)**

### 8.3 Dependency Graph

```
Task 1 (Adapter Header)
  └─→ Task 2 (Text Replace)
        └─→ Task 3 (Block Rewriter Function)
              └─→ Task 4 (Integration)
                    └─→ Task 5 (multiSelect)
                          └─→ Task 6 (Tests)
                                └─→ Task 7 (Docs)
```

Tasks 1 and 2 can be parallelized. Tasks 3-5 are sequential. Task 6 can partially overlap with 3-5. Task 7 is independent.

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Regex fragility on new AskUserQuestion patterns | Medium | Low | Document expected format; regex has pass-through fallback |
| Copilot CLI changes its interaction model | Low | Medium | Our approach is additive text — still works if Copilot adds tools |
| Model ignores interaction guidance | Medium | Medium | Adapter header is prominent; test with real Copilot CLI sessions |
| Install size increase | Low | Low | ~500 bytes per file, negligible |
| Breaks existing Copilot install tests | Low | High | Run full test suite after each task |

### 8.5 Cognitive Complexity Budget

| Function | Lines | Nesting | Parameters |
|----------|-------|---------|------------|
| `getCopilotSkillAdapterHeader()` | 20 → 35 | 1 | 1 |
| `convertClaudeToCopilotMarkdown()` | 12 → 15 | 1 | 1 |
| `rewriteAskUserQuestionForCopilot()` (new) | ~40 | 2 | 1 |

All within budget (50 lines, 3 nesting, 4 params).

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Test `rewriteAskUserQuestionForCopilot()` with sample blocks | 8+ | Regex accuracy, edge cases, multiSelect handling |
| **Integration** | Test `convertClaudeToCopilotMarkdown()` end-to-end with real workflow content | 5+ | Full conversion pipeline, adapter header presence |
| **E2E** | Install with `--copilot --local` → read installed SKILL.md → verify content | 2+ | Install pipeline, file output, real workflow conversion |

### 9.2 Assertion Density Requirements

Every test must assert:
- **Success tests:** (a) numbered options present in output, (b) response instruction present ("Type a number..."), (c) no raw `AskUserQuestion` text remaining
- **multiSelect tests:** (a) "comma-separated" instruction present, (b) "one or more" language present
- **Pass-through tests:** (a) non-matching content unchanged, (b) no crash on malformed input

### 9.3 Boundary Value Analysis

- [ ] Empty content string → returns empty string
- [ ] Content with no AskUserQuestion references → returns unchanged
- [ ] Content with 1 AskUserQuestion reference (simplest case)
- [ ] Content with 6+ AskUserQuestion references (discuss-phase has 6)
- [ ] AskUserQuestion block with 2 options (minimum)
- [ ] AskUserQuestion block with 4 options (maximum typical)
- [ ] multiSelect: true block
- [ ] AskUserQuestion reference without block (inline mention)
- [ ] Malformed block (missing options, missing question)
- [ ] Content with mixed AskUserQuestion blocks and non-AskUserQuestion content

### 9.4 Regression Verification

After implementing, verify:
- [ ] Full suite: `npm test` — ALL 790+ existing tests pass unchanged
- [ ] Related test file: `tests/copilot-install.test.cjs` — all 30 existing tests pass
- [ ] No existing test expectations changed

### 9.5 Performance Validation

- [ ] Install with `--copilot --local` completes in < 5 seconds (current baseline)
- [ ] No regression in full test suite runtime
- [ ] Converted SKILL.md files < 50KB each

---

## Phase 10: Output Artifacts

### 10.1 Specification Document
Saved to: `docs/specs/copilot_cli_interaction_featureai.md` (this file)

### 10.2 ADR
Saved to: `docs/decisions/ADR-0004-copilot-cli-interaction.md`

### 10.3 Report Summary

```
## /featureAI Complete — Copilot CLI Interactive Experience Optimization

### Problem & Evidence
Users on Copilot CLI see unstructured prose instead of clean numbered choices —
Evidence: user-reported (this conversation), architectural gap (41 AskUserQuestion
invocations stripped without replacement)

### Strategic Assessment
- Blue Ocean: Eliminate widget assumptions, Reduce interaction ambiguity,
  Raise Copilot CLI to first-class parity, Create text-based structured interaction protocol
- Wardley: Custom-Built → targeting Product
- Moat Score: 19/30 — strongest in Cross-Platform (5) and Developer Experience (5)
- Cognitive Load: -1 (simplifies)
- Recommendation: Build

### Design Summary
- Feature Type: Core Enhancement (installer converter)
- Modules Affected: bin/install.js (3 functions modified/added)
- Output Schema: N/A (string content conversion)
- Error Handling: Regex pass-through on non-match
- Breaking Changes: None (additive improvement to installed files)
- Layer Violations: None

### Feature Ladder
- v0 (MVP): Adapter header + simple text replace — S (2 pts)
- v1 (Complete): Full block rewrite + multiSelect — M (4 pts)
- v2 (Enhanced): Per-command dynamic adapter — M (4 pts)

### Implementation
- Tasks: 7 tasks
- Complexity: M total (13 points)
- Files to create: 0
- Files to modify: 3 (bin/install.js, tests/copilot-install.test.cjs, CHANGELOG.md)
- Tests planned: 15+ (unit: 8, integration: 5, e2e: 2)

### Security
- Attack surface: Minimal (install-time string conversion, trusted input)
- Path safety: Not needed (no user-supplied paths)
- Output sanitization: Verified (no absolute paths, no env vars)

### Adoption
- Discovery: Automatic on reinstall
- Learning curve: Zero (users know how to type numbers)
- Aha moment: First time discuss-phase shows numbered options on Copilot CLI

### Documents Created
- Spec: docs/specs/copilot_cli_interaction_featureai.md
- ADR: docs/decisions/ADR-0004-copilot-cli-interaction.md

### Next Step
Add to superplan: /superplan --refresh
Execute: /execplan
```
