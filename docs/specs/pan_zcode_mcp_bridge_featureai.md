# /featureAI — PAN-Z: a ZCode-Native Subsystem via a Deterministic MCP Bridge

**Source:** User request — "build a system that works like PAN Wizard but works with ZCode, even as a completely separate method and folders."
**Status:** Design verified by a 38-agent adversarial review (2026-07-19). Winner: **PAN-Z (MCP-First Bridge)**, avg 36.3/50. Four load-bearing claims were refuted; all have folded-in fallbacks (below). Companion: the [GLM/z.ai provider spec](glm_zai_provider_featureai.md) covers GLM *through PAN's existing runtimes*; this spec covers a *ZCode-native* subsystem.

> **ZCode** = z.ai's own GLM-5.2 coding-agent harness (a Claude-Code peer). It cannot host PAN's slash-commands, hooks, or a project config dir — so a command-for-command port is a dead end. But it runs Markdown subagents, speaks **MCP**, and has a "Goals" loop. PAN-Z reuses PAN's engine unchanged and reaches ZCode through MCP.

---

## Phase 0: Problem Framing

### 0.1 Problem Statement
PAN's value — the multi-phase planning lifecycle, the bot-army with a human merge gate, deterministic state tracking — is delivered on Claude Code through slash-commands + hooks + a project `.claude/` tree. ZCode has none of those extension points. The question is whether a *separate subsystem*, its own folders and installer, can give ZCode the same outcomes. The answer is **yes, by inversion**: instead of porting PAN's command surface, expose PAN's deterministic engine (`pan-tools`) as a local **MCP server** that ZCode's primary Agent drives, port PAN's agents to ZCode subagents, and relocate the two safety-critical guarantees (the merge gate, the orchestration state machine) from agent prose into deterministic MCP code.

### 0.2 Scope
| In Scope | Out of Scope |
|----------|--------------|
| A standalone `pan-zcode/` subsystem (sibling of `pan-wizard-core`, reused **in place** — no fork, no vendored copy) | Rewriting or forking `pan-wizard-core` |
| A **zero-dependency** stdio MCP server bridging `pan-tools` verbs → MCP tools/resources | Adding an MCP SDK runtime dependency (PAN is zero-runtime-dep) |
| A token-gated, model-proof merge tool + a `next-action` orchestrator tool | Relaxing the human merge gate in any way |
| A ZCode agent/command → subagent/skill converter (reusing `install-lib` converters) | Reverse-engineering ZCode's churning Beta on-disk formats by hand |
| Honest degradation for what ZCode cannot host | Claiming full parity — several capabilities are genuinely lost (§5) |

### 0.3 Success Criteria
```
SC-1: pan-zcode ships ZERO new runtime dependencies (hand-rolled JSON-RPC 2.0 over stdio).
SC-2: pan-wizard-core is byte-for-byte unchanged; the bridge only spawns `node pan-tools.cjs <verb> --raw --cwd <root>`.
SC-3: The MCP server implements initialize / tools/list / tools/call / resources/list / resources/read, negotiating the client's protocolVersion.
SC-4: Read-only pan-tools verbs are exposed as MCP RESOURCES (quota-friendly); mutators as TOOLS carrying destructiveHint.
SC-5: No force-push / history-rewrite / reset verb is ever exposed as a tool.
SC-6: The merge tool refuses a protected-branch write unless (green CI + verify PASS + a human-origin token it cannot self-mint); it ignores any agent-supplied approval argument.
SC-7: Tool inputs are passed as an argv array to a shell-less spawn — no shell string interpolation (injection-safe).
SC-8: Unit tests cover: registry shape, JSON-RPC handshake, tools/list, a real tools/call against a scaffolded project, resources/read, unknown-tool error, and argument-injection safety.
SC-9: The build is verifiable WITHOUT a ZCode install; ZCode-dependent facts are gated behind an M0 verify spike.
SC-10: No regression in the existing suite.
```

