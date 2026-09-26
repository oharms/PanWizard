# PAN local plugin marketplace

A `command`-source marketplace that installs PAN as a Claude Code plugin **built
from this checkout on demand**. No hosting, no publishing, no registry.

It exists to answer the one question that has kept `dist/pan-wizard-plugin/`
unpublished: **does `${CLAUDE_PLUGIN_ROOT}` expand inside command *markdown*?**
It is documented as substituted in hook and MCP *configs*; for content, the measurement below (case A, 2026-08-14) says it is.
Everything else about the plugin is already tested — this is the gap.

## Requirements

- **Claude Code v2.1.229 or later.** Command sources were added there. On
  v2.1.120–v2.1.228 the install fails with *"This plugin uses a source type your
  Claude Code version does not support. Update Claude Code and try again."*; on
  older versions the whole marketplace fails to load.
- Not blocked by org policy. An administrator can disable command sources with
  `disableCommandPluginSources`, and setting `allowManagedHooksOnly` blocks them
  by default.

## Run the test

From **any directory that is not inside `dist/pan-wizard-plugin/`** — Claude Code
refuses a printed path that is the session's own directory or one of its parents:

```text
/plugin marketplace add D:/PanWizard/marketplace
/plugin install pan-wizard@pan-wizard-local
```

Claude Code shows the exact command string before running it and records your
acceptance. If the install summary says `Run /reload-plugins to activate.`, do that.

Then:

```text
/pan-plugin-selftest
```

It reports four probes and ends with a line like `VERDICT: case A`. The command is plugin-only: `scripts/build-plugin.js` writes it from `buildPluginSelfTestCommand()` in `bin/install-lib.cjs`; there is no `commands/pan/` file for it. Probe 4 was
added in 2026-09 and answers a separate question: whether the plugin's agents
load under the scoped `pan-wizard:pan-…` name that its bundled `workflows/`
scripts spawn — reported on its own line as `AGENT_SCOPE: scoped` or
`AGENT_SCOPE: bare`.

## Result — measured 2026-08-14

**`VERDICT: case A`** on Claude Code **2.1.233**, Windows.

| probe | result |
|---|---|
| 1 — markdown substitution | a real absolute path into the plugin cache; **no placeholder text survived** |
| 2 — env var | **(empty)** |
| 3 — engine through the placeholder | ok — pan-tools ran and printed its usage banner, exit 0 |

So plugin content **may** reference the plugin root directly, PAN's existing
content rewrite is correct as it stands, and **marketplace publishing is
unblocked**.

> **The sharpest finding is probe 2, and it corrects this document's own case-B
> description below.** That text claimed a *shell* command inside content would
> still work under case B "because the shell expands the variable". It would not:
> `CLAUDE_PLUGIN_ROOT` is **not** exported into the Bash tool's environment, so a
> shell evaluating `$CLAUDE_PLUGIN_ROOT` at runtime gets an empty string. The two
> mechanisms are **not interchangeable**. Generated content must keep using the
> textually-substituted form. Had the verdict been case B, it would in practice
> have behaved like case C.
>
> This is one measurement, on one version, on one platform. Re-run the probe
> before relying on it after a Claude Code upgrade.

**Bonus result from the same install:** the plugin's `.mcp.json` works. The bridge
registered as `pan` and answered a real `tools/call` through the plugin path —
confirming the MCP declaration end to end, not just its presence in the bundle.

## Reading the verdict

The probe deliberately separates **textual substitution in markdown** from **the
environment variable being set**, because a test that only ran a shell command
through the placeholder would pass whenever the variable is exported and prove
nothing about markdown.

| Verdict | Meaning | What it unblocks |
|---|---|---|
| **case A** | Markdown *is* substituted | Content may address the plugin root directly. PAN's existing content rewrite is correct as-is, and marketplace publishing is unblocked |
| **case B** | Not substituted, but the env var is set | A *shell* command inside content still works, because the shell expands it. Anything resolved as a path by something that is not a shell — an `@` file import, notably — breaks. PAN's content rewrite would need narrowing to shell invocations only |
| **case C** | Neither | Content cannot address the plugin root at all. PAN would need runtime path resolution, and publishing stays gated |

