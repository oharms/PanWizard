# ADR-0045: Ship PAN as an Agent Plugins bundle — one portable package for the non-Claude runtimes

## Status

Accepted — 2026-09-10. Spike complete (this document, plus the two normative schemas pinned under `tests/fixtures/agent-plugins/`). Implementation tracked as items 4b–4g of `docs/specs/market-delta-2026-09-superplan.md`.

## Context

PAN reaches five runtimes with a loose-file installer and reaches Claude Code additionally as a plugin (`scripts/build-plugin.js`, ADR-0028 Phase 3). The June review planned bespoke packaging for the others — "Codex plugin + Gemini extension remain" — and the August review ranked plugin distribution as the unit that matters. Neither review saw the thing that changed the picture.

**Agent Plugins 1.0** was published on 2026-08-06 by Vercel with Amazon, Cursor, GitHub, Microsoft and OpenAI; Google joined the same day. It is a vendor-neutral package format for exactly two component types: Agent Skills and MCP servers. It is loaded natively by Copilot CLI, VS Code and the Copilot app (GA 2026-08-12), by Codex (0.146–0.147, remote marketplaces from 0.153), by Cursor and Kiro, and Antigravity declares its plugin format a superset that discovers from the workspace `.agents/plugins/` tree. Anthropic is not a maintainer; Claude Code keeps its own format.

PAN already has both component types the standard packages: a spec-conformant skills compiler (`convertClaudeCommandToUnifiedSkill`, ADR-0028) and a zero-dependency MCP server (`pan-wizard-core/mcp/`, ADR-0041). What it lacks is the wrapper.

### What was verified, and from where (read 2026-09-10)

| Fact | Source | Status |
|---|---|---|
| `plugin.json` is a **closed** schema: required `$schema` (const `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`) and `name` (1–64 chars, `^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`); optional `version`, `description`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords[]`, `extensions{reverse-domain: object}`; `additionalProperties: false` | `agent-plugins.org/schemas/1.0.0/plugin.schema.json`, pinned as a fixture | Verified |
| Optional metadata fields are "validated only by their JSON types" — a client must not reject on semver/URL/SPDX format | `spec/1.0.0.md` §5 | Verified |
| Unknown top-level manifest field or non-object `extensions` is **non-fatal**; any other schema violation is **fatal** to the whole plugin | `spec/1.0.0.md` conformance section | Verified |
| Skills: fixed `skills/` directory; each immediate child holding a regular file named exactly `SKILL.md` is one skill; no recursion; a non-conforming skill is skipped, not fatal | `spec/1.0.0.md` | Verified |
| MCP: fixed `mcp.json` at plugin root, never inline in the manifest; `$schema` const `…/1.0.0/mcp.schema.json` + `mcpServers`; stdio servers carry `type: "stdio"`, `command` (single executable token, bare name or `./`-prefixed, **no placeholder**), optional `args[]`, `env{}`, `cwd` | `mcp.schema.json`, pinned as a fixture; `spec/1.0.0.md` | Verified |
| `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded by the client in `args` elements, `env` values and `cwd` — not in `command`, not in keys, not anywhere else. Single non-recursive textual replacement; unknown placeholder-like text stays literal | `spec/1.0.0.md` | Verified |
| **When `cwd` is omitted, the client MUST use the plugin root as the subprocess working directory** | `spec/1.0.0.md` | Verified — and consequential, see D6 |
| Client-specific files live in a top-level directory named for a reverse-domain namespace; matching manifest data goes under `extensions[namespace]`; a client ignores namespaces it does not implement without validating them. No registry of namespaces exists | `spec/1.0.0.md` | Verified |
| Copilot: namespace `com.github.copilot/` with `agents/*.agent.md`, `hooks/hooks.json`, `commands/`, `rules/`; the older root-level layout (`agents/`, `hooks.json`, `.mcp.json`) is still read; plugin hooks accept the Claude matcher format and expand `${CLAUDE_PLUGIN_ROOT}` (also exported to the hook process) | `code.visualstudio.com/docs/agent-customization/agent-plugins`; `github.blog` changelog 2026-08-12 | Verified for VS Code; **Copilot CLI's own how-to shows only the root layout** — treat the namespace layout as VS Code-verified, CLI-unverified |
| Codex: consumes the root `plugin.json` directly; OpenAI-specific data lives inline under `extensions["com.openai"]` (`hooks` path or inline, `apps`, `interface`), hooks at `hooks/hooks.json`; `.codex-plugin/plugin.json` remains a compatibility fallback; marketplaces at `.agents/plugins/marketplace.json` (repo) or `~/.agents/plugins/marketplace.json`; install via `codex plugin marketplace add` / `/plugin`; enable in `config.toml` as `[plugins."name@marketplace"] enabled = true` | `developers.openai.com/plugins/build/plugins` | Verified |
| Antigravity: discovers `<workspace>/.agents/plugins/<name>/` and `~/.gemini/antigravity-cli/plugins/<name>/`; layout `plugin.json` (**own closed schema: `name`, `description`, `$schema` only**), `mcp_config.json`, `hooks.json`, `skills/`, `agents/`, `rules/`; install `agy plugin install <path>` | `antigravity.google/docs/cli/plugins/` | Verified layout; **mcp_config.json shape, hooks.json shape, agent/rule formats, and whether an Agent Plugins `$schema` is accepted are all UNSPECIFIED on the page** |
| Spec 1.1.0 is a working draft that still scopes v1 to skills + MCP: "Other component types are outside the v1 format" | `spec/1.1.0.md` | Verified |

