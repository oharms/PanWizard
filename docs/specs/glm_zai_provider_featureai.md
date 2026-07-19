# /featureAI — GLM (z.ai) Provider Support & ZCode Interop

**Source:** User request — "make PAN work with ZCode / GLM."
**Lineage:** Concrete, shippable instance of [`multi_model_routing_featureai.md`](multi_model_routing_featureai.md) (that spec anticipated non-Anthropic providers; this one lands the first real one). Reuses the existing `PROVIDER_MODELS` / `detectProvider` / `resolveTierToModel` seam.

> GLM = Zhipu AI's model family, sold internationally as **z.ai**. The **GLM Coding Plan** is a flat-fee subscription exposing an **Anthropic-compatible** endpoint (`https://api.z.ai/api/anthropic`). GLM-5.2 (16 Jun 2026, MIT-licensed, 1M ctx) benches ~between Opus 4.7 and 4.8 on agentic coding. **ZCode** is z.ai's *own* coding-agent harness (a Claude-Code peer) built on GLM-5.2.

---

## Phase 0: Problem Framing

### 0.1 Problem Statement

PAN's bot army is powerful but, in practice, Anthropic-priced. Users on z.ai's flat-fee GLM Coding Plan (a fraction of Claude Code Pro, ~parity on coding benchmarks) currently get PAN *accidentally* working under Claude Code — because Claude Code itself remaps `opus/sonnet/haiku` → GLM via `ANTHROPIC_DEFAULT_*_MODEL` env vars, and PAN already emits those tier tokens rather than hardcoded IDs. But that "accidental" path is unmanaged: PAN believes it's on Anthropic, the installer **false-warns** that the model lacks 1M-context/thinking, the cost ledger fabricates per-token dollars against a flat-fee plan, and there is **zero** provisioning help (the user hand-edits `settings.json`). PAN should make GLM a *first-class, provisioned, honestly-labelled* backend across the runtimes that actually support it — and give an honest answer on ZCode.

### 0.2 Scope

| In Scope | Out of Scope |
|----------|--------------|
| GLM/z.ai as a recognized **backend** + `zhipu` tier-provider | PAN making direct API calls to z.ai (PAN always delegates to the host CLI) |
| Provisioning z.ai config into **Claude Code** (`.claude/settings.json` env) and **OpenCode** (`opencode.json` provider) | Persisting the z.ai **API token** in any committed file (security — token stays in shell env / gitignored local settings) |
| `detectProvider` recognizing GLM (config / `PAN_PROVIDER` / `ANTHROPIC_BASE_URL`) | A generic "any OpenAI/Anthropic-compatible endpoint" wizard (GLM is the concrete target; generic BYO-endpoint is a follow-up) |
| GLM branch in `detectModelCapabilities` (stop the false 1M-ctx/thinking warning) | Benchmarking or auto-selecting GLM vs Claude per task |
| Cost honesty for flat-fee plans (no fabricated `$`) | Token/quota metering of the z.ai subscription |
| `/pan:provider` command + `pan-tools provider` verb | Codex / Gemini / Copilot GLM paths (not z.ai-blessed targets — see matrix) |
| **ZCode**: honest feasibility verdict + a *partial* `~/.zcode/agents/` agent-pack path | ZCode as a full 6th runtime (blocked — ZCode has no custom slash-commands / project config / hooks today) |

### 0.3 Success Criteria (Measurable)

