# Ecosystem Review & Strategic Plan — August 2026

**Date:** 2026-08-12 · **Tree:** main @ `be451c8` (v3.25.0, clean) · **Predecessor:** [ECOSYSTEM-REVIEW-2026-06.md](ECOSYSTEM-REVIEW-2026-06.md)

> **Scope.** A refresh of the June 2026 review against live sources, plus a planned response. The June review's *structural* conclusions held; what changed is that three items it filed as strategic or optional have become the category's table stakes, and one it ranked "Optional" (item 16, MCP delivery) is now the most under-exploited asset in the repo.
>
> **This document carries no counts about code.** Per CLAUDE.md's counts doctrine, every claim with members names the class and gives the command that enumerates it. Measurements are stated as the command that reproduces them, because a number written here is a maintenance debt nothing enforces.
>
> **Point-in-time.** Statuses were derived from the tree on 2026-08-12. Re-derive before relying on any of them: `git rev-parse HEAD && git status --porcelain`.

---

## 1. What changed since June

| Area | June 2026 position | August 2026 reality | Delta |
|---|---|---|---|
| **Agent Skills** | "became a cross-tool standard" | Public spec since 2025-12-18; ~40 platforms; three-tier progressive disclosure is normative; skills marketplaces at six-figure scale (SkillsMP, ClawHub, tonsofskills) | **Hardened into an ecosystem with distribution.** Not just a format anymore |
| **MCP** | "stateless RC locked for 2026-07-28" | **Shipped final 2026-07-28.** Stateless core, MRTR, header routing, cacheable lists, extensions framework. Tier-1 SDKs near half a billion downloads/month | **Landed.** PAN already tracks it ([ADR-0041](decisions/ADR-0041-mcp-dual-era-bridge.md)) — in the wrong subsystem |
| **Workflows-as-code** | "Native Workflows (`.claude/workflows/*.js`)" noted as a surface | Documented product with a stable primitive contract (`agent`/`parallel`/`pipeline`/`phase`/`log`/`args`), background execution, resume, plugin distribution, `/config` size guidelines, `ultracode` | **Matured into the answer for deterministic orchestration** |
| **Plugins** | "first slice shipped, marketplace gated" | Git-based distribution is how teams ship agent tooling; plugins bundle skills+agents+hooks+MCP as one versioned unit; Copilot consumes the Claude format | **The unit of distribution.** PAN builds one and ships it nowhere |
| **Competitors** | GSD destabilized, arms race | SDD is a mapped category (30+ frameworks). BMAD = 12-agent team sim; Spec Kit = spec-first breadth; GSD = lean Claude-native; Taskmaster = MCP-delivered task graphs | **Positioning still open**, but the delivery channel has consolidated |

### The one-line read

The market did not diverge from PAN's thesis — it converged on it. Progressive disclosure, subagents with isolated context, state discipline against context rot, deterministic orchestration, behavioral evals: PAN shipped all five before they were standard. What the market also built, and PAN did not, is the **packaging and distribution layer** around those ideas. PAN's gap is not conceptual. It is that its correct ideas are expressed in a private idiom.

---

## 2. The mapping

| PAN construct | 2026 market primitive | Verdict |
|---|---|---|
| `commands/pan/*.md` | Agent Skills (`SKILL.md`, 3-tier disclosure) | **Structurally valid, tier-3 skipped.** Compiler emits a flat body; no in-bundle `references/`. See §3.1. **Superseded `2026-09-10`:** tier 3 works via `@` references and the compiler emits `compatibility`; see the correction at the top of §3.1 |
| `pan-wizard-core/workflows/*.md` | Skill resources (judgment) / `.claude/workflows/*.js` (deterministic) | **Split verdict.** The portable path must stay markdown; the deterministic fan-outs belong in code. See §3.2 |
| `agents/*.md` | Subagents — genuinely per-runtime, no standard | **Aligned; PAN pioneered it.** Newer frontmatter unadopted (`isolation: worktree`, `skills:` preload, `maxTurns`, `memory`) |
| `pan-tools` + core modules | **MCP server** | **Built, mis-aimed.** See §3.3 — the single highest-leverage finding here. **Superseded `2026-09-10`:** re-aimed and shipped in v3.26.0 (`pan-wizard-core/mcp/`, registered per runtime); see the IMPLEMENTED note in §3.3 |
| `hooks/*.js` | Lifecycle hooks | **Aligned.** Every runtime that supports hooks gets PAN's |
| `references/`, `learnings/` | Skill resources / `rules/*.md` path scoping | **Right pattern, wrong boundary** — progressive disclosure implemented by path reference from outside the bundle |
| `.planning/` | *No standard exists* | **The moat.** Durable planning state is unstandardized and PAN is furthest along |
| AGENTS.md section | AGENTS.md (Linux Foundation / AAIF) | **Aligned** |
| `dist/pan-wizard-plugin/` | Plugin + marketplace | **Built, unpublished.** gitignored, absent from `package.json` `files` |
| PanLoop harness | Agent behavioral evals | **Ahead of the category.** **Superseded `2026-09-10`:** PanLoop is gone from disk; its in-repo successor is `harness/` (ADR-0047), same verdict |
| `bridge.cjs` | MCP *client*-side tool use | **Stub** — discovery-only, auto-invocation deferred |

