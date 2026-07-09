# Model Profiles & Routing

Model profiles control which model tier each PAN agent uses. The routing system maps abstract tiers to provider-specific models, allowing PAN to work across Anthropic, OpenAI, and Google providers.

---

## Tier System

PAN uses three abstract tiers instead of hardcoded model names:

| Tier | Purpose | Anthropic | OpenAI | Google |
|------|---------|-----------|--------|--------|
| `reasoning` | Architecture, planning, complex decisions | inherit (Fable/Opus) | inherit | inherit |
| `mid` | Execution, research, verification | Sonnet | mid | mid |
| `fast` | Read-only extraction, budget tasks | Haiku | fast | fast |

**Why `inherit` for reasoning?** Host runtimes map "opus" to a specific model version. PAN returns `inherit` for reasoning-tier agents, so they use whatever top-tier model the user has configured. This avoids version conflicts and silent fallbacks.

### Legacy Aliases

For backward compatibility, legacy Anthropic model names still work:

| Legacy Name | Maps To | Tier |
|-------------|---------|------|
| `opus` | `reasoning` | Top-tier |
| `sonnet` | `mid` | Mid-tier |
| `haiku` | `fast` | Budget |

---

## Recommended Models (Claude)

PAN never selects your host model — it recommends one. Because the `reasoning` tier is `inherit`, whichever top-tier model you configure in your runtime (Claude Code, etc.) runs every reasoning-tier agent (planner, conductor, executor, hardener…). `mid` and `fast` agents stay on Sonnet/Haiku regardless, so the whole fleet is never on one expensive model.

| Model | Role in PAN | Context | Relative cost | Notes |
|-------|-------------|---------|---------------|-------|
| `claude-fable-5` | **Recommended flagship** — deepest long-horizon reasoning; best for the bot army's Mission Control + planning | 1M | ~2× Opus | Runs input safety classifiers (see caveat below); requires 30-day data retention |
| `claude-opus-4-8` | **Cost-conscious default** — same 1M context + thinking, half the cost, no cyber classifier | 1M | 1× | The safe pick when you want Opus behavior without Fable's refusal surface |

**Why Fable is the recommended flagship.** It is Anthropic's most capable widely released model for demanding, long-horizon agentic work — exactly what PAN's hierarchical bot army (Mission Control → squads → workers) asks of its reasoning tier. Select it in your host runtime and `inherit` routes the reasoning-tier agents to it automatically.

**Fable caveat — the cyber-classifier refusal, and how PAN handles it.** Fable is the only current Claude model that runs input safety classifiers targeting cybersecurity and biology content, and benign *defensive* security tooling can trigger false positives — a successful response with `stop_reason: "refusal"` and `stop_details.category: "cyber"`. In PAN this hits every security path: `/pan:review-deep`, `exec-phase --deep-review`, **and the `focus-auto`/army `security` category** (which was observed refusing in a real project). Two mitigations, in order of reliability:

1. **Opus pin (the durable fix).** `pan-hardener`, `pan-reviewer`, and `pan-meta-reviewer` carry `model: opus` in their frontmatter, so on **Claude Code** they run on Opus 4.8 regardless of your session model and never reach Fable's classifier. The `focus-auto` security category routes its vulnerability *assessment* through the Opus-pinned `pan-hardener` for the same reason. This pin is **Claude-Code-only** — it is stripped from the Gemini/OpenCode/Codex/Copilot outputs by the installer, so on the other runtimes run security campaigns on a non-Fable model.
2. **Defensive framing.** Those agents and the `focus-auto` security prose are written as *authorized, defensive review* (no exploit-path narration), which lowers the trigger rate but cannot eliminate it — a security scanner must name injection, auth bypass, and RCE by definition. Framing is the backstop; the Opus pin is the fix.

**Fable data-retention requirement.** Fable is not available under zero data retention; an org whose retention is below 30 days gets a hard `400` on every request. If Fable 400s on every call with an otherwise-valid request, check the org's retention setting before debugging anything else.

**Prompting note for Fable.** Fable prefers *less-prescriptive* prompts than earlier models and runs longer per turn. PAN's autonomous-loop guidance (anti-overplanning, grounded progress claims, act-when-you-have-enough) already aligns with this; avoid piling on `CRITICAL: YOU MUST` scaffolding, which can reduce Fable's output quality.

---

## Profile Definitions

| Agent | `quality` | `balanced` | `budget` |
|-------|-----------|------------|----------|
| pan-planner | reasoning | reasoning | mid |
| pan-roadmapper | reasoning | mid | mid |
| pan-executor | reasoning | mid | mid |
| pan-phase-researcher | reasoning | mid | fast |
| pan-project-researcher | reasoning | mid | fast |
| pan-research-synthesizer | reasoning | mid | fast |
| pan-debugger | reasoning | mid | mid |
| pan-document_code | reasoning | fast | fast |
| pan-verifier | reasoning | mid | fast |
| pan-plan-checker | reasoning | mid | fast |
| pan-integration-checker | reasoning | mid | fast |
| pan-reviewer | reasoning | fast | fast |

### Profile Philosophy

**quality** — Maximum reasoning power
- Reasoning tier for ALL agents. Use when quota is available, critical architecture work, or maximum quality is desired.

**balanced** (default) — Smart allocation
- Reasoning only for planning (where architecture decisions happen). Mid for execution. Fast for read-only tasks. Good balance of quality and cost.

