# Stability Test — Deployed Install, 2026-08

**Point-in-time document.** Everything below describes source `D:\PanWizard` on branch
`fix/e2e-audit-highs-2026-08` at commit `2be1000` (`package.json` version 3.23.0), tested against
real installs under `d:\pantesting\stab-*` on Windows 11 / Node 24. The repo moves; a finding
marked open here may already be closed. Re-verify before quoting this document as current.

A concurrent session committed to the source repo during the test window (HEAD advanced
`05e8f5b` → `2be1000`, plus untracked `docs/specs/panloop-self-optimization.md` and `tools/`).
Every code-level finding below was re-read against `2be1000` after the fact, including by the
author of this document, so the results are not stale relative to that move.

---

## 0. Resolution (2026-08-06, after this report)

**Every Critical and High in this report is fixed and re-verified in a deployed install.** The
verdict in §1 below is preserved as written — it was correct at the time and the reasoning is worth
keeping — but it is no longer the current state.

Fixed, each with a regression test that fails against the pre-fix code (`ee2338b`, `caf3c91`,
`cfe9735`, `3a63163`):

| Was | Now |
|---|---|
| Installer destroyed an unparseable `settings.json` | `readSettings` distinguishes "absent" from "unusable"; the file survives byte-identical, warned, install continues |
| `verify reconcile` was a dead gate — the parser demanded 4-space indent, every shipped surface emits 2 | Parser derives indent from the document; a rubber-stamped pass over a stub exits 1, an honest pass exits 0 |
| `phase remove 0` corrupted the roadmap; a large negative hung for hours | Both rejected in ~200ms before anything is touched; the renumber loop also has its own floor |
| `pan-tools commit` staged a sensitive file then blocked, leaving the secret in the index and wedging all later commits | PAN's own additions are unstaged on refusal; the user's pre-staged files are left alone |

Re-verified against a fresh 5-runtime install (`d:\pantesting\reverify`): install exits 0 with no
errors and no `learnings/internal` leak; all five runtimes carry their full command surface in their
native layout; a `//`-commented `settings.json` survives an upgrade with a warning; the reconcile
gate refuses a stub and passes an honest artifact; all four Codex hooks exit 0 in a `"type":
"module"` project with the `commonjs` marker present; `bus drain --mode consume --limit 2` leaves the
unread remainder intact; `phase remove 0` and `-1234567890` both exit 1 promptly with the roadmap
untouched; a blocked commit leaves the secret out of the index while preserving what the user had
staged; all five Claude hooks exit 0; and the real home is untouched.

**Still open: the Medium and Low tail in §3** — the OpenCode global permission glob (the second item
§1 called release-blocking, a permanent-residue defect), `focus scan` finding no work items on PAN's
own roadmap template, the `learn` commands resolving their store from cwd, cost understating by
roughly a third, and `preview`/`phase add` dropping checklist-format phases. None of these destroys
data or silently disarms a gate, which is what separated the blockers from the rest.

**One finding here is worth carrying forward as a method, not just a fix.** The reconcile gate had
been verified as working by five rounds of adversarial audit — against fixtures the auditors wrote
by hand at 4-space indent. It had never once been run against a plan in the format PAN itself
emits. Its regression test now parses the shipped template file rather than a literal, so the
emitted format and the parser cannot drift apart again without failing. Prefer a test that reads
PAN's own output over one that restates what you believe the format to be.

---

## 1. Verdict (as written on 2026-08-06, before the fixes above)

**No — do not publish this as-is. Yes — publish after two fixes, both small and both localized.**

One defect is release-blocking: **the installer silently destroys a `settings.json` it cannot
parse as strict JSON** — no warning, no backup, exit 0, success ticks printed the whole way. A
second is a permanent-residue defect: **the global OpenCode permission grant points at a directory
that does not exist, and the uninstaller can never remove it** — this machine is already carrying
that residue from an earlier cycle.

Everything else found in the deployed test is Medium or below, and — this is the part that should
matter to a maintainer who has been reading audit reports for weeks — **nothing in the core
lifecycle broke.** Install, verify, upgrade, self-repair, uninstall, and user-config preservation
all held up under deliberate abuse. The command layer took hundreds of hostile invocations without
a single stack trace.

**What would change the verdict to "publish":**

1. `readSettings()` stops swallowing parse errors and stops returning `{}` for a file that exists
   (fix at `bin/install.js:257`, with a plain-object type guard). The correct pattern already lives
   in the same file for `opencode.json` — copy it upward.
2. The OpenCode permission path stops disagreeing with itself (`bin/install.js:1538-1540`), gets
   `--config-dir` threaded in, and the uninstall key filter (`bin/install.js:1397`) widens so
   machines already carrying `pan-wizard/*` get cleaned on the next uninstall.
