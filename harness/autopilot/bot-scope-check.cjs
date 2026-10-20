'use strict';
/**
 * The autopilot's scope check and canary check (program S2). Development only.
 *
 * A bot that can edit its own evaluator can make anything pass (the Darwin Gödel
 * Machine's lesson). So a bot run's changed files are checked against its lane: files
 * outside the lane's paths are refused, and so are evaluator files wherever they sit:
 * scenarios, sims, corpus, allowlists, coverage policy, the lints, CI, and the autopilot
 * itself. Canary mutants are commands that must fail; a run after which one passes has
 * gamed the evaluator and is refused.
 */

const EVALUATOR = [
  /^harness\/(scenarios|sims|corpus|corpus-replays|cassettes|autopilot)\//,
  /^harness\/src\//,
  /^tests\/fixtures\/[^/]*allowlist[^/]*\.json$/,
  /^tests\/fixtures\/coverage-policy\.json$/,
  /^tests\/fixtures\/prompt-rules\.json$/,
  /^tests\/fixtures\/surface\.json$/,
  /^scripts\/(test-quality-lint|prompt-lint|prompt-rules|test-surface|coverage-gate|mutation-probe)\.cjs$/,
  /^\.github\//,
  /^\.claude\//,
];

const norm = (f) => String(f).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * @param {string[]} files - the run's changed files
 * @param {{paths?: string[]}} lane
 * @returns {{ok: boolean, refused: Array<{file, reason: 'evaluator'|'outside_lane'}>}}
 */
function scopeCheck(files, lane = {}) {
  const paths = (lane.paths || []).map(norm);
  const refused = [];
  for (const raw of files) {
    const f = norm(raw);
    if (EVALUATOR.some((re) => re.test(f))) refused.push({ file: f, reason: 'evaluator' });
    else if (paths.length && !paths.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`))) refused.push({ file: f, reason: 'outside_lane' });
  }
  return { ok: refused.length === 0, refused };
}

/**
 * @param {Object<string, 'red'|'green'>} before - each canary's result before the run (red expected)
 * @param {Object<string, 'red'|'green'>} after
 */
function canaryCheck(before, after) {
  const gamed = Object.keys(before).filter((id) => before[id] === 'red' && after[id] !== 'red');
  return { ok: gamed.length === 0, gamed };
}

module.exports = { scopeCheck, canaryCheck, EVALUATOR };