**budget** — Minimal token spend
- Mid for anything that writes code. Fast for research and verification. Use for high-volume work or less critical phases.

### Cost Multipliers

Relative cost per tier (fast = 1× baseline):

| Tier | Multiplier |
|------|------------|
| reasoning | 15× |
| mid | 3× |
| fast | 1× |

Use `/pan:profile <profile>` to see estimated cost differences before switching.

---

## Routing Pipeline

Model resolution follows this priority chain:

```
1. Per-agent override (model_overrides in config.json)     ← highest priority
2. Per-phase override (<!-- model_tier: X --> in roadmap)
3. Complexity routing (if strategy = "complexity")
4. Profile lookup (MODEL_PROFILES[agent][profile])          ← lowest priority
```

### Provider Detection

PAN auto-detects the LLM provider to map tiers to the right model names:

1. **Explicit config** — `routing.provider` in config.json (if not `"auto"`)
2. **Environment variable** — `PAN_PROVIDER` env var
3. **Runtime directory** — `.claude/` → Anthropic, `.codex/` → OpenAI, `.gemini/` → Google
4. **Fallback** — Default provider map (Anthropic-style names)

---

## Routing Strategies

Set in `.planning/config.json` under the `routing` section:

### Static (default)

```json
{
  "routing": {
    "strategy": "static"
  }
}
```

Every agent always gets the tier assigned by its profile. Predictable and simple.

### Complexity

```json
{
  "routing": {
    "strategy": "complexity",
    "complexity_thresholds": {
      "downgrade_max": 2,
      "upgrade_min": 6
    }
  }
}
```

Adjusts tiers up or down based on task metadata:

| Factor | Score 0 | Score 1 | Score 2 | Score 3 |
|--------|---------|---------|---------|---------|
| fileCount | ≤5 | 6–15 | >15 | — |
| waveCount | ≤1 | 2–3 | >3 | — |
| requirementCount | ≤2 | 3–5 | >5 | — |
| isArchitectural | false | — | — | true |

- Score ≤ `downgrade_max` (default 2): tier steps down one level (e.g., mid → fast)
- Score ≥ `upgrade_min` (default 6): tier steps up one level (e.g., mid → reasoning)
- Otherwise: tier stays as assigned by profile

---

## Per-Agent Overrides

Override specific agents without changing the entire profile:

```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "opus",
    "pan-planner": "haiku"
  }
}
```

Overrides accept tier names (`reasoning`, `mid`, `fast`) or legacy names (`opus`, `sonnet`, `haiku`). They take highest priority — above per-phase overrides, complexity routing, and profile lookup.

---

## Per-Phase Overrides

Override the model tier for all agents within a specific roadmap phase by adding an HTML comment to the phase section:

```markdown
## Phase 3: Quick UI polish
**Goal:** Style cleanup
<!-- model_tier: fast -->
```

When an orchestrator passes `phaseNum` in task metadata, the routing pipeline checks the roadmap phase for a `model_tier` comment. This lets you use a cheaper tier for simple phases without changing the global profile.

Valid values: `reasoning`, `mid`, `fast`, `opus`, `sonnet`, `haiku`.

---

## Configuration Reference

Full routing config in `.planning/config.json`:

```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "opus"
  },
  "routing": {
    "strategy": "static",
    "provider": "auto",
    "cascade_quality_gate": true,
    "complexity_thresholds": {
      "downgrade_max": 2,
      "upgrade_min": 6
    }
  }
}
```

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| `model_profile` | `quality`, `balanced`, `budget` | `balanced` | Base tier assignment for all agents |
| `model_overrides` | `{ agent: tier }` | `{}` | Per-agent tier override |
| `routing.strategy` | `static`, `complexity` | `static` | How tiers are adjusted at runtime |
| `routing.provider` | `auto`, `anthropic`, `openai`, `google` | `auto` | LLM provider for tier→model mapping |
| `routing.cascade_quality_gate` | `true`, `false` | `true` | Reserved for future cascade routing |
| `routing.complexity_thresholds.downgrade_max` | number | `2` | Max complexity score to downgrade tier |
| `routing.complexity_thresholds.upgrade_min` | number | `6` | Min complexity score to upgrade tier |

---

## Switching Profiles

Runtime: `/pan:profile <profile>`

### Downgrade Confirmation

| Direction | Example | Behavior |
|-----------|---------|----------|
| Downgrade | quality → balanced | Confirmation required |
| Downgrade | balanced → budget | Confirmation required |
| Upgrade | budget → balanced | Proceeds silently |
| Same | balanced → balanced | Proceeds silently |

**Tier Order:** `quality` (3) > `balanced` (2) > `budget` (1)

---

## Design Rationale

**Why reasoning for pan-planner?**
Planning involves architecture decisions, goal decomposition, and task design. This is where model quality has the highest impact.

**Why mid for pan-executor?**
Executors follow explicit PLAN.md instructions. The plan already contains the reasoning; execution is implementation.

**Why mid (not fast) for verifiers in balanced?**
Verification requires goal-backward reasoning — checking if code *delivers* what the phase promised, not just pattern matching.

**Why fast for pan-document_code?**
Read-only exploration and pattern extraction. No reasoning required, just structured output from file contents.

**Why fast for pan-reviewer in balanced?**
Code review is pattern-matching against known conventions and security rules. Fast handles checklist-style verification efficiently.
