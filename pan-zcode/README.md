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
pan-wizard-core/mcp  (SHARED)    a thin, zero-dep bridge — verbs → MCP tools/resources
        │  spawn: node pan-tools.cjs <verb> --cwd <root>
pan-wizard-core  (reused as-is)  the deterministic engine; .planning/ stays the state store
```

**The bridge is no longer part of this subsystem.** It was written here, but it lives at
`pan-wizard-core/mcp/` so it ships with the engine to every install and every runtime — PAN-Z
is now a **consumer** of it, alongside the main installer. `install-zcode.js` emits an MCP
registration pointing at that shared path. **Never fork a copy back under `pan-zcode/`**: one
protocol layer, many consumers, or the two drift the way the per-runtime command trees did
before ADR-0028.

**Scope boundary (by design):** the bridge exposes `pan-tools` verbs as MCP tools/resources and nothing more. It intentionally does **not** carry rich agent *session state* — diffs, streaming, live thread lifecycle — because MCP can't faithfully represent it (the reason OpenAI built the Codex harness as a native Rust core rather than over MCP). Keep the bridge to tool/resource exposure; the CLI's JSON contract is the tool contract. See `KNOWN-BETA-RISKS.md`.

## Status — M1–M5 built (M0 is the human verify spike)

- **M1 — bridge core.** `pan-wizard-core/mcp/tool-registry.cjs` (pure verb→tool/resource map, with a hard
  guardrail against exposing a force/reset/rebase/push verb) + `pan-wizard-core/mcp/server.cjs` (a
  **zero-dependency** JSON-RPC 2.0 stdio MCP server; reads → resources, actions → tools with
  accurate hints; shell-less `execFile` spawn; `@file:` overflow protocol; strict per-arg
  validation). **Dual-era** per the MCP 2026-07-28 stateless spec (ADR-0041): legacy clients
  use the `initialize` handshake; modern clients declare their protocol version in each
  request's `_meta`, probe `server/discover`, and get `UnsupportedProtocolVersionError`
  (`-32022`) on a version mismatch.
- **M2 — determinism grafts.** `pan-wizard-core/mcp/merge-gate.cjs` (two-step, model-proof merge: a
  human-origin env token that ignores agent-supplied approval; never force/reset/push) +
  `pan-wizard-core/mcp/orchestrator.cjs` (the deterministic `next-action` state machine with safety
  caps + regression circuit-breaker), exposed as native MCP tools via
  `pan-wizard-core/mcp/native-tools.cjs`.
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

A third M0 checkpoint (added 2026-08): **which protocol era does the real ZCode client speak?**
The bridge is now dual-era (ADR-0041), so it answers both a legacy `initialize` handshake and a
modern `server/discover` probe. Confirm on a real install which path ZCode takes and that the
version it declares is in our supported list; if ZCode ever declares a revision newer than
`2026-07-28`, add it to `SUPPORTED_VERSIONS_LIST` in `pan-wizard-core/mcp/server.cjs` once its method shapes are
implemented.

## Zero dependencies

Like the rest of PAN, this subsystem ships **no runtime dependencies**. The MCP protocol is
implemented directly rather than via an SDK. If protocol drift ever makes that costly, the
escape hatch is to vendor an MCP SDK **inside this package only**, leaving `pan-wizard-core`
untouched.
