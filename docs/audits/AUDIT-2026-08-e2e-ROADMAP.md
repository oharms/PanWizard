# E2E Audit 2026-08 — Remediation Roadmap (Part 2)

**Companion to:** [`AUDIT-2026-08-e2e.md`](AUDIT-2026-08-e2e.md) (findings) · **Created:** 2026-08-05

> Point-in-time planning doc; counts describe the audit run and are exempt from the live-counts policy.

## Status — follow-up sweep applied (2026-08-05); pending independent re-verification

> **History (do not re-inflate):** the original banner falsely claimed "ALL 137 RESOLVED." The independent fix-verification re-audit ([`AUDIT-2026-08-e2e-VERIFICATION.md`](AUDIT-2026-08-e2e-VERIFICATION.md) @ `4baf609`) corrected that to **122/137 verified**, with **15 outstanding** (H7, M6, M26, M33, M34, M45, M57, M60, M61, M62, M64, M65, L34, L47 + L36) and **14 fix-pass regressions (2 High: N1 uninstall-deletes-unparseable-settings, N2 update.md local/global collapse)**.
>
> **This sweep** then fixed all 15 outstanding items and all 14 regressions (N1–N14): the 2 High regressions (settings-preservation + install-scope detection derived from the templated path), the M60 bridge-dir fail-closed hardening, M61/M62 hook guards, the missing M30/M32 CLI exit-code tests, and the doc/content residuals. Full suite: **3466 tests / 742 suites / 0 failures**, doc-lint + parity lint green. **This has NOT yet been independently re-verified** — treat "resolved" as "fixed + suite-green", pending a re-audit pass.

