---
topic: secret-handling
last_updated: 2026-05-03T06:32:54.332Z
patterns:
  - id: P-SEC-001
    summary: Treat secrets as a typed boundary, not a string — redact at the logger, deny-list at the committer, never round-trip through prose-serialized state
    promoted_at: 2026-05-03T06:32:54.332Z
    source_experiments: [external]
---

# Secret Handling (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-SEC-001 — Treat secrets as a typed boundary, not a string — redact at the logger, deny-list at the committer, never round-trip through prose-serialized state

**Evidence:** External research synthesis: OWASP Top-10 A02 (Cryptographic Failures), GitGuardian / TruffleHog state-of-secrets reports (2025: ~24M leaked credentials/year, half from logs and CI artifacts), Google Cloud Secret Manager design notes, the post-mortems of Stripe-key-in-stripe.com-Sentry incident (2017) and Uber GitHub key leak (2016). PAN-relevant baseline: PAN ships harvest.json that captures process output verbatim; pan-tools commit warns about .env (string match) but no agent codifies the rule. Internal observation: the recent notepadrs experiment harvested optimization traces (~100s of agent IO events) directly into the source repo without a redaction pass — fine for this experiment, dangerous as a general pattern as experiments grow to authenticated workflows.

**Rule:** Secrets must be three things at once: (1) a TYPED VALUE, not a string — wrap as Secret<T> / SecretString / opaque struct so toString() returns '[REDACTED]' and Display/Debug/JSON-serialize all respect the type. (2) DENY-LISTED at the persistence boundary — committer/publisher/uploader runs a regex sweep for known secret SHAPES (AWS AKIA, ghp_, sk-, JWT 3-part base64, PEM blocks, generic high-entropy 32+ char strings) AND a path deny-list (.env, *.pem, *.p12, credentials.json, config.local.*). Match → block, not warn. (3) NEVER ROUND-TRIPPED THROUGH PROSE STATE — agent traces, summary.md, harvest.json, plan.md must scrub secret-shaped tokens before write. Read-time scrubbing is not enough; an attacker who steals the file before scrubbing has the secret. Final rule: if a value is a secret, it goes through ONE pipe (env var → in-memory typed wrapper → consumer) and NEVER lands on disk under a path the committer can reach.

**Applies in:** any tool that captures process output (loggers, harvest, trace captures, AI agent transcripts), any tool that writes commits or publishes artifacts (git committers, npm/cargo publish, CI artifact uploaders), any framework that serializes state to disk (orchestrators, schedulers, replay buffers), any external integration handler
