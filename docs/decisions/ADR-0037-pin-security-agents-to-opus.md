# ADR-0037: Pin Security-Review Agents to Opus (Fable Cyber-Classifier Exception)

## Status

Accepted — 2026-07-02. Implemented in v3.12.6. A deliberate, narrow exception to the `reasoning: inherit` rule (model-profiles.md, ADR-0023): three security agents and one command path are pinned off the host model to a specific model. Claude Code only.

## Context

PAN's model routing is **inherit-only** for the reasoning tier: `PROVIDER_MODELS.anthropic.reasoning = 'inherit'` (core.cjs) means PAN never hardcodes a top model — reasoning-tier agents run on whichever top model the host runtime has selected. This is deliberate: provider-agnostic, no version pinning, no silent fallbacks. v3.12.5 then made **Claude Fable 5** PAN's recommended flagship, so selecting Fable routes every reasoning-tier agent to it.

Fable has one behavior no other current Claude model shares: it runs **input safety classifiers** targeting cybersecurity and biology content, and Anthropic's own guidance says benign *defensive* security tooling can trigger **false positives** — a successful `HTTP 200` with `stop_reason: "refusal"` and `stop_details.category: "cyber"`.

PAN is security tooling. Its security-review surface — `pan-hardener` (OWASP Top 10 + STRIDE), `pan-reviewer`, `pan-meta-reviewer`, and the `focus-auto`/army **`security`** category — exists to find injection, auth bypass, RCE, and crypto failures. It cannot do that job without naming those things.

**We tried prompt-wording tuning twice and it failed twice in a real project (the lending project):**
- v3.12.5 reframed the security agents as *authorized, defensive review* and softened offensive language.
- The same release reworded `focus-auto.md`'s security category (removing an explicit "the exploit path is: attacker does X → Y → compromised" narration).

Both shipped; Fable still refused the `focus-auto` security category. **Root cause:** a security scanner is classifier-adjacent *by definition* — you cannot word-launder "SQL injection" or "authentication bypass" out of a security review. Wording has a hard floor, and we hit it.

## Decision

**1. Pin the three security-review subagents to Opus.** `pan-hardener`, `pan-reviewer`, and `pan-meta-reviewer` carry `model: opus` in their frontmatter. On Claude Code, a subagent's `model` overrides the session model, so they run on Opus 4.8 regardless of what the user selected — never reaching Fable's classifier. This fixes `/pan:review-deep` and `exec-phase --deep-review` deterministically.

**2. Route the `focus-auto` security category's assessment through the pinned hardener.** The autonomous loop's main thread runs on the *session* model (possibly Fable) and cannot be frontmatter-pinned. So `focus-auto.md`'s security category now delegates the classifier-triggering work — the Pass-3 semantic analysis and each item's risk statement — to the Opus-pinned `pan-hardener` subagent. The main loop keeps only the pattern-matching grep triage (Passes 1–2, no exploit reasoning) and the fix implementation (parameterized queries, bcrypt, etc.), neither of which trips the classifier.

**3. The pin is Claude-Code-only.** The installer strips `model:` from the Gemini and OpenCode agent frontmatter (OpenCode's own `model` field expects a `provider/model` id and would choke on `opus`); the Codex and Copilot converters drop it by construction (they emit only `name`/`description`/`effort`/`tools`). On the other four runtimes, run security work on a non-Fable model — documented in `references/model-profiles.md`.

**4. Keep the defensive framing as a backstop, not the fix.** The v3.12.5/v3.12.6 wording (authorized-defensive framing, no attack-path narration) stays — it lowers the trigger rate on runtimes where the pin doesn't apply — but the Opus pin is the reliable mechanism.

## Alternatives considered

- **Keep tuning wording (status quo).** Rejected: failed twice; a security scanner cannot avoid classifier vocabulary. Whack-a-mole with no endpoint.
- **Add a provider-agnostic PAN tier meaning "Opus, not the host model."** Rejected for now: the tier system only expresses `reasoning|mid|fast`, and `reasoning = inherit = host`. Adding an "explicit non-host model" concept touches the routing engine, `MODEL_PROFILES`, config schema, and cost estimation. The frontmatter pin achieves the same result on Claude Code with zero engine change. Revisit only if a non-Claude runtime needs the same guarantee.
- **Stop recommending Fable as the default.** Rejected: the user wants Fable as the flagship (v3.12.5). This ADR makes Fable-default *safe* instead of walking it back.
- **Route every agent off Fable.** Rejected: only security content trips the classifier, and Fable is genuinely the strongest reasoning model for planning/execution. Pinning the whole fleet would forfeit that and roughly double cost for no benefit.

## Consequences

- **Security review is deterministically classifier-safe on Fable sessions** (Claude Code) — the block that recurred in the lending project is closed at the mechanism level, not the vocabulary level.
- **First hardcoded model in a shipped agent.** A documented, narrow exception to inherit-only, contained to three agents plus one command path. The `reasoning: inherit` default is otherwise unchanged.
- **Claude-Code-only.** Other runtimes need a non-Fable session for security work (documented). Acceptable — the pin mechanism (subagent `model:`) is a Claude Code feature.
- **Minor cost/latency.** The security agents always run on Opus (they are read-only and correctness-sensitive, so this is desirable), and `focus-auto` adds a hardener spawn for the security assessment. Bounded and only on the security path.
- **Tested.** The two converter strips and the three agent pins are asserted in `tests/installer-functions.test.cjs`.
- **Trade-off:** `model: opus` is an alias — it pins to the *current* Opus, not a fixed version. Accepted: the goal is "anything but Fable's classifier," and the alias tracking the current Opus is exactly right.

## References

- Trigger and root-cause: the lending project refusals (2026-07-02); Anthropic model reference on Fable's `refusal` / `cyber` classifier.
- Related: ADR-0023 (Opus adoption / inherit rule), ADR-0032 (squad model — Quality squad owns these agents), v3.12.5 (Fable flagship recommendation + defensive framing).
- Touch points: `agents/{pan-hardener,pan-reviewer,pan-meta-reviewer}.md`; `commands/pan/focus-auto.md` (security category); `bin/install-lib.cjs` (`convertClaudeToGeminiAgent`, `convertClaudeToOpencodeFrontmatter`); `pan-wizard-core/references/model-profiles.md`.