3. A regression test that a `settings.json` containing a `//` comment survives an install
   byte-identical. Without a test this class comes back — see §5.

**What would change the verdict to "don't publish, keep digging":** findings from the three test
areas whose reports did not reach this document (see the coverage caveat immediately below). If
hooks, hostile-input, or regression testing surfaced anything of Critical or High severity, this
verdict is void and must be rewritten.

### Coverage caveat — read this before trusting the verdict

Six test areas ran. **Three area reports reached this document in full or in part; three did not.**

| Area | Sandbox | Report received | Verdict as reported |
|---|---|---|---|
| 1 — Install / upgrade / uninstall, 5 runtimes, local + global | `stab-install` | Full | FAIL |
| 2 — Global install + scope detection | `stab-global` | Full | FAIL |
| 3 — CLI functional sweep against a deployed install | `stab-cli` | **Evidence only; failure list truncated** | FAIL |
| 4 — Hooks | `stab-hooks` | **Not received** | unknown |
| 5 — Hostile input | `stab-hostile` | **Not received** | unknown |
| 6 — Regression | `stab-regress` | **Not received** | unknown |

The three sandboxes exist on disk, so those areas did run. Their findings are simply not in front
of me, and I will not invent them. **Area 3 is the sharper gap:** its verdict is FAIL, but the
portion of its report I received contains no failures — only its evidence, which is uniformly
strong. Its FAIL therefore rests entirely on findings I cannot see. Fold those four reports in
before treating §1 as final.

### Where a reported verdict looks unsupported by its own evidence

- **Area 2 (`FAIL`) is overstated.** Its highest-severity finding is Medium. Its evidence shows the
  primary paths passing: global install across all five runtimes clean, scope detection correct on
  the canonical path in every runtime × mode combination tested, the capability-warning matrix
  correct in every case including the future-model cases that must *not* warn, and a global
  uninstall that left one residual file. Every failure it reports lives on the `--config-dir` side
  road or in the OpenCode permission glob. On a consistent severity ladder that is
  `PASS_WITH_NOTES`, not `FAIL`. Read as FAIL it inflates the apparent instability of the release.
- **Area 2 and Area 1 double-count one defect.** The OpenCode `pan-wizard/*` glob is a single bug;
  Area 1 rated it High (it also caught the un-removable-residue half), Area 2 rated it Medium.
  It is counted once below, as High.
- **Area 3's `FAIL` cannot be evaluated** for the reason given above. Its evidence, as received,
  reports zero stack traces across every fault class it tried.
- **Area 1's `FAIL` is supported** — an independently reproduced silent-data-loss defect justifies
  it without argument.

---

## 2. What was actually exercised

Concrete, so you can judge the coverage rather than take a number on faith.

**Isolation.** Every install ran with `HOME` and `USERPROFILE` redirected into a sandbox fake home,
verified *before* the first global run via `node -e "require('os').homedir()"`. `D:\PanWizard` was
never the installer's cwd and was only ever read. Final real-home audit after all runs:
`~/.claude/settings.json` md5 unchanged from baseline, `~/.agents/skills` still empty, `~/.codex`
still absent, no `pan-*` anywhere under `~/.copilot`, `~/.gemini`, or `~/.config/opencode`. The
only real-home deltas were Claude Code's own session churn. The earlier home-pollution incident
(a full skills tree written into the real home) did not recur.

**Installs.** Fresh install of all five runtimes locally; the same command re-run over itself
(upgrade path); all five globally; `--all --local`; `--config-dir` with absolute, `./`-prefixed,
and bare-relative values; uninstall per-runtime and all-at-once; uninstall with the manifest
deliberately deleted; uninstall of an already-clean runtime. Host projects included a CJS repo, an
ESM repo (`"type": "module"`), a path containing spaces, a repo with a pre-existing `AGENTS.md` +
`CLAUDE.md` + a user's own statusline, a non-PAN repo, and an empty directory.

**Integrity, both directions.** Every entry in every runtime manifest re-hashed with SHA-256:
zero missing, zero mismatches, on the fresh install, after upgrade, and from the spaces path.
Reverse sweep — every file on disk reconciled against the manifest — accounted for all untracked
files as merge/config files the installer intentionally leaves user-editable. Deleting a core
module and a command file, then reinstalling, restored both (self-repair works). Planted legacy
artifacts in the pre-rename locations were swept.

**Content and path rewriting.** For each runtime: its command surface, agent surface, skill surface,
and the shared core (workflows, templates, references) present; every skill carries frontmatter with
`name` and `description`. Every embedded `pan-tools.cjs` reference extracted per runtime and checked
to point only at that runtime's own directory — zero `~/.claude` leaks into non-Claude runtimes. Two
genuine rewrite misses were found this way and are listed below. (Counts of commands/agents/modules
are deliberately absent from this document; enumerate with `ls commands/pan/*.md`, `ls agents/*.md`,
`ls pan-wizard-core/bin/lib/*.cjs`.)

