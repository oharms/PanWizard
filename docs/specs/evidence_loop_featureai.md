# Evidence loop — featureAI specification

| | |
|---|---|
| Status | BUILT `2026-09-28` on `feat/evidence-loop` — plan [evidence-loop-plan.md](evidence-loop-plan.md), both sessions executed |
| Branch | `feat/evidence-loop` |
| Inputs | [trace-failure-capture](investigations/features/trace-failure-capture.md) (ENHANCE P2), [optimize-apply-regression-gate](investigations/features/optimize-apply-regression-gate.md) (ENHANCE P3), [market-ideas queue](market-ideas-2026-09.md) M11, M12, M17 |
| Decision record | [ADR-0049](../decisions/ADR-0049-machine-verdicts-and-findings-ledger.md) |
| Runtimes | Verdicts, findings, dispositions, revert and the `contract` field work on all five runtimes. Tool-failure capture is Claude-only, because it needs per-agent transcripts. |

PAN's judging agents (verifier, plan checker, reviewer, design checker) already decide whether work passed. PAN keeps almost none of that evidence. Today:

- Verdicts are prose that each workflow re-parses in its own way.
- Findings disappear after the phase.
- Failures inside a subagent never reach the trace.
- `optimize apply` writes memory entries that every later agent reads, and they cannot be undone.

This feature makes the evidence explicit, durable and mechanical. There are four pieces:

1. A machine verdict contract that every judge emits.
2. An append-only findings ledger with recorded dispositions.
3. Failure capture in the trace hook.
4. A revertible optimizer apply.

The machine-readable outputs get a `contract` version so consumers can depend on them.

---

## Phase 0 — Problem framing

### 0.1 Problem statement

PAN's improvement loop (`optimize trace` → `/pan:learn` → `optimize apply`) and its quality gates (plan check, review, verification, milestone audit) all run on evidence. At each point where evidence exists, it is either not recorded or recorded in a form nothing reads back:

- **Judges' verdicts live in prose.** Each workflow re-derives the outcome in its own way:
  - exec-phase greps `status:` from verification frontmatter (`pan-wizard-core/workflows/exec-phase.md:544`).
  - plan-phase matches the headings `## VERIFICATION PASSED` / `## ISSUES FOUND` (`plan-phase.md:449-462`).
  - The review step pipes a `$REVIEW_OUTPUT` shell variable that nothing ever sets (`exec-phase.md:452`). A Task result is not a shell variable, so that trace event always counted "1 error" or never fired.
- **Findings are not kept.** The reviewer is read-only and its report is never written to disk. `/pan:review-deep` step 1 reads `.planning/phases/<N>/review.md` "written by exec-phase", but nothing writes it (`commands/pan/review-deep.md:41,63`). Even if it existed, `parseReviewFindings` wants `## Findings` bullets, while the reviewer emits `### Findings` tables. The reviewer half of every deep review has always merged as zero findings.
- **Findings have no disposition.** milestone-audit asks the model to reconstruct "tech debt, deferred items, warnings" from prose in each verification.md (`milestone-audit.md:76-80`). No record says a finding was deliberately deferred, dismissed or fixed, or why (market idea MI-031).
- **Failures inside subagents are invisible.** The trace hook writes one completion event per spawn, plus a redundancy heuristic (`hooks/pan-trace-logger.js:824,873`). It already reads the subagent's own transcript for tokens, but it never looks at the failed tool calls in it.
- **Optimizer applies cannot be undone.** `applyReportRecommendations` appends to memory files that every later agent reads. It logs only counts and types (`pan-wizard-core/bin/lib/optimize.cjs:752-762`), and running it twice on the same report appends everything twice.
- **Scope creep has no class.** No check compares what a phase changed against what its plans declared (MI-030).

**Why now:** the Growing Harness result (arXiv:2609.26760) says a loop improves from feedback only when the runtime records each failure and ties it to where it happened. PAN has that runtime hook already (the per-agent transcripts the cost ledger proved in 3.29.0). The market scan found two peers that converged on the verification side: Spec Kit's classes include "unrequested", and BMAD's review triage records a disposition with a reason.

### 0.2 Scope

| In scope | Out of scope (with reason) |
|---|---|
| `pan-verdict` block: contract, parser, validator, agent-by-agent mapping, verification.md frontmatter adapter | Rewriting the judges' prose reports (the block is appended, the prose stays for people) |
| Findings ledger `.planning/findings.jsonl`, `findings record/list/dispose/debt`, MCP resource `pan://findings` | A findings UI or HTML report (the phase HTML report can read the ledger later) |
| Workflows record verdicts on the critical path and dispose findings where they continue past them; milestone-audit reads `findings debt` | Recording findings from `/pan:review-deep`'s hardener and meta-reviewer (they have a parsed format already; follow-up) |
| M11: `verify scope <phase>` (mechanical candidate list), verifier `unrequested:` frontmatter, reviewer lens | Blocking a phase on unrequested work (it is a finding to dispose, not a gate) |
| Trace hook: `error/tool_error` events and `tool_calls`/`tool_errors` on completions, from the agent's own transcript; redaction; off switch | Capture on Codex/Copilot (payload and transcript shape unverified), Gemini (no subagent-stop event), OpenCode (no hooks: market item M6) |
| `optimize learn` reads the new signal; `--sessions <n>` pools sessions | `optimize verdict` (the before/after regression verdict): deferred with a trigger, see §3.8 |
| Revertible `optimize apply` (apply ids, action records, re-apply guard) and `optimize revert` | Automatic revert (revert stays a user decision) |
| M17: `contract: "1.0"` on `state`, `state json`, `progress` JSON and the resources wrapping them | Versioning every JSON output PAN has |
| Review chain defects found on the way: persist `review.md`, fix review-deep's path and parser, make exec-phase `--deep-review` real | Redesigning review-deep's severity ladder |

