#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: run the evidence loop end to end through a DEPLOYED Claude
 * install, model-free (plan item EL-12; ADR-0049).
 *
 *   node evidence-loop.cjs <workspace> <repo>
 *
 * Every check goes through the INSTALLED copies, the ones a user's host runs.
 * The unit suites exercise the source files. Steps:
 *   1. The installed trace hook, given a SubagentStop payload whose agent transcript
 *      holds failing tool calls (the record shape of tests/fixtures/hooks/
 *      subagent-tool-errors-claude.json), writes error/tool_error events.
 *   2. The installed engine records a verification with gaps. A passing
 *      re-verification closes them (auto-fix, attempt 2). A reviewer report with
 *      warnings is recorded and deferred with a reason, and `findings debt` reads
 *      the deferral back.
 *   3. `optimize learn` sees the captured failures and the verdicts.
 *   4. `optimize apply` writes a memory entry, and `optimize revert --last` restores
 *      the file byte for byte.
 * Prints JSON { checks, problems[] } and exits 1 on any problem.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, repo] = process.argv.slice(2);
const problems = [];
let checks = 0;
function check(ok, what) {
  checks++;
  if (!ok) problems.push(what);
  return ok;
}
function done() {
  console.log(JSON.stringify({ checks, problems }));
  process.exit(problems.length ? 1 : 0);
}
if (!ws || !repo || !fs.existsSync(ws)) { problems.push(`usage: evidence-loop.cjs <workspace> <repo> (got ${ws}, ${repo})`); done(); }

const tools = path.join(ws, '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const hook = path.join(ws, '.claude', 'hooks', 'pan-trace-logger.js');
if (!check(fs.existsSync(tools) && fs.existsSync(hook), 'the deployed Claude install carries pan-tools and the trace hook')) done();

function pan(args, input) {
  const r = spawnSync(process.execPath, [tools, ...args], { cwd: ws, encoding: 'utf8', input, timeout: 60000 });
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '') };
}
const json = (args, input) => { const r = pan(args, input); try { return JSON.parse(r.out); } catch { return { _unparsed: r.out, _code: r.code, _err: r.err }; } };
function substitute(value, map) {
  if (typeof value === 'string') return value.replace(/\{\{[A-Z_]+\}\}/g, (m) => (m in map ? map[m] : m));
  if (Array.isArray(value)) return value.map((v) => substitute(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, map)]));
  return value;
}
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(repo, 'tests', 'fixtures', 'hooks', name), 'utf8'));

// ── 1. The installed trace hook captures tool failures ──────────────────────
const SESSION = 'e1dence0-0000-4000-8000-000000000001';
const AGENT = 'aharness0evidence';
const tdir = path.join(ws, 'transcripts');
fs.mkdirSync(path.join(tdir, SESSION, 'subagents'), { recursive: true });
const parent = path.join(tdir, `${SESSION}.jsonl`);
// Built at runtime, never committed as a literal (the repository's gitleaks scan flags one).
const FAKE_SECRET = ['sk', 'fixture0123456789abcdef'].join('-');
const map = { '{{PROJECT_DIR}}': ws, '{{SESSION_ID}}': SESSION, '{{AGENT_ID}}': AGENT, '{{TRANSCRIPT_PATH}}': parent, '{{FAKE_SECRET}}': FAKE_SECRET };
const fx = substitute(fixture('subagent-tool-errors-claude.json'), map);
fs.writeFileSync(parent, JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: 'parent' } }) + '\n');
fs.writeFileSync(path.join(tdir, SESSION, 'subagents', `agent-${AGENT}.jsonl`), fx.agent.map((r) => JSON.stringify(r)).join('\n') + '\n');
const payload = substitute(fixture('subagent-stop-claude.json'), map);
const h = spawnSync(process.execPath, [hook], { cwd: ws, input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000 });
check(h.status === 0, `the installed trace hook exits 0 (got ${h.status}: ${h.stderr})`);
const tracesDir = path.join(ws, '.planning', 'optimization', 'traces');
const events = [];
try {
  for (const s of fs.readdirSync(tracesDir)) {
    const f = path.join(tracesDir, s, 'trace.jsonl');
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.trim()) events.push(JSON.parse(l));
  }
} catch { /* checked below */ }
const toolErrors = events.filter((e) => e.category === 'tool_error');
check(toolErrors.length === 4, `the hook wrote 4 tool_error events (got ${toolErrors.length})`);
check(toolErrors.every((e) => !String(e.context && e.context.message).includes(FAKE_SECRET)), 'no planted secret reached the trace');

