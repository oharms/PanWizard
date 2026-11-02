/**
 * Open work -- the PAN units of work started and not finished, in one place.
 *
 * `/pan:resume` (through `init resume`) lists them and the guard's `unrouted_write`
 * rule asks whether any is in flight. The guard is a hook, copied alone into each
 * runtime's hook directory, so it cannot require this module: hooks/pan-guard.js keeps
 * its own `workInFlight`, and tests/open-work.test.cjs pins the two to the same answer
 * (spec focus_phase_integration_featureai.md, A1-R).
 */

const fs = require('fs');
const path = require('path');
const { PHASES_DIR, QUICK_DIR, STATE_FILE } = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');

const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const stem = (n, suffix) => n.slice(0, -suffix.length);

/** The phase state.md names, as the guard reads it, or null. */
function currentPhase(cwd) {
  const state = read(planningPath(cwd, STATE_FILE));
  if (!state) return null;
  const m = state.match(/\*\*Current Phase:\*\*[ \t]*([0-9]+(?:\.[0-9]+)?)/i) || state.match(/^Phase:[ \t]*([0-9]+(?:\.[0-9]+)?)/m);
  return m ? String(parseFloat(m[1])) : null;
}

/** Plans in a directory with no summary of the same stem. */
function unfinishedPlans(dir) {
  const names = list(dir);
  const done = new Set(names.filter((n) => n.endsWith('-summary.md')).map((n) => stem(n, '-summary.md')));
  return names.filter((n) => n.endsWith('-plan.md') && !done.has(stem(n, '-plan.md')));
}

/**
 * The work started and not finished.
 * @param {string} cwd - Project root
 * @returns {{in_flight: boolean, phase_plans: Array, quick: Array, debug: Array, continue_here: Array}}
 *   in_flight is the guard's question: an unfinished plan in the phase state.md names,
 *   an open quick task (focus cycles included), or a debug session. phase_plans lists
 *   every phase's unfinished plans, `current` marking the ones that count; a plan with
 *   a step journal adds `resume_at`, `completed_steps` and `unverified_steps`.
 */
function openWork(cwd) {
  const current = currentPhase(cwd);
  const phasePlans = [];
  const continueHere = [];
  for (const dir of list(planningPath(cwd, PHASES_DIR))) {
    const n = dir.match(/^(\d+(?:\.\d+)?)-/);
    if (!n) continue;
    const full = planningPath(cwd, PHASES_DIR, dir);
    // A plan with a step journal resumes at the first task it cannot prove done
    // (journal.cjs); one without restarts at its first task, as before.
    const journals = require('./journal.cjs').journalsIn(cwd, full);
    for (const plan of unfinishedPlans(full)) {
      const j = journals[plan];
      phasePlans.push({
        phase: dir, plan: planningRel(PHASES_DIR, dir, plan), current: String(parseFloat(n[1])) === current,
        ...(j ? { resume_at: j.resume_at, completed_steps: j.completed, unverified_steps: j.unverified } : {}),
      });
    }
    for (const f of list(full).filter((x) => x.startsWith('.continue-here') && x.endsWith('.md'))) {
      continueHere.push({ path: planningRel(PHASES_DIR, dir, f) });
    }
  }

  const quick = [];
  for (const task of list(planningPath(cwd, QUICK_DIR))) {
    const dir = planningPath(cwd, QUICK_DIR, task);
    for (const plan of unfinishedPlans(dir)) {
      const fm = extractFrontmatter(read(path.join(dir, plan)) || '');
      const focus = String(fm.source || '').replace(/^["']|["']$/g, '') === 'focus';
      quick.push({
        dir: planningRel(QUICK_DIR, task), plan: planningRel(QUICK_DIR, task, plan), source: focus ? 'focus' : 'quick',
        ...(focus ? { kind: fm.focus_kind || null, run_id: fm.run_id && fm.run_id !== 'null' ? fm.run_id : null, opened_at: fm.opened_at || null } : {}),
      });
    }
  }

  const debug = list(planningPath(cwd, 'debug')).filter((n) => n.endsWith('.md')).map((n) => ({ file: planningRel('debug', n) }));

  return {
    in_flight: phasePlans.some((p) => p.current) || quick.length > 0 || debug.length > 0,
    phase_plans: phasePlans, quick, debug, continue_here: continueHere,
  };
}

module.exports = { openWork };