### 0.3 Success criteria

```
SC-1  A judging agent's pan-verdict block round-trips: agent text → parseVerdictBlock → ledger rows → findings list,
      for the block examples shipped in each judging agent AND in each runtime's converted copy of it (5 runtimes).
SC-2  findings record is idempotent per artifact (same content twice → one verdict), numbers attempts per (agent, phase),
      auto-fixes a re-verified agent's unreported findings (except human/unrequested), and reopens a regressed fix.
SC-3  findings dispose refuses deferred/dismissed/decision without --reason (exit 1); findings debt returns deferred
      findings with reasons and lists undisposed open ones, filtered by milestone.
SC-4  The trace hook, given a Claude SubagentStop payload whose agent transcript holds failing tool results (fixture built
      from a real emitted transcript's record shape), writes error/tool_error events with tool, class, exit code and a
      redacted message; the same test fails against the pre-change hook (revert-proven).
SC-5  No capture from a parent-transcript slice, none when execution.error_pattern_learning is false, none outside a PAN tree.
SC-6  optimize apply records an apply_id with per-action records; applying the same report twice appends nothing the
      second time; optimize revert restores a memory_append byte-for-byte (LF and CRLF files), refuses a hand-edited
      file, and refuses out-of-order reverts on the same file.
SC-7  optimize learn reports tool_error_patterns and verdict_stats; --sessions <n> pools the last n sessions.
SC-8  state/state json/progress JSON carry contract "1.0"; the pan://state and pan://progress resources return it.
SC-9  review.md is written by exec-phase and parsed by review-deep (reviewer findings no longer merge as zero);
      exec-phase --deep-review runs the deep review.
SC-10 Installs into all five runtimes carry the new agents, workflows and references intact (fixture installs);
      the tier-0 harness scenario runs the loop against a deployed install; full suite, release-check and harness tier 0 green.
```

### 0.4 User stories

- As a PAN user finishing a milestone, I want the audit to list every finding we chose to defer, with the reason given at the time, so that tech debt comes from a record and not from the model re-reading prose.
- As a PAN user in a gap-closure loop, I want each re-verification to mark the previous gaps it no longer reports as fixed, and to count the attempt, so that I can see what the fix round actually resolved.
- As a PAN user running `/pan:learn`, I want the analysis to show which tool calls keep failing, and in which agents, across sessions. Then the optimizer writes memory from a failure that recurs, not from a guess.
- As a PAN user who ran `/pan:learn --apply`, I want to undo one apply exactly, without hand-editing memory files, if agents behave worse afterwards.
- As an MCP client author, I want `contract` on PAN's state and findings JSON, so that I can pin the shape I consume.

---

## Phase 1 — Internal reconnaissance

### 1.1 Measured premise (re-measured `2026-09-28`, as the digest asked)

The measurements were read-only and aggregate only; no project content was copied.

Reproduce as follows:
- Trace files: walk `find /d -maxdepth 7 -type d -name traces -path "*/.planning/optimization/*" -not -path "/d/pantesting/*/*"` and group each `trace.jsonl` line by `type/category`.
- Transcripts: walk `~/.claude/projects/*/<session>/subagents/**/agent-*.jsonl` and count `tool_result` blocks with `is_error: true`.

| Measure | Field projects (14) | PAN experiment trees (44) |
|---|---|---|
| Trace events | 3,968 | 740 |
| `decision/agent_completion` (hook) | 3,904 (98.4%) | 334 |
| Prose-logged decisions (plan_verified, verification_passed, phase_complete, plans_created …) | 64 | 322 |
| `error/*`, `gap/*`, `correction/*` events | **0** | 30 errors, 6 gaps, 0 corrections |
| Projects that ran `optimize learn` / `optimize apply` | 3 / 1 (one apply run ever) | 0 / 0 |
| Field trees whose trace files are tracked by git | 2 of the 4 git-backed trees checked | — |

| Subagent transcripts on this machine | Field | PAN development |
|---|---|---|
| Transcripts | 1,969 | 58 |
| Transcripts with ≥ 1 failed tool call | 463 (23.5%) | 16 |
| Failed tool results | 869 (max 18 in one spawn) | 28 |
| Classes of failure | exit code 597 · other 108 · not found 84 · bad tool input 46 · permission denied 16 · user rejected 11 · network 7 | exit code 20 · permission 5 · not found 2 · network 1 |
| Tools | Bash 708 · Read 68 · Grep 30 · Edit 18 · WebFetch 14 · PowerShell 11 · Write 8 · other 12 | Bash 25 · Read 2 · WebFetch 1 |

**What this changes in the write-up's premise.** The write-up says agents never call `optimize trace log`. They do, on the success branches, roughly once per phase: 64 field events. Part of the earlier silence was the discard defect fixed in 3.29.0 (`optimize.cjs:189-199`: events were dropped when no session was active). What is true, and what this design fixes:

1. No error branch has ever logged in the field.
2. The verdict events carry no findings.
3. Nothing records the failures inside subagents. The transcripts hold about 0.44 failed tool calls per spawn, and the trace holds zero.

The optimizer loop is barely used (one apply run in the field). That shapes §3.8: the design fixes the signal and makes apply safe, and it defers the regression verdict until use exists.

**Side finding (follow-up, not built here).** 181 recent completion events name an `agent_id` with no agent type, and no transcript for them exists anywhere on disk. They look like host-internal helper agents and add zero-token noise to agent stats. This is tracked as a separate task.

### 1.2 What exists (SOURCE unless marked)

