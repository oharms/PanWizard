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

## Status — M1–M5 built (M0 is the human verify spike)

- **M1 — bridge core.** `mcp/tool-registry.cjs` (pure verb→tool/resource map, with a hard
  guardrail against exposing a force/reset/rebase/push verb) + `mcp/server.cjs` (a
  **zero-dependency** JSON-RPC 2.0 stdio MCP server; reads → resources, actions → tools with
  accurate hints; shell-less `execFile` spawn; `@file:` overflow protocol; protocol-version
  negotiation; strict per-arg validation).
- **M2 — determinism grafts.** `mcp/merge-gate.cjs` (two-step, model-proof merge: a human-origin
  env token that ignores agent-supplied approval; never force/reset/push) + `mcp/orchestrator.cjs`
  (the deterministic `next-action` state machine with safety caps + regression circuit-breaker),
  exposed as native MCP tools via `mcp/native-tools.cjs`.
- **M3 — content port.** `lib/convert-agent.cjs` — Claude agents → ZCode subagents (reusing the
  installer's frontmatter helpers): drops `Task` (no nesting), maps PAN tiers → `inherit`,
  preserves the body; plus a command → skill wrapper.
- **M4 — bundle + install.** `bin/install-zcode.js` — assembles `agents/` + `pan-mcp.json` +
  manifest + `INSTALL-ZCODE.md` into a `--target` dir; refuses to write inside the source repo;
  drives ZCode's own Import to finish.
- **M5 — hardening + docs.** Full test matrix + [`KNOWN-BETA-RISKS.md`](KNOWN-BETA-RISKS.md)
  (the beta-churn ledger + the M0 go/no-go questions).

Tests: `tests/pan-zcode-mcp.test.cjs`, `tests/pan-zcode-orchestration.test.cjs`,
`tests/pan-zcode-install.test.cjs`.

## Still pending — M0 (needs a real ZCode install)

Two go/no-go facts can only be settled empirically: **can a subagent call MCP tools?** and **are
local stdio MCP calls metered?** Both have folded-in fallbacks (see `KNOWN-BETA-RISKS.md`), so the
design holds either way — but confirm them before relying on the richer paths.

## Zero dependencies

Like the rest of PAN, this subsystem ships **no runtime dependencies**. The MCP protocol is
implemented directly rather than via an SDK. If protocol drift ever makes that costly, the
escape hatch is to vendor an MCP SDK **inside this package only**, leaving `pan-wizard-core`
untouched.