---

## Phase 1: Verified Reconnaissance (38-agent review)

### 1.1 ZCode's real extension model
- **Subagents** — Markdown at `~/.zcode/agents/<name>.md`, **user-global only** (no repo-scoped rosters). Created via Settings → Subagents (Name/Color/Model/Description/Available-tools/System-prompt); per-agent model selection; per-agent tool allowlist; built-ins `general-purpose` (all tools) and `Explore` (hard read-only) are immutable. Invoked by description-match or `@name`.
- **MCP** — ZCode registers local **stdio** MCP servers (`command`/`args`/`env`, Claude-compatible JSON), User/Workspace scope. Documented and usable by the ZCode Agent.
- **Goals** — a continuous plan→execute→verify loop, **failed-closed** on defined acceptance criteria. Cannot be file-seeded or launched by a custom command; a human types `/goal`.
- **Commands** — "a command is a simple prompt sent to the agent," not an orchestrator; cannot invoke `/goal`.
- **No** documented hook schema (hooks doc 404s), **no** project config dir, **no** headless/CLI/daemon mode.

### 1.2 The four refuted claims (and the fixes now in the design)
| Claim tested | Verdict | Fix folded in |
|---|---|---|
| Subagents can call MCP tools | **unknown / leans no** | **Primary Agent makes all MCP calls**; subagents are read-only fan-out. Determinism independent of the unknown. |
| Goals can be file-seeded to drive autonomous loops | **refuted** | Human pastes a **done-state-fenced** objective into `/goal`; the loop is driven by the primary Agent + `next-action`. Unattended multi-day `--schedule` campaigns are **lost**. |
| ZCode's on-disk formats are stable enough to reverse-engineer | **refuted** (weekly Beta churn) | Drive ZCode's own **Import-from-Claude-Code / Settings / marketplace**; treat formats as GUI-owned; keep a beta-risk ledger. |
| Spawn/budget caps can be hard-enforced pre-spawn | **refuted** (no spawn hook) | Relocate enforcement to the **MCP-tool-call boundary** (every mutation passes through `pan-mcp`, which can refuse). Caps are deterministic in decision, cooperative at the spawn event. |

Additionally **confirmed** (a design constraint, not a bug): under ZCode **Full Access**, a raw Bash `git push` bypasses any local MCP gate — so the merge gate needs a second lock outside the agent's reach (§3.3).

Plausible (adversary failed to refute): local stdio MCP calls are **not** metered against ZCode's MCP-Calls quota (which scopes to *hosted* z.ai tools) — treat as inferred; never make a hosted z.ai MCP load-bearing in a tool-heavy loop.

---

## Phase 3: Design

### 3.1 Three layers (only the middle is new code)
1. **Engine — `pan-wizard-core`, reused in place, unchanged.** `.planning/` stays the durable, git-committable, honest-state store; every verb is a pure function over that tree.
2. **Bridge — `pan-zcode/mcp/`, new & thin, zero-dep.** A stdio JSON-RPC 2.0 server. Each `pan-tools` verb maps 1:1 to an MCP tool (or resource) by spawning `node pan-tools.cjs <verb> [args] --raw --cwd <root>` and returning its JSON. The CLI's JSON contract **is** the tool contract.
3. **Harness — ZCode, native.** The **primary Agent** is the single MCP caller and orchestrator; ported subagents fan out for read-only analysis; skills carry references/templates.

### 3.2 Why zero-dep / hand-rolled MCP
PAN is zero-runtime-dependency by charter (`dependencies: {}`). Rather than break that with `@modelcontextprotocol/sdk`, the bridge implements the small MCP stdio surface directly (newline-delimited JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `ping`). If protocol drift ever makes hand-rolling costly, the escape hatch is to vendor the SDK **inside `pan-zcode` only** (its own `package.json`), still leaving `pan-wizard-core` zero-dep.

