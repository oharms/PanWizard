---
name: pan:feedback
group: System
description: Print a privacy-safe report of what PAN learned on this project, to paste into a GitHub issue for the PAN developers (nothing is sent)
argument-hint: "[--note \"<your words>\"] [--tool-errors] [--days <N>] [--format json]"
allowed-tools:
  - Bash
---
<objective>
Show the user a report of what PAN learned on this project: which phase-gate checks refuse, what the judges found and which findings the user dismissed as noise, test and cost outcomes, which commands were started and never finished. The user reads it and may paste it into a GitHub issue for the PAN developers. Nothing is sent anywhere.

The engine builds the report from counts, codes and PAN's own command and agent names only, and scans it before printing. It never contains code, file contents, file names, paths, plan or finding text, prompts, phase names, project or branch names, git identities, credentials or e-mail addresses.
</objective>

<process>
1. Run the engine with the flags the user gave (`--tool-errors`, `--days <N>`, `--format json`). If they gave a note, pass it after `--note` in single quotes, writing each `'` inside it as `'\''`, so the shell reads none of it: never in double quotes or backticks.

   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs feedback --tool-errors --note 'the review step didn'\''t finish'
   ```

2. **Exit 0:** show the output to the user **verbatim**, in full, as one block. Do not summarise it, reword it, translate it, add anything to it, or remove anything from it, and do not quote anything from the project next to it. The report is only safe because code built it; a paraphrase could carry project details into it.

   Then tell the user, in two or three sentences:
   - it was built on their machine and nothing was sent;
   - to share it, they can paste it into a new issue using the link at the end of the report, or run `gh issue create --repo oharms/PanWizard --template feedback.md` themselves;
   - they can add their own words with `--note "…"`, which is checked the same way, and include tool-error signatures with `--tool-errors`.

   Do not open the link, run `gh`, or send the report anywhere yourself.

3. **Exit 1 with `"error": "not_a_pan_project"`:** say there is no `.planning/` here, so there is nothing to report.

4. **Exit 1 with `"error": "feedback_refused"`:** the privacy scan matched something, so nothing was printed. Show the `reason` and the `rules` list (rule names only). If the reason mentions `--note`, ask the user to rephrase their note without the flagged detail. Otherwise this is a PAN bug: suggest reporting the rule names, and only the rule names, at https://github.com/oharms/PanWizard/issues. Never try to work around a refusal, and never print the project data the rule matched.
</process>
