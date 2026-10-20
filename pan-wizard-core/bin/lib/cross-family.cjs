'use strict';
/**
 * The cross-family reviewer lane (program R4): `pan-tools review cross-family <phase>`.
 *
 * A reviewer from the same model family as the author tends to share its blind spots.
 * This lane runs one more review of the phase on another host's CLI, read-only (the
 * argv is hosts.cjs `review`), and keeps its pan-verdict block beside the others, so
 * review-deep can merge it as a fourth source (`--cross-file`).
 *
 * Opt-in per project: `workflow.cross_family_review` is `off` by default, or names a
 * host. `--host` overrides it for one run; `--dry-run` prints the lane, the argv and the
 * prompt and spawns nothing; `--reps N` runs it N times and reports each verdict, which
 * is what the lane's evidence run needs.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { output, execGit, safeReadFile, toPosix } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { HOSTS } = require('./hosts.cjs');
const { findVerdictBlocks, validateVerdict } = require('./verdict.cjs');

const MAX_DIFF_CHARS = 120000;
// Windows caps a command line near 32k characters; a longer prompt goes through a file.
const MAX_ARG_PROMPT = 24000;

function laneHost(cwd, override) {
  if (override) return override;
  const wf = (require('./test-gate.cjs').rawConfig(cwd).workflow) || {};
  const v = wf.cross_family_review;
  return typeof v === 'string' && v && v !== 'off' ? v : null;
}

function buildPrompt(cwd, phase) {
  const { reviewScope } = require('./verify-scope.cjs');
  const scope = reviewScope(cwd, phase);
  if (scope.error) return { error: scope.error, reason: scope.reason };
  let diff = '';
  if (scope.base) {
    const r = execGit(cwd, ['diff', scope.base, '--', ...scope.files.map((f) => f.path)]);
    if (r.exitCode === 0) diff = r.stdout;
  } else if (scope.files.length) {
    const r = execGit(cwd, ['diff', 'HEAD', '--', ...scope.files.map((f) => f.path)]);
    if (r.exitCode === 0) diff = r.stdout;
  }
  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS);
  const contract = safeReadFile(path.join(__dirname, '..', '..', 'references', 'verdict-contract.md')) || '';
  const intent = scope.intent.plans.map((p) => `### ${p.plan}\n${p.objective || ''}${p.review_focus ? `\n\nReview focus:\n${p.review_focus}` : ''}`).join('\n\n');
  const reqs = scope.intent.requirements.map((r) => `- ${r.id}: ${r.text || '(missing)'}`).join('\n');
  const prompt = [
    `You are an independent code reviewer from a different model family than the author. Review phase ${scope.phase} of this project: find correctness, security and maintainability defects in the change below, judged against the plans' intent. Do not edit anything.`,
    `Reply with one fenced \`pan-verdict\` block, as the contract below defines: \`"contract": "1.0"\`, \`"agent": "cross-family-reviewer"\`, \`"phase": "${scope.phase}"\`, a \`verdict\` and \`outcome\`, and one finding per defect (\`where\` as \`file:line\`). Name what you could not judge in \`declined\`.`,
    '## Verdict contract', contract.trim(),
    '## Intent', intent || '(no plans found)', reqs ? `## Requirements\n${reqs}` : '',
    `## Files in scope\n${scope.files.map((f) => `- ${f.path}`).join('\n') || '(none)'}`,
    `## Diff${scope.base ? ` (from ${scope.base.slice(0, 12)})` : ''}${truncated ? ' (truncated)' : ''}`, '```diff', diff || '(no diff)', '```',
  ].filter(Boolean).join('\n\n');
  return { phase: scope.phase, prompt, truncated };
}

function parseVerdict(text) {
  const blocks = findVerdictBlocks(text || '');
  const last = blocks.filter((b) => b.closed).pop();
  if (!last) return { verdict: null, error: 'no_verdict_block' };
  try {
    const r = validateVerdict(JSON.parse(last.body));
    return r.ok ? { verdict: r.verdict } : { verdict: null, error: r.error };
  } catch { return { verdict: null, error: 'invalid_json' }; }
}

/**
 * Plan or run the lane. Pure apart from reading the project and, without dryRun,
 * spawning the host and writing `.planning/reviews/<NN>/cross-family-<host>.md`.
 */