**Hooks, actually fired.** Every registered hook command across all six hook config files was
executed exactly as registered, with realistic stdin payloads (`SessionStart`, `PostToolUse` with
tool name/input/response, `SubagentStop` with usage + agent type + a real two-line
`transcript.jsonl`). All exited 0. Side effects verified, not assumed: a v3 token record landed in
`.planning/metrics/tokens.jsonl` with `token_source: "transcript"`, and a trace session directory
was created. Re-run under an ESM host — still 0, because each runtime dir ships its own
`package.json` CommonJS shield. Global hooks (absolute quoted paths) run from a non-PAN repo exited
0 and correctly created no `.planning/`.

**Upgrade safety.** File list before and after a re-install: identical. Hook arrays not duplicated.
Local modifications planted across all runtimes were detected, reported, and backed up to
`pan-local-patches/` with correct `backup-meta.json`, originals restored pristine — with one
exception, listed below.

**Uninstall safety.** User keys planted in four config files and three user-owned files before
uninstalling: all survived. Claude kept `permissions.allow`/`deny`, `env`, `model`, and the user's
own `PreToolUse` hook while PAN's own entries and statusline were removed. Gemini kept theme and a
custom key; Copilot kept its user pref; OpenCode kept theme and model. The host project's own files
were md5-identical to their pre-install baselines, and its git history was intact. In the project
with a pre-existing `AGENTS.md` and `CLAUDE.md`, both files came back **byte-identical** to
pre-install after the full cycle. Ref-counting held: uninstalling one runtime of several left the
shared sections in place; uninstalling the last one removed them.

**Hostile probing of the CLI.** Against a deployed `--claude --local` install in a brownfield JS
repo with git history, driven through the *installed* dispatcher (never the source copy): 184
distinct command surfaces across roughly 430 invocations in six fault classes — happy path, missing
required arguments, nonexistent phase/id, malformed `config.json`, malformed JSONL/JSON state, and
corrupted `state.md`/`roadmap.md`/plan frontmatter including raw NUL bytes. **Zero stack traces.**
`validate health` correctly surfaced the broken config as a structured error; `hud`, `report index`,
`dashboard`, `preflight`, `retro`, and `context-budget` all still produced output on a corrupted
project. Two previously-fixed data-loss defects were re-confirmed fixed under adversarial input:
`bus drain --mode consume` removes exactly the messages it returned and preserves a malformed line
verbatim; the cost ledger prices genuine pre-fix rows lacking `event_sig` alongside current rows,
quarantines implausible values, and skips a torn half-written row without failing the report.

**Independent re-verification for this document.** The blocking defect was reproduced first-hand in
a fresh sandbox (`d:\pantesting\stab-verdict`), and the four cited root causes were read directly
out of `bin/install.js`, `pan-wizard-core/learnings/index.json`, `commands/pan/audit-deployment.md`,
and `pan-wizard-core/workflows/update.md` at `2be1000`.

---

## 3. Findings, ranked and separated by class

### (a) Code defects — wrong behavior, wrong results, or data loss

**A1 — BLOCKING · Critical · The installer destroys a `settings.json` it cannot parse as strict
JSON: no warning, no backup, exit 0.**

Reproduced independently for this document:

```bash
mkdir -p /d/pantesting/stab-verdict/host/.claude
printf '{\n  // my model choice\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls)"] },\n  "env": { "ACME_TOKEN_PATH": "/secrets/tok" }\n}\n' \
  > /d/pantesting/stab-verdict/host/.claude/settings.json
cd /d/pantesting/stab-verdict/host && node /d/PanWizard/bin/install.js --claude --local
```

Observed: `EXIT=0`. Warning/`⚠`/"could not parse" lines in the whole install log: **0**. Output
ends with `✓ Configured statusline` and `Done!`. Afterwards `.claude/settings.json` contains only
`hooks` and `statusLine` — `model`, `permissions`, and `env` are gone, and `find` for `*.bak` or
`settings.json.*` returns nothing. Area 1 reproduced the same outcome across four malformed
variants (JSONC comment, trailing comma, truncated, binary) and for the other two settings-based
runtimes, destroying Gemini's `selectedAuthType` and Copilot's `trustedFolders`.

Root cause, `bin/install.js:257`:

```js
function readSettings(settingsPath) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}
```

Ten call sites treat that `{}` as "the user has no settings" and write a fresh object back. The
*correct* pattern already exists in the same file, at `configureOpencodePermissions()`
(`bin/install.js:~1520`): `parseJsonc` + `⚠ Could not parse opencode.json - skipping permission
config … Your config was NOT modified` + early return. Verified working — a malformed
`opencode.json` was left byte-identical in the same test run.

