# /featureAI — Multi-Model Routing Within Agent Workflows

**Source:** `docs/specs/comp_analysis_markdown_v1.md` — Enhancement #2

> "The research shows 30–70% cost reduction is achievable through intelligent model routing. PAN's 12 agents should support configurable model assignment — reasoning models (Claude Opus, GPT-5) for architecture and planning agents, mid-tier models (Sonnet, GPT-4.5) for coding agents, lightweight models (Haiku, GPT-4.5-mini) for verification and formatting agents. Stanford's FrugalGPT research demonstrated up to 98% cost reduction with cascade routing patterns."

---

## Phase 0: Problem Framing

### 0.1 Problem Statement

PAN Wizard currently has a 3-tier model profile system (quality/balanced/budget) with per-agent overrides, but it is Anthropic-only (opus/sonnet/haiku) and static — the same model is used for every invocation of a given agent regardless of task complexity. As PAN expands to support multiple LLM providers (OpenAI, Google, local models) and as model pricing varies dramatically (Opus is ~75× more expensive than Haiku per token), users need intelligent routing that assigns the right model to the right agent for the right task. The competitive analysis shows 30–70% cost reduction is achievable through intelligent model routing, and Stanford's FrugalGPT demonstrated up to 98% reduction with cascade patterns. Without this, PAN users either overspend on quality profiles or sacrifice output quality on budget profiles — there is no middle ground that adapts per-invocation.

### 0.2 Scope