function crossFamilyReview(cwd, phase, opts = {}) {
  if (!phase) return { error: 'phase_required', reason: 'Usage: review cross-family <phase> [--host <name>] [--reps N] [--dry-run]' };
  const host = laneHost(cwd, opts.host);
  if (!host) return { enabled: false, reason: 'lane_off', hint: 'set workflow.cross_family_review to a host, or pass --host' };
  const h = HOSTS[host];
  if (!h || !h.review) return { error: 'unknown_host', reason: `no review lane for host "${host}"`, hosts: Object.keys(HOSTS) };
  const built = buildPrompt(cwd, phase);
  if (built.error) return built;
  const nn = String(built.phase).padStart(2, '0');
  const dir = planningPath(cwd, 'reviews', nn);
  let prompt = built.prompt;
  let promptFile = null;
  if (h.review.promptVia === 'arg' && prompt.length > MAX_ARG_PROMPT) {
    promptFile = path.join(dir, `cross-family-${host}-prompt.md`);
    prompt = `Read ${toPosix(path.relative(cwd, promptFile))} and follow it exactly. Do not edit anything.`;
  }
  const argv = h.review.args(h.review.promptVia === 'arg' ? prompt : '');
  const base = {
    enabled: true, lane: `cross-family:${host}`, host, family: h.family, bin: h.bin,
    argv, prompt_via: h.review.promptVia, truncated_diff: built.truncated,
  };
  if (opts.dryRun) return { ...base, prompt: built.prompt, prompt_file: promptFile && toPosix(path.relative(cwd, promptFile)), dry_run: true };

  fs.mkdirSync(dir, { recursive: true });
  if (promptFile) fs.writeFileSync(promptFile, built.prompt);
  const reps = Math.max(1, Math.min(10, Number(opts.reps) || 1));
  const runs = [];
  const outputs = [];
  const refused = require('./autodev.cjs').standinMissing(h.bin);
  if (refused) return { ...base, error: 'standin_missing', reason: refused };
  for (let i = 0; i < reps; i++) {
    const r = spawnSync(h.bin, argv, {
      cwd, encoding: 'utf8', input: h.review.promptVia === 'stdin' ? built.prompt : undefined,
      shell: process.platform === 'win32', timeout: Number(opts.timeoutMs) || 15 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error) return { ...base, error: 'spawn_failed', reason: r.error.message };
    const v = parseVerdict(r.stdout);
    outputs.push(r.stdout || '');
    runs.push({ rep: i + 1, exit: r.status, verdict: v.verdict ? v.verdict.verdict : null, outcome: v.verdict ? v.verdict.outcome : null, findings: v.verdict ? v.verdict.findings.length : 0, error: v.error });
  }
  const file = path.join(dir, `cross-family-${host}.md`);
  // The last parseable run is the one review-deep merges; every rep is kept for the record.
  const keep = outputs.map((o, i) => [o, runs[i]]).filter(([, r]) => r.outcome).pop();
  fs.writeFileSync(file, `# Cross-family review: phase ${nn} on ${host} (${h.family})\n\n${(keep ? keep[0] : outputs[outputs.length - 1]).trim()}\n`);
  const counts = {};
  for (const r of runs) if (r.verdict) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { ...base, reps, runs, verdict: majority ? majority[0] : null, file: toPosix(path.relative(cwd, file)) };
}

function cmdReviewCrossFamily(cwd, phase, opts, raw) {
  const r = crossFamilyReview(cwd, phase, opts);
  output(r, raw, r.file || r.reason || r.error);
}

module.exports = { crossFamilyReview, cmdReviewCrossFamily, buildPrompt, parseVerdict };