Three facts that a changelog-level reading would have gotten wrong, recorded so they are not re-derived: the Antigravity manifest schema is **closed and different** from the Agent Plugins one, so a single `plugin.json` cannot satisfy both; `command` in `mcp.json` may **not** carry a placeholder, so the bundled server must be launched as `node` + `${PLUGIN_ROOT}/…` in `args`; and the stdio default working directory is the **plugin root**, which is the opposite of what PAN's server assumes.

## Decision

**D1 — One bundle, a separate builder.** Emit an Agent Plugins 1.0 package to `dist/pan-agent-plugin/` from a new `scripts/build-agent-plugin.js`. The Claude plugin builder is not extended with a format flag: the two layouts share almost no file paths, and the Claude plugin's output must stay byte-identical (a test pins that). Shared logic goes into pure functions in `bin/install-lib.cjs`, never into a second copy.

**D2 — Skills come from the one compiler.** The bundle's `skills/pan-*/SKILL.md` is produced by `convertClaudeCommandToUnifiedSkill` with the same content rewrite the installer applies — extracted from `bin/install.js` into install-lib so the installer and the builder call one function. ADR-0028's rule stands: no second skills compiler, ever. The emitted skills already satisfy every hard rule the spec's skills discovery applies (name equals directory, closed key set, no angle brackets, single-line description).

**D3 — A PAN placeholder, not a client one, for paths inside skill bodies.** Agent Plugins expands `${PLUGIN_ROOT}` only in `mcp.json`; Claude's `${CLAUDE_PLUGIN_ROOT}` textual substitution in content is Claude-specific (VS Code expands it in hooks and MCP config, not in skill bodies). Skill bodies in the bundle therefore reference the bundled core through PAN's own token, `{{PAN_PLUGIN_ROOT}}`, in the same style as the existing `{{PAN_ARGS}}`, and the skill adapter header defines it: the directory containing this plugin's `plugin.json`, two levels above the `SKILL.md`, which the runtime reports when it loads the skill. The header also says to prefer the `pan` MCP server's tools where the runtime has connected them. Whether models resolve the token reliably on each runtime is the live gate in 4c/4d; a conformance test can only assert that no `.claude/` or install-directory path survives in the bundle.

**D4 — `mcp.json` declares the bundled bridge.** `{"$schema": …, "mcpServers": {"pan": {"type": "stdio", "command": "node", "args": ["${PLUGIN_ROOT}/pan-wizard-core/mcp/server.cjs"]}}}`. `node` is a bare executable token, which the spec permits; the placeholder sits in `args`, where expansion is defined. No `env` block: a plugin serves whatever project the session is in, the same rule the Claude plugin follows.

**D5 — Vendor directories per runtime, each behind its own verification.** Copilot: `com.github.copilot/agents/*.agent.md` via the existing `convertClaudeToCopilotAgent`, and `com.github.copilot/hooks/hooks.json` in the Claude matcher format with `${CLAUDE_PLUGIN_ROOT}` paths, since that is the form VS Code documents as expanded. Codex: agents via `convertClaudeAgentToCodexToml`, location and hook variable **unverified** — emit only after reading the Codex plugin reference for agents, and register hooks under `extensions["com.openai"].hooks` only once its path form is known. Antigravity: **a separate variant, not this bundle**, because its manifest schema is closed with a different `$schema`; it is deferred until `mcp_config.json` and `hooks.json` shapes are read from a primary source. Emitting an unverified shape would repeat the dead-config-path class the June review caught twice.

