/**
 * Design hand-off -- where /pan:focus-design writes its design, and where the design
 * goes next (spec focus_phase_integration_featureai.md, D6).
 *
 * `design paths <slug>`: a project that keeps designs in `docs/specs/` and
 * `docs/decisions/` (PAN's own source repository, or a project that adopted that
 * layout) gets those, with the next ADR number; any other project gets
 * `.planning/designs/<slug>/`, which focus-plan already reads. The design used to
 * land in `docs/` whatever the project, where nothing else in PAN looked.
 *
 * `design handoff <spec> --as phase|focus`: `phase` adds a roadmap phase whose entry
 * names the spec (`**Design:**`) and returns `/pan:plan-phase <N> --prd <spec>`, so
 * the spec becomes the phase's context through plan-phase's PRD intake; `focus`
 * returns the focus-auto plan step that reads it. Nothing is added without a choice.
 */

const fs = require('fs');
const path = require('path');
const { output, toPosix, generateSlugInternal } = require('./core.cjs');
const { planningPath, planningRel } = require('./utils.cjs');

const HANDOFF_AS = ['phase', 'focus'];

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The next ADR number in a decisions directory, zero-padded to four. */
function nextAdrNumber(dir) {
  let max = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* none yet */ }
  for (const n of names) {
    const m = /^ADR-(\d+)/i.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(4, '0');
}

/**
 * Where a design's spec, decision record and checker verdict go.
 * @param {string} cwd
 * @param {string} name - A slug or a feature name (slugged)
 * @returns {{layout: 'docs'|'planning', slug, spec, decision, check, adr_number?}|{error, reason}}
 */
function designPaths(cwd, name) {
  const slug = generateSlugInternal(String(name || '').trim());
  if (!slug) return { error: 'slug_required', reason: 'Usage: design paths <feature name or slug>' };
  const specs = path.join(cwd, 'docs', 'specs');
  const decisions = path.join(cwd, 'docs', 'decisions');
  if (isDir(specs) && isDir(decisions)) {
    const adr = nextAdrNumber(decisions);
    return {
      layout: 'docs', slug,
      spec: `docs/specs/${slug}_featureai.md`,
      decision: `docs/decisions/ADR-${adr}-${slug}.md`,
      check: `docs/specs/${slug}_featureai.check.md`,
      adr_number: adr,
    };
  }
  const base = planningRel('designs', slug);
  return { layout: 'planning', slug, spec: `${base}/spec.md`, decision: `${base}/decision.md`, check: `${base}/check.md` };
}

/** A spec's title (its first `#` heading) and one-line problem statement. Pure. */
function readSpecHeadline(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const h1 = lines.find((l) => /^#\s+\S/.test(l));
  const title = h1 ? h1.replace(/^#\s+/, '').replace(/^(?:feature|spec(?:ification)?)\s*:\s*/i, '').replace(/[*_`]/g, '').trim() : null;
  let problem = null;
  const at = lines.findIndex((l) => /^#{2,4}\s+.*\bproblem\b/i.test(l));
  if (at !== -1) {
    const para = [];
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^#{1,6}\s/.test(l)) break;
      if (!l) { if (para.length) break; continue; }
      if (/^[|`>-]/.test(l)) { if (para.length) break; continue; }
      para.push(l);
    }
    if (para.length) {
      const joined = para.join(' ').replace(/[*_`]/g, '');
      const first = (/^(.+?[.!?])(\s|$)/.exec(joined) || [null, joined])[1];
      problem = first.length > 200 ? `${first.slice(0, 197)}...` : first;
    }
  }
  return { title, problem };
}

/**
 * Hand a finished design to the phase system or to focus.
 * @param {string} cwd
 * @param {string} spec - The spec, relative to the project (or absolute inside it)
 * @param {{as: string}} opts
 * @returns {Object}
 */
function designHandoff(cwd, spec, opts = {}) {
  if (!HANDOFF_AS.includes(opts.as)) return { error: 'invalid_as', reason: `--as must be one of: ${HANDOFF_AS.join(', ')}` };
  if (!spec) return { error: 'spec_required', reason: 'Usage: design handoff <spec> --as phase|focus' };
  const abs = path.resolve(cwd, spec);
  const rel = toPosix(path.relative(cwd, abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { error: 'spec_outside_project', reason: `${spec} is not inside the project` };
  let text;
  try { text = fs.readFileSync(abs, 'utf-8'); } catch { return { error: 'spec_not_found', reason: `spec not found: ${rel}` }; }
  const head = readSpecHeadline(text);
  const title = head.title || path.basename(rel, '.md');

  if (opts.as === 'focus') {
    return { as: 'focus', spec: rel, title, command: '/pan:focus-auto --step plan --mode features', note: `focus-plan reads the spec; point it at ${rel} if it does not find it` };
  }

  let roadmap;
  try { roadmap = fs.readFileSync(planningPath(cwd, 'roadmap.md'), 'utf-8'); } catch {
    return { error: 'no_roadmap', reason: 'this project has no roadmap: start it with /pan:new-project, or hand the design to focus (--as focus)' };
  }
  // Handing the same design off twice would add a second phase for it.
  const marker = new RegExp(`^\\*\\*Design:\\*\\*\\s*${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  if (marker.test(roadmap.replace(/\r\n/g, '\n'))) return { error: 'already_handed_off', reason: `the roadmap already has a phase for ${rel}` };

  const added = require('./phase.cjs').phaseAdd(cwd, title, { goal: head.problem || `Build the design in ${rel}`, design: rel });
  if (added.error) return added;
  return {
    as: 'phase', spec: rel, title, phase_number: added.phase_number, directory: added.directory,
    command: `/pan:plan-phase ${added.phase_number} --prd ${rel}`,
  };
}

function cmdDesign(cwd, sub, args, raw) {
  const flag = (f) => { const i = args.indexOf(f); return i !== -1 && i + 1 < args.length && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined; };
  const positional = args.filter((a, i) => !String(a).startsWith('--') && !(i > 0 && String(args[i - 1]).startsWith('--')));
  let r;
  if (sub === 'paths') {
    r = designPaths(cwd, positional.join(' '));
    if (r.error) return output(r, raw, r.reason, 1);
    return output(r, raw, r.spec);
  }
  if (sub === 'handoff') {
    r = designHandoff(cwd, positional[0], { as: flag('--as') });
    if (r.error) return output(r, raw, r.reason, 1);
    return output(r, raw, r.command);
  }
  return output({ error: 'unknown_subcommand', reason: 'Usage: design paths <name> | design handoff <spec> --as phase|focus' }, raw, 'unknown subcommand', 1);
}

module.exports = { designPaths, designHandoff, readSpecHeadline, nextAdrNumber, cmdDesign };