- **Part 1 (9 High):** 8 fully verified fixed via live reproduction; **H7 PARTIAL** (Example 6's closing "Continue normally" block still shows the old renumbering flow).
- **Part 2 (80 Medium + 48 Low):** all 7 batches below were executed, but verification upheld **14 outstanding items**: NOT_FIXED M33, M61, M62, L36; PARTIAL M6, M26, M34, M45, M57, M60, M64, M65, L34, L47.
  - **A** parity lint + path sweep (M37/M41/M52/M54/M55) + preventive `tests/shipped-content-prefix.test.cjs`
  - **B** dead gates & exit codes (M5/M9/M28/M30/M31/M32)
  - **C** core correctness/robustness/security (M3/M6/M8/M10–M29/M79)
  - **D** shipped-content drift (M1/M2/M4/M7/M34–M56/M80)
  - **E** docs corrections (M63–M78)
  - **F** test-coverage holes (M57/M58/M59)
  - **G** Low-tail hygiene (L1–L48)
- **The fix pass introduced 14 new confirmed issues (N1–N14** in the verification report**)**, including 2 High: uninstall can delete a user's unparseable `settings.json` (`bin/install.js`), and the M55 fix collapsed `update.md`'s local/global detection so global installs update as LOCAL.

Full suite: **3445 tests / 733 suites / 0 failures** at `4baf609` — but N12 (promised M30/M32 exit-code tests never added) and N13/N14 (vacuous assertions) mean green CI under-covers two of the fixed gates. The remainder of this document is the original planning record.

---

The audit's own "highest-leverage" guidance drives the ordering: close whole *classes* systemically (with a lint that prevents recurrence) before grinding individual items.

---

## Batch A — Runtime-parity lint + path sweep (systemic; do first)

**Why first:** this is the dominant High theme (H4/H6) and it recurs across the Medium tail. The root cause is that the installer's path-rewrite only recognizes the canonical `~/.claude/` prefix; any other prefix ships verbatim and breaks the 4 non-Claude runtimes + global installs. Fix the sources **and add a shipped-content lint** so the class can never come back.

- **A0 (preventive):** new test/lint asserting shipped content (`commands/`, `agents/`, `pan-wizard-core/workflows|templates|references/`) contains only the canonical `~/.claude/` prefix — no `./.claude/`, bare `.claude/`, or `$HOME/.claude/`. This guards H4, H6, and every item below.
- **Items:** M37 (`/pan:learn` `.claude/workflows/learn.md`), M41 (`/pan:settings` `@./.claude/…`), M52 (new-project.md `./.claude/` everywhere), M55 (update.md `$HOME/.claude/` not rewritten), M54 (global defaults path mismatch `~/.pan-wizard-core` vs `~/.pan-wizard`, stray `~/.gsd`).

**Effort:** M · **Risk:** low (mechanical) · closes a class + prevents recurrence.

## Batch B — Dead gates & wrong exit codes (trust-critical)

**Why:** same class as H3 — commands that *claim* to gate but always exit 0, so orchestrators/CI can't rely on them. Audit every CLI path routed through `output()` (which now takes an `exitCode` arg after H3).

- M9 (`campaign due` always exits 0), M30 (`verify stubs --gate` no-op on blocking findings), M32 (`learn lint` never non-zero despite docs), M28 (`dashboard --raw` discards output via raw=false), M31 (`validate health --repair` writes legacy config that disables the verifier gate), M5 (installer model-capability warning is dead code — `finishInstall` undefined `targetDir` in a swallowed catch).
- **Add CLI-level exit-code tests** for each (the H3 gap: pure functions were tested, the exit path was not).

**Effort:** M · **Risk:** medium (behavior change on exit codes — check CI/scenario consumers).

## Batch C — Core-module correctness & robustness

Crashes on malformed input, silent no-ops, and false "success" returns. User-facing bugs.

- **Crashes / injection / containment (do first, security-adjacent):** M22 (regex injection in `requirements mark-complete` — unescaped ID → `new RegExp`), M23 (`optimize apply` writes report-supplied relative paths with no containment check — path escape), M79 (Windows backslash `..` bypasses `saveLocalPatches` traversal guard), M10 (`scaffold` without `--phase` → raw TypeError), M24 (`phases list --include-archived` ENOENT), M3 (unguarded `fs.unlinkSync` aborts whole install).
- **Silent no-ops / false success:** M11 (`config-set` missing value reports updated:true), M27 (`state resolve-blocker` resolved:true with no match), M20 (`git commit` leaks subcommand token into files list — stages stray paths), M33 (executor blocker example omits `--text` → never recorded).
- **Wrong results / dead code:** M12 (phase-number normalization mismatch), M13 (`cost.rates` overrides skipped for versioned model ids), M19 (frontmatter inline-array lossy on `, `), M21 (`memory optimize` agent-log consolidation dead code), M26 (`experiment stop` can never stop — pid persisted too late), M8 (`isDreamDue` contract contradiction, no consumer), M14/M15 (distill false "phantom try/catch" + "REGRESSED" labels), M16 (`experiment new` installer step always fails in installed projects), M17/M38 (counts computed from source-repo layout → wrong in host projects), M18 (`prompts_complete` stop reason unreachable), M6 (statusline clobbers Gemini/Copilot custom statuslines), M25 (review-deep ignores `--cwd`), M29 (`validate deployment` hook-path check validates nothing).

**Effort:** L (largest batch) · **Risk:** medium · split across 2-3 sub-PRs by sub-group.

## Batch D — Shipped-content drift (commands / agents / workflows / templates)

Stale cross-refs, renamed-command leftovers, contradictory instructions, nonexistent-file references.

- **Commands/agents:** M1 (Copilot converter reads `allowed_tools:` no agent uses → no tool restrictions), M2 (`--copilot` missing from `--help`), M4 (upgrade never sweeps stale Claude skill shims), M7 (`--type plan|summary` vs code `plans`/`summaries`), M34 (`audit-deployment` false CRITICALs on healthy installs), M35/M36 (`experiment` stale status + `/pan:check` doesn't exist), M39 (`optimize` `trace status` → `trace current`), M40 (`retro` "modifies no files" false), M42 (`what-if` overwrite claim false), M43 (`help` phantom `--dry-run`), M44/M48 (`help`/help.md "42 commands" table omits 17 of 59 + embeds a count).
- **Workflows/templates:** M45 (diagnose-issues wrong agent), M46 (exec-phase nonexistent continuation-prompt template), M47 (execute-plan resume detection dead), M49 (milestone-audit doubled `v{version}-v{version}` prefix), M50 (milestone-new cites nonexistent `/pan:discuss-milestone`), M51 (uppercase researcher filenames), M53 (resume-project case-mismatched substitution), M56 (verify-phase wrong glob).
- **pan-zcode:** M80 (merge-approval instruction tells operator to use request id, not the nonce — no gated merge can be approved).

**Effort:** M-L (high volume, mostly mechanical) · **Risk:** low.

## Batch E — Docs correction batch

Prose that contradicts code. Several overlap themes already fixed in Part 1 (balanced-tier, install-from-source, Codex skills path) — fold in the same corrections.

- M63/M75 (ARCHITECTURE/USER-GUIDE stale map-codebase agent counts + UPPERCASE filenames), M64 (ARCHITECTURE "Codex hooks not supported" — contradicted), M65/M66/M67/M68 (CLI-REFERENCE phantom experiment/doc-lint flags), M69 (DEVELOPMENT local-testing refused by guard — same as H8), M70 (EXAMPLES milestone-done mid-milestone), M71/M76 (FAQ/README balanced=Opus — same as H5), M72 (FAQ Codex skills path — same as H9), M73 (MIGRATION impossible v2.10.0 rollback), M74 (TROUBLESHOOTING "no locking" — false since ADR-0030), M77/M78 (ADR-0027 status vs shipped; GLM/z.ai spec unmarked).

**Effort:** M · **Risk:** low.

## Batch F — Test-coverage holes

- M57: global-install mode (`--global`/`--config-dir`/env-var) — no positive coverage on any runtime. Add a scenario test per resolution path.
- M58: extract `pan-check-update.js`'s update-check logic out of the inline `node -e` string into a testable module, then cover it.
- M59: `pan-context-monitor.js` (134 lines threshold/debounce/escalation) — add behavioral tests.

**Effort:** M · **Risk:** low · high long-term value (these holes hid H1/H3-class bugs).

## Batch G — Low tail (48) — hygiene sweep

Embedded counts (count-SSoT violations), link rot, cosmetic drift. Largely mechanical; run the `doc-lint` count/flag scanners, delete embedded counts, fix stale links. Can piggyback on the next scheduled doc-audit rather than a dedicated PR.

**Effort:** S-M · **Risk:** trivial.

---

## Suggested sequencing

1. **A** (systemic parity lint — prevents recurrence, closes a class)
2. **B** (dead gates — trust) + **C-security** (M22/M23/M79 injection/containment)
3. **C-rest** (core correctness, 2-3 sub-PRs)
4. **D** + **E** (drift + docs — high volume, mechanical, parallelizable)
5. **F** (coverage holes)
6. **G** (Low hygiene — fold into routine doc-audit)

Each batch: fix → add/extend tests → `npm run test:all` green → live-verify installer-facing items in `d:\pantesting` → PR. Batches A–C are the real bug-fix value; D–G are drift/hygiene/coverage.
