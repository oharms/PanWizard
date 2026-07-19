# PAN-Z — a ZCode-native PAN subsystem

PAN-Z gives [ZCode](https://zcode.z.ai) (z.ai's GLM-5.2 coding harness) the PAN Wizard
workflow — the multi-phase lifecycle, the bot-army with a human merge gate, deterministic
state tracking — **without** cloning PAN's slash-commands or hooks (ZCode has neither).

Instead of porting the command surface, PAN-Z **reuses PAN's engine in place** and reaches
ZCode through the one interface it speaks: **MCP**.

> Design + verified feasibility: [`docs/specs/pan_zcode_mcp_bridge_featureai.md`](../docs/specs/pan_zcode_mcp_bridge_featureai.md).
> The architecture was confirmed by a 38-agent adversarial review; four optimistic
> assumptions were refuted and their fixes folded into the design.

## How it fits

```
ZCode harness (GLM-5.2)          primary Agent drives everything; ported subagents fan out
        │  MCP · local stdio
pan-zcode/mcp  (this subsystem)  a thin, zero-dep bridge — verbs → MCP tools/resources
        │  spawn: node pan-tools.cjs <verb> --raw --cwd <root>
pan-wizard-core  (reused as-is)  the deterministic engine; .planning/ stays the state store
```

## Status — M1 (bridge core)

- `mcp/tool-registry.cjs` — pure map of safe `pan-tools` verbs → MCP tools/resources, with a
  hard guardrail against ever exposing a force/reset/rebase/push verb.
- `mcp/server.cjs` — a **zero-dependency** JSON-RPC 2.0 stdio MCP server (hand-rolled to keep
  PAN's zero-runtime-dep charter). Read verbs are MCP resources; actionable verbs are tools with
  accurate `readOnlyHint` / `destructiveHint`. The child process is launched shell-less
  (`execFile`, argv array) and every tool argument is validated to a strict shape.

Tests: `tests/pan-zcode-mcp.test.cjs`.

## Not yet built

- **M0** — a go/no-go verify spike on a real ZCode install (can a subagent call MCP? are local
  stdio calls metered?). These two facts can only be settled empirically.
- **M2** — `merge-gate.cjs` (token-gated, model-proof merge) + `orchestrator.cjs` (`next-action`).
- **M3–M5** — agent/command → subagent/skill port, plugin bundle + pull-based install, hardening.

## Zero dependencies

Like the rest of PAN, this subsystem ships **no runtime dependencies**. The MCP protocol is
implemented directly rather than via an SDK. If protocol drift ever makes that costly, the
escape hatch is to vendor an MCP SDK **inside this package only**, leaving `pan-wizard-core`
untouched.