**User impact.** A user whose `settings.json` contains a `//` comment — a thing people write
constantly — permanently loses it on install *or upgrade*. Lost content includes Claude Code
permission allow/deny lists, env vars, and custom hooks; Gemini auth type (forces re-auth); Copilot
`trustedFolders` (a security setting). Unrecoverable if the file was not in git. The trigger is
conditional — the file has to be non-strict JSON, which is a minority of users, and runtimes
themselves write strict JSON — but the consequence is total, silent, and printed as success. That
combination is what makes it blocking rather than merely serious. Note the same hole sits on the
**uninstall** path at `bin/install.js:1258`.

---

**A2 — BLOCKING · High · The global OpenCode permission grant points at a directory that does not
exist, and the uninstaller can never remove it. This machine already carries the residue.**

```bash
cd <sandbox>/proj && HOME=<fakehome> node /d/PanWizard/bin/install.js --opencode --global
# prints: ✓ Configured read permission for PAN docs
cat <fakehome>/.config/opencode/opencode.json
# {"permission":{"read":{"~/.config/opencode/pan-wizard/*":"allow"},
#                "external_directory":{"~/.config/opencode/pan-wizard/*":"allow"}}}
ls -d <fakehome>/.config/opencode/pan-wizard      # No such file or directory
ls -d <fakehome>/.config/opencode/pan-wizard-core # exists — this is what was installed
```

Root cause, `bin/install.js:1538-1540` — the two branches disagree, and only the default-global one
is wrong:

```js
const panPath = opencodeConfigDir === defaultConfigDir
  ? '~/.config/opencode/pan-wizard/*'                               // missing "-core"
  : `${opencodeConfigDir.replace(/\\/g, '/')}/pan-wizard-core/*`;   // correct everywhere else
```

The uninstaller at `bin/install.js:1397` only prunes keys where `key.includes('pan-wizard-core')`,
so the broken spelling can never match and survives every uninstall.

**Confirmed on the developer's real machine, read-only, not created by this test run** (the test's
global installs went to a fake home):

```bash
cat C:/Users/ocker/.config/opencode/opencode.json
# still contains both ~/.config/opencode/pan-wizard/* entries
ls -d C:/Users/ocker/.config/opencode/pan-wizard-core  # No such file or directory
ls -d C:/Users/ocker/.config/opencode/pan-wizard       # No such file or directory
```

A previous global install/uninstall cycle left dangling PAN permission grants behind permanently.

**User impact.** Two failures. (1) Every default-location global OpenCode install gets a permission
rule that cannot match, so PAN's own core docs — the workflows, references, and templates that
`external_directory` guards — are never allow-listed, which is precisely what the grant was written
to prevent, while the installer prints `✓ Configured read permission for PAN docs`. (2) Uninstall
reports success and "Your other files and settings have been preserved" while leaving PAN-authored
keys in the user's global config forever. Whether OpenCode then blocks, prompts, or ignores the
missing grant needs a live OpenCode runtime — the severity here rests on the confirmed mismatch and
the confirmed permanent residue, not on an observed block.

---

**A3 — High (cluster) · `--config-dir` is advertised but not threaded through the post-install
paths, so a `--config-dir` install can never update itself.**

Three distinct defects, one theme. `--config-dir` is documented in `--help`.

- `configureOpencodePermissions(isGlobal = true)` (`bin/install.js:1504`, called at `:2608` as
  `configureOpencodePermissions(isGlobal)`) takes no explicit dir and resolves via
  `getOpencodeGlobalDir()`. With `--opencode --global --config-dir <dir>`, `<dir>` gets **no**
  `opencode.json` and the default `~/.config/opencode/opencode.json` is created instead — a file in
  the location the user deliberately avoided, carrying the broken glob from A2.
- `pan-wizard-core/workflows/update.md` never mentions `--config-dir` (`grep -c config-dir` → 0 at
  `2be1000`). Step 1 correctly detects the custom-dir install and reads its version, then
  `run_update` runs bare `npx -y pan-wizard@latest --global`. Observed: the custom dir stayed at the
  stale version while a full second install appeared in the home dir. The user sees
  "PAN Updated: 3.22.0 → 3.23.0" while the install their runtime actually loads is still 3.22.0,
  and every subsequent update repeats it.
- A relative `--config-dir` breaks scope detection in both directions, because the installed
  detection block infers scope from the *shape* of the templated prefix
  (`case "$VERSION_FILE" in ./*) LOCAL ;; *) GLOBAL ;; esac`, `workflows/update.md:23-26`).
  `--global --config-dir './relcfg'` templates `./relcfg/...` and reports **LOCAL** — the same
  user-visible failure as the N2 regression this design was introduced to fix.
  `--config-dir 'barecfg'` reports GLOBAL but is cwd-relative, so detection returns UNKNOWN from
  any other directory. Fix is one line at the templating site: `path.resolve` the value.

---

**A4 — Medium · `UNKNOWN` scope is routed to `--global`, so a local-only user running `/pan:update`
from a subdirectory gets an unrequested global install in their real home.**

Detection templates a cwd-relative `./.claude/pan-wizard-core/VERSION` for local installs. Run the
installed detection block verbatim from `<project>/src/deep` and it prints `UNKNOWN`; from the
project root it prints `3.23.0 LOCAL`. `workflows/update.md:152-163` then says:
**"If GLOBAL install (or unknown):** `npx -y pan-wizard@latest --global`". Blast radius is the real
home — `~/.claude`, `~/.gemini`, `~/.codex`, plus the shared skills tree, which is the same
directory as the earlier home-pollution incident — while the local install the user meant to update
stays stale. The precondition is real rather than theoretical: Codex and Copilot resolve skills from
the repo root and can legitimately be invoked from a subdirectory. Caveat: the routing step is prose
an LLM executes. The `UNKNOWN` output was confirmed deterministically and the instruction text was
read; an LLM was not observed acting on it. Either walk up to the project root, or make `UNKNOWN`
stop and ask.

---

**A5 — Medium · The installer prints `✓ Configured … hook` four times and `✓ Configured statusline`
while registering nothing, when `settings.json` holds a JSON array.**

`printf '["not","an","object"]' > .claude/settings.json`, then install: exit 0, five success ticks,
`grep -c pan-check-update .claude/settings.json` → 0, and the file on disk is the same array
re-serialized (so it *was* written). `readSettings` returns the array; callers assign
`settings.hooks = …` as a named property on an Array; `JSON.stringify` drops it. Cost logging,
context monitoring, update check, and the statusline are all silently inert while the install
reports complete. **Same root cause as A1** — no type validation around `readSettings`. Fix A1 with
a plain-object guard and this closes with it.

---

**A6 — Medium · Codex skill edits are silently overwritten with no backup, while the docs promise a
backup.**

`saveLocalPatches()` skips any manifest key containing `..` (`bin/install.js:1770`), and Codex's
entire skill surface is tracked as `../.agents/skills/…`. Observed: six in-tree edits across the
other runtimes were reported and backed up correctly; the `.agents/skills/pan-help/SKILL.md` edit
was not mentioned in the output, not backed up, and gone from disk after reinstall.
`docs/USER-GUIDE.md:1089` and `docs/AGENTS.md:910` both promise the backup unqualified. The code
comment acknowledges the exception; the user-facing docs do not. Codex has no other command surface,
so this is the whole customization story for that runtime. Cheapest fix is the doc line; the better
fix is a sibling patches directory.

---

**A7 — Medium · Internal learnings are stripped from disk but `learnings/index.json` still lists
them.**

Verified at source: `index.json` carries 4 topics with `scope: "internal"` whose files
(`learnings/internal/{experiment-runner,external-research,loop-design,pan-dev-bugs}.md`) exist only
upstream and are correctly removed from every installed copy by the strip at `bin/install.js:639`
and `:2074`. The strip does not rewrite the index. Two effects: internal topic names and pattern IDs
ship to every public install, defeating the strip's purpose for metadata; and the index's own totals
overstate what is installed, so anything sizing or budgeting against it is wrong. Degrades silently
rather than crashing.

---

**A8 — Low · A corrupt `pan-file-manifest.json` silently disables local-patch backup.**
`saveLocalPatches()` does `try { … } catch { return [] }`, so an unreadable manifest is
indistinguishable from "no local modifications". Observed: install exits 0, prints
`✓ Wrote file manifest` and `✓ Verified …`, and never mentions that it could not read the old
manifest. A truncated manifest — interrupted install, bad merge — means the next upgrade overwrites
every locally modified PAN file with no backup and no notice. Third symptom of the same
catch-and-continue pattern as A1 and A5. One warning line makes it recoverable.

**A9 — Low · `pan-tools` has two incompatible error contracts, and one `learn` dispatch is broken.**
`context-budget --raw` prints a plain-text error to **stdout** and exits **0** (so a caller that
`JSON.parse`s it gets a string); `knowledge playbook` returns a JSON envelope with a raw ENOENT and
a Windows path, exit 0; `roadmap get-phase` with no argument writes to stderr and exits **1**. Any
wrapper gating on exit status treats a missing `.planning/` as success. Separately,
`learn index|list|topics|"search plan"` all return the identical "No trace session active" error —
the subcommand is ignored; only `learn promote` dispatches.

**A10 — Low · A local install writes an absolute machine path into a project file.**
`.opencode/opencode.json` gets
`{"permission":{"read":{"D:/…/host/.opencode/pan-wizard-core/*":"allow"}}}`. If that file is
committed — and PAN creates it inside the project — every teammate and CI runner inherits a grant
pointing at the original author's absolute path, silently doing nothing for them.

**A11 — Low · Uninstall orphans.** After a full local uninstall, `pan-local-patches/` trees survive
containing PAN source files, and the uninstall summary never names them (the manifest that described
them is deleted, so nothing points the user at them). After a full global uninstall,
`.claude/cache/pan-update-check.json` survives. Empty runtime directories survive local uninstall.
Retaining the patches is correct — doing it silently, under a banner reading "Your other files and
settings have been preserved", is not.

### (b) Documentation and prose that does not match the code

The first of these is prose that *behaves* like code, and it is the most consequential item in this
class by a wide margin.

**B1 — The shipped `/pan:audit-deployment` command specifies wrong paths for OpenCode and Codex, so
the audit it drives reports false failures on a healthy install.**
`commands/pan/audit-deployment.md:81-82` says OpenCode commands live at `CONFIG_DIR/command/`
(singular) and Codex skills at `CONFIG_DIR/skills/pan-*/SKILL.md`. Verified against the installer:
`bin/install.js:1661` writes `commands/` (plural) and `:1475` treats `command/` as the *legacy*
directory to sweep; Codex's skills go to `./.agents/skills/` and `.codex/skills` does not exist.
The wrong text ships in every installed copy and both skill trees. Section 1.4 is marked CRITICAL,
so an LLM following this checklist on a correct OpenCode or Codex install will find nothing where
it was told to look and report the command surface as missing. `README.md:143` and
`docs/USER-GUIDE.md:1200` already state the correct locations, so the shipped command contradicts
the shipped docs. Users chasing a fabricated CRITICAL on a healthy install is the exact opposite of
what a deployment audit is for.

**B2 — `mcp-bridge` points non-Claude runtimes at `.claude/settings.json`.**
`commands/pan/mcp-bridge.md:101` tells the user to check "the host runtime's MCP config —
`.claude/settings.json` for Claude Code, or the runtime's equivalent", and that line ships unchanged
into the OpenCode, Codex, and Copilot copies. Those runtimes use `.opencode/opencode.json`,
Codex config, and `.github/mcp.json`. The per-runtime rewrite substitutes command names and
`pan-tools` paths in this same file but leaves this path alone — the one genuine rewrite miss in
otherwise-correct templating. Effect: a user whose MCP tools do not appear is sent to inspect a file
their runtime does not read, and the troubleshooting path dead-ends.

**B3 — The installer tells Copilot users to run a command form Copilot does not have.** After
backing up local modifications it prints "Run `/pan:patches`", but `reportLocalPatches()` only
special-cases OpenCode (`/pan-patches`) and Codex (`$pan-patches`); Copilot falls through to the
Claude/Gemini form. The installer's own closing line correctly says `/pan-new-project` for Copilot.
A Copilot user follows the instruction, the command does not exist, and their backed-up
modifications are never merged.

**B4 — The installer prints paths that do not exist for global and `--config-dir` installs.**
`--copilot --global` prints `✓ Configured hooks (.github/hooks/pan.json: …)` while the file is at
`~/.copilot/hooks/pan.json` and no `.github` exists in the home dir. `--codex --global --config-dir
<dir>` prints `✓ Configured hooks (.codex/hooks.json: …)` while the file is at `<dir>/hooks.json`.
Users troubleshooting hooks go looking in a directory that is not there.

**B5 — `docs/USER-GUIDE.md:1089` and `docs/AGENTS.md:910` promise local-patch backup without
qualification** — see A6. Whichever way A6 is resolved, one of these two lines has to change.

### (c) Cosmetic

**C1 — `workflows/update.md`'s cache-clear step offers two branches that are byte-identical in
every install.** Both the LOCAL and GLOBAL branches read the same templated path, because there is
one install location per install and the path is templated at install time — the file even says so.
Harmless, but it invites a reader (or an LLM) to choose between options that cannot differ, in the
one workflow whose scope handling has already regressed twice.

**C2 — Per-runtime `Done!` blocks print out of order** relative to the `Installing for …` headers
during a multi-runtime global install (OpenCode's `Done!` appears under Copilot's install).

**C3 — `context-budget`'s error text has no trailing newline**, so it runs into the next shell
prompt.

---

## 4. What could not be tested headless

PAN's orchestration layer is prompts — commands, agents, workflows, and templates that an LLM
executes inside a host runtime. Nothing in a headless harness can exercise that. What this test
verified is that the files are present at the documented paths, structurally valid, correctly
path-rewritten per runtime, and that every executable the prompts invoke (`pan-tools`, the hooks)
runs and produces the right side effects. What remains unverified:

- **Whether each runtime actually loads what PAN registers.** Claude Code discovering the flat
  `.claude/skills/pan-*.md` shims (real Claude Code skills are `<dir>/SKILL.md`, and PAN writes
  single `.md` files here while writing proper skill directories for the shared and Copilot trees —
  this is the single most likely place for a silent no-op); Codex resolving `$pan-*` from
  `.agents/skills`; Gemini's `experimental.enableAgents`; the `.github/hooks/pan.json` `version: 1`
  schema and its camelCase event names; Copilot's documented cross-read of `.claude/settings.json`.
  Files written and valid — hosts honoring them, unverified.
- **Codex's project-trust gate.** `.codex/` config only loads once the project is trusted. The
  installer prints the reminder; the behavior needs a live Codex CLI.
- **Every LLM-executed instruction.** Structure, frontmatter, and embedded tool paths were checked
  for the whole command/agent/workflow/template surface. That an agent following those instructions
  produces a correct plan, execution, or verification was not tested and cannot be.
- **The `run_update` routing decision** (A4, A3) — the detection bash is deterministic and was run
  verbatim from the installed files; the LOCAL/GLOBAL/UNKNOWN → flag mapping is prose.
- **Statusline rendering inside each runtime.** The hook exits 0 and emits plausible ANSI text; each
  host's statusline contract is unverified, and the installer itself flags Copilot's as experimental.
- **A real cross-version npm upgrade.** Only the same-version installer could be re-run, with stale
  artifacts simulated by hand. Genuine migration paths — renamed commands, schema bumps from an
  older published version — are untested.
- **The network half of the update workflow** — `npm view`, the changelog fetch, real
  `npx -y pan-wizard@latest` resolution.
- **OpenCode's enforcement of the malformed grant** (A2) — the mismatch is proven; the consequence
  is inferred.
- **Interactive install prompts.** Every run was flag-driven.

**How to smoke-test the unverifiable layer yourself, in one session.** In a scratch directory,
install one runtime locally, then run a single full lifecycle in that runtime:
`/pan:new-project` → `/pan:plan-phase 1` → `/pan:execute-phase 1` → `/pan:verify-phase 1` →
`/pan:cost report`. Watch four things: the commands are *discoverable* (they autocomplete), the
statusline appears, `.planning/` fills with real artifacts rather than templates,
and `.planning/metrics/tokens.jsonl` grows — that last one proves the `SubagentStop` hook is being
called by the host, which is the discovery question the harness cannot answer. Repeat for a second
runtime, ideally Codex, since its skill surface has the most unverified assumptions. Thirty minutes
covers what weeks of headless testing structurally cannot.

---

## 5. What the audit chain's finding count actually means

The chain that preceded this test produced a large number of findings, and the count is the reason
this release feels unstable. It is worth being precise about what the count is made of, because this
deployed test is the cleanest available read on that question — it tested the *shipped artifact*,
not the source.

**The overwhelming majority of what turns up is claims that do not match the code, not code that
does not work.** That pattern repeats here. Of everything reported in this test, exactly two items
are release-blocking, and both are single-expression defects in one function each. Below that line
sit a cluster of `--config-dir` gaps on a side road, three symptoms of one shared discipline
problem, and a set of prose-versus-code mismatches. The prose items are real and worth fixing — B1
in particular, because it is prose an LLM executes, which is a category this project generates a lot
of and should treat as code. But a doc line that names the wrong directory is not evidence of an
unstable product. It is evidence of documentation drifting faster than it was maintained, which is
exactly what a long audit chain is supposed to find and precisely why the count is large.

**Does the code layer look solid? Yes — with one named exception.** The things that would indicate
an unstable product were all specifically attacked, and all held:

- Manifest integrity verified in both directions, on fresh install, after upgrade, and from a path
  containing spaces: zero missing files, zero hash mismatches.
- Upgrade is idempotent — the file list before and after a re-install is identical, hook arrays are
  not duplicated, and no shadow command surfaces appear.
- Self-repair works: deleted core files come back on reinstall.
- Uninstall preserved **every** planted user key across four config files and three user-owned
  files, and returned a pre-existing `AGENTS.md` and `CLAUDE.md` byte-identical to their pre-install
  state. Host project files and git history untouched throughout.
- Ref-counting across five runtimes behaves correctly in both directions.
- 184 command surfaces × roughly 430 invocations × six fault classes, including malformed JSON,
  malformed JSONL, corrupted frontmatter, and raw NUL bytes: **zero stack traces**, structured
  errors throughout.
- Two historical data-loss defects were re-attacked adversarially and are genuinely fixed
  (`bus drain` consume semantics; cost-ledger old-schema compatibility with a torn row present).
- Two historical regressions did not reproduce: the scope-detection misfire on the canonical path
  (correct in every runtime × mode tested) and the capability-warning crash (the whole matrix
  correct, including future model IDs that must *not* warn).
- The real home was verifiably untouched across dozens of install and uninstall cycles, including
  every global one.

**The one named exception is a discipline problem, not an architecture problem, and it is the reason
for the blocking verdict.** A1, A5, and A8 are the same mistake three times:
`catch { return empty }`, followed by code that treats "empty" as "user has nothing", followed by a
success message. The project already knows the right pattern — `configureOpencodePermissions()`
implements it correctly, in the same file, refusing to touch a config it cannot parse and saying so.
Promote that pattern to every config reader, add the type guard, and cover it with a test, and this
class is closed rather than merely patched. That is a contained, high-confidence fix — which is why
the recommendation below is "fix and publish", not "hold and keep auditing".

One process note worth acting on: `grep -rn "pan-wizard/\*"` across tests, core, docs, and README
returns nothing. The A2 string is asserted nowhere, which is why green tests did not catch a typo
that has been shipping and leaving residue on real machines. Every fix below should land with an
assertion on the literal string it fixes.

---

## 6. Release recommendation

**Hold the publish. Fix two things, verify Areas 3-6, then publish.** Do not restart the audit
chain — the evidence does not support that, and another round will produce another pile of prose
findings while these two defects keep shipping.

**Preconditions (blocking):**

1. **A1 + A5** — `readSettings()` must distinguish "file absent" from "file present but
   unparseable", must refuse to write when it cannot parse, must warn when it refuses, and must
   reject non-plain-object contents. Port the `parseJsonc` + warn + early-return pattern from
   `configureOpencodePermissions()`. Apply to all ten call sites, including the uninstall path at
   `bin/install.js:1258`. **Ship with a test** asserting a `settings.json` containing a `//` comment
   is byte-identical after an install, and one asserting an array-valued `settings.json` produces a
   warning rather than five success ticks.