```
SC-1: `routing.provider: "zhipu"` (aliases glm/zai) resolves — no silent downgrade to 'default'.
SC-2: PROVIDER_MODELS gains a `zhipu` entry; resolveTierToModel('mid','zhipu') → a GLM id; reasoning stays 'inherit'.
SC-3: detectProvider recognizes GLM via (a) config.routing.provider, (b) PAN_PROVIDER=glm, (c) ANTHROPIC_BASE_URL containing an allowlisted z.ai host.
SC-4: detectModelCapabilities('glm-5.2' / 'GLM-4.7' / 'glm-4.5-air') returns has_1m_ctx/has_thinking correctly; the installer E-9 warning no longer fires for GLM.
SC-5: `pan-tools provider set glm` provisions Claude Code (.claude/settings.json env block: ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL, API_TIMEOUT_MS) — and NEVER writes the auth token to a tracked file.
SC-6: `pan-tools provider set glm` provisions OpenCode (opencode.json custom @ai-sdk/anthropic provider, baseURL …/anthropic/v1, GLM models).
SC-7: `pan-tools provider show` reports the active backend + effective tier→model mapping; `provider clear` reverts.
SC-8: Cost surfaces (cost.cjs / hud / report) show tokens + a "flat-fee plan" note instead of a fabricated $0.00 when backend=zai.
SC-9: Running `pan-tools provider set glm` for Codex/Gemini/Copilot prints a clear "not a supported z.ai target" message and makes no changes.
SC-10: Unit + scenario tests cover provider resolution, capability branch, provisioning (both runtimes), secret-safety, and the unsupported-runtime guard (≥10 cases, incl. 2 runtime-specific + 2 error).
SC-11: No regression; existing behavior identical when no GLM backend is configured (default path untouched).
```

### 0.4 User Stories

```
US-1: As a GLM Coding Plan subscriber, I want `pan-tools provider set glm` to wire up
      Claude Code for me, so the whole PAN bot army runs on GLM at flat-fee cost,
      instead of hand-editing settings.json and guessing the env var names.

US-2: As an OpenCode user, I want PAN to register z.ai as a custom provider and emit
      real glm-* model ids, so my agents actually route to GLM,
      instead of OpenCode choking on the bare tier token "sonnet".

US-3: As any GLM user, I want PAN to stop telling me my model "lacks 1M context and
      extended thinking" and stop inventing a $0.00 spend, so the HUD/report tell the
      truth about a flat-fee GLM plan.

US-4: As a ZCode user, I want an honest answer on whether PAN runs inside ZCode today,
      and the closest thing that does work, instead of a half-broken install.
```

---

## Phase 1: Internal Reconnaissance (findings)

PAN already has the *exact* abstraction this needs; it just has no notion of a custom **endpoint/backend**.

| Seam | Location | Today | GLM change |
|------|----------|-------|-----------|
| Tier→ID map | `core.cjs:35-40` `PROVIDER_MODELS` | `anthropic/openai/google/default` | **add `zhipu`** `{ reasoning:'inherit', mid:'glm-4.6', fast:'glm-4.5-air' }` |
| Legacy aliases | `core.cjs:43` `LEGACY_ALIASES` | opus/sonnet/haiku → reasoning/mid/fast | unchanged (GLM inherits the same tiers) |
| Provider detect | `core.cjs:714-735` `detectProvider` | config → `PAN_PROVIDER` → runtime-dir | **add** glm/zai alias acceptance + `ANTHROPIC_BASE_URL` z.ai sniff |
| Tier resolve | `core.cjs:743-747` `resolveTierToModel` | unknown provider → default; unknown tier → mid | unchanged (graceful; no allowlist to fight) |
| Agent model decl | `agents/*.md` frontmatter | tier alias only (`model: opus` on 3 security agents); **never full IDs** | unchanged — this is *why* GLM already flows under Claude Code |
| Installer model writes | `install.js:2337-2451` | **never writes model/provider/endpoint**; only *reads* `.claude` `model` for E-9 warn (`install.js:2477-2501`) | **new**: opt-in provider provisioning path |
| Capability classifier | `install-lib.cjs:1013-1071` `detectModelCapabilities` | no GLM branch → GLM falls to `unknown` (all caps false) → false warning | **add GLM branch** |
| Config defaults | `config.cjs:42-95` `buildConfigDefaults` | emits `routing{strategy,provider:'auto',…}`; **not** in `templates/config.json` | add optional `routing.backend`; (note the template/loader divergence) |
| Cost | `cost.cjs` per-token pricing + `ledgerReliability()` honesty | prices by model id; GLM unpriced | **flat-fee mode** when backend=zai (reuse honesty pattern) |
| Model catalog | — | **none** — no allowlist anywhere | nothing to gate; only `PROVIDER_MODELS` + `detectModelCapabilities` enumerate identity |