| In Scope | Out of Scope |
|----------|--------------|
| Multi-provider model identifiers in MODEL_PROFILES | Direct API calls to any LLM provider (PAN delegates to the host runtime) |
| Complexity-aware routing hints (task metadata → model tier) | Automatic model quality benchmarking |
| Cascade routing: try cheaper model first, escalate on failure | Token counting or cost tracking dashboards |
| User-configurable routing rules in config.json | Training or fine-tuning models |
| Provider-agnostic model aliases (reasoning/mid-tier/fast) | Rate limiting or quota management (host runtime's job) |
| Cost estimation display before execution | A2A or MCP protocol integration (separate feature) |
| Per-phase model override (e.g., critical phase → quality) | Real-time model switching mid-agent-execution |
| Runtime-specific model name resolution | Support for non-text modalities (vision, audio) |

### 0.3 Success Criteria (Measurable)

```
SC-1: MODEL_PROFILES supports provider-agnostic tier aliases (reasoning, mid, fast) alongside specific model names
SC-2: resolveModelInternal() resolves aliases to runtime-specific model names based on detected or configured provider
SC-3: config.json supports routing_strategy: "static" (current behavior), "complexity", or "cascade"
SC-4: Complexity routing uses task metadata (file count, wave count, requirement count) to select model tier
SC-5: Cascade routing attempts fast-tier first and escalates to mid/reasoning on structured failure detection
SC-6: /pan:profile command shows estimated cost multiplier per profile
SC-7: Per-phase model override via roadmap.md frontmatter (e.g., `model_tier: reasoning`)
SC-8: All 5 runtimes work correctly with the new routing (Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI)
SC-9: Existing 3-profile system (quality/balanced/budget) remains fully backward-compatible
SC-10: Unit tests cover all routing strategies, alias resolution, cascade logic, and per-phase overrides
SC-11: No regression in existing 1658 tests
```

### 0.4 User Stories

```
US-1: As a solo developer on a tight budget, I want PAN to automatically use
      cheaper models for simple verification and formatting agents,
      so that I can run full workflows without burning through my quota,
      instead of manually toggling between quality and budget profiles.

US-2: As a team lead on a complex architecture phase, I want to mark specific
      phases as "critical" so PAN uses reasoning-tier models for those phases,
      so that architecture decisions get maximum quality,
      instead of running everything at the same tier.

US-3: As a developer using Codex CLI (OpenAI), I want PAN's model profiles
      to map to OpenAI model names automatically,
      so that agent model selection works without manual configuration,
      instead of the current Anthropic-only opus/sonnet/haiku hardcoding.

US-4: As a cost-conscious enterprise user, I want PAN to try a cheaper model
      first and only escalate to expensive models when the cheap model fails,
      so that 80%+ of routine tasks run at minimum cost,
      instead of paying reasoning-tier prices for formatting and boilerplate.

US-5: As a PAN user about to run exec-phase on 3 plans, I want to see an
      estimated cost comparison between profiles before committing,
      so that I can make informed decisions about quality vs. spend,
      instead of guessing.
```

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities

PAN already has a solid foundation for model routing:

| Component | Location | Current State |
|-----------|----------|--------------|
| `MODEL_PROFILES` constant | `pan-wizard-core/bin/lib/core.cjs:30-42` | 12 agents × 3 profiles (quality/balanced/budget) → opus/sonnet/haiku |
| `resolveModelInternal()` | `pan-wizard-core/bin/lib/core.cjs:497-511` | Checks `model_overrides` → falls back to profile lookup → maps opus→"inherit" |
| `cmdResolveModel()` | `pan-wizard-core/bin/lib/commands.cjs:274-295` | CLI wrapper: `pan-tools.cjs resolve-model <agent-type>` |
| `buildConfigDefaults()` | `pan-wizard-core/bin/lib/config.cjs:46-78` | Hardcoded defaults including `model_profile: "balanced"` |
| `/pan:profile` command | `commands/pan/profile.md` | Switches profile (quality/balanced/budget) with downgrade confirmation |
| `/pan:settings` command | `commands/pan/settings.md` | Interactive 7-question config including model profile |
| `model-profiles.md` reference | `pan-wizard-core/references/model-profiles.md` | Documentation consumed by agents explaining the profile system |
| Per-agent overrides | `config.json → model_overrides` | `{"pan-executor": "opus"}` — already supports per-agent override |
| Profile display | `pan-wizard-core/workflows/profile.md` | Shows model table after profile switch |

### 1.2 Key Design Constraints Discovered

1. **opus → "inherit" mapping**: When an agent resolves to "opus", it returns `"inherit"` so the host runtime uses its native top-tier model. This is already provider-agnostic for the top tier.
2. **Three valid model returns**: `"inherit"`, `"sonnet"`, `"haiku"` — these are passed directly to the Task tool's `model` parameter. The host runtime interprets them.
3. **Config merge pattern**: `buildConfigDefaults()` deep-merges user defaults with hardcoded defaults. New config keys must follow this pattern.
4. **Zero dependencies**: All routing logic must use Node.js builtins only.
5. **CommonJS required**: All `.cjs` modules — no ES module syntax.

### 1.3 Runtime Compatibility Analysis

| Runtime | Model Parameter Support | Native Model Names | Notes |
|---------|------------------------|-------------------|-------|
| Claude Code | `model` param in Task tool | claude-opus-4-0520, claude-sonnet-4-0514, claude-haiku-3-5-20241022 | Maps "inherit"/"sonnet"/"haiku" internally |
| Codex CLI | Model selection in config | gpt-5, gpt-4.5, gpt-4.5-mini | Would need alias mapping |
| Gemini CLI | Model selection in config | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash-lite | Would need alias mapping |
| OpenCode | Model selection in config | Supports multiple providers | Provider-dependent naming |
| Copilot CLI | Model selection in config | gpt-4o, claude-sonnet, etc. | Multi-provider via GitHub |

**Key insight**: Only Claude Code currently uses PAN's `resolve-model` output to set the Task tool's `model` parameter. The other 4 runtimes use their own model selection. This means the multi-provider routing primarily affects documentation and future API integration — the immediate value is in complexity-aware and cascade routing within the Anthropic tier.

---

## Phase 2: Competitive Analysis

### How Competitors Handle Model Routing

| Tool | Approach | Cost Savings Claimed | Limitations |
|------|----------|---------------------|-------------|
| **Cursor** | Per-request model dropdown + auto-routing in background | Not disclosed | Manual selection, no task-based routing |
| **Cline** | BYOK — user picks model per session | N/A (user manages) | No intelligent routing |
| **Aider** | `--model` flag, architect mode uses separate model | Community-reported savings | Two-model max (architect + editor) |
| **Continue.dev** | Model selection per action type (chat/edit/autocomplete) | Not disclosed | Action-type routing only, not complexity-based |
| **Roo Code** | Mode-specific model assignment (Architect/Code/Debug) | Not disclosed | 5 modes, static assignment |
| **Factory AI** | Proprietary multi-model orchestration | Claims significant savings | Closed source, enterprise only |
| **FrugalGPT** (Stanford) | Cascade: cheap → expensive on failure | Up to 98% cost reduction | Research paper, not productized |
| **Martian** | Model router API with quality prediction | 30-70% reduction | External dependency, not open-source |
| **OpenRouter** | Smart routing based on prompt characteristics | Varies by config | Third-party API dependency |

### Differentiation Opportunity

No open-source AI coding tool currently offers:
1. **Per-agent complexity-aware routing** — routing based on the specific task's complexity, not just the agent type
2. **Cascade execution** — try cheaper model, escalate on structured failure
3. **Provider-agnostic tier aliases** — abstract model names that resolve per-runtime
4. **Cost estimation before execution** — show comparative cost before committing to a profile

PAN can be first-to-market in the open-source space with all four.

---

## Phase 3: Design

### Architecture Decision

The feature is implemented as an **extension of the existing model resolution pipeline**, not a replacement. The current 3-profile system becomes a special case of the more general routing system.

### 3.1 Model Tier Aliases

Introduce provider-agnostic tier aliases that replace hardcoded model names:

```
reasoning  → The provider's most capable model (opus, gpt-5, gemini-2.5-pro)
mid        → The provider's balanced model (sonnet, gpt-4.5, gemini-2.5-flash)
fast       → The provider's cheapest model (haiku, gpt-4.5-mini, gemini-2.0-flash-lite)
```

**Backward compatibility**: `opus`, `sonnet`, `haiku` continue to work as direct aliases for `reasoning`, `mid`, `fast` in the Anthropic provider.

### 3.2 Provider Resolution

```javascript
const PROVIDER_MODELS = {
  anthropic: { reasoning: 'inherit', mid: 'sonnet', fast: 'haiku' },
  openai:    { reasoning: 'inherit', mid: 'mid',    fast: 'fast'  },
  google:    { reasoning: 'inherit', mid: 'mid',    fast: 'fast'  },
  default:   { reasoning: 'inherit', mid: 'sonnet', fast: 'haiku' },
};
```

Provider is detected from: (1) `config.json → provider` field, (2) runtime directory detection (`.claude/` → anthropic), (3) environment variable `PAN_PROVIDER`, (4) default to `anthropic`.

### 3.3 Updated MODEL_PROFILES

```javascript
const MODEL_PROFILES = {
  'pan-planner':              { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-roadmapper':           { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-executor':             { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-phase-researcher':     { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-project-researcher':   { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-research-synthesizer': { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-debugger':             { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-document_code':        { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  'pan-verifier':             { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-plan-checker':         { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-integration-checker':  { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-reviewer':             { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
};
```

### 3.4 Routing Strategies

#### Strategy 1: `static` (Default — Current Behavior)

Profile + per-agent override. No change from today.

#### Strategy 2: `complexity`

Task metadata determines whether to upgrade or downgrade from the profile's default tier:

```javascript
function resolveComplexityTier(baseTier, taskMetadata) {
  const { fileCount, waveCount, requirementCount, isArchitectural } = taskMetadata;
  
  const complexityScore = 
    (fileCount > 15 ? 2 : fileCount > 5 ? 1 : 0) +
    (waveCount > 3 ? 2 : waveCount > 1 ? 1 : 0) +
    (requirementCount > 5 ? 2 : requirementCount > 2 ? 1 : 0) +
    (isArchitectural ? 3 : 0);

  // Score 0-2: downgrade eligible (fast if base is mid, mid if base is reasoning)
  // Score 3-5: use base tier
  // Score 6+: upgrade eligible (mid if base is fast, reasoning if base is mid)
  
  if (complexityScore <= 2 && baseTier !== 'fast') return downgrade(baseTier);
  if (complexityScore >= 6 && baseTier !== 'reasoning') return upgrade(baseTier);
  return baseTier;
}
```

Task metadata is extracted from the plan frontmatter (already available — `requirements`, `wave`, task list count).

#### Strategy 3: `cascade`

Try cheaper model first; escalate on structured failure:

```
1. Resolve base tier from profile
2. Downgrade one tier (reasoning→mid, mid→fast)
3. Execute agent with downgraded model
4. If agent output passes quality gate → done (saved cost)
5. If agent output fails quality gate → re-execute with base tier
```

**Quality gates** (simple heuristics, no external deps):
- Plan output: has required frontmatter keys, ≥N tasks, has success criteria
- Research output: has Sources section, has Confidence ratings, ≥N lines
- Verification output: has pass/fail verdict, checked all must-haves
- Executor: no error in commit, tests pass (already verified by PAN)

**Cascade is opt-in** and adds latency (potential double-execution). Recommended only for high-volume workflows.

### 3.5 Per-Phase Model Override

Allow roadmap.md phase sections to specify a model tier:

```markdown
## Phase 3: Authentication Architecture
<!-- model_tier: reasoning -->
```

When present, overrides the profile for ALL agents in that phase. Useful for flagging critical architecture phases.

### 3.6 Cost Estimation

Add cost multiplier display to `/pan:profile` and pre-execution summary:

```
Estimated cost multiplier vs budget:
  quality:  ~15× budget (Opus for all)
  balanced: ~5× budget  (Opus for planning, Sonnet elsewhere)
  budget:   1× baseline (Sonnet + Haiku)
  
This phase (3 plans, 2 waves): ~4,200 tokens estimated
  quality:  ~$0.42
  balanced: ~$0.18
  budget:   ~$0.04
```

Token estimates are rough (based on average agent consumption from PAN's own execution data, not real-time counting).

### 3.7 Config Schema Extension

```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "reasoning"
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

### Implementation Plan

```
1. pan-wizard-core/bin/lib/core.cjs
   - Add PROVIDER_MODELS constant
   - Update MODEL_PROFILES to use tier aliases (reasoning/mid/fast)
   - Add detectProvider() function
   - Add resolveTierToModel() function (alias → provider-specific model name)
   - Add resolveComplexityTier() function
   - Update resolveModelInternal() to support routing strategies
   - Add estimateCostMultiplier() function
   - Maintain backward compat: opus/sonnet/haiku still accepted in model_overrides

2. pan-wizard-core/bin/lib/config.cjs
   - Update buildConfigDefaults() to include routing section
   - Add routing config validation

3. pan-wizard-core/bin/lib/commands.cjs
   - Update cmdResolveModel() to accept optional task metadata JSON
   - Add cmdEstimateCost() for pre-execution cost display

4. pan-wizard-core/bin/pan-tools.cjs
   - Wire resolve-model to accept --metadata flag
   - Wire new estimate-cost command

5. pan-wizard-core/references/model-profiles.md
   - Update with tier aliases, provider mapping, routing strategies

6. commands/pan/profile.md
   - Add cost estimation display

7. pan-wizard-core/workflows/profile.md
   - Add cost multiplier output step

8. pan-wizard-core/workflows/settings.md
   - Add routing strategy question to interactive config

9. docs/USER-GUIDE.md
   - Update Model Profiles section with new capabilities

10. docs/AGENTS.md
    - Update Model Profiles section

11. docs/COMPARISON.md
    - Update "Model Flexibility" row and "Where PAN Wizard Leads" section

12. docs/INTERNALS.md
    - Document routing pipeline internals

13. tests/core.test.cjs
    - New tests for tier alias resolution, provider detection, complexity routing,
      cascade logic, per-phase override, backward compatibility

14. tests/config.test.cjs
    - New tests for routing config defaults, validation

15. tests/commands.test.cjs
    - New tests for resolve-model with metadata, estimate-cost command
```

### Test Plan

**Unit tests in `tests/core.test.cjs`:**

| # | Test | Type |
|---|------|------|
| 1 | PROVIDER_MODELS has entries for anthropic, openai, google, default | Happy path |
| 2 | MODEL_PROFILES uses tier aliases (reasoning/mid/fast) not model names | Happy path |
| 3 | resolveTierToModel('reasoning', 'anthropic') returns 'inherit' | Happy path |
| 4 | resolveTierToModel('mid', 'anthropic') returns 'sonnet' | Happy path |
| 5 | resolveTierToModel('fast', 'anthropic') returns 'haiku' | Happy path |
| 6 | resolveTierToModel('mid', 'openai') returns 'mid' | Happy path |
| 7 | Legacy 'opus' in model_overrides still resolves to 'inherit' | Backward compat |
| 8 | Legacy 'sonnet' in model_overrides still resolves to 'sonnet' | Backward compat |
| 9 | Legacy 'haiku' in model_overrides still resolves to 'haiku' | Backward compat |
| 10 | detectProvider() returns 'anthropic' when .claude/ exists | Happy path |
| 11 | detectProvider() returns configured provider when set in config | Happy path |
| 12 | detectProvider() returns 'default' when no runtime detected | Edge case |
| 13 | resolveComplexityTier downgrades on low complexity (score ≤2) | Happy path |
| 14 | resolveComplexityTier maintains tier on medium complexity (3-5) | Happy path |
| 15 | resolveComplexityTier upgrades on high complexity (score ≥6) | Happy path |
| 16 | resolveComplexityTier never downgrades 'fast' (already lowest) | Edge case |
| 17 | resolveComplexityTier never upgrades 'reasoning' (already highest) | Edge case |
| 18 | resolveComplexityTier with empty metadata returns base tier | Edge case |
| 19 | resolveModelInternal with strategy='static' behaves identically to current | Backward compat |
| 20 | resolveModelInternal with strategy='complexity' uses task metadata | Happy path |
| 21 | Per-agent override takes precedence over routing strategy | Priority |
| 22 | Per-phase override takes precedence over profile default | Priority |
| 23 | estimateCostMultiplier returns reasonable numbers for all 3 profiles | Happy path |
| 24 | Invalid routing strategy falls back to 'static' | Error case |
| 25 | Unknown provider falls back to 'default' | Error case |
| 26 | Config without routing section works (backward compat) | Backward compat |

**Unit tests in `tests/config.test.cjs`:**

| # | Test | Type |
|---|------|------|
| 27 | buildConfigDefaults includes routing section with strategy='static' | Happy path |
| 28 | User defaults can override routing.strategy | Happy path |
| 29 | Invalid routing strategy in user defaults is accepted (validated at resolve time) | Edge case |

**Unit tests in `tests/commands.test.cjs`:**

| # | Test | Type |
|---|------|------|
| 30 | resolve-model with --metadata flag uses complexity routing | Happy path |
| 31 | resolve-model without --metadata flag uses static routing | Backward compat |
| 32 | estimate-cost returns JSON with cost multipliers | Happy path |
| 33 | estimate-cost with --raw returns formatted text | Happy path |

**Runtime-specific tests:**

| # | Test | Type |
|---|------|------|
| 34 | Installer deploys updated model-profiles.md to all 5 runtimes | Runtime-specific |
| 35 | resolve-model output is valid for Claude Code Task model parameter | Runtime-specific |

---

## Phase 4: Specification Output

### Feature: Multi-Model Routing Within Agent Workflows

### Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| `pan-wizard-core/bin/lib/core.cjs` | Modify | Add PROVIDER_MODELS, update MODEL_PROFILES to tier aliases, add detectProvider(), resolveTierToModel(), resolveComplexityTier(), estimateCostMultiplier(), update resolveModelInternal() |
| `pan-wizard-core/bin/lib/config.cjs` | Modify | Add routing defaults to buildConfigDefaults() |
| `pan-wizard-core/bin/lib/commands.cjs` | Modify | Update cmdResolveModel() for metadata, add cmdEstimateCost() |
| `pan-wizard-core/bin/pan-tools.cjs` | Modify | Wire estimate-cost command, update resolve-model case |
| `pan-wizard-core/references/model-profiles.md` | Modify | Full rewrite with tier aliases, provider mapping, routing docs |
| `commands/pan/profile.md` | Modify | Add cost estimation display |
| `pan-wizard-core/workflows/profile.md` | Modify | Add cost multiplier step |
| `pan-wizard-core/workflows/settings.md` | Modify | Add routing strategy question |
| `docs/USER-GUIDE.md` | Modify | Update Model Profiles section |
| `docs/AGENTS.md` | Modify | Update Model Profiles section |
| `docs/COMPARISON.md` | Modify | Update Model Flexibility row |
| `docs/INTERNALS.md` | Modify | Document routing pipeline |
| `tests/core.test.cjs` | Modify | Add ~26 tests for routing logic |
| `tests/config.test.cjs` | Modify | Add ~3 tests for routing config |
| `tests/commands.test.cjs` | Modify | Add ~4 tests for new/updated commands |

### Implementation Steps

#### Step 1: Core Routing Engine (`core.cjs`)

```javascript
// ─── Provider model mapping ──────────────────────────────────────────────────

const PROVIDER_MODELS = {
  anthropic: { reasoning: 'inherit', mid: 'sonnet', fast: 'haiku' },
  openai:    { reasoning: 'inherit', mid: 'mid',    fast: 'fast'  },
  google:    { reasoning: 'inherit', mid: 'mid',    fast: 'fast'  },
  default:   { reasoning: 'inherit', mid: 'sonnet', fast: 'haiku' },
};

// Legacy alias mapping (backward compat)
const LEGACY_ALIASES = { opus: 'reasoning', sonnet: 'mid', haiku: 'fast' };

// Updated MODEL_PROFILES with tier aliases
const MODEL_PROFILES = {
  'pan-planner':              { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-roadmapper':           { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  // ... (all 12 agents as in Phase 3.3)
};
```

```javascript
function detectProvider(cwd, config) {
  // 1. Explicit config
  if (config.routing?.provider && config.routing.provider !== 'auto') {
    return config.routing.provider;
  }
  // 2. Environment variable
  if (process.env.PAN_PROVIDER) return process.env.PAN_PROVIDER;
  // 3. Runtime directory detection
  const checks = [
    ['.claude', 'anthropic'], ['.codex', 'openai'],
    ['.gemini', 'google'], ['.opencode', 'openai'], ['.github', 'default'],
  ];
  for (const [dir, provider] of checks) {
    try { if (fs.statSync(path.join(cwd, dir)).isDirectory()) return provider; }
    catch { /* continue */ }
  }
  return 'default';
}

function resolveTierToModel(tier, provider) {
  // Handle legacy names
  const normalizedTier = LEGACY_ALIASES[tier] || tier;
  const providerMap = PROVIDER_MODELS[provider] || PROVIDER_MODELS['default'];
  return providerMap[normalizedTier] || providerMap['mid'];
}
```

```javascript
function resolveComplexityTier(baseTier, taskMetadata) {
  if (!taskMetadata) return baseTier;
  const { fileCount = 0, waveCount = 0, requirementCount = 0, isArchitectural = false } = taskMetadata;
  
  const score =
    (fileCount > 15 ? 2 : fileCount > 5 ? 1 : 0) +
    (waveCount > 3 ? 2 : waveCount > 1 ? 1 : 0) +
    (requirementCount > 5 ? 2 : requirementCount > 2 ? 1 : 0) +
    (isArchitectural ? 3 : 0);

  const thresholds = taskMetadata.thresholds || { downgrade_max: 2, upgrade_min: 6 };
  const tiers = ['fast', 'mid', 'reasoning'];
  const idx = tiers.indexOf(baseTier);
  if (idx === -1) return baseTier;

  if (score <= thresholds.downgrade_max && idx > 0) return tiers[idx - 1];
  if (score >= thresholds.upgrade_min && idx < 2) return tiers[idx + 1];
  return baseTier;
}
```

```javascript
// Updated resolveModelInternal
function resolveModelInternal(cwd, agentType, taskMetadata) {
  const config = loadConfig(cwd);
  const provider = detectProvider(cwd, config);

  // 1. Per-agent override (highest priority)
  const override = config.model_overrides?.[agentType];
  if (override) {
    return resolveTierToModel(override, provider);
  }

  // 2. Profile lookup
  const profile = config.model_profile || 'balanced';
  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) return resolveTierToModel('mid', provider);
  
  let tier = agentModels[profile] || agentModels['balanced'] || 'mid';

  // 3. Routing strategy
  const strategy = config.routing?.strategy || 'static';
  if (strategy === 'complexity' && taskMetadata) {
    const thresholds = config.routing?.complexity_thresholds;
    tier = resolveComplexityTier(tier, { ...taskMetadata, thresholds });
  }
  // Note: cascade is handled by the orchestrator workflow, not here

  return resolveTierToModel(tier, provider);
}
```

```javascript
const COST_MULTIPLIERS = { reasoning: 15, mid: 3, fast: 1 };

function estimateCostMultiplier(profile) {
  let total = 0;
  const agents = Object.keys(MODEL_PROFILES);
  for (const agent of agents) {
    const tier = MODEL_PROFILES[agent][profile] || 'mid';
    total += COST_MULTIPLIERS[tier] || 3;
  }
  return { profile, total, average: +(total / agents.length).toFixed(1), agentCount: agents.length };
}
```

#### Step 2: Config Defaults (`config.cjs`)

Add to `buildConfigDefaults()`:

```javascript
routing: {
  strategy: 'static',
  provider: 'auto',
  cascade_quality_gate: true,
  complexity_thresholds: {
    downgrade_max: 2,
    upgrade_min: 6,
  },
},
```

And include in the deep-merge:

```javascript
routing: { ...hardcoded.routing, ...(userDefaults.routing || {}) },
```

#### Step 3: CLI Commands (`commands.cjs`, `pan-tools.cjs`)

Update `cmdResolveModel` to accept optional metadata:

```javascript
function cmdResolveModel(cwd, agentType, raw, metadataJson) {
  if (!agentType) error('agent-type required');

  let taskMetadata = null;
  if (metadataJson) {
    try { taskMetadata = JSON.parse(metadataJson); }
    catch { /* ignore invalid metadata, use static routing */ }
  }

  const config = loadConfig(cwd);
  const profile = config.model_profile || 'balanced';
  const strategy = config.routing?.strategy || 'static';
  const model = resolveModelInternal(cwd, agentType, taskMetadata);
  
  const result = { model, profile, strategy };
  output(result, raw, model);
}
```

Add `estimate-cost` command:

```javascript
function cmdEstimateCost(cwd, raw) {
  const estimates = ['quality', 'balanced', 'budget'].map(estimateCostMultiplier);
  output({ estimates }, raw, estimates.map(e =>
    `${e.profile}: ~${e.average}× baseline (${e.agentCount} agents)`
  ).join('\n'));
}
```

Wire in `pan-tools.cjs`:

```javascript
case 'estimate-cost': {
  commands.cmdEstimateCost(cwd, raw);
  break;
}
```

#### Step 4: Documentation Updates

- **model-profiles.md**: Full rewrite with tier aliases, provider mapping, all 3 routing strategies, cascade quality gates, per-phase override syntax
- **USER-GUIDE.md**: Update Model Profiles section with new routing options and cost estimation
- **AGENTS.md**: Update Model Profiles section with tier aliases
- **COMPARISON.md**: Update "Model Flexibility" to highlight multi-provider routing
- **INTERNALS.md**: Document the full resolution pipeline

#### Step 5: Command/Workflow Updates

- **profile.md**: Add cost estimation display after model table
- **profile.md workflow**: Add step to call `estimate-cost` and display results
- **settings.md workflow**: Add "Routing Strategy" question (Static/Complexity/Cascade)

### Tests Required

35 total tests across 3 test files (see Phase 3 Test Plan for full breakdown).

### Documentation Updates

| Document | Section | Change |
|----------|---------|--------|
| `docs/USER-GUIDE.md` | Model Profiles | Add tier aliases, routing strategies, cost estimation |
| `docs/AGENTS.md` | Model Profiles | Update table to show tier aliases |
| `docs/COMPARISON.md` | Model Flexibility row | Highlight multi-provider + intelligent routing |
| `docs/INTERNALS.md` | Per-Agent Overrides | Document full resolution pipeline |
| `pan-wizard-core/references/model-profiles.md` | Entire file | Rewrite with tier aliases and routing strategies |
| `CHANGELOG.md` | Next release | Document feature addition |

### Runtime Matrix

| Runtime | Supported | Notes |
|---------|-----------|-------|
| Claude Code | ✅ | Full support — resolve-model output drives Task tool model parameter |
| Codex | ✅ | Provider detection maps to openai, tier aliases resolve correctly |
| Gemini | ✅ | Provider detection maps to google, tier aliases resolve correctly |
| OpenCode | ✅ | Provider detection maps to openai (default), configurable |
| GitHub Copilot | ✅ | Provider detection maps to default, full alias support |

---

## Phase 5: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing model_overrides with legacy names (opus/sonnet/haiku) | **High** — users with custom config.json lose override behavior | Medium | LEGACY_ALIASES map ensures opus→reasoning, sonnet→mid, haiku→fast. Existing string values continue to work. Test explicitly. |
| Cascade routing doubles execution time on failure | **Medium** — slower for agents that consistently need higher tier | Medium | Cascade is opt-in only. Default remains `static`. Document clearly that cascade adds latency. |
| Complexity scoring produces unexpected tier assignments | **Medium** — wrong model for task complexity | Medium | Conservative thresholds (downgrade ≤2, upgrade ≥6). Configurable via `complexity_thresholds`. Users can tune or disable. |
| Provider detection wrong (e.g., multiple runtime dirs exist) | **Low** — resolves to wrong provider's model names | Low | Priority order: config explicit > env var > directory scan. First match wins. Users can always set explicit provider. |
| Cost estimates are inaccurate | **Low** — misleading but not functionally harmful | High | Label all estimates as "approximate". Use relative multipliers, not dollar amounts. |
| Non-Anthropic runtimes don't use resolve-model output | **Low** — feature is invisible to 4 of 5 runtimes today | N/A | This is expected. The tier alias system prepares for future runtime integration. Document this honestly. |
| resolveModelInternal signature change (new `taskMetadata` param) | **Medium** — internal callers break | Low | Parameter is optional with default `undefined`. Existing calls with 2 args continue to work identically (strategy defaults to 'static', no metadata → no complexity routing). |
| Config migration — existing config.json missing routing section | **Low** — new section not present | High | `buildConfigDefaults()` provides defaults. `resolveModelInternal()` uses `config.routing?.strategy \|\| 'static'` — missing section = current behavior. Zero migration needed. |

### Priority Recommendation

**Implement in this order:**

1. **Tier aliases + legacy compat** (lowest risk, highest long-term value) — enables multi-provider future
2. **Provider detection** (low risk, foundational for multi-runtime) — auto-detection with explicit override
3. **Cost estimation** (zero risk, immediate user value) — read-only display, no behavior change
4. **Complexity routing** (medium risk, significant cost savings) — opt-in strategy with conservative defaults
5. **Cascade routing** (highest risk, highest savings potential) — implement last, opt-in only, requires quality gate definitions

Steps 1-3 can ship together as a single release. Steps 4-5 should be separate releases with their own test cycles.