---

## 3. Planned moves

Three moves, ordered by leverage per unit of effort. Each states its finding as evidence, the decision, phasing, and the gate that proves it landed. None requires new architecture; all three are completions.

### 3.1 — Finish the skills packaging (Move C in priority, listed first because it is prerequisite plumbing)

> **CORRECTED 2026-08-12, after checking the emitted tree instead of reasoning from the compiler source. Most of this section's premise did not survive.** What the plan called gaps are largely conformant already:
>
> - **Tier 3 works.** Skill bodies import the shared core with `@` references — root-relative (`@./.agents/pan-wizard-core/…`) for a local install, **absolute** for a global one, where a root-relative path would dangle. Both resolve; verified in both scopes. It is not *bundle-local*, which is a portability limitation, not a broken tier.
> - **Every hard spec rule already passes** across the whole emitted tree: `name` equals its parent directory (the requirement that actually gates discovery), the charset/hyphen and 64-char rules hold, and every `description` is present, single-line and inside 1024 chars.
> - **So P1 as written was the wrong call.** Copying the workflow and reference corpus into each of the emitted skill directories would duplicate it many times over to satisfy a shape, while PAN always ships the core alongside the skills. The single-source-of-truth arrangement is *better* here; the honest cost is only that a PAN skill is not a standalone bundle.
>
> **The trigger that reverses this, now concrete (found 2026-08-14).** Claude Code v2.1.224 hardened skills synced from claude.ai: their bodies **do not expand `@` files** (nor run `!` commands), and their descriptions are sanitized and labeled. That hardening applies to the claude.ai-sync path, not to local installs — so nothing is broken today. But PAN's entire tier 3 *is* `@` expansion. **Therefore: the moment PAN skills travel by any distribution path that disables `@` expansion, tier 3 goes dark and in-bundle `references/` stops being optional.** That is a sharper condition than "if a marketplace listing happens", and it is worth re-checking whenever a new distribution route is considered. Verify the current behaviour before acting — this is one release note, not a tested claim.
>
> **What was actually missing, and is now done:** the optional `compatibility` field (PAN needs Node and a `.planning/` directory — neither inferable from a body), plus a **spec-conformance suite**, which is the durable part. Nothing validated the emitted tree before: the pre-existing checks assert `name:` and `description:` are *present*, while the spec constrains their *values*. The new suite pins the value rules, asserts every `@` reference resolves on disk in both scopes, and leads with a non-vacuity guard — which immediately earned itself by catching that its own fixture was empty, a state in which four of the five assertions would have passed on nothing. `allowed-tools` stays unemitted by design (experimental; ADR-0028's rule is that unverified frontmatter waits for a live per-runtime check) and a test now guards against adding it prematurely.
>
> **Still genuinely open:** the body-budget item below (unchanged, and see its own note), and P4.

**Original finding (retained for the record).** The unified compiler (`convertClaudeCommandToUnifiedSkill` in `bin/install-lib.cjs`) emits a valid skill: `name`, `description`, `metadata.short-description`, adapter header, body. Two gaps were claimed against the spec:

1. ~~**No tier 3.**~~ **Refuted above.** The emitted skill directory holds only `SKILL.md`, and PAN's progressive disclosure runs through path references into `pan-wizard-core/` from outside the bundle. That was read as a defect; it is a deliberate trade that avoids duplicating the corpus.
2. **Body budget exceeded by a known class.** The spec recommends a SKILL.md body under ~5000 tokens. Enumerate the offenders rather than trusting a number here:

   ```bash
   for f in commands/pan/*.md; do t=$(( $(wc -c < "$f") / 4 )); \
     [ $t -gt 5000 ] && printf "%6d  %s\n" "$t" "$f"; done | sort -rn
   ```

   > **Note added 2026-08-12.** Measure the **emitted skill**, not the source command — the adapter header adds to every body, which pushes at least one command over the line that passes when measured at source. Substitute `.agents/skills/*/SKILL.md` in the loop after a `--unified-skills` install. Also weigh this before acting: the budget is a **recommendation**, the cost it describes is context consumed at activation, and the members are behavioural pipeline prompts. Splitting a multi-phase prompt changes what the agent reads and when, which is not verifiable by a size check — so this one wants live testing, not a mechanical split. It is the reason this item stayed open rather than being executed with the rest of §3.1.

   As of this writing the loop returns the `focus-*` family only, and the largest member is multiples over budget. (`army.md` sits just under the line — near enough that any edit can push it over, so treat it as in the class for planning purposes even though the check passes today.) Every member is a command ARCHITECTURE.md documents as "self-contained … no workflow" — one that inlined its procedure instead of delegating it. **The design decision that made them self-contained is what put them over budget**, which is why the fix is a file-boundary move rather than a rewrite.

3. Optional frontmatter the compiler never emits: `license`, `compatibility`, `allowed-tools`. `compatibility` is the one that matters — it is where "needs Node ≥18, needs a `.planning/` directory" belongs.

**Decision.** Split the oversized class along the boundary the spec already draws: activation-time instructions in `SKILL.md`, procedural detail in the bundle's own `references/`. This is not a rewrite — it is moving prose across a file boundary that PAN's architecture already respects conceptually.

**Phasing.**
- **P1** — Extend the compiler to emit `references/` inside the skill dir, and teach it to place workflow/reference content there instead of relying on an absolute path read. Keep the path-reference fallback for the runtimes that resolve it today.
- **P2** — Split the enumerated over-budget commands. Verify each stays under budget with the loop above, run as a test.
- **P3** — Emit `compatibility`; consider `allowed-tools` (experimental — gate on a live check per ADR-0028's own rule).
- **P4** — Flip `--unified-skills` default-on behind the per-runtime live discovery gates ADR-0028 already specifies. **This is the parked item**; the gates are a testing task, not engineering.

**Gate.** A test that walks every emitted skill dir, asserts `SKILL.md` body under budget, asserts `name` matches the parent directory (spec requirement — currently unverified), and asserts referenced resources resolve inside the bundle.

**Risk.** Low. Shared-tree failure domain is real but already mitigated by ADR-0028's per-runtime gates and the scenario matrix.

### 3.2 — Scale the native-workflow bridge

**Finding, and it is better news than the June review implies.** `buildNativeWorkflowScripts()` already emits scripts that use the **exact current primitive contract** — `export const meta` with `phases`, `phase()`, `parallel()`, `agent()` with `{agentType, label, phase, schema}`, `log()`, `args`, `.filter(Boolean)` on nullable agent results, JSON Schema for inter-stage data. Someone verified this against the real spec. It is correct code against a live contract.

What is missing is coverage. Enumerate what exists:

```bash
# scripts the builder emits, matched on the meta blocks inside its template
# literals (2-space indent + trailing comma):
grep -oE "^  name: 'pan-[a-z-]+'," bin/install-lib.cjs

# cross-check against the filenames written on install (this one also
# returns the hooks, so read it as a superset):
grep -oE "'pan-[a-z-]+\.js'" bin/install-lib.cjs | sort -u
```

**Two traps worth recording, because both bit while writing this document.** A looser `grep "name: 'pan-…'"` over the whole file also matches the plugin manifest's own name and over-reports. And scoping with `sed -n '/function buildNativeWorkflowScripts/,/^}/p'` *under*-reports, because the emitted scripts are template literals containing lines that begin with `}`, so the range closes early. Use the two commands above, and prefer the filename cross-check as the tiebreaker — the same "an enumerable claim is a maintenance debt" lesson the [outstanding-work ledger](audits/OUTSTANDING-2026-08.md) records, reproduced here in miniature.

**Why this matters more than coverage usually does.** PAN has field telemetry, which almost nothing in this category has, and it says prose orchestration drops steps. PanLoop finding 0 measured auto-advance chain completion at 0/3, then 1/5, then 6/7, then 16/16 across the fix chain. The root cause on record: a prose orchestrator "executes the mid-document state bookkeeping of the ~600-line inline transition but drops the final spawn step at its lowest-context moment." The responses were prose reinforcement, then `pan-stop-guard.js` — a hook that *detects the drop after it happens* and blocks the session stop once.

That is a correct mitigation and it should stay. But the market moved orchestration into code for precisely this failure mode, and the official framing is explicit about the mechanism: the script holds the loop, the branching, and the intermediate results, so the model's context holds only the final answer. A script cannot skim past step 9. **PAN independently produced the empirical case for a change it has already built the machinery for.**

**Decision.** Promote deterministic fan-out protocols to native scripts, case by case, keeping ADR-0028's explicit refusal to build a markdown→JS transpiler. Judgment-heavy protocols stay markdown.

**The selection rule** (this is the part worth writing down): a protocol is a script candidate when its control flow is knowable before the run — fixed fan-out width, a barrier that is genuinely a barrier, a loop with a computable termination condition. It stays markdown when the *next step depends on reading the last result*. By that rule the candidates are the wave/fan-out protocols and the merge-and-verdict protocols; `transition.md` is the interesting case — its bookkeeping is deterministic and its decision is not, which argues for splitting it rather than porting it whole.

**Hard constraints to design against** (all verified against the live docs):
- **Claude Code only.** Workflows run in the CLI, Desktop, IDE extensions, `claude -p`, and the Agent SDK — all Claude surfaces. The other four runtimes have no equivalent. **The markdown workflows therefore remain the portable path and cannot be retired.** This move is additive acceleration on one runtime, never a migration.
- No filesystem or shell access from the script itself; agents do that work. PAN's existing scripts already comply.
- No module loading — `import()` fails before the run starts.
- Concurrency and total-agent caps apply; a fan-out of many small agents survives interruption better than one long agent (resume replays from the first unfinished agent onward).
- Scripts distribute in a plugin from a `workflows/` directory at the plugin root, namespaced `/<plugin>:<name>` — which is what ties this move to 3.3's packaging.

**Gate.** Per script: the emitted source parses, declares no forbidden construct, and its `meta.phases` titles match its `phase()` calls. Behaviorally, the honest gate is PanLoop — run the ported protocol against a deployed install and compare chain completion to the markdown path. That is the oracle-diffing doctrine from [stability patterns](../CLAUDE.md), applied to orchestration.

**Risk.** Medium, and concentrated in one place: a ported script that diverges from its markdown twin creates two behaviors for one command. Mitigation is the drift test pattern PAN already uses for squad rosters — pin the pair.

### 3.3 — Re-aim the MCP server at PAN itself

**This is the finding of the review.** `pan-zcode/mcp/server.cjs` is a zero-dependency, dual-era (legacy handshake + 2026-07-28 stateless) JSON-RPC MCP server over stdio. Check its coupling to the beta harness it was written for:

```bash
grep -in "zcode\|z\.ai\|glm" pan-zcode/mcp/server.cjs   # comments only
```

It is **generic in protocol and logic** — the hits are comments plus one path assumption: the server resolved its default engine location by walking up to a root and back down into `pan-wizard-core/`.

> **Correction, recorded because an earlier revision of this section got it wrong.** That assumption was described here as "the only real coupling" and "precisely what P1 has to parameterize", implying the extraction was more than a file move. It was not. Once the module sits in `pan-wizard-core/mcp/`, the old two-levels-up form and a sibling-relative form resolve to the **identical** path — in the source tree and in an install alike, because the grandparent of `mcp/` contains `pan-wizard-core/` in both. Check it rather than trusting either claim:
> ```bash
> node -e "const p=require('path');const b='/x/pan-wizard-core/mcp';
> console.log(p.join(b,'..','..','pan-wizard-core','bin','pan-tools.cjs')===p.join(b,'..','bin','pan-tools.cjs'))"
> ```
> The real difference is narrower and worth keeping anyway: the old form requires the grandparent to hold a directory *named* `pan-wizard-core`, so it breaks under a vendored or renamed core, while the sibling form depends only on the layout it actually needs. **Net: the extraction is closer to a pure file move than this section originally claimed** — which makes the move cheaper, not harder.

Its own header states the thesis better than I can: *"the CLI's JSON contract IS the tool contract, so the PAN engine (pan-wizard-core) is reused byte-for-byte with no refactor."* `handle()` is a pure function over an injected spawn impl, so the protocol layer is unit-testable without stdio or a child process. The security posture is already right: `execFile` with an argv array and no shell, verb chosen from a registry allowlist, every argument validated to a strict shape before it becomes argv.

So PAN has a production-shaped MCP server for its own engine, sitting inside an experimental preview subsystem, aimed at a beta harness, gated on a verify spike against that harness — and **not delivered by the main installer at all**:

```bash
grep -rn "mcpServers\|mcp.json" bin/install.js   # returns nothing
```

**The registry is not a stub — it is a correctly-designed thin slice**, which is better news and required correcting an earlier draft of this section. Enumerate all three of its surfaces; a grep of `pan_*` names in `tool-registry.cjs` alone misses two of them:

```bash
grep -oE "uri: 'pan://[a-z]+'" pan-zcode/mcp/tool-registry.cjs   # MCP resources
grep -oE "name: 'pan_[a-z_]+'" pan-zcode/mcp/tool-registry.cjs   # spawn-backed tools
grep -oE "name: 'pan_[a-z_]+'" pan-zcode/mcp/native-tools.cjs    # in-process tools
```

What that returns is a design already making the right calls: read-only aggregators are exposed as **resources** (the module's own reasoning: "cheaper, side-effect-free, quota-friendly") while anything actionable is a **tool** carrying accurate `readOnlyHint`/`destructiveHint` annotations; a `FORBIDDEN_VERB` guardrail structurally refuses to ever expose a history-rewriting or force git op ("recovery is revert-only"); every argument is validated against a whitelist regex with a length bound before it can become argv; and the human merge gate is enforced by an out-of-band approval token that an agent-supplied value cannot satisfy.

So the correction to make loudly: **the pattern is right and proven; the work is coverage.** PAN's engine is a large documented CLI surface ([CLI-REFERENCE.md](CLI-REFERENCE.md)) and this slice reaches a fraction of it — but every verb added follows a template that already exists rather than inventing one. And Taskmaster proved the delivery model for this category; the June review said so and then ranked it "Optional."

**One asset here deserves separate notice, because it connects this move to §3.2.** The native tool `pan_next_action` is a deterministic state machine that answers "what should the agent do next" — plan / execute / verify / request_merge / await_approval / stop — with the safety caps and a regression circuit-breaker enforced *in code*. That is the same problem PanLoop finding 0 is about: a prose orchestrator dropping the next step at its lowest-context moment. **PAN-Z already built the deterministic orchestration graft the main product's measured defect calls for.** It is currently reachable only by a beta harness. Whether it should back the main chain is a genuine design question, not a foregone conclusion — but it should be asked, and §3.2's port list should be drawn up knowing this exists.

**Decision.** Promote the MCP bridge from a pan-zcode-internal component to a first-class delivery target of the main installer, and grow the registry to the useful subset of the CLI surface.

**Phasing.**
- **P1 — Extract, don't fork.** Move the protocol layer to a shared location both consumers require. One server, two consumers (main installer, pan-zcode). Forking it is the failure mode: it would create exactly the five-way drift class ADR-0028 exists to end.
- **P2 — Widen the registry along the existing pattern.** The core read aggregators are already resources, so this is extension rather than groundwork: add the reporting/foresight reads that have no side effects (`preview`, `cost`, `report index`, `validate health`, `links validate`) as resources or read-only tools, then reassess. **Read-before-write remains the safety ordering** — a write verb reachable over MCP is a write reachable by any connected client, and `.planning/` is the source of truth. Any write must arrive behind the same whitelist-regex validation and annotation discipline the registry already enforces, and must respect `FORBIDDEN_VERB`.
- **P3 — Register it.** `.mcp.json` for Claude Code, `.github/mcp.json` for Copilot, `mcp_servers` in Codex agent TOML — the per-runtime registration table belongs next to `HOOK_EVENT_MAP` in `install-lib.cjs`, which is the established pattern for exactly this shape of problem.
- **P4 — Ship it in the plugin.** Plugins bundle MCP servers; this is the same versioned unit as 3.1 and 3.2.

**Gate.** The existing dual-era suite (`tests/pan-zcode-mcp.test.cjs`) must stay green through the extraction — it is the regression oracle. Then a scenario test that installs, registers, and round-trips `tools/list` + one `tools/call` per registered verb. Per ADR-0041's own rule: **never advertise a protocol version whose method shapes are not actually implemented.**

> **IMPLEMENTED 2026-08-12 (P1–P3).** The bridge now lives at `pan-wizard-core/mcp/` and ships to every install; the registry gained the side-effect-free reads; the installer registers the server per runtime. What the work turned up, recorded because it is the durable part:
>
> - **Two of the four original MCP resources were DEAD from M1** — `pan://roadmap` and `pan://phases` each named a bare verb that requires a subcommand, so every read returned `Unknown <x> subcommand`. They survived because **every protocol test injects a fake spawn**; no test had ever read a resource through the real engine. Enumerate the surface and read each one before trusting it: `resources/list` proves a URI is *advertised*, not that it *works*.
> - **The resource/tool rule** now written into `tool-registry.cjs`: a resource must be readable on ANY project, including a bare directory. If "no data yet" is reported as an error, it is a tool. `roadmap analyze` and `preview phases` both exit non-zero without a roadmap, so both are tools. Check with `node pan-tools.cjs <verb> --cwd <empty-dir>; echo $?` before adding a resource.
> - **`defaultPanToolsPath()` had zero coverage**, so the whole suite would have stayed green had the relocation pointed the default at nothing — the server only spawns the engine at `tools/call` time, so the failure surfaces per-call in a deployed install and never at startup. Now covered and revert-proven.
> - **A repo-root-relative path in the registration table doubled** (`.github/.github/mcp.json`) because Copilot's config dir already *is* `.github/`. It installed and verified cleanly — a dead config path looks exactly like a live one on disk. Paths in `MCP_REGISTRATION` are **config-dir-relative**, pinned by a test that also covers the rows where `register: false`, so flipping one on later cannot inherit the bug.
> - **Deliberately not written:** Codex (MCP lives in `config.toml`; PAN is zero-dep with no TOML merge, so it prints a snippet) and Claude *global* (`~/.claude.json` is keyed by every project path the user has opened). Both recorded with rationale in the table rather than left as gaps.

**Risk.** Low-to-medium. The protocol code is tested and already handles the hard part. The real risk is scope: an MCP surface is an API, and APIs are forever. Keep the registry deliberately smaller than the CLI, and treat the allowlist as the contract.

---

## 4. What not to do

- **Do not retire the markdown workflows.** They are the only portable orchestration path across five runtimes. §3.2 is additive on one of them.
- **Do not chase a sixth runtime.** June's decision — serve new harnesses through the standard tree — is more correct now than when it was made, because the standard tree got an ecosystem.
- **Do not standardize `.planning/`.** No standard threatens it. It is the differentiator, and "the planning/state/verification layer above runtime-native orchestration" remains the right position.
- **Do not soften PanLoop.** A behavioral eval harness that catches what static review misses is rare in this category. It found the case for §3.2 by measurement.
- **Do not publish to a skills marketplace on quality grounds alone.** These marketplaces index public repos without certifying safety; being listed is distribution, not endorsement. Ship the plugin (a versioned, auditable unit) first.

---

## 5. Verification caveats

Primary sources read for this refresh: `code.claude.com/docs/en/workflows` (fetched in full — the primitive contract, constraints, plugin distribution, and permission model in §3.2 come from it directly), `blog.modelcontextprotocol.io` (the `2026-07-28` spec), plus search-level corroboration for Agent Skills adoption scale, the SKILL.md frontmatter/progressive-disclosure spec, plugin/marketplace practice, and the SDD competitive map.

Flagged as **secondary-source-only — verify before building on**:
- Skills-marketplace scale figures (six-figure counts vary wildly by source and are self-reported by the marketplaces).
- The "~40 platforms" adoption figure, which was already flagged in June's caveats in its earlier form.
- Exact `allowed-tools` semantics — labelled experimental in the spec; gate on a live check per ADR-0028's frontmatter rule.
- Per-runtime MCP registration paths in §3.3 P3 — these move, and June's review caught two dead config paths (Copilot hooks, Codex skills) exactly this way. **Verify each against its live docs before writing the installer table.**

**Refresh cadence.** The June review aged usefully in two months: nothing it said became wrong, but two "strategic" items became table stakes and one "optional" item became the best asset in the repo. That is the natural period for this document. Re-run it around October 2026.

---

## 7. Two-day delta (checked 2026-08-14)

A spot-check two days after §1 was written. Nothing here invalidates the plan; three items are actionable and one closes a risk. **All from the official Claude Code changelog and the Agent Skills spec — but each is a release note rather than a tested claim, so verify before building.**

| Finding | Version / source | Bearing on PAN |
|---|---|---|
| **Plugin marketplace `command` sources** — "a local command … prints the plugin directory, which is re-resolved each session and applied without a restart; `mode: \"link\"` uses it in place" | Claude Code v2.1.229 | **The most useful thing here.** PAN builds a plugin and ships it nowhere, because publishing was gated on verifying `${CLAUDE_PLUGIN_ROOT}` expansion inside command markdown. A `command` source sidesteps a hosted marketplace entirely: point it at a command that prints `dist/pan-wizard-plugin`, and `mode: "link"` consumes it in place with no copy. That is a real distribution path for dev, teams and CI **today**, and it also gives the gated expansion question a cheap live test bed |
| Plugins accept `"."` as a `skills` path | v2.1.221 | Small enabler for the same work — a plugin can declare its root as the skills path |
| **claude.ai-synced skills no longer expand `@` files** | v2.1.224 | Qualifies §3.1's deferral with a concrete trigger — see the note in that section. PAN's tier 3 *is* `@` expansion |
| MCP client no longer hangs 30s on a malformed protocol-version probe reply | v2.1.226 | **Checked PAN against this failure mode: clean.** `server/discover`, the legacy `initialize` (with and without a version), a modern `params._meta` version, and an unsupported version all answer in well under a millisecond — the last with `-32022` plus `supported`/`requested`. It always answers; there is no hang path. (Note the probe shape: `_meta` lives **inside `params`**. Putting it at the top level silently reads as legacy) |
| Subagent forking on by default; `subagent_type: "fork"` inherits full conversation **and prompt cache**; non-teammate spawns run in background by default | v2.1.232 | Worth a decision rather than adoption. PAN's quality guarantee is the *opposite* — every agent starts from zero context. Forking trades that for cache reuse, so it suits a cheap same-context follow-up, never the planner/verifier chain. The background-by-default change may also alter how `/pan:exec-phase` waves surface to a user |
| Self-hosted runners (`claude self-hosted-runner`), plus server-supplied hooks for those sessions | v2.1.224 / v2.1.229 | Relevant to the army/campaign story for teams who cannot send repo contents off-network. Note the boundary: checkouts, artifacts and secrets stay on your infra, but the conversation — prompts, responses, tool results — still goes to Anthropic for inference. Not a data-residency claim PAN should make on its behalf |
| MCP `Roots`, `Sampling` and `Logging` deprecated in the `2026-07-28` revision | MCP spec | **Retroactively validates ADR-0041's scope boundary**, which declined MRTR on the grounds that the bridge has no sampling/elicitation/roots. The features it chose not to build are the ones being removed |
| Market position: OpenCode leads open-source agents by stars; the common stack pairs a frontier terminal agent with an open-source one **through the same MCP servers** | Aggregators (secondary) | Independent support for §3.3's premise: MCP is the interoperability layer, so one PAN bridge serves both halves of that stack. Treat the ranking numbers as self-reported |

**Acted on immediately:** two spec rules PAN satisfied by construction but not by test — no angle brackets in frontmatter (a prompt-injection vector the spec warns about, and PAN inherits `description` from each command, so a future bracket would open it silently) and the closed set of allowed top-level keys. Both now guarded and revert-proven.

**The `command`-source distribution is now built as a test bed** (`marketplace/`, `scripts/plugin-path.js`, and a plugin-only `/pan-plugin-selftest`). See `marketplace/README.md` for the two commands that run it.

**ANSWERED 2026-08-14 — `VERDICT: case A`.** Run on Claude Code **2.1.233**, Windows, by installing the plugin from the `command`-source marketplace and running `/pan-plugin-selftest`. Probe 1 returned a real absolute path into the plugin cache with **no placeholder text surviving**; probe 3 confirmed pan-tools runs through that path. **The plugin-root placeholder does expand inside command markdown, PAN's existing content rewrite is correct as it stands, and marketplace publishing is unblocked.**

**Probe 2 is the finding worth carrying, and it corrects the probe's own case-B description.** `CLAUDE_PLUGIN_ROOT` is **not** exported into the Bash tool's environment — it read empty. So textual substitution and shell expansion are **not interchangeable**: content must keep using the substituted form, because a shell evaluating `$CLAUDE_PLUGIN_ROOT` at runtime gets an empty string. Case B was written assuming a shell would rescue that path; on this environment it would not, and case B would have behaved as case C. The probe text now carries that caveat so a future run does not inherit the wrong premise.

Treat this as one measurement on one version and one platform. Re-run after a Claude Code upgrade rather than assuming it holds.

**A second result came free from the same install: the plugin's `.mcp.json` works.** The bridge registered as `pan` and answered a real `tools/call` returning engine JSON — confirming §3.3's P4 end to end, not merely that the file ships in the bundle. Shipped *and* declared *and* reachable.

Two constraints found while building it, both from primary docs and both of which a changelog-level reading would have gotten wrong:

- **`mode: "link"` is unsupported on Windows** — Claude Code refuses a link-mode plugin there. The changelog line advertises link mode as the interesting part; on this project's own development platform it is unusable. The entry declares `"copy"`, and a test pins it.
- Command sources need **v2.1.229+**. On v2.1.120–v2.1.228 the install fails with a specific message, and on older versions **the whole marketplace fails to load** — so a user on an older build sees the marketplace break, not just this plugin.

Also worth recording about the probe's design: it separates *textual substitution in markdown* from *the environment variable being set*. A probe that merely ran a shell command through the placeholder would pass whenever `CLAUDE_PLUGIN_ROOT` is exported into the tool environment and prove nothing about markdown — a false positive that would have "unblocked" publishing on no evidence. The three outcomes are labelled `case A` / `case B` / `case C`, and case B is the genuinely awkward one: shell invocations in content keep working while `@` file imports do not.

---

## 6. Recommended sequence

3.3 first, then 3.1, then 3.2.

3.3 is the cheapest by a wide margin — the hard part is written and tested, the work is a registry and a registration table — and it opens a distribution channel PAN currently has no presence in. 3.1 is prerequisite plumbing for the plugin that 3.2 and 3.3 both want to ship inside, and its P4 unparks work already done. 3.2 is last not because it matters least — it addresses a measured product defect class — but because it is the only one with genuine behavioral risk, and it is worth doing after the packaging that distributes it exists.


---

## 8. Four-week delta (checked `2026-09-10`)

An interim scan run ahead of the October re-run. Nothing here invalidates the plan; §3.2 is still the only open move. One finding the August pass missed outright: **Agent Plugins**, a vendor-neutral plugin bundle published on `2026-08-06` that Copilot CLI, Codex and Antigravity now load natively (Antigravity from the workspace `.agents/plugins/` tree) — it collapses the remaining per-runtime packaging work into one emitted bundle, with Claude Code keeping its own format. Also found: a stale rate row for the current default Claude model, a Claude plugin build that omits the native workflows, per-bucket prompt-cache TTL controls that leave every subagent on the short lifetime, and async observer hooks on Codex.

The findings table and the prioritised, sized queue live in [specs/market-delta-2026-09-superplan.md](specs/market-delta-2026-09-superplan.md). That file also records what remained unverified at scan time (the Agent Plugins field-level schema and vendor-directory names) and gates each item on a primary-source check before building.


---

## 9. Reality check (run `2026-09-10`, evening — first run of `/reality-check`)

A same-day re-verification after the §8 scan, run as the first execution of the new `/reality-check` dev skill against branch `feat/market-delta-2026-09-s1` @ `5684d38` (PR #29 open, every check green, mergeable; the commits since the `v3.27.0` tag are unreleased). The findings table, the sized queue and the sources live in the addendum at the end of [specs/market-delta-2026-09-superplan.md](specs/market-delta-2026-09-superplan.md), and the step-by-step execution plan for every item is [specs/reality-check-2026-09-superplan.md](specs/reality-check-2026-09-superplan.md); this section records what changed in the picture.

**What held.** The suite, every release gate and the harness's model-free tier are green on a packed artifact installed into all five runtimes; every MCP resource the installed bridge advertises reads through the real engine on a bare project; the rate rows match the provider pricing page read today; the Agent Plugins bundle keeps its placeholder out of `command`, which the spec now states explicitly. Reproduce with `npm run test:all`, `node scripts/release-check.js`, `npm run harness`, and Phase 1.3 of the skill.

**What did not.**

| Finding | Evidence | Bearing |
|---|---|---|
| **"Fable 5.1 is Claude Code's default" is false.** | `code.claude.com/docs/en/model-config`: "Neither Fable model is the account-type default on any plan or provider"; `default` is Opus 5 or Sonnet 5 by plan; the `fable` and `best` aliases resolve to Fable 5.1 | The S1 rate fix stands (users on the alias were over-billed), but the unreleased CHANGELOG, the `cost.cjs` comment and F2/1b of the plan give a wrong reason. Correct before release |
| **`validate health` exits 0 on `status: broken`.** | `cmdValidateHealth` calls `output()` without an exit code; the health payload's `errors[]` sits outside the error family CLI-REFERENCE defines, and CLI-REFERENCE says verdict commands set the code explicitly. No test pins it | An orchestrator gating on the exit code reads a broken project as healthy |
| **§8's "BMAD and GSD: no release since May 2026" is false for both.** | BMAD `v6.11.0` (`2026-08-10`) and `v6.12.0` (`2026-09-04`); GSD's upstream repository was archived on `2026-06-26` and the project continues as **`open-gsd/gsd-core`** with releases `v1.11.0` to `v1.13.0` inside the window | gsd-core is PAN's closest peer and was read as dormant. See the convergence note below |
| **COMPARISON.md is a March snapshot.** | "MCP Support: via host tool" (PAN ships and registers its own server); "nobody else does this" on plan verification and "no competitor offers structured UAT" (gsd-core ships a plan-checker gate and a manual UAT walkthrough; Spec Kit ships cross-artifact analysis); Continue.dev has been read-only since June; Windsurf is Devin Desktop and removed Cascade on `2026-09-08`; Aider's last release predates the window by a year | The false statements are corrected in this run and the date moved; the matrix refresh is queued |
| **README promises a prompt that does not exist and embeds a hook count.** | The installer prompts for runtime only and defaults to local silently. The Hook System row carries a number, against the counts doctrine, and the number is wrong | Queued |
| **Several "leads" are Claude-only or capped, and the README does not say so.** | Bot army and fresh-context spawning are code-verified on Claude Code and prose-adapted elsewhere; the plan-checker loop caps at three passes; per-task commits coalesce trivial tasks; reviewer-class agents pin a model despite "every agent inherits"; the abort kill-switch is prompt-enforced | A README accuracy pass, queued |
| **OpenCode's local config path is live but undocumented.** | PAN writes `.opencode/opencode.json`; the docs page lists only a repo-root `opencode.json`, while the loader source reads `opencode.json` and `.jsonc` inside any `.opencode` directory | Cite the loader, not the docs page, in `MCP_REGISTRATION`; add OpenCode and Gemini live-gate scenarios, which the harness lacks |
| **Four priced models resolve to no rate.** | Both Mythos ids and the dated Opus 4.5 and Sonnet 4.5 ids return `null` from `resolveRate`; all four are on the pricing page today | A primary citation exists, so the "no rate without a source" rule now permits the rows |
| **The Agent Plugins bundle on disk was stale.** | `dist/pan-agent-plugin/` predated the S3 vendor-directory commit; the Codex and Copilot marketplaces resolve to that path with no rebuild-on-resolve, unlike the Claude `command` source | A stale bundle ships silently; gate it |

**Model-tier evidence from the same evening (a concurrent session's run, not this one's).** The tracked ledger and `d:/pantesting/harness-runs/run-20260910-190841-i1aw` record a five-rep tier-2 run of the markdown exec-phase chain on build `3.27.0` @ `8e776bf` under a twenty-dollar cap: three reps completed, one exited non-zero with `passed=false`, one produced no summaries and no source files. The native `pan-exec-waves` chain got no measurement at all: every rep was budget-starved before its first step by the pre-fix equal split, which `87e53c9` then corrected. Two later tier-1 runs of `plugin-agent-scope` spent nothing, finished in seconds and printed neither greppable line, which reads as a probe wiring fault rather than a product verdict; both stay open in the ledger. **So the chain-drop class that PanLoop closed at 16/16 is measurable again and sits at three of five on this seed and this Claude Code build.** Item 5c, the markdown-versus-native oracle comparison, is now the highest-value spend in the queue (R19).

**Convergence, restated.** The market kept moving onto PAN's thesis, and one peer now occupies most of the same ground: gsd-core uses a `.planning/` tree with the same core files, a plan-checker gate, a verifier with manual UAT, an MCP server, quality/balanced/budget model profiles, a Claude plugin, and lists more runtimes than PAN targets. Spec Kit (`v1.0.0` on `2026-08-21`, then a steady run of point releases) added declarative workflows with loops and an event dispatcher plus cross-artifact analysis. Superpowers runs a behavioural harness against real tool sessions. Codex and Copilot converged on Agent Plugins; Cursor and Devin Desktop moved to parallel agents in worktrees. So the August read holds with one amendment: **the gap is no longer only packaging, it is publication and positioning.** PAN builds both plugin formats and publishes neither beyond npm, while BMAD, Superpowers and gsd-core are one `plugin install` away on the runtimes' own marketplaces. And the "no competitor does this" language is now false where it was checked.

**Where PAN is still ahead, with the evidence that says so.** A behavioural harness that installs from a packed, content-identified artifact and keeps a findings ledger (only Superpowers has a comparable harness, and not in CI); an MCP surface with a code-enforced forbidden-verb list and a nonce-bound human merge gate (gsd-core exposes its engine over MCP; nothing read enforces a merge gate in code); a cost ledger whose rate table tracks cache-read economics (no peer's ledger was found); the learnings store with a lint gate; native Claude Code workflow scripts pinned to their markdown twins; zero runtime dependencies (Spec Kit and BMAD need Python and uv). The bot army is unique and Claude-only.

**Roster change.** Add **OpenSpec** (Fission-AI; the largest spec-driven project by stars, releasing steadily through the window). Treat **Taskmaster** as dormant (no release since `2026-03-31`). Read GSD at `open-gsd/gsd-core`.

**What not to do — re-affirmed, two additions.** Every entry from §4 and the plan still holds. Added: *do not describe `.planning/` as unthreatened* — the layout is shared with gsd-core, so the differentiator is the depth of what PAN does with it, and hygiene should recognise a foreign layout rather than call it broken; *do not write "no competitor" or "nobody else" in an evergreen doc without a dated peer check* — such claims were false today where checked.

**Cadence.** This run replaces the interim; the full October re-run stands. Re-run earlier if gsd-core or Spec Kit ships an MCP or harness change, if a runtime drops a path PAN writes, or if the `fable` and `best` alias target moves.