**Decisive fact:** PAN emits *tier tokens*, and Claude Code remaps them to GLM via env vars. So GLM already works under Claude Code — the feature is about *managing, provisioning, and telling the truth about* that path, plus adding the OpenCode path.

---

## Phase 2: Competitive Analysis

`docs/COMPARISON.md:24` already claims *"Multi-model routing (tier aliases + provider mapping)"* as a PAN differentiator — GLM makes that claim real for the value-leader backend of 2026. Peers: OpenCode/Cline/Kilo expose raw provider config (powerful, but the user assembles the JSON themselves); Claude Code takes env vars (no product-level notion of "provider = GLM"). **PAN's differentiation:** a one-command, tier-aware, *honest* GLM switch that carries the whole bot-army model policy (profiles, per-agent pins, effort) across the swap — and refuses to fake costs on a flat-fee plan.

---

## Phase 3: Design

### 3.1 Two integration surfaces

**Surface A — GLM through PAN's existing runtimes (primary, feasible now).**
Point Claude Code / OpenCode at z.ai's Anthropic-compatible endpoint. This is where ~all the value is and where the work lands.

**Surface B — ZCode as a runtime (deferred/partial).**
ZCode's documented extensibility = subagents in `~/.zcode/agents/` (Markdown, `@name`), MCP, and a nascent skills/plugin system. It has **no** custom slash-commands, **no** project-level config dir, **no** hooks, **no** headless mode. PAN is command- and hook-heavy (58 commands, 5 hooks), so a *full* PAN-on-ZCode install is **not possible today**. Feasible subset: a "ZCode agent pack" — install PAN's `agents/*.md` into `~/.zcode/agents/` (they're already Markdown) + optionally register `pan-tools` as an MCP server. Recommendation: **ship Surface A now; track ZCode's roadmap** (gate the pack behind ZCode gaining command/config extensibility).

### 3.2 The key abstraction: separate **tier-provider** from **backend**

- `routing.provider` (existing) answers *"what model token do I emit?"* — for **Claude-Code-on-GLM** it stays `anthropic` (the host remaps sonnet/haiku→GLM); for **OpenCode-on-GLM** it becomes `zhipu` (emit real `glm-*` ids).
- `routing.backend` (**new**, e.g. `"zai"`) answers *"what service actually answers?"* — this single marker drives capability detection, cost honesty, telemetry labels, and provisioning, **without** contorting the tier map. Absent/`null` = today's behavior exactly.

### 3.3 Architecture decisions

1. **`PROVIDER_MODELS.zhipu`** (`core.cjs`): `{ reasoning:'inherit', mid:'glm-4.6', fast:'glm-4.5-air' }`. Model ids sourced from a single `GLM_MODELS` constant so a version bump is one edit. `reasoning:'inherit'` lets the host pick its top GLM (via `ANTHROPIC_DEFAULT_OPUS_MODEL` under Claude Code, or the provider's default under OpenCode).
2. **`detectProvider`** (`core.cjs`): accept `glm`/`zai` as aliases of `zhipu`; add an env sniff — if `ANTHROPIC_BASE_URL` matches an **allowlisted** z.ai host (exact host compare, not substring), infer backend=zai. (Host allowlist constant, not a regex over user input — avoids the taint-barrier pitfalls from the report/hud work.)
3. **`detectModelCapabilities`** (`install-lib.cjs`): add a `glm` branch → `{ has_1m_ctx:true, has_thinking:true, has_cache:true, tier: <by name> }` for glm-5._/glm-4.7; and when `backend=zai`, suppress the E-9 warning entirely.
4. **Provisioning** — new module `provider.cjs` + dispatcher verb `provider set|show|clear <name>` and command `commands/pan/provider.md`:
   - **Claude Code:** merge an `env` block into `.claude/settings.json`: `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `API_TIMEOUT_MS`. **Never** `ANTHROPIC_AUTH_TOKEN` in a tracked file — instead (a) instruct the user to `export ANTHROPIC_AUTH_TOKEN=…`, or (b) with explicit `--persist-token`, write it only to `.claude/settings.local.json` (gitignored). Proto-pollution-safe merge (reuse `config.cjs` guard).
   - **OpenCode:** merge a custom provider into `opencode.json`: `@ai-sdk/anthropic`, `options.baseURL = https://api.z.ai/api/anthropic/v1`, `models: { "glm-4.6": {…}, "glm-4.5-air": {…} }`. Set `routing.provider=zhipu` so PAN emits real ids.
   - **Codex/Gemini/Copilot:** no-op + a clear message: *"GLM via <runtime> isn't a supported z.ai target — use `--claude` or `--opencode`."*
5. **Cost honesty** (`cost.cjs` + `hud.cjs`/`phase-report.cjs` consumers): when `backend=zai`, route through the existing `ledgerReliability()` degradation — show token volume + a "flat-fee GLM Coding Plan (per-token cost N/A)" advisory instead of a dollar figure.
6. **Installer flag** (`bin/install.js`): `--provider <name>` (and convenience `--zai`) calls the same `provider.cjs` provisioning against the runtimes being installed. Purely additive; no change to the default install.

### 3.4 Implementation plan

```
1. pan-wizard-core/bin/lib/core.cjs
   - GLM_MODELS constant; PROVIDER_MODELS.zhipu; detectProvider glm/zai alias + z.ai host sniff;
     thread routing.backend through loadConfig fallback + buildConfig.
2. pan-wizard-core/bin/lib/config.cjs
   - buildConfigDefaults: routing.backend default (null); document key. (Also close the
     template↔loader routing divergence flagged in recon.)
3. bin/install-lib.cjs
   - detectModelCapabilities: GLM branch (pure fn, easy to unit test).
4. pan-wizard-core/bin/lib/provider.cjs   (NEW)
   - setProvider/showProvider/clearProvider; per-runtime writers (claude settings.json env,
     opencode.json provider); secret-safety; unsupported-runtime guard.
5. pan-wizard-core/bin/pan-tools.cjs
   - `provider` dispatch case → provider.cjs.
6. bin/install.js
   - `--provider`/`--zai` → provider provisioning after runtime install; teach E-9 warn about backend=zai.
7. pan-wizard-core/bin/lib/cost.cjs (+ hud/report consumers)
   - flat-fee branch when backend=zai.
8. commands/pan/provider.md   (NEW, runtime-agnostic)
9. pan-wizard-core/references/glm-provider.md   (NEW agent-loaded reference)
10. Docs: CLI-REFERENCE (provider cmd + routing.backend + config row), USER-GUIDE (config table),
    COMPARISON (GLM as the proven backend), FAQ (how do I run PAN on GLM?), README (qualitative).
```

### 3.5 Test plan (≥10; 3 happy / 3 edge / 2 error / 2 runtime-specific)

```
tests/provider.test.cjs (NEW)
  happy:   set glm on claude writes the 5 env keys (not the token); show reports backend+mapping; clear reverts.
  happy:   set glm on opencode writes @ai-sdk/anthropic provider + routing.provider=zhipu.
  resolve: resolveTierToModel('mid','zhipu') → glm-4.6; ('reasoning','zhipu') → 'inherit'; glm/zai alias == zhipu.
  caps:    detectModelCapabilities glm-5.2 / GLM-4.7 / glm-4.5-air → 1m/thinking true; unknown-glm-x graceful.
  edge:    settings.json already has an env block → merge, don't clobber; proto-pollution key rejected.
  edge:    ANTHROPIC_BASE_URL=z.ai host → detectProvider infers backend=zai; look-alike host NOT matched.
  edge:    cost with backend=zai → no $ fabricated (tokens + advisory) via ledgerReliability.
  error:   `provider set glm` on codex/gemini/copilot → unsupported message, zero writes.
  error:   `--persist-token` writes ONLY to .claude/settings.local.json (assert not settings.json, and gitignored).
  runtime: full matrix — claude ✅, opencode ✅, others guarded.
tests/scenarios/provider-install.test.cjs (NEW)
  `install.js --claude --zai` end-to-end → settings.json env present, token absent, install verifies.
```

---

## Phase 4: Specification Output

### Files to Create/Modify
- **New:** `pan-wizard-core/bin/lib/provider.cjs`, `commands/pan/provider.md`, `pan-wizard-core/references/glm-provider.md`, `tests/provider.test.cjs`, `tests/scenarios/provider-install.test.cjs`.
- **Modify:** `core.cjs`, `config.cjs`, `install-lib.cjs`, `install.js`, `pan-tools.cjs`, `cost.cjs` (+ hud/report consumers), `templates/config.json`; docs (CLI-REFERENCE, USER-GUIDE, COMPARISON, FAQ, README qualitative); CLAUDE.md counts refresh.

### Runtime Matrix
| Runtime | GLM Supported | Mechanism / Notes |
|---------|:---:|---|
| Claude Code | ✅ Full | `.claude/settings.json` `env`: base URL + `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`; host remaps PAN's tier tokens → GLM. Token via shell env. |
| OpenCode | ✅ Full | `opencode.json` custom `@ai-sdk/anthropic` provider (baseURL `…/anthropic/v1`); PAN emits real `glm-*` ids (`routing.provider=zhipu`). |
| Codex | ⚠️ Not a z.ai target | OpenAI-compatible override is technically possible but unsupported by z.ai; guarded no-op + message. |
| Gemini | ❌ | Google-native; no BYO Anthropic endpoint. |
| GitHub Copilot | ❌ | GitHub-managed models; no custom endpoint. |
| **ZCode** (new) | ⚠️ Deferred/partial | Agent-pack into `~/.zcode/agents/` + optional MCP only; no commands/hooks/config → not a full runtime yet. |

---

## Phase 5: Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Secret leakage** — z.ai token written to a committed `settings.json` | High | Never persist the token by default; non-secret env only; `--persist-token` writes solely to gitignored `settings.local.json`; test asserts token absent from tracked files. |
| Clobbering a user's existing `settings.json`/`opencode.json` | High | Deep-merge with proto-pollution guard; `provider clear` restores; snapshot the pre-write file. |
| GLM model ids drift (4.6 → 5.2 → …) | Medium | Single `GLM_MODELS` constant; `reasoning:'inherit'` defers top-tier choice to the host/plan; document that ids track the plan. |
| Base-URL string reaching a shell / taint barrier | Medium | Fixed allowlisted host constant + exact-host compare; no user string interpolated into any exec (reuse the report/hud opener discipline). |
| False cost data on flat-fee plan | Medium | `backend=zai` → flat-fee branch via `ledgerReliability()`; never emit a per-token `$`. |
| Users expect full ZCode support | Low | Spec + docs state the honest partial verdict and the blocking reason up front. |
| Regression for non-GLM users | Low | Entire path is opt-in behind `backend`/`--provider`; default resolution untouched; SC-11 guards it. |

---

## Recommendation

Ship **Surface A** in milestones: **M1** provider awareness (core.cjs + capability branch — GLM stops being mislabelled), **M2** provisioning (`provider.cjs` + `/pan:provider` + `--zai`), **M3** cost honesty + docs. Treat **ZCode** (Surface B) as a tracked, gated follow-up pending ZCode extensibility. Net: PAN's whole bot army runs on the 2026 value-leader backend with one command, and never lies about cost or capability.