| Piece | Where | Relevance |
|---|---|---|
| Per-agent transcript resolution | `hooks/pan-trace-logger.js:566` `resolveAgentTranscript` (mirrored in `pan-cost-logger.js`) | Capture reads the same file; only when `token_source` is `agent-transcript` |
| Cursor-sliced transcript reading | `pan-trace-logger.js:624` `readUsageFromTranscript(path, sessionId, sinceLine)` | Failure extraction must read the same slice (resumed agents grow one file) |
| Batch dedup on re-fire | `pan-trace-logger.js:901` `appendTraceEvents` + `isDuplicateCompletion` | Failure events ride in the completion's batch, so a re-fire drops them too |
| Event-name guard | `pan-trace-logger.js:716` returns `[]` unless `hook_event_name` is absent or exactly `SubagentStop` | Harmless on Copilot: its camelCase payloads carry no event name (hooks reference). What does break there is the field names (§1.3) |
| Trace append with auto-session | `optimize.cjs:200` `logTraceEvent` | `findings record` logs verdict events through it |
| Analysis | `optimize.cjs:462` `analyzeEvents` (frequency by category; `reviewer_correction` counted by category) | Gains tool-error patterns and verdict stats; must keep counting legacy categories |
| Apply | `optimize.cjs:675` `applyReportRecommendations` (memory create, memory_append, note, planning_note; containment check) | Gains apply ids, action records, re-apply guard |
| Severity ladder | `review-deep.cjs:27` `SEVERITIES = critical, high, medium, low, info` | Reused as the verdict severity vocabulary (one ladder in PAN) |
| Mechanical verdict cross-check | `verify.cjs:471` `reconcilePhase` | Pattern for `verify scope`: derive signals in code, let the agent judge |
| Plan scope | plan frontmatter `files_modified` (`templates/phase-prompt.md:21`; required by `frontmatter.cjs:352`); summary `key-files` | Declared vs reported scope for M11 |
| Commit convention | `{type}({phase}-{plan}): …` (`agents/pan-executor.md:331`) | `verify scope` finds the phase's commits by subject |
| Reserved config key | `execution.error_pattern_learning` (`config.cjs:81`; documented as "Reserved — written by the defaults but not read", `docs/USER-GUIDE.md:579`) | Becomes the capture off switch; no new key |
| Hook payload fixtures with provenance | `tests/fixtures/hooks/*.json` + `.meta.json` | New fixture follows the same rule: structure from a real emission, synthetic values |
| Attempt numbers | `resolve-model --attempt` (`core.cjs:842-946`); the ledger never records them because the hook cannot see them (M8 status) | The findings ledger derives attempts from its own history instead |

Real transcript shape of a failed tool call (read `2026-09-28` from a PAN development subagent transcript; structure only):
- A `type: "user"` record carries `message.content[] = {type: "tool_result", tool_use_id, is_error: true, content: <string>}`, plus top-level `toolUseResult` (string, prefixed `Error: `) and `sourceToolAssistantUUID`.
- The tool name comes from the matching `{type: "tool_use", id, name, input}` block in the preceding assistant record.
- For Bash the first content line is `Exit code <n>`, and the useful line follows it.
- Beside each `agent-<id>.jsonl` the host writes `agent-<id>.meta.json` with `agentType`, `description` and `toolUseId`. This is a fallback for the agent name when the payload has no `agent_type`.

### 1.3 Runtime compatibility

| Runtime | Judges emit block / workflows record | Hook capture | Why |
|---|---|---|---|
| Claude | yes | yes | per-agent transcripts proven by the cost ledger (3.29.0) |
| Codex | yes | no | `SubagentStop` registered, per-agent transcript layout unverified; the hook finds no agent file and records no failures |
| Gemini | yes | no | no subagent-completion event (`HOOK_EVENT_MAP.gemini.subagentStop = null`) |
| OpenCode | yes | no | no hooks registered (`HOOK_EVENT_MAP.opencode = null`; observers are market item M6) |
| Copilot | yes | no | `subagentStop` registered. Copilot's hooks reference (docs.github.com, read `2026-09-28`, documented only) gives the camelCase payload `sessionId`, `transcriptPath`, `agentId`, `agentType`, `agentName` and `response` (the subagent's final text), with no `hook_event_name`, and a single session transcript. There is no per-subagent file. PAN's loggers read only the snake_case names, so on Copilot they see no agent and no transcript (plan item Q-4) |

---

## Phase 2 — Competitive analysis

Sources were read on `2026-09-21` for the market ledger and on `2026-09-28` for the digest.