**D6 — The server must learn the project root from the call, not the process.** `pan-wizard-core/mcp/server.cjs` resolves its project as `opts.cwd || PAN_PROJECT_ROOT || process.cwd()`. Under Claude Code the process cwd is the project, so it works. Under Agent Plugins the client launches the server **in the plugin root**, so every tool would read `.planning/` from inside the plugin cache and report an empty project — cleanly, which is the worst kind of failure. The fix is additive and shared with the Claude plugin: every registry tool gains an optional `cwd` input (absolute project path), the server uses it per call when present and falls back to today's resolution otherwise, and the resource rule from ADR-0041 (`args` static, never a function of client input) is preserved by scoping the parameter to tools only. Tracked as new item 4g; it is a prerequisite for the live gates, not a follow-up to them.

**D7 — Distribution.** A Codex marketplace file at `.agents/plugins/marketplace.json` in this repository (local `./dist/pan-agent-plugin` source for the test bed; a git source once published) and a Copilot marketplace file where its docs place it. Both gated on the same policy as the Claude plugin: ship the versioned bundle before listing anywhere that indexes without certifying.

**D8 — Conformance suite before any live gate.** A zero-dependency structural validator, driven by the pinned schemas, asserts: the manifest validates against `plugin.schema.json` (required keys, `$schema` const, name pattern, closed key set, field types); `mcp.json` validates against `mcp.schema.json`; every skill directory name equals its `name`; skill frontmatter uses only the closed key set with no angle brackets; every `{{PAN_PLUGIN_ROOT}}` reference resolves to a file inside the bundle; no `.claude/` or `.agents/pan-wizard-core/` path survives; a non-vacuity guard runs first. The Claude plugin build is asserted byte-identical before and after the compiler extraction.

## Consequences

- One emitted bundle serves Copilot and Codex today and Cursor/Kiro incidentally; Antigravity needs a thin variant later. This replaces the June plan's two bespoke packagings and closes ADR-0028 Phase 3's remaining half for those runtimes.
- The skills compiler extraction touches the installer's unified-skills path. Its output is pinned by `tests/unified-skills-install.test.cjs`; the extraction must leave that suite untouched and green.
- D6 changes the MCP bridge's tool schemas (additive optional field). Every runtime that registers the bridge sees the new parameter; the tool descriptions must make clear it is optional.
- The `{{PAN_PLUGIN_ROOT}}` convention is a bet on runtimes exposing the skill's file location at activation. If a runtime does not, its skills cannot reach `pan-tools` by path and must rely on the `pan` MCP tools — which is why D4 and D6 are not optional.
- PAN takes on a second `dist/` artefact and a second manifest that mirrors `package.json`; the manifest-mirror test pattern from the Claude plugin applies.

## Alternatives considered

- **Extend `build-plugin.js` with `--format agent-plugins`.** Rejected: different manifest location and schema, different MCP file name and schema, different placeholder, different vendor layout — a flag would be two builders in one function, and the Claude plugin's byte-identity guarantee would be harder to hold.
- **Fork the skills compiler for the bundle.** Rejected outright; it recreates the drift class ADR-0028 removed.
- **Use `${PLUGIN_ROOT}` inside skill bodies.** Rejected: the spec defines expansion only for `mcp.json` fields; the token would reach the model literally and unexplained.
- **Set `PAN_PROJECT_ROOT` in `mcp.json` `env`.** Rejected: the project path is unknown at build time, and `env` cannot name `PLUGIN_ROOT` or `PLUGIN_DATA`.
- **Wait for Agent Plugins 1.1 to add agents and hooks natively.** Rejected: the draft explicitly keeps them out of v1 scope; vendor namespaces are the standard's answer and are stable.

## Verification caveats

Copilot CLI's namespace layout is verified through VS Code's documentation and GitHub's changelog, not through the CLI's own how-to; Codex agent placement and hook path variables, and every Antigravity file shape, are unverified. Each is gated in the plan. Re-read the spec repository before implementing 4c/4d — the 1.1.0 draft is live.
