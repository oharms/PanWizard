# PAN local plugin marketplace

A `command`-source marketplace that installs PAN as a Claude Code plugin **built
from this checkout on demand**. No hosting, no publishing, no registry.

It exists to answer the one question that has kept `dist/pan-wizard-plugin/`
unpublished: **does `${CLAUDE_PLUGIN_ROOT}` expand inside command *markdown*?**
It is documented as substituted in hook and MCP *configs*; content is unverified.
Everything else about the plugin is already tested — this is the gap.

## Requirements

- **Claude Code v2.1.229 or later.** Command sources were added there. On
  v2.1.120–v2.1.228 the install fails with *"This plugin uses a source type your
  Claude Code version does not support. Update Claude Code and try again."*; on
  older versions the whole marketplace fails to load.

  > ⚠️ **Checked 2026-08-14: `claude --version` reported `2.1.170` on this machine,
  > which is inside the failing range.** The marketplace will load (that needs only
  > v2.1.120) and `/plugin install` will refuse with the message above. **Update
  > Claude Code before running the test**, then re-check with `claude --version`.
  > Nothing else in this directory is blocked by the version — the automated tests
  > cover the contract independently of the running CLI.
- Not blocked by org policy. An administrator can disable command sources with
  `disableCommandPluginSources`, and setting `allowManagedHooksOnly` blocks them
  by default.

## Run the test

From **any directory that is not inside `dist/pan-wizard-plugin/`** — Claude Code
refuses a printed path that is the session's own directory or one of its parents:

```
/plugin marketplace add D:/PanWizard/marketplace
/plugin install pan-wizard@pan-wizard-local
```

Claude Code shows the exact command string before running it and records your
acceptance. If the install summary says `Run /reload-plugins to activate.`, do that.

Then:

```
/pan-plugin-selftest
```

It reports three probes and ends with a line like `VERDICT: case A`.

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

Record the answer in `docs/ECOSYSTEM-REVIEW-2026-08.md` §7 and in
`scripts/build-plugin.js`'s header, which currently states the question as open.

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