2. **A2 + A3a** — fix the default-global `panPath` to `pan-wizard-core/*`; give
   `configureOpencodePermissions` an `explicitDir` parameter and pass it from the call site at
   `bin/install.js:2608`; widen the uninstall key filter at `bin/install.js:1397` to prune both
   spellings so machines already carrying the residue (including this one) get cleaned on the next
   uninstall. Assert the literal grant string in a test.
3. **Fold in the four missing area reports** — Area 3's failure list plus hooks, hostile-input, and
   regression. If any is Critical or High, this section is void.

**Strongly recommended before publish (cheap, user-visible):**

4. **A3b + A3c** — `path.resolve` the `--config-dir` value before templating, and thread
   `--config-dir` into `workflows/update.md`'s `run_update` command. Without these a `--config-dir`
   user can never update and is never told why.
5. **A4** — change the `UNKNOWN` branch from "treat as global" to "stop and ask". A one-line prose
   change that removes the only path in this report that writes into a user's real home unasked.
6. **B1** — one-line path correction in `commands/pan/audit-deployment.md`. It is the checklist that
   generates fabricated CRITICALs on healthy installs, which actively feeds the impression this
   document exists to correct.

**Fine to defer to a follow-up:** A6-A11, B2-B5, C1-C3. None of them break a working install.