| Peer / source | What it does | What PAN takes | What PAN does not take |
|---|---|---|---|
| Growing Harness (arXiv:2609.26760 v2) | The runtime records execution traces; failures are localised to the function they passed through; changes are kept only if a held-out gate does not drop, otherwise rolled back | Runtime-recorded, localised failures (`command, phase, agent, tool`); every change revertible | The automatic held-out gate: a PAN project has no fixed task set, and one apply run in the field does not justify the verb yet (§3.8) |
| Spec Kit `/speckit.converge` (MI-030) | Classes missing / partial / contradicts / unrequested; "completion claims are not evidence" | The four classes, verbatim, as the verification side of the class vocabulary | Its whole-spec convergence pass |
| BMAD review triage (MI-031) | Every finding ends as patch / defer / dismiss-with-reason / decision-needed, never silently | Dispositions `fixed / deferred / dismissed / decision`, reason required for the last three | Human-only triage (PAN's workflows dispose where they continue past a finding) |
| gsd-core (MI-029) | Escalates the model tier on failure, capped | Nothing new: PAN has it (M8). The ledger now supplies the attempt number the hook could not see | — |
| Claude Code host | Per-agent transcripts, `agent-<id>.meta.json`, SubagentStop payload | Read-only use of both | Writing anything into the host's transcript tree |

Where PAN is different: the evidence stays in the project's own `.planning/`, in files with a `contract` version. Judges emit it; code records it; nothing leaves the machine (MI-056: no usage telemetry).

---

## Phase 3 — Design

### 3.1 Architecture

```
 judging agent ──returns text──▶ orchestrator (workflow)
   (plan-checker, reviewer,         │ writes the text verbatim to the phase dir
    design-checker: pan-verdict      │   NN-plan-check.md · NN-review.md · NN-design-check.md
    block; verifier: frontmatter)    ▼   (verifier writes NN-verification.md itself)
                                  pan-tools findings record --phase N --file F --raw
                                     │ parse (verdict.cjs) → ledger rows (findings.cjs)
                                     │ → trace event verdict_passed / verdict_failed / verdict_retry
                                     ▼
                                  prints the native verdict → the workflow branches on it
                                     │ continuing past findings? → findings dispose … --reason
                                     ▼
 milestone-audit ◀── findings debt ── .planning/findings.jsonl ──▶ findings list · pan://findings

 subagent stops ─▶ pan-trace-logger (Claude) ── own transcript slice ─▶ error/tool_error events
                                                                         + tool_calls/tool_errors on the completion
 optimize learn [--sessions n] ─▶ tool_error_patterns · verdict_stats ─▶ pan-optimizer report
 optimize apply ─▶ applied.jsonl {apply_id, actions[]} ──▶ optimize revert <apply_id>
```

### 3.2 Decisions

**D1 — Verdict capture is a verb the workflow needs. The hook does not parse verdicts.** This answers the write-up's open question: *should agents emit a machine verdict line that the hook reads?* Agents do emit one, but a verb reads it, not the hook:
- The verb works on all five runtimes; per-agent transcripts exist on one.
- It sits on the critical path. The workflow branches on the verb's output, which replaces the grep and heading matches it does today. The call is the step that gives the answer, not a side instruction the model can skip.
- There is one writer per verdict, so no two-path dedup ambiguity arises.

The hook keeps what only it can see: the failed tool calls inside the subagent.
*Rejected:* hook-parsed verdicts (Claude-only, and a second writer beside the workflow); keeping prose `optimize trace log` calls (proven not to fire on error branches).

**D2 — One block, for the judges that return text; the verifier keeps its frontmatter.** The plan checker, reviewer and design checker append a fenced `pan-verdict` JSON block to their return. The verifier already writes a machine contract, the verification.md frontmatter that `/pan:plan-phase --gaps` consumes. `findings record` reads that frontmatter through an adapter instead of asking the verifier to repeat it in a second block that could disagree with it. M11 extends the frontmatter with `unrequested:`.
*Rejected:* a block in verification.md too (two sources of truth in one file); parsing each judge's prose (the review-deep table/bullet mismatch shows how that fails).

**D3 — Persist every judge's report in the phase directory.** The reviewer, plan checker and design checker stay read-only, as their role requires. The orchestrator writes the returned text verbatim to `{PHASE_DIR}/{PADDED}-review.md`, `-plan-check.md` or `-design-check.md` with the Write tool. That fixes review-deep's dangling input and makes each verdict an artifact that can be recorded. None of these names match `isPlanFile`, `isSummaryFile` or `isVerificationFile`.

**D4 — An append-only project ledger, folded on read.** `.planning/findings.jsonl` holds `verdict`, `finding` and `disposition` rows. The ledger is never rewritten, so parallel writers and interrupted runs cannot lose an update. The same pattern is used by `metrics/tokens.jsonl` and `trace.jsonl`. One project file rather than one file per phase: phase numbers continue across milestones (`milestone-new.md:269`), and each row also records its milestone.

**D5 — Deterministic identity and idempotency.**
- `record_sig` is the hash of the EOL-normalised input artifact. Recording the same artifact twice is a no-op that returns the first verdict. This is why verify-phase and exec-phase may both record the same verification.md safely.
- A finding's `id` is a hash of (phase, agent, class, where, normalised summary). The same finding reported again keeps its id.
- `attempt` is 1 plus the number of distinct earlier verdicts by the same agent on the same phase.

**D6 — Status comes from the record, with two automatic rules.**
- **Auto-fix.** When agent A records a new verdict on phase P, every *open* finding from A's earlier verdicts on P that the new verdict does not report becomes `fixed`, with reason `not reported by A at attempt k`. This is how a gap-closure round closes gaps.
- **Reopen.** A `fixed` finding that a newer verdict reports again is open again (a regression).
- **Exemptions.** `human` and `unrequested` findings are never auto-fixed: a re-verification does not re-check them, so silence is not evidence. Deliberate dispositions (`deferred`, `dismissed`, `decision`) are never overridden by a later report.
- **Known limit.** A finding whose wording changes between attempts appears as fixed and re-opened under a new id. The open count stays right.

**D7 — Dispositions are explicit and need a reason.** `fixed`, `deferred`, `dismissed` and `decision` come from BMAD's patch/defer/dismiss/decision-needed. A reason is required for the last three; the verb refuses without one (exit 1). This is M12's "a dismissal without a reason fails the check", enforced at the write rather than in a template. Workflows dispose where they continue past a finding:
- warnings accepted at `PASS_WITH_WARNINGS` are deferred with that reason;
- "continue anyway" at `NEEDS_FIXES` is deferred with that reason;
- "force proceed" after three plan revisions is deferred with that reason.

**D8 — Failure capture reads only the subagent's own transcript slice.** Capture happens only when `token_source` is `agent-transcript`; the parent-slice fallback would book the session's failures to one spawn. It uses the same cursor slice as the token read, so a resumed agent is not counted twice. Rules:
- One `error/tool_error` event per distinct (tool, class, message signature) per spawn, carrying an occurrence `count`.
- At most 10 events per spawn; the rest are reflected in the completion's `tool_errors` total.
- A failure is data, not a verdict: TDD red runs and grep-no-match exit codes are expected. `optimize learn` weighs recurrence across spawns and sessions, never a single occurrence.

**D9 — Redaction is new, and mandatory.** The write-up assumed "the same rules the cost ledger uses". There are none: the ledger stores no text. Trace files are committed in some projects (§1.1), so the message is redacted before it is stored:
- key/value secrets (`token=…`, `Authorization: …`, `password: …`);
- known token prefixes (`sk-`, `ghp_`/`gho_`/`ghs_`, `xox[abp]-`, `AKIA…`, JWT `eyJ…`);
- any run of 32 or more base64/hex characters;
- URL query strings;
- the user's home directory, which becomes `~`.

The message is also capped at 160 characters. `execution.error_pattern_learning: false`, a reserved key that finally gets its meaning, turns capture off.

**D10 — Apply records make revert exact and prevent double applies.**
- Each `optimize apply` gets an `apply_id`. Every action is recorded with its path, its kind (`created`/`appended`), the exact appended text, and the hash of the EOL-normalised file after the write.
- An action whose signature is already applied (and not reverted) is skipped with `already applied in <apply_id>`.
- `optimize revert <apply_id|--last>` deletes created files and truncates appended spans. It refuses:
  - a file whose normalised hash no longer matches (edited since the apply);
  - a file a *later* unreverted apply also touched (reverts are last-in, first-out per file).
- It preserves CRLF files byte-for-byte: it detects `\r\n`, works in LF, and writes back in the file's own style.
- Legacy rows without an `apply_id` stay readable and are reported as not revertible.

**D11 — `contract` is a version string with an additive rule.** `"1.0"` on the verdict block, on the `findings` outputs and on the M17 state/progress JSON. Rules:
- Fields may be added within a major version and are never renamed or removed.
- Readers accept any `1.x` and ignore unknown fields.
- An unknown major is refused.

**D12 — `verify scope` is the mechanical half of M11.** It returns the phase's changed files that its plans did not declare:
- **Changed** = files touched by the phase's plan commits (subject `{type}({phase}-{plan}):`, no merges, bounded history), plus the summaries' `key-files`.
- **Declared** = the union of the plans' `files_modified`.

From the difference it:
- excludes the planning tree and lockfiles;
- tags tests that match a declared file's stem with `hint: test_for_declared`, so the verifier can accept supporting work quickly.

The verifier judges the candidates and records the real ones as `unrequested:`. The reviewer gets the same lens for behaviour.

### 3.3 Contract: the `pan-verdict` block (`contract "1.0"`)

The judge appends it as the last element of its return:

````markdown
```pan-verdict
{"contract":"1.0","agent":"pan-reviewer","phase":"03","verdict":"NEEDS_FIXES","outcome":"fail",
 "findings":[{"class":"defect","severity":"high","where":"src/utils/parser.ts:42","summary":"parse() drops the final token"}]}
```
````

| Field | Required | Values |
|---|---|---|
| `contract` | yes | `"1.x"` (a bare `1` is accepted and normalised) |
| `agent` | yes (or `--agent`) | the agent's name, `^[a-z][a-z0-9-]*$` |
| `outcome` | yes | `pass` · `fail` · `needs_human` |
| `verdict` | no | the agent's own word (`NEEDS_FIXES`, `issues_found`, `GAPS` …) |
| `phase` | no | informational; `--phase` wins, a mismatch is a warning |
| `findings[]` | no | at most 100; each `{class, severity, where?, summary}` |
| `findings[].class` | yes | `missing` · `partial` · `contradicts` · `unrequested` · `defect` · `risk` · `quality` · `human` |
| `findings[].severity` | yes | `critical` · `high` · `medium` · `low` · `info` (review-deep's ladder) |
| `findings[].where` | no | `path[:line]` or `plan-file#task`, 200 characters max |
| `findings[].summary` | yes | 300 characters max (longer is truncated with a warning) |

Parsing rules:
- The **last** fenced block whose info string is exactly `pan-verdict` wins. Backtick or tilde fences are accepted, and so is leading indentation: the host indents framed subagent results.
- Unknown class or severity values are recorded as `quality` / `info` and reported in `warnings[]`.
- If a known agent's `verdict` maps to a different outcome than the one given, `outcome_mismatch` is added to the warnings. The block's outcome is still recorded.
- A missing block, invalid JSON, an unsupported major or a missing required field → exit 1 with `{error, reason}`, so a workflow's `||` fallback runs.

Native verdict → outcome (`KNOWN_VERDICTS`):

| Agent | pass | fail | needs_human |
|---|---|---|---|
| pan-verifier | `passed` | `gaps_found` | `human_needed` |
| pan-plan-checker | `passed` | `issues_found` | — |
| pan-reviewer | `PASS`, `PASS_WITH_WARNINGS` | `NEEDS_FIXES` | — |
| pan-design-checker | `PASS` | `GAPS` | — |

Class guide, shipped in `references/verdict-contract.md`:

| Judge | Mapping |
|---|---|
| plan checker | requirement coverage → `missing`; task completeness, verification derivation, spec sufficiency, decision trace → `partial`; dependency correctness → `defect`; key links, test coverage, Nyquist → `missing`; scope sanity → `risk`; context compliance → `contradicts`; standards → `quality`. Blocker → `high`, warning → `medium`, info → `info` |
| reviewer | Convention → `quality`; Security → `risk`; Code Quality → `defect`; work no plan asked for → `unrequested`. ERROR → `high`, WARNING → `medium`, INFO → `info` |
| design checker | requirement coverage → `missing`; architecture conformance → `contradicts`; threat coverage → `risk`; scope discipline → `unrequested`; others → `partial`; every gap `high` unless the checker marks it a caveat (`medium`) |

**verification.md adapter** (used when the file has no block):
- `status` gives the verdict; the outcome comes from the table above.
- `gaps[]` → `missing` (failed) or `partial` (partial), `high` or `medium`. `where` is the first artifact path; `summary` is the truth plus the reason.
- `human_verification[]` → `human`, `info`.
- `unrequested[]` (new) → `unrequested`, `low`, where `path`, summary `what`.

### 3.4 Contract: the findings ledger (`.planning/findings.jsonl`, row `v: 1`)

```json
{"v":1,"kind":"verdict","ts":"…","verdict_id":"v_3f2a…","record_sig":"9c1e…","phase":"03","milestone":"v1.1","agent":"pan-verifier","verdict":"gaps_found","outcome":"fail","attempt":2,"source":".planning/phases/03-auth/03-verification.md","finding_ids":["f_81ab…"],"by_severity":{"high":1},"warnings":[]}
{"v":1,"kind":"finding","ts":"…","id":"f_81ab…","verdict_id":"v_3f2a…","phase":"03","milestone":"v1.1","agent":"pan-verifier","class":"missing","severity":"high","where":"src/auth/login.ts","summary":"login never checks the password — handler returns 200"}
{"v":1,"kind":"disposition","ts":"…","id":"f_5d0c…","disposition":"fixed","reason":"not reported by pan-verifier at attempt 2","auto":true,"verdict_id":"v_3f2a…"}
```

Rules:
- A finding row is written once per id. A verdict re-reporting an id lists it in `finding_ids`.
- Every recorded input produces exactly one `appendFileSync` of all its rows.
- `source` is a POSIX path relative to the project.
- **Status fold.** The latest disposition wins, except that `fixed` gives way to `open` when a newer verdict lists the id. With no disposition the finding is `open`.

### 3.5 Contract: trace events

The verdict events are written by `findings record` through `logTraceEvent`; the tool-error events by the hook, whose trace schema `v` moves from 4 to 5.

| Type/category | Written by | Context |
|---|---|---|
| `decision/verdict_passed` · `error/verdict_failed` · `decision/verdict_needs_human` | `findings record` (not on a duplicate) | `agent, phase, verdict, attempt, findings, by_severity, by_class, verdict_id`; impact `major` for a failure with a `critical`/`high` finding, else `minor` |
| `correction/verdict_retry` | `findings record`, when attempt ≥ 2 and the previous verdict failed | `agent, phase, attempt, previous_outcome, outcome, auto_fixed, reopened, verdict_id` |
| `error/tool_error` | trace hook, agent-transcript path only | `tool, error_class, exit_code, message, message_sig, count, command, agent_id`; impact `minor` |
| `decision/agent_completion` (existing) | trace hook | gains `tool_calls`, `tool_errors` (null unless read from the agent's own transcript) |

`error_class` is one of: `exit_code`, `permission_denied`, `not_found`, `tool_input`, `edit_precondition`, `user_rejected`, `network_or_timeout`, `other`. These are the classes measured in §1.1.

`analyzeEvents` counts the legacy categories alongside the new ones:
- `verification_passed`/`_gaps`/`_human_needed`, `plan_verified`, `plan_checker_issues`, `reviewer_correction` and `reviewer_warnings` are all counted, so old sessions still analyse.
- `summary.reviewer_corrections` counts the legacy category plus `verdict_failed` by `pan-reviewer`.

### 3.6 Contract: apply records (`optimization/applied.jsonl`)

```json
{"ts":"…","kind":"apply","apply_id":"apl_20260928_141501_7c2e","report":"sess_auto_20260928-report.md","applied_count":2,"skipped_count":1,"applied_types":["memory_append","note"],
 "actions":[{"i":0,"type":"memory_append","path":".planning/memory/pan-executor.md","kind":"appended","text":"\n- run the suite with npm run test:all","sha256_after":"…","action_sig":"…"}]}
{"ts":"…","kind":"revert","apply_id":"apl_20260928_141501_7c2e","reverted":[0],"refused":[]}
```

### 3.7 CLI surface

| Command | Output (`--raw`) | Notes |
|---|---|---|
| `findings record --phase N (--file P \| --text T \| --stdin) [--agent A]` | JSON `{contract, recorded, duplicate, verdict_id, agent, verdict, outcome, attempt, findings, new, auto_fixed, reopened, warnings}` (`--raw`: the native verdict, else the outcome) | exit 1 on unparseable input; exit 0 whatever the outcome (a failed verdict is data) |
| `findings list [--phase N] [--agent A] [--status S] [--class C] [--milestone V]` | `{contract, findings[], counts}` | also the MCP resource `pan://findings` |
| `findings dispose (<id>… \| --phase N [--agent A] --open) --as D [--reason R]` | `{contract, disposed[], skipped[]}` | reason required for `deferred`/`dismissed`/`decision` |
| `findings debt [--milestone V]` | `{contract, milestone, phases[{phase, deferred[], open[]}], deferred_count, open_count}` | defaults to the current milestone |
| `verify scope <phase>` | `{phase, declared[], changed[], candidates[{path, hint}], excluded[]}` | read-only; git optional (falls back to summaries) |
| `optimize revert (<apply_id> \| --last)` | `{apply_id, reverted[], refused[{i, path, reason}], status}` | status `reverted` · `partial` · `nothing_to_revert` |
| `optimize learn --sessions <n>` | as today, plus `pooled_sessions[]` | pools the last n sessions by start time |

### 3.8 The regression verdict: deferred, with a trigger

`optimize verdict <apply_id>` would compare judge failure rates in the sessions before and after an apply. The data it needs will exist after this feature: verdicts in every session, and apply timestamps with ids. What does not exist is use: one apply run across 14 field projects. Building the verb now would add surface for no user. The apply records keep everything it needs, so it can be added later without a migration.

**Trigger:** `optimize stats` shows apply runs in three or more projects. **Answer to the write-up's owner questions:**
1. Yes, ship revert first, together with the signal.
2. The loop is worth fixing (signal and safety) but not worth growing (verdict) until it is used.

### 3.9 Files

| File | Change |
|---|---|
| `pan-wizard-core/bin/lib/verdict.cjs` (new) | pure: `parseVerdictBlock`, `validateVerdict`, `verdictFromVerificationFrontmatter`, `findingId`, `recordSig`, constants (`VERDICT_CONTRACT`, `FINDING_CLASSES`, `OUTCOMES`, `DISPOSITIONS`, `KNOWN_VERDICTS`, `AUTO_FIX_EXEMPT`) |
| `pan-wizard-core/bin/lib/findings.cjs` (new) | ledger IO and fold: `readLedger`, `foldFindings`, `recordVerdict`, `disposeFindings`, `listFindings`, `findingsDebt`, `cmdFindings*` |
| `pan-wizard-core/bin/pan-tools.cjs` | `case 'findings'` arm; `verify scope` sub-arm; `optimize revert` and `learn --sessions` |
| `pan-wizard-core/bin/lib/verify.cjs` | `scopePhase()` + `cmdVerifyScope` |
| `pan-wizard-core/bin/lib/optimize.cjs` | apply ids, action records, re-apply guard, `revertApply`, `cmdOptimizeRevert`; `analyzeEvents` tool-error patterns and verdict stats; pooled learn; stats count reverts |
| `pan-wizard-core/bin/lib/review-deep.cjs` | `parseReviewFindings` takes findings from a `pan-verdict` block when present |
| `pan-wizard-core/bin/lib/state.cjs`, `commands.cjs` | `contract: "1.0"` on `state` (load), `state json`, `progress` JSON |
| `pan-wizard-core/mcp/tool-registry.cjs` | resource `pan://findings` |
| `hooks/pan-trace-logger.js` | `readTranscriptSlice`, `extractToolFailures`, `classifyToolError`, `redactErrorText`, `errorCaptureEnabled`; completion gains `tool_calls`/`tool_errors`; `SCHEMA_V` 5; agent name falls back to `agent-<id>.meta.json` |
| `agents/pan-plan-checker.md`, `pan-reviewer.md`, `pan-design-checker.md` | the `pan-verdict` block in their return contracts; the reviewer's unrequested lens |
| `agents/pan-verifier.md`, `templates/verification-report.md` | `unrequested:` frontmatter, a scope step that runs `verify scope` |
| `pan-wizard-core/references/verdict-contract.md` (new) | the contract, the class guide, examples; loaded by the judges |
| `workflows/exec-phase.md` | persist review.md; `findings record` for review and verification (grep kept as the fallback); dispositions on continue; `--deep-review` step; drop the `$REVIEW_OUTPUT` and verdict trace-log blocks |
| `workflows/plan-phase.md` | persist plan-check.md; record; branch on the verb; dispose at force-proceed; drop the two checker trace-log blocks |
| `workflows/verify-phase.md` | record at return; drop the two trace-log blocks |
| `workflows/milestone-audit.md` | tech debt and undisposed findings from `findings debt` |
| `commands/pan/design-phase.md` | persist design-check.md; record |
| `commands/pan/review-deep.md` | reviewer path `{phase_dir}/{padded}-review.md`; exec-phase writes it (now true) |
| `commands/pan/exec-phase.md`, `optimize.md`, `learn.md`; `workflows/optimize.md`, `learn.md`; `agents/pan-optimizer.md` | document record/dispose, revert, `--sessions`, the new analysis fields |
| `harness/scenarios/evidence-loop.json` (new, tier 0) + `harness/scripts/evidence-loop.cjs` | the loop against a deployed install, model-free |
| `harness/scenarios/tool-error-capture.json` (new, tier 1) | a model run on the `uat-with-failure` seed; asserts a captured `tool_error` (paid, `--max-usd`) |
| Tests | see §4.3 |
| Docs | `docs/HOOKS.md`, `CLI-REFERENCE.md`, `USER-GUIDE.md` (evidence section; the `error_pattern_learning` row), `ARCHITECTURE.md` (ledger), `CHANGELOG.md`, ADR-0049; the two investigation write-ups and M11/M12/M17 marked BUILT |

Installer and manifest: no installer code changes. The new reference, agents and workflows ship through the existing copy steps and appear in `pan-file-manifest.json` like any core file. The new modules ship under `pan-wizard-core/bin/lib/`. Fixture installs prove each runtime carries them intact.

---

## Phase 4 — Specification output

### 4.1 Implementation steps (dependency order)

1. `verdict.cjs` and its tests, which pin the contract before anything consumes it.
2. `findings.cjs` + dispatcher arm + `pan://findings` + tests; regenerate `module-surface.json` and `surface.json`.
3. `verify scope` + tests.
4. Agents, reference and template (the block, the class guide, `unrequested:`) + per-runtime conversion tests.
5. Workflows and commands (record, persist, dispose, deep-review, milestone-audit) + drift tests.
6. `review-deep.cjs` block path + test.
7. Trace hook capture + fixture + revert-proof.
8. `optimize` analysis, pooled learn, apply records, revert + tests.
9. M17 `contract` + tests.
10. Harness scenarios, docs, ADR, CHANGELOG, counts; the full gate run.

### 4.2 Runtime matrix

| Runtime | Supported | Notes |
|---|---|---|
| Claude | ✅ | everything, including hook capture from per-agent transcripts |
| Codex | ✅ (no capture) | verbs, block, workflows; the hook finds no per-agent transcript and records completions only |
| Gemini | ✅ (no capture) | verbs, block, workflows; no subagent-completion event |
| OpenCode | ✅ (no capture) | verbs, block, workflows; no hooks until M6 |
| Copilot | ✅ (no capture) | verbs, block, workflows; payload unverified (§5) |

### 4.3 Tests required

| Area | Cases |
|---|---|
| `verdict.cjs` | last block wins; tilde fence and indented fence; pretty and one-line JSON; missing block, invalid JSON, contract 2.0, missing outcome (all errors); unknown class/severity (recorded + warning); `outcome_mismatch`; >100 findings; long summary truncated; `contract: 1` normalised; adapter: gaps failed/partial, human items, unrequested, status→outcome |
| `findings.cjs` | record then list; duplicate artifact (same record_sig) is a no-op; attempts 1→2; auto-fix of unreported findings; human/unrequested exempt; reopen of a regressed fix; deferred not overridden by a re-report; dispose each disposition; missing reason refused (exit 1); unknown id skipped; bulk `--open` by agent; debt by milestone with deferred + open; `--raw` prints the native verdict; not a PAN project → error; trace events written (verdict_failed, verdict_retry) and none on a duplicate |
| `verify scope` | declared vs changed from summaries; from git commits by subject; lockfile and planning-tree exclusion; test-for-declared hint; no git repo → summaries only; unknown phase → error |
| Agents / conversion | each judge's shipped block example parses; the same after conversion for all five runtimes; the verifier template carries `unrequested:`; the reference ships to every runtime |
| Workflows (drift) | exec-phase records review and verification, persists review.md, keeps the grep fallback, disposes on continue, runs deep review on `--deep-review`, has no `$REVIEW_OUTPUT`; plan-phase records and disposes at force-proceed; verify-phase records; milestone-audit reads `findings debt`; review-deep's reviewer path is the phase-dir form; no remaining verdict-category `optimize trace log` calls |
| `review-deep.cjs` | a reviewer report with a block merges its findings (fails on the current parser) |
| Trace hook | fixture from the real record shape: tool_error events with tool, class, exit code, redacted message; dedupe with count; cap at 10; completion `tool_calls`/`tool_errors`; parent-slice path records none; `error_pattern_learning: false` records none; non-PAN directory writes nothing; resumed agent (cursor) not double counted; redaction cases (token, bearer, AKIA, JWT, long hex, home dir, query string); meta.json agent-name fallback; revert-proof against the pre-change hook |
| `optimize` | apply writes apply_id and records; second apply of the same report appends nothing; revert of memory_append byte-for-byte (LF and CRLF); revert of a created memory file; refuse hand-edited; refuse out-of-order on the same file; `--last`; legacy rows reported not revertible; analysis tool_error_patterns (spawns, sessions) and verdict_stats; `--sessions 2` pools; legacy verdict categories still counted |
| M17 | `state` / `state json` / `progress` carry `contract: "1.0"`; the MCP resources return it |
| Harness | tier 0 `evidence-loop` green on a packed install; tier 1 `tool-error-capture` defined (runs with `--max-usd`) |

### 4.4 Documentation updates

- `docs/HOOKS.md`: capture, redaction, the off switch, the runtime limits.
- `docs/CLI-REFERENCE.md`: the `findings` verb, `verify scope`, `optimize revert`, `learn --sessions`, the contract rule.
- `docs/USER-GUIDE.md`: an evidence-loop section, and the `execution.error_pattern_learning` row, which is no longer "Reserved".
- `docs/ARCHITECTURE.md`: the ledger and verdict flow.
- ADR-0049, and CHANGELOG `[Unreleased]`.
- Status lines in the two investigation write-ups, the investigations index and the market-ideas queue.

---

## Phase 5 — Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| A judge omits the block or emits invalid JSON | Medium: the verdict is not recorded | Exit 1 → each workflow keeps its current parse as the `\|\|` fallback, so control flow never depends on the new verb alone |
| Workflow prose changes regress the phase pipeline | High | Drift tests on every edited step; fallbacks kept; tier-0 harness on a deployed install; the tier-1/2 chain scenarios remain the behavioural check |
| Secrets in captured error text end up in committed traces | High | Mandatory redaction with tests, 160-character cap, off switch; nothing leaves `.planning/` |
| Noise: expected failures (TDD red, grep no match) read as problems | Medium | Class and count recorded; learn ranks by recurrence across spawns and sessions; the optimizer is told never to write memory from one occurrence |
| Auto-fix marks a reworded finding fixed | Low | Documented; open count stays correct; human/unrequested exempt; deliberate dispositions never overridden |
| Revert deletes user content | High | Hash check (EOL-tolerant) refuses any file changed since the apply; last-in, first-out per file; created files only deleted when unchanged |
| Hook slowdown at SubagentStop | Low | One extra read of the agent's own file, capture skipped on every other path |
| Copilot completions recorded as `unknown` with zero tokens (existing, not introduced). The documented camelCase payload names every field differently from what the loggers read; the event-name guard is not the cause, because camelCase payloads carry no event name | Medium | Plan item Q-4: accept the documented camelCase aliases in both loggers, with a fixture built from the reference; a live probe before any claim that Copilot rows are right. Tool-failure capture stays off on Copilot either way (no per-subagent transcript) |
| Ledger growth | Low | Rows are small (a few KB per phase); one file per project |
| Two writers append at once (parallel judges) | Low | One `appendFileSync` per record call; the fold tolerates any interleaving |

---

## Answers to the write-ups' open questions

- *Keep or delete the workflow-prose `optimize trace log` calls the hook makes redundant?* Delete the verdict-path calls: `findings record` writes those events on every runtime. Keep the decisions only the orchestrator knows (memory primed, wave complete, phase complete, plans created, auto-mode bypasses).
- *Is the verdict match stable enough, or should the verifier and plan-checker emit a machine line?* Emit a machine block, read by a verb rather than by the hook (D1, D2).
- *Ship revert alone first?* Revert ships with the signal. The verdict verb waits for use (§3.8).
- *Is the optimize loop worth the investment?* Fixing the signal and making apply safe is worth it. Growing it is not, until it is used.