The answer is recorded in `docs/ECOSYSTEM-REVIEW-2026-08.md` §7 and in the header of
`scripts/build-plugin.js` (case A — the placeholder expands).

## Notes

- `mode` is `"copy"`, not `"link"`. **Link mode is unsupported on Windows** and
  Claude Code refuses a link-mode plugin there. Do not "optimise" this to link;
  a test pins it.
- The command rebuilds the plugin on every run, and Claude Code re-runs it once
  per session in the background — so source edits are picked up without
  reinstalling. In copy mode the version is a hash of the directory contents, so
  an unchanged build counts as up to date.
- `scripts/plugin-path.js` must print **exactly one line** on stdout. It relays
  the builder's chatty output to stderr for that reason; a stray `console.log`
  there breaks the install.
- This directory is not shipped: it is absent from `package.json` `files`.

## Dev loop without a marketplace

For iterating on the plugin itself you do not need this marketplace at all.
Claude Code loads a plugin directory straight from the command line:

```bash
npm run build:plugin
claude --plugin-dir D:/PanWizard/dist/pan-wizard-plugin
```

Since Claude Code v2.1.265 the flag also accepts a **folder of plugins**, where
each child directory loads as its own plugin — handy for testing PAN next to
another plugin that shares an agent or hook event. Adding or removing a child
while the session runs applies immediately unless the change would force a full
prompt-cache re-read, in which case Claude Code holds it and asks for
`/reload-plugins`.

The marketplace above remains the path that exercises the `command` source, the
placeholder-expansion probe, and install/uninstall — `--plugin-dir` skips all
three, so it is a faster loop, not a substitute for the test.

## Plugin evals

The built plugin carries an eval suite in `evals/` for `claude plugin eval`
(Claude Code 2.1.269 or later): help discovery, progress routing, todo capture and
the self-test above, all scored by mechanical graders. The cases live in
`harness/plugin-evals/` and the builder copies them in; that directory's README
lists each case and the tools it needs.

```bash
npm run build:plugin
claude plugin eval dist/pan-wizard-plugin --trust-plugin --runs 1 --ablation none --no-publish
```

The runs are paid model calls on your account; add `--max-cost-usd <n>` to cap
them. On Windows, Claude Code refuses to start a case that is granted a shell tool
(`--allow-tools Bash`), because it cannot sandbox one there; the cases that need
`Bash` or `Write` run fully on Linux or macOS with `--allow-tools Bash Write`.

## Other hosts: the Agent Plugins bundle

Claude Code is the only runtime that reads this directory's `command`-source
marketplace. For Copilot CLI, Codex, Cursor and Kiro the equivalent is the
**Agent Plugins 1.0** bundle (ADR-0045):

> **Build before you install from the Codex or Copilot marketplaces.** Both `.agents/plugins/marketplace.json` and `.github/plugin/marketplace.json` resolve to `./dist/pan-agent-plugin`, and unlike the Claude `command` source nothing rebuilds it on resolve — a stale bundle installs silently. Run `npm run build:agent-plugin` first; the release gate (`node scripts/release-check.js`, Gate 8) refuses to pass while `dist/pan-agent-plugin` differs from a fresh build.

```bash
npm run build:agent-plugin        # → dist/pan-agent-plugin/
```

Two marketplace files in the repository (`.agents/plugins/` and `.github/plugin/`) point at that build:

- `.agents/plugins/marketplace.json` — Codex reads it automatically inside this
  repository (repo-scoped marketplace). Open Codex here, run `/plugins`, install
  `pan-wizard`, start a new session.
- `.github/plugin/marketplace.json` — Copilot: `copilot plugin marketplace add`
  with this repository, then install `pan-wizard` from the plugin browser.

Both reference the build output, so build first. What has run live so far: the
bundle installs on Copilot CLI from a local path (harness `live-gate-copilot`),
and Codex CLI 0.157.1 accepts this repository as a marketplace and lists it as
`pan-wizard-local` (harness `live-gate-codex`, 2026-09-26). Installing the plugin
inside a Codex session, and anything on Antigravity (no CLI on the machine that
built them), has not — so treat the vendor directories as conformance-tested, not
field-verified, beyond those two gates.