### One-command smoke test after publishing

Run this from Git Bash immediately after the release lands. It checks the blocking defect against
the *published* package and confirms the deployed CLI is alive:

```bash
D=$(mktemp -d) && cd "$D" && git init -q && mkdir -p .claude && \
printf '{\n  // keep my model\n  "model": "opus",\n  "permissions": {"allow":["Bash(ls)"]}\n}\n' > .claude/settings.json && \
npx -y pan-wizard@latest --claude --local && \
{ grep -q '"model"' .claude/settings.json && echo "PASS: settings.json preserved" || echo "FAIL: settings.json DESTROYED"; } && \
node ./.claude/pan-wizard-core/bin/pan-tools.cjs validate health; echo "exit=$?"; echo "sandbox: $D"
```

Expect `PASS: settings.json preserved` and a structured `validate health` result. `FAIL` means A1
shipped — unpublish or patch immediately, because that path silently eats user config on every
install *and* upgrade.

For the OpenCode half, in a throwaway `HOME`:

```bash
npx -y pan-wizard@latest --opencode --global && \
grep -o 'pan-wizard[a-z-]*' "$HOME/.config/opencode/opencode.json" | sort -u
```

Expect `pan-wizard-core` only. Bare `pan-wizard` means A2 shipped.

---

*Sandboxes retained for re-verification: `d:\pantesting\stab-install`, `stab-global`, `stab-cli`,
`stab-hooks`, `stab-hostile`, `stab-regress`, and `stab-verdict` (this document's independent A1
repro). Nothing under `D:\PanWizard` was modified to produce this report except the creation of this
file.*
