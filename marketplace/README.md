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
  Claude Code version does not support"*; on older versions the whole marketplace
  fails to load. Check with `claude --version`.
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
