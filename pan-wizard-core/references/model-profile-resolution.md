# Model Profile Resolution

Resolve model profile once at the start of orchestration, then use it for all Task spawns.

## Resolution Pattern

```bash
MODEL_PROFILE=$(cat .planning/config.json 2>/dev/null | grep -o '"model_profile"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"'); MODEL_PROFILE=${MODEL_PROFILE:-balanced}
```

Default: `balanced` if not set or config missing.

## Lookup Table

@~/.claude/pan-wizard-core/references/model-profiles.md

Prefer the `*_model` fields your workflow's `init` call returns, or `pan-tools resolve-model <agent> --raw`: both apply `model_overrides` and the provider mapping, which a table lookup skips. A phase's `<!-- model_tier: … -->` pin applies only when the phase is passed: `resolve-model <agent> --metadata '{"phaseNum":"N"}' --raw`. `routing.strategy: complexity` applies to any `--metadata`, and scores only its `fileCount`, `waveCount`, `requirementCount` and `isArchitectural`: metadata without them, a bare `phaseNum` included, scores as a simple task and drops the agent one tier (an agent already on the fast tier stays there). Otherwise look up the agent in the table for the resolved profile. Pass the model parameter to Task calls:

```
Task(
  prompt="...",
  subagent_type="pan-planner",
  model="{resolved_model}"  # "inherit" for the reasoning tier, otherwise the provider's model name ("sonnet"/"haiku" on Anthropic)
)
```

**Note:** Reasoning-tier agents resolve to `"inherit"` (not `"opus"`). This causes the agent to use the parent session's model, avoiding conflicts with organization policies that may block specific model versions.

## Usage

1. Resolve once at orchestration start
2. Store the profile value
3. Take each agent's model from the init `*_model` field or `resolve-model` (the table only when neither is available)
4. Pass that value to each Task call as is