### 3.3 The double-locked merge gate
- **Lock 1 (in the engine):** `confirm-merge` refuses any protected-branch write unless green CI + verify PASS + a **human-origin token** all hold; it **ignores any agent-supplied approval argument**; no force-push/history-rewrite verb is ever exposed (recovery is revert-only).
- **Lock 2 (outside the agent):** mandatory **server-side GitHub branch protection** — the truly non-bypassable anchor, holding even under Full Access. The installer mandates it and "never Full Access during install."

### 3.4 Read/mutate split → resources/tools
Read-only aggregators (`state`, `roadmap`, `phases`, `dashboard`, `progress`) are exposed as MCP **resources** (cheaper, quota-friendly, no side effects). Mutating verbs are **tools** with `destructiveHint`. This mirrors PAN's own read-vs-mutate split and hedges the (inferred-exempt) MCP-Calls quota.

### 3.5 Implementation plan
```
pan-zcode/mcp/tool-registry.cjs   verb → {tool|resource} descriptors + hints (PURE)
pan-zcode/mcp/server.cjs          zero-dep JSON-RPC 2.0 stdio server (handle() is pure/testable)
pan-zcode/mcp/merge-gate.cjs      request-merge / confirm-merge (human-token; M2)
pan-zcode/mcp/orchestrator.cjs    next-action state machine (waves/caps; M2)
pan-zcode/lib/convert-agent.cjs   port agents via install-lib converters (M3)
pan-zcode/plugin/                 agents/ skills/ mcp/pan-mcp.json AGENTS.md (M4)
pan-zcode/bin/install-zcode.js    pull-based install → ZCode Import/Settings (M4)
tests/pan-zcode-mcp.test.cjs      registry + protocol + spawn + safety
```

---

## Phase 4: Runtime Matrix & Milestones

| Milestone | Deliverable | ZCode needed? |
|---|---|---|
| **M0** | Verify spike on a real ZCode install: (a) can a subagent call MCP? (b) are local stdio calls metered? | **Yes — human** |
| **M1** | `pan-mcp` bridge core: `tool-registry.cjs` + `server.cjs` + tests (**this build**) | No |
| **M2** | `merge-gate.cjs` (token gate) + `orchestrator.cjs` (`next-action`) | No |
| **M3** | Content port: agents/commands → subagents/skills via `install-lib` converters | No |
| **M4** | Plugin bundle + pull-based install driving ZCode Import/Settings | Partial |
| **M5** | Hardening, beta-risk ledger, honest-limits doc | Partial |

---

## Phase 5: Risk Assessment
| Risk | Impact | Mitigation |
|------|--------|------------|
| Break PAN's zero-dep charter | High | Hand-rolled JSON-RPC; any SDK stays inside `pan-zcode`'s own package. |
| Merge gate bypass via Full Access + raw Bash | High | Lock 2: mandatory server-side branch protection; installer refuses Full Access. |
| Argument injection through tool inputs | High | Shell-less `execFile`/`spawn` with an argv array; verb allowlist; validate path args. |
| ZCode Beta format churn | Medium | Drive ZCode's own authoring surfaces; beta-risk ledger; no hand-written on-disk formats. |
| Lost autonomy (no headless/Goals-seed) | Medium | Human-stepped loop; done-state-fenced objectives; documented as a real loss. |
| MCP-Calls quota throttling | Low | Read verbs as resources; local stdio inferred-exempt; never depend on hosted z.ai MCPs. |

---

## Recommendation
Build **M1 now** (zero-dep bridge — provable without ZCode), then **M2** (the two determinism grafts). Gate M3–M5 behind the **M0 verify spike** on a real ZCode install, since two go/no-go facts (subagent-MCP access, quota metering) can only be settled empirically. ~90% of PAN's value transfers; the losses (scheduled campaigns, repo-scoped rosters, committable permissions) are named, not hidden.