// ── 2. Verdicts, auto-fix, dispositions, debt ───────────────────────────────
const phaseDir = path.join(ws, '.planning', 'phases', '01-greetings');
if (!check(fs.existsSync(phaseDir), 'the seed has phase 01-greetings')) done();
const verification = path.join(phaseDir, '01-verification.md');
fs.writeFileSync(verification, '---\nphase: 01-greetings\nstatus: gaps_found\ngaps:\n  - truth: "greet() says hello"\n    status: failed\n    reason: "greet() is a stub"\n    artifacts:\n      - path: "src/greet.js"\n---\n\n# Phase 1 verification\n');
const first = json(['findings', 'record', '--phase', '1', '--file', verification]);
check(first.recorded === true && first.outcome === 'fail' && first.attempt === 1 && first.findings === 1, `a gaps_found verification is recorded as attempt 1 with one finding (${JSON.stringify(first)})`);
fs.writeFileSync(verification, '---\nphase: 01-greetings\nstatus: passed\n---\n\n# Phase 1 re-verification\n');
const second = json(['findings', 'record', '--phase', '1', '--file', verification]);
check(second.attempt === 2 && second.auto_fixed === 1, `the passing re-verification is attempt 2 and closes the gap (${JSON.stringify(second)})`);
const FENCE = '`'.repeat(3);
const reviewFile = path.join(phaseDir, '01-review.md');
fs.writeFileSync(reviewFile, `## Code Review — Phase 01\n\n### Verdict\nPASS_WITH_WARNINGS\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '01', verdict: 'PASS_WITH_WARNINGS', outcome: 'pass', findings: [{ class: 'quality', severity: 'medium', where: 'src/greet.js:3', summary: 'greet() mixes formatting and I/O' }] })}\n${FENCE}\n`);
const reviewVerdict = pan(['findings', 'record', '--phase', '1', '--agent', 'pan-reviewer', '--file', reviewFile, '--raw']);
check(reviewVerdict.out === 'PASS_WITH_WARNINGS', `the reviewer's verdict word comes back raw (got ${reviewVerdict.out})`);
const disposed = json(['findings', 'dispose', '--phase', '1', '--agent', 'pan-reviewer', '--open', '--as', 'deferred', '--reason', 'accepted at review: PASS_WITH_WARNINGS']);
check(Array.isArray(disposed.disposed) && disposed.disposed.length === 1, `the warning is deferred with its reason (${JSON.stringify(disposed)})`);
const debt = json(['findings', 'debt']);
check(debt.deferred_count === 1 && debt.open_count === 0, `findings debt reports the deferral and nothing undisposed (${JSON.stringify({ d: debt.deferred_count, o: debt.open_count })})`);
check(((debt.phases || [])[0] || { deferred: [{}] }).deferred[0].reason === 'accepted at review: PASS_WITH_WARNINGS', 'the deferral keeps its reason');

// ── 3. optimize learn sees the captured failures and the verdicts ───────────
const learn = json(['optimize', 'learn']);
check(learn.summary && learn.summary.tool_errors === 5, `optimize learn counts the 5 captured failures (${JSON.stringify(learn.summary && learn.summary.tool_errors)})`);
check(learn.verdict_stats && learn.verdict_stats['pan-verifier'] && learn.verdict_stats['pan-verifier'].retries === 1, 'optimize learn sees the verifier\'s retry');

// ── 4. apply → revert round-trips a memory file ─────────────────────────────
const memFile = path.join(ws, '.planning', 'memory', 'pan-executor.md');
fs.mkdirSync(path.dirname(memFile), { recursive: true });
const before = '# pan-executor memory\n\n- existing rule\n';
fs.writeFileSync(memFile, before);
const reportFile = path.join(ws, '.planning', 'optimization', 'reports', 'harness-opt-report.md');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `# report\n\n## Auto-Apply Actions\n\n${FENCE}json\n${JSON.stringify([{ type: 'memory_append', path: '.planning/memory/pan-executor.md', content: '- run npm test before reporting done' }])}\n${FENCE}\n`);
const applied = json(['optimize', 'apply', '--report', reportFile]);
check(/^apl_/.test(String(applied.apply_id)) && fs.readFileSync(memFile, 'utf8') !== before, `optimize apply wrote the memory entry and named its apply (${applied.apply_id})`);
const again = json(['optimize', 'apply', '--report', reportFile]);
check(Array.isArray(again.applied) && again.applied.length === 0, 'applying the same report again writes nothing');
const reverted = pan(['optimize', 'revert', '--last', '--raw']);
check(reverted.out === 'reverted', `optimize revert --last reports reverted (got ${reverted.out})`);
check(fs.readFileSync(memFile, 'utf8') === before, 'the memory file is byte-for-byte what it was before the apply');

done();
