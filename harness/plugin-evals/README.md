# PAN plugin evals

The eval suite `scripts/build-plugin.js` copies into the Claude plugin as `evals/`
(market-ideas queue M4). `claude plugin eval` (Claude Code 2.1.269 or later) runs
each case against the built plugin and, by default, against a no-plugin baseline,
and reports the score difference the plugin makes.

Every grader here is a mechanical one — `tool_used`, `regex`, `file_exists` — so
scoring costs nothing beyond the runs themselves, and a score does not move with a
judge model's mood. The format is Claude Code's (`<case>/prompt.md` plus
`<case>/graders/*.md`); see its "Test plugins with evals" documentation.

| Case | What it measures | Tools it needs beyond the read-only set |
|------|------------------|------------------------------------------|
| `help-discovery` | Asked about PAN's commands, Claude reaches for the plugin's own help, and the answer names the core lifecycle commands | none |
| `progress-routing` | Asked where an empty project stands, Claude runs the progress command and routes to `new-project` | `Bash` |
| `todo-capture` | Asked to save a todo, Claude runs the todo command and a todo file lands in `.planning/todos/pending/` | `Write`, `Bash` |
| `plugin-selftest` | The plugin contract the harness's `plugin-agent-scope` scenario checks: the plugin-root placeholder verdict, and that plugin agents load under the scoped `pan-wizard:` name the native workflow scripts spawn | `Bash` |

A `tool_used: Skill` grader only counts in the with-plugin arm (Claude Code scores it
as an indicator there), so `Δ` comes from the result graders.

## Run it

```bash
npm run build:plugin
claude plugin eval dist/pan-wizard-plugin --trust-plugin --allow-tools Bash Write --no-publish
```

- `--runs 1 --ablation none` is the cheap smoke form: one run per case, no baseline.
- `--max-cost-usd <n>` caps the spend; the runs are paid model calls on your account.
- On Windows Claude Code refuses a case granted a shell tool (no sandbox there), so run the `Bash`/`Write` cases on Linux or macOS.
- Results go to `dist/pan-wizard-plugin/evals/results/`, which the next build wipes.

Edit the cases here, never under `dist/`: the build replaces that directory.
