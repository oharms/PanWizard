# ADR-0053: Local executor offload — the executor hands the typing to a model on the user's own hardware

## Status

Proposed — 2026-11-13. Built on the maintainer's instruction to let PAN hand implementation work to a local model (Qwen served by Ollama) while the coding tool's own model keeps planning, review and verification. The maintainer accepts or amends it at release review. It narrows one line of `docs/specs/multi_model_routing_featureai.md`, which kept direct model calls out of scope: PAN still never calls the host's model, but it may now call a model the user serves locally, for one bounded job.

## Context

Most of a plan's tokens are spent by the executor writing code, running tests and fixing simple failures: well-specified, mechanical work. Teams that run a capable open-weight coding model on their own hardware (Qwen 3.6, Qwen3-Coder-Next on a Mac Studio or an RTX workstation) want that work to run there, for three reasons: it costs nothing per token, it keeps most of the code on their own machines (POPIA, GDPR, client contracts), and it leaves the paid model's limits for the design and review work it is best at.

PAN's model routing (`resolve-model`, tiers, `routing.provider`) cannot do this. It picks which of the HOST's models a subagent runs on, and only Claude Code acts on it; none of the five hosts can run a subagent on an arbitrary local endpoint. Pointing the whole host at a local model (`ANTHROPIC_BASE_URL` to Ollama) works, but then the local model also plans, checks and verifies, which is exactly the judgement PAN wants from the strongest model.

Community MCP bridges exist (`claude-code-delegate-local` and others). They need Python and a package manager, give the local model a general unsandboxed shell, and would make a zero-dependency npm package depend on a third-party server.

## Decision

1. **A `pan-tools delegate` verb, not a host feature.** `delegate status` reports whether offload is on and its model is served; `delegate run --spec F --allow a,b --verify CMD` runs the local model's tool loop for one task and prints a JSON report. Every runtime's executor can call it, as it calls every other verb. Zero dependencies: Node's own `fetch` and `child_process`.
2. **One API: OpenAI-compatible `/v1/chat/completions` with tool calls.** Ollama, LM Studio, llama.cpp's server, vLLM and LiteLLM all serve it, so one client covers a laptop and an office gateway.
3. **The local model gets five tools and no shell.** `list_files`, `read_file`, `write_file` (only the files the executor listed for this task), `run_verify` (the executor's command; the model cannot choose one) and `finish`. Paths are resolved through symlinks and confined to the project; `.git/`, the planning tree and files matching `commit.sensitive_patterns` are out of reach. This is tighter than the community bridges' unsandboxed `run_bash`, and it is enforced in code rather than by asking the model.
4. **On this machine unless the project says otherwise.** An endpoint that is not loopback is refused unless `local_executor.allow_remote` is true (an office server on the LAN). An API key is read from the environment variable `api_key_env` names, never from config.json, and is never printed.
5. **The report never rests on the model's claim.** After the loop, `delegate run` runs the verify command once more and reports that result; a model that says `done` while the tests fail is `failed_verify`.
6. **The executor stays the engineer of record.** `pan-executor` checks `delegate status` once. When ready, it writes a spec per `type="auto"` task, runs `delegate run`, reviews the diff, runs the verification itself and commits with a `PAN-Delegated: <model>` trailer after `PAN-Step`. Failed rounds get fix notes and a re-run; after `local_executor.max_rounds` the executor does the task itself and records a deviation. Checkpoints, TDD RED steps and tasks touching authentication, payments, cryptography, secrets or security fixes are never handed off. An endpoint error makes the executor finish the plan itself.
7. **One command to set it up, for the computer by default** (*amended 2026-11-13*). `/pan:local` runs `delegate setup`: it asks the server which models it serves, ranks them (coding-tuned first, then the larger configured context window, then the larger model; aliases of one model folded together), asks which model and where, and turns offload on. Which model a computer serves is a property of the computer, so the default scope is `~/.pan-wizard/local-executor.json`, read under the project's own `local_executor` section; a file outside `.planning/` also survives `/pan:new-project` writing a fresh config.json. A project section wins, so one confidential repository can switch offload off. The status line shows `⌂ <model>` while it is on.
8. **No thinking by default, and no transport ceiling** (*amended 2026-11-13, from the live proof run*). The loop sends `reasoning_effort: none` unless `local_executor.reasoning` says otherwise: Qwen 3.6 otherwise wrote about fourteen times more tokens per turn, and single turns passed five minutes. Each reply is bounded by `max_output_tokens`. Chat requests use Node's `http`, because the global `fetch` drops a response whose headers take more than 300 s, which a non-streaming completion always is when it is long.
9. **Measured attribution, not a claim** (*amended 2026-11-13*). Every `delegate run` saves `.planning/delegations/<run_id>.json` (each reply's id and hash, each write's path and SHA-256, the final content of every file the model wrote) and the raw replies in `<run_id>.transcript.jsonl`; the model cannot write there. `delegate attribute --staged | --ref` matches the lines a commit adds against those records and prints the `PAN-Delegated` trailer with the count (`42/45 added lines from the local model`), which the executor commits verbatim. Before this, the trailer was the executor's own judgement, and a proof run could not tell which lines the local model wrote.
10. **Off by default.** `config-ensure-section` writes the section with `enabled: false`. A project that never enables it sees no change: `delegate status` answers `ready: false` and the executor implements every task as before.

## Consequences

**Positive.**
- The token-heavy part of execution can run at no per-token cost, and with the default settings the task, the files read and everything written stay on the machine.
- Planning, plan checks, review and verification keep the host's strongest model; the local model is checked by the same gates as any executor output, plus the executor's own review.
- Works the same in all five runtimes, with no MCP server, no Python and no new dependency.
- The record is in the repository: the spec beside the plan, the commit trailer, and the summary's offload line.

**Negative.**
- The executor still reads the plan, writes specs and reviews diffs, so offload reduces the host model's spend rather than removing it.
- A weaker local model costs fix rounds; with a poor model, offload can be slower than doing the task directly. `max_rounds` bounds the loss.
- The local model cannot run arbitrary commands (installing a package, running a generator); such tasks come back `blocked` or `incomplete` and the executor does them.
- The verify command runs through the shell. It is the executor's own choice, as when the executor runs it directly, but it means `delegate run` executes what the executor passes.

## Alternatives considered

- **Point the host at the local model (`ANTHROPIC_BASE_URL`).** Fully local, but the local model then also plans and judges. Documented for private repositories outside PAN, not adopted as the PAN mode.
- **A PAN MCP tool.** The MCP bridge's handler path is synchronous and a tool loop runs for minutes; a verb keeps the bridge unchanged and reaches the runtimes without MCP.
- **Adopt a community bridge.** Python and a package manager as prerequisites, an unsandboxed shell for the local model, and a third-party dependency in a zero-dependency package.
- **Give the local model a shell inside an OS sandbox.** macOS `sandbox-exec` is deprecated and there is no equivalent on all three platforms PAN supports; the five-tool surface gives the same safety on every platform.
