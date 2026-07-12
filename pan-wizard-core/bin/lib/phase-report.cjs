/**
 * Phase report — per-phase graphical HTML deliverable (M1 of the phase-report
 * design; see the design dossier). Produces one self-contained HTML report per
 * phase plus a project-level timeline index, reusing hud.cjs's rendering
 * foundation verbatim so both surfaces look identical.
 *
 * Three layers, mirroring hud.cjs:
 *   1. collectPhaseData / collectIndexData — PURE reads of .planning/, deterministic
 *      given an injected `now`, never write/exec, never throw on missing artifacts.
 *   2. renderPhaseHtml / renderIndexHtml — PURE string producers, one self-contained
 *      document each; every project-derived value is HTML-escaped via esc().
 *   3. cmdReport — the ONLY side-effecting layer: resolves paths, writes (skipping a
 *      write when only the timestamp changed), optionally opens a browser, calls output().
 *
 * Honesty by construction: the reconcile verdict is shown beside the (rubber-stampable)
 * self-reported verification status; status is framed as a current-disk snapshot; and
 * counts are derived from disk at render time (never embedded as drift-prone literals).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  output, error, safeReadFile, escapeRegex, toPosix,
} = require('./core.cjs');
const {
  ROADMAP_FILE, PROJECT_FILE,
  isResearchFile, isContextFile, isVerificationFile,
  getPlanId, getSummaryId,
} = require('./constants.cjs');
const {
  planningPath, phasesPath, listPhaseDirs, parsePhaseDir,
  filterPlanFiles, filterSummaryFiles,
} = require('./utils.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { reconcilePhase } = require('./verify.cjs');
const {
  HUD_CSS, esc, pill, bar, metricCard, fmtUsd, fmtTokens,
  pipelineStage, STATUS_DOT, MARK_SVG, CHECK_SVG,
  scanPhases, ledgerReliability,
} = require('./hud.cjs');
const cost = require('./cost.cjs');

const REPORT_SUFFIX = '-report.html';
const INDEX_FILE = 'report-index.html';

// ─── small helpers ─────────────────────────────────────────────────────────────

/** Coerce a frontmatter value to a string array (handles scalar, array, undefined). */
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.filter(x => x != null).map(String) : [String(v)];
}

/** First present key of an object. */
function pick(obj, ...keys) {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return undefined;
}

/** Normalize a phase number for comparison ("03" and "3" match; "04.1" preserved). */
function normNum(n) {
  return String(n).trim().replace(/^0+(?=\d)/, '');
}

// ─── data collection (pure) ─────────────────────────────────────────────────────

function projectName(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg && pkg.name) return String(pkg.name);
  } catch { /* no package.json */ }
  const proj = safeReadFile(path.join(planningPath(cwd), PROJECT_FILE));
  if (proj) {
    const h = proj.match(/^#\s+(.+)$/m);
    if (h) return h[1].trim();
  }
  return path.basename(cwd.replace(/[\\/]+$/, '')) || 'project';
}

/** Locate a phase directory by number. Returns { dir, dirName, number, name } or null. */
function resolvePhase(cwd, phaseNumber) {
  const want = normNum(phaseNumber);
  for (const dirName of listPhaseDirs(cwd)) {
    const { number, name } = parsePhaseDir(dirName);
    if (normNum(number) === want) {
      return { dir: path.join(phasesPath(cwd), dirName), dirName, number, name: name ? name.replace(/-/g, ' ') : null };
    }
  }
  return null;
}

/** Extract a phase's goal + success criteria from roadmap.md (pure, no output). */
function extractPhaseGoal(cwd, phaseNumber) {
  const content = safeReadFile(path.join(planningPath(cwd), ROADMAP_FILE));
  if (!content) return { objective: null, success_criteria: [] };
  const re = new RegExp('#{2,4}\\s*Phase\\s+' + escapeRegex(String(phaseNumber)) + ':\\s*([^\\n]+)', 'i');
  const m = content.match(re);
  if (!m) return { objective: null, success_criteria: [] };
  const start = m.index;
  const rest = content.slice(start + 1);
  const nextH = rest.match(/\n#{2,4}\s+Phase\s+\d/i);
  const end = nextH ? start + 1 + nextH.index : content.length;
  const section = content.slice(start, end);
  const gm = section.match(/(?:\*\*Goal:\*\*|\*\*Goal\*\*:)\s*([^\n]+)/i);
  const objective = gm ? gm[1].trim() : null;
  const cm = section.match(/\*\*Success Criteria\*\*[^\n]*:\s*\n((?:\s*\d+\.\s*[^\n]+\n?)+)/i);
  const success_criteria = cm
    ? cm[1].trim().split('\n').map(l => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return { objective, success_criteria };
}

function bulletList(body, cap) {
  return (body.match(/^\s*[-*]\s+(.+)$/gm) || [])
    .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(t => t && !/^none\b/i.test(t))
    .slice(0, cap || 6);
}

/** Parse a phase's verification.md into structured signals + the reconcile verdict. */
function parseVerification(cwd, dir, verFile, phaseNumber) {
  const raw = safeReadFile(path.join(dir, verFile)) || '';
  const fm = extractFrontmatter(raw);
  let status = fm.status != null ? String(fm.status) : null;
  if (!status) { const sm = raw.match(/^status:\s*([A-Za-z_-]+)/m); status = sm ? sm[1] : null; }
  const tot = raw.match(/TEST_TOTAL[:\s]+(\d+)/i) || raw.match(/\b(\d+)\s+tests?\b/i);
  const pass = raw.match(/(?:TEST_)?PASS(?:ED)?[:\s]+(\d+)/i);
  const fail = raw.match(/(?:TEST_)?FAIL(?:ED)?[:\s]+(\d+)/i);
  const test_gate = (tot || pass || fail)
    ? { total: tot ? Number(tot[1]) : null, passed: pass ? Number(pass[1]) : null, failed: fail ? Number(fail[1]) : null }
    : null;
  const scoreM = raw.match(/\bscore[:\s]+(\d+)/i);
  const score = scoreM ? Number(scoreM[1]) : null;
  const gapsBlock = raw.match(/#{2,4}\s*Gaps?\b[^\n]*\n([\s\S]*?)(?=\n#{2,4}\s|\n---|$)/i);
  const gaps = gapsBlock ? bulletList(gapsBlock[1]) : [];
  const apBlock = raw.match(/#{2,4}\s*Anti-?patterns?\b[^\n]*\n([\s\S]*?)(?=\n#{2,4}\s|\n---|$)/i);
  const anti_patterns = apBlock ? bulletList(apBlock[1]) : [];

  let reconcile = { checked: false, ok: true, verdict: 'n/a', contradictions: [] };
  try {
    const rec = reconcilePhase(cwd, phaseNumber);
    if (rec && rec.found) {
      reconcile = {
        checked: (rec.mechanical_signals || 0) > 0,
        ok: !!rec.reconciled,
        verdict: rec.reconciled ? 'confirmed' : 'contradiction',
        contradictions: rec.contradictions || [],
      };
    }
  } catch { /* reconcile is best-effort; never blocks the report */ }

  return { present: true, status, test_gate, score, gaps, anti_patterns, reconcile };
}

/**
 * Collect one phase's report data. Returns null only when the phase directory
 * does not exist; otherwise always returns a valid, honest object.
 * @param {string} cwd
 * @param {string|number} phaseNumber
 * @param {{now?: Date}} [opts]
 */
function collectPhaseData(cwd, phaseNumber, opts = {}) {
  const now = opts.now || new Date();
  const rp = resolvePhase(cwd, phaseNumber);
  if (!rp) return null;

  let files = [];
  try { files = fs.readdirSync(rp.dir); } catch { /* unreadable */ }

  const planFiles = filterPlanFiles(files);
  const summaryFiles = filterSummaryFiles(files);
  const hasResearch = files.some(isResearchFile);
  const hasContext = files.some(isContextFile);
  const verFile = files.find(isVerificationFile);
  const uatFile = files.find(f => f.endsWith('-uat.md') || f === 'uat.md');
  const recordFile = files.find(f => f.endsWith('-record.md') || f === 'record.md');

  const summaryIds = new Set(summaryFiles.map(getSummaryId));
  const plans = planFiles.map(f => {
    const fm = extractFrontmatter(safeReadFile(path.join(rp.dir, f)) || '');
    const id = getPlanId(f);
    return {
      id, file: f,
      wave: pick(fm, 'wave') ?? null,
      files_modified: asArray(pick(fm, 'files_modified', 'files-modified')),
      must_haves: asArray(pick(fm, 'must_haves', 'must-haves')),
      requirements: asArray(pick(fm, 'requirements')),
      autonomous: pick(fm, 'autonomous') ?? null,
      hasSummary: summaryIds.has(id),
    };
  });
  const summaries = summaryFiles.map(f => {
    const fm = extractFrontmatter(safeReadFile(path.join(rp.dir, f)) || '');
    const kf = pick(fm, 'key-files', 'key_files') || {};
    return {
      id: getSummaryId(f), file: f,
      subsystem: pick(fm, 'subsystem') != null ? String(pick(fm, 'subsystem')) : null,
      tags: asArray(pick(fm, 'tags')),
      key_files_created: asArray(kf.created),
      key_files_modified: asArray(kf.modified),
      key_decisions: asArray(pick(fm, 'key-decisions', 'key_decisions')),
      requirements_completed: asArray(pick(fm, 'requirements-completed', 'requirements_completed')),
      duration: pick(fm, 'duration') != null ? String(pick(fm, 'duration')) : null,
      completed: pick(fm, 'completed') != null ? String(pick(fm, 'completed')) : null,
    };
  });

  // whole-roadmap scan (reused, tested) — zip with dir names for stepper/position
  const scan = scanPhases(cwd);
  const dirs = listPhaseDirs(cwd);
  const roadmap = scan.phases.map((p, i) => ({ number: p.number, name: p.name, status: p.status, dirName: dirs[i] }));
  const status = (roadmap.find(p => normNum(p.number) === normNum(rp.number)) || {}).status
    || 'empty';
  const index = roadmap.findIndex(p => normNum(p.number) === normNum(rp.number));
  const total = roadmap.length;

  const plansDone = Math.min(summaryFiles.length, planFiles.length);
  const goal = extractPhaseGoal(cwd, rp.number);

  // per-phase requirements — DERIVED (never global scanRequirements)
  const declared = [...new Set(plans.flatMap(p => p.requirements))];
  const completed = new Set(summaries.flatMap(s => s.requirements_completed));
  const requirements = declared.length
    ? declared.map(id => ({ id, done: completed.has(id) }))
    : [...completed].map(id => ({ id, done: true }));

  const durations = summaries.map(s => s.duration).filter(Boolean);

  const stage = pipelineStage({ status });

  return {
    generated_at: now.toISOString(),
    project: projectName(cwd),
    phase: { number: rp.number, name: rp.name, slug: rp.dirName, dir: rp.dir },
    status,
    pipeline: {
      stage,
      steps: ['research', 'plan', 'execute', 'verify'].map((label, i) => {
        const ci = ['research', 'plan', 'execute', 'verify'].indexOf(stage);
        return { label, state: ci < 0 ? 'todo' : i < ci ? 'done' : i === ci ? 'now' : 'todo' };
      }),
    },
    position: { index, total, percent: scan.percent },
    roadmap,
    goal,
    counts: { plans: planFiles.length, summaries: summaryFiles.length, plansDone },
    plans,
    summaries,
    artifacts: {
      context: { present: hasContext },
      research: { present: hasResearch },
      record: { present: !!recordFile },
    },
    verification: verFile ? parseVerification(cwd, rp.dir, verFile, rp.number) : null,
    uat: uatFile ? { present: true } : null,
    requirements,
    timing: { durations },
  };
}

/**
 * Collect the project-level timeline index data. Returns null when there are no
 * phases (a phase-less / focus-auto project — the HUD covers those instead).
 */
function collectIndexData(cwd, opts = {}) {
  const now = opts.now || new Date();
  const dirs = listPhaseDirs(cwd);
  if (!dirs.length) return null;
  const scan = scanPhases(cwd);

  const agg = cost.aggregate(cwd);
  const rel = ledgerReliability(agg.totals);
  const tok = (agg.totals.input_tokens || 0) + (agg.totals.output_tokens || 0);
  const spend = {
    reliable: rel.ok,
    usd: rel.ok ? agg.totals.cost_usd : null,
    tokens: tok,
  };

  const phases = scan.phases.map((p, i) => {
    const dirName = dirs[i];
    const hasReport = (() => {
      try {
        const fp = path.join(phasesPath(cwd), dirName);
        return fs.readdirSync(fp).some(f => f.endsWith(REPORT_SUFFIX));
      } catch { return false; }
    })();
    return {
      number: p.number, name: p.name, slug: dirName, status: p.status,
      stage: pipelineStage({ status: p.status }),
      plansDone: Math.min(p.summaries, p.plans), plansTotal: p.plans,
      has_report: hasReport,
      href: 'phases/' + encodeURIComponent(dirName) + '/' + encodeURIComponent(p.number + REPORT_SUFFIX),
    };
  });

  const inFlight = phases.filter(p => p.status !== 'complete' && p.status !== 'empty').length;
  const current = (phases.find(p => p.status !== 'complete') || phases[phases.length - 1] || {}).number || null;

  return {
    generated_at: now.toISOString(),
    project: projectName(cwd),
    aggregate: { total: scan.total, complete: scan.completed, in_flight: inFlight, percent: scan.percent, spend },
    current,
    phases,
  };
}

// ─── rendering (pure) ────────────────────────────────────────────────────────────

// Report-only additions on top of HUD_CSS (crumbs, phase-report stepper wrap,
// and the index timeline). All colours reference the HUD's :root tokens.
const REPORT_CSS = `
.crumbs{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:14px;}
.crumbs a{color:var(--indigo);text-decoration:none;}
.crumbs a:hover{text-decoration:underline;}
.crumbs .sep{color:var(--faint);}
.stepwrap{overflow-x:auto;padding-bottom:4px;}
.stepwrap .stepper{min-width:max-content;}
.sdot.now a,.sdot a{color:inherit;text-decoration:none;}
.reqrow{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;}
.tl{display:flex;flex-direction:column;margin-top:4px;}
.trow{display:grid;grid-template-columns:26px 1fr;gap:14px;}
.rail{display:flex;flex-direction:column;align-items:center;}
.rail .rd{width:15px;height:15px;border-radius:50%;flex:none;z-index:1;border:2px solid var(--bg);margin-top:14px;}
.rail .rl{width:3px;flex:1;min-height:16px;background:var(--faint);}
.tcard{flex:1;background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:12px 15px;margin-bottom:10px;
  display:flex;justify-content:space-between;align-items:center;gap:12px;text-decoration:none;color:inherit;transition:border-color .15s;}
a.tcard:hover{border-color:var(--coral);}
.tcard .tt{font-weight:700;font-size:14px;}
.tcard .tsub{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:4px;font-family:var(--mono);font-size:10.5px;color:var(--muted);}
.mini{display:inline-flex;gap:5px;font-family:var(--mono);font-size:10px;}
.mini .s{color:var(--faint);}.mini .s.done{color:var(--green);}.mini .s.on{color:var(--coral);font-weight:700;}
.pnf{color:var(--text2);font-size:13px;}
`;

function docShell(title, bodyHtml, generatedAt) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${HUD_CSS}${REPORT_CSS}</style></head>
<body><div class="wrap">
${bodyHtml}
<div class="foot">PanWizard · generated ${esc(generatedAt)} · self-contained snapshot</div>
</div></body></html>`;
}

function reportTopBar(d) {
  return `
  <div class="topbar">
    <div class="tb-brand">${MARK_SVG}<span class="tb-word"><span class="c">Pan</span>Wizard <span class="hud">PHASE REPORT</span></span></div>
    <div class="tb-meta">
      <a href="../../${esc(INDEX_FILE)}" style="color:var(--indigo);text-decoration:none">↖ all phases</a>
      <span class="sep">·</span><span>phase ${esc(d.position.index >= 0 ? d.position.index + 1 : d.phase.number)} of ${esc(d.position.total)}</span>
      <span class="sep">·</span><span>${esc(d.generated_at)}</span>
    </div>
  </div>`;
}

function reportHero(d) {
  const stage = d.pipeline.stage;
  const ci = ['research', 'plan', 'execute', 'verify'].indexOf(stage);
  const pipe = d.pipeline.steps.map((s, i) =>
    `<span class="pstep ${s.state === 'done' ? 'done' : s.state === 'now' ? 'on' : 'off'}">${esc(s.label)}${i < ci ? ' ✓' : i === ci ? ' ●' : ''}</span>`
  ).join('<span class="pgt">›</span>');
  return `
  <section class="nowbuilding">
    <div class="nbtop">
      <div class="ph dark">phase report</div>
      <div class="nbphase"><span class="nd"></span>${esc(d.status)} · ${esc(stage)}</div>
    </div>
    <div class="nbcard" style="margin-top:14px">
      <div class="nbhead">
        <div class="nbtitle">Phase ${esc(d.phase.number)}${d.phase.name ? ' — ' + esc(d.phase.name) : ''}</div>
        <div class="pipeline">${pipe}</div>
      </div>
      ${d.goal.objective ? `<div class="nbsub">${esc(d.goal.objective)}</div>` : '<div class="nbsub">no roadmap goal recorded</div>'}
    </div>
  </section>`;
}

function reportStepper(d) {
  if (!d.roadmap.length) return '';
  const els = [];
  d.roadmap.forEach((p, i) => {
    const done = p.status === 'complete';
    const active = normNum(p.number) === normNum(d.phase.number);
    const dot = done ? `<span class="sdot done">${CHECK_SVG}</span>`
      : active ? `<span class="sdot now">${esc(p.number)}</span>`
        : `<span class="sdot todo">${esc(p.number)}</span>`;
    const href = './../' + encodeURIComponent(p.dirName) + '/' + encodeURIComponent(p.number + REPORT_SUFFIX);
    const label = (p.name || '').split(' ')[0] || p.number;
    const lab = `<span class="slabel ${active ? 'now' : done ? 'done' : 'todo'}">${esc(label)}</span>`;
    els.push(`<div class="step"><a href="${esc(href)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;align-items:center;gap:6px">${dot}${lab}</a></div>`);
    if (i < d.roadmap.length - 1) {
      const next = d.roadmap[i + 1];
      const cls = done && next.status === 'complete' ? 'done' : done && normNum(next.number) === normNum(d.phase.number) ? 'grad' : 'todo';
      els.push(`<span class="sline ${cls}"></span>`);
    }
  });
  return `<section class="panel"><div class="ph">roadmap position</div><div class="stepwrap"><div class="stepper">${els.join('')}</div></div></section>`;
}

function verifPill(status) {
  if (!status) return pill('not verified', 'muted');
  if (/^(pass|passed|verified|complete)/i.test(status)) return pill(status, 'ok');
  if (/gap/i.test(status)) return pill(status, 'warn');
  if (/human|needed|fail|block/i.test(status)) return pill(status, 'danger');
  return pill(status, 'info');
}

function reportMetrics(d) {
  const c = d.counts;
  const req = d.requirements;
  const reqDone = req.filter(r => r.done).length;
  const dur = d.timing.durations.length ? d.timing.durations[0] : null;
  const v = d.verification;
  const verCard = `<div class="metric"><div class="mlabel">Verification</div>`
    + `<div class="mnum" style="font-size:18px;margin-top:8px">${v ? verifPill(v.status) : pill('none yet', 'muted')}</div>`
    + `<div class="msub">${v && v.score != null ? 'score ' + esc(v.score) : ''}${v && v.gaps.length ? (v.score != null ? ' · ' : '') + v.gaps.length + ' gap' + (v.gaps.length > 1 ? 's' : '') : ''}</div></div>`;
  const cards = [
    metricCard({
      label: 'Plans done', value: c.plansDone, unit: ` / ${c.plans}`,
      barPct: c.plans ? Math.round((c.plansDone / c.plans) * 100) : 0, barColor: 'var(--coral)',
      sub: c.plans ? (c.plansDone >= c.plans ? 'all summarised' : (c.plans - c.plansDone) + ' open') : 'no plans yet',
    }),
    req.length
      ? metricCard({ label: 'Requirements', value: reqDone, unit: ` / ${req.length}`, barPct: Math.round((reqDone / req.length) * 100), barColor: 'var(--indigo)', sub: (req.length - reqDone) + ' open' })
      : metricCard({ label: 'Requirements', value: '—', sub: 'none traced' }),
    verCard,
    metricCard({ label: 'Duration', value: dur || '—', sub: dur ? 'from summary' : 'spend n/a · no per-phase ledger' }),
  ];
  return `<section class="panel mission"><div class="metrics">${cards.join('')}</div></section>`;
}

function reportObjective(d) {
  const crit = d.goal.success_criteria;
  const req = d.requirements;
  const critRows = crit.length
    ? crit.map(c => `<div class="row"><span class="rl">${esc(c)}</span></div>`).join('')
    : '<div class="row noborder pnf">no success criteria in roadmap</div>';
  const reqEls = req.length
    ? `<div class="reqrow">${req.map(r => pill(esc(r.id), r.done ? 'ok' : 'muted')).join('')}</div>`
    : '<div class="pnf" style="margin-top:8px">no per-phase requirements traced in plan frontmatter</div>';
  return `
  <section class="panel">
    <div class="ph">objective &amp; success criteria</div>
    ${critRows}
    <div class="row noborder"><span class="rl">Requirements (plan-declared)</span><span class="amono dim">${req.filter(r => r.done).length} / ${req.length} done</span></div>
    ${reqEls}
    <div class="row noborder"><span class="rl">Snapshot</span><span class="amono dim">${d.counts.plans} plan(s) · ${d.counts.summaries} summar${d.counts.summaries === 1 ? 'y' : 'ies'} → ${esc(d.status)}</span></div>
  </section>`;
}

function reportVerification(d) {
  const v = d.verification;
  if (!v) {
    return `<section class="panel"><div class="ph">verification &amp; quality</div><div class="row noborder pnf">Not verified yet — no verification.md in this phase.</div></section>`;
  }
  const tg = v.test_gate;
  const rec = v.reconcile;
  const recPill = !rec.checked ? pill('n/a — no must_haves', 'muted')
    : rec.ok ? pill('confirmed', 'ok') : pill('contradiction', 'danger');
  return `
  <section class="panel">
    <div class="ph">verification &amp; quality</div>
    ${tg ? `<div class="row"><span class="rl">Test gate</span><span class="amono">${tg.total != null ? tg.total + ' total' : ''}${tg.passed != null ? ' · ' + tg.passed + ' pass' : ''}${tg.failed != null ? ' · ' + tg.failed + ' fail' : ''}</span></div>` : ''}
    <div class="row"><span class="rl">Self-reported</span>${verifPill(v.status)}</div>
    <div class="row"><span class="rl">verify reconcile</span>${recPill}</div>
    ${v.score != null ? `<div class="row"><span class="rl">Score</span><span class="amono">${esc(v.score)}</span></div>` : ''}
    <div class="row noborder"><span class="rl">Anti-patterns</span><span class="amono ${v.anti_patterns.length ? 'warnc' : 'okc'}">${v.anti_patterns.length ? esc(v.anti_patterns.length + ' flagged') : 'none'}</span></div>
    ${rec.contradictions.length ? `<div class="open" style="margin-top:8px">${rec.contradictions.map(c => `<div class="amono" style="color:var(--red)">• ${esc(c)}</div>`).join('')}</div>` : ''}
  </section>`;
}

function reportChanges(d) {
  if (!d.summaries.length) return '';
  const tasks = d.summaries.map(s => {
    const files = [...s.key_files_created, ...s.key_files_modified];
    const fileNote = files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : (s.tags.length ? s.tags.slice(0, 3).join(', ') : 'summary');
    return `<div class="task"><span class="tname"><span class="td"></span>${esc(s.subsystem || s.id || s.file)}</span><span class="tpath">${esc(fileNote)}</span></div>`;
  }).join('');
  const decisions = d.summaries.flatMap(s => s.key_decisions).slice(0, 5);
  return `
  <section class="panel">
    <div class="ph">what changed</div>
    <div class="tasks">${tasks}</div>
    ${decisions.length ? `<div class="open" style="margin-top:12px">${decisions.map(k => `<div class="amono dim">• ${esc(k)}</div>`).join('')}</div>` : ''}
  </section>`;
}

function reportGaps(d) {
  const v = d.verification;
  if (!v || !v.gaps.length) return '';
  return `
  <section class="panel">
    <div class="ph">gaps &amp; blockers</div>
    ${v.gaps.map(g => `<div class="row"><span class="rl">${esc(g)}</span>${pill('open', 'danger')}</div>`).join('')}
  </section>`;
}

function renderPhaseHtml(d) {
  const body = [
    reportTopBar(d),
    reportHero(d),
    reportStepper(d),
    reportMetrics(d),
    `<div class="grid"><div class="gcol">${reportObjective(d)}</div><div class="gcol">${reportVerification(d)}</div></div>`,
    reportChanges(d),
    reportGaps(d),
  ].filter(Boolean).join('\n');
  return docShell(`PanWizard · Phase ${d.phase.number}${d.phase.name ? ' — ' + d.phase.name : ''}`, body, d.generated_at);
}

function indexTopBar(d) {
  return `
  <div class="topbar">
    <div class="tb-brand">${MARK_SVG}<span class="tb-word"><span class="c">Pan</span>Wizard <span class="hud">TIMELINE</span></span></div>
    <div class="tb-meta"><span>pan-tools report index</span><span class="sep">·</span><span>${esc(d.generated_at)}</span></div>
  </div>`;
}

function indexHero(d) {
  const a = d.aggregate;
  const cur = d.phases.find(p => p.number === d.current);
  const spendCard = a.spend.reliable
    ? metricCard({ label: 'Spend', value: fmtUsd(a.spend.usd), sub: fmtTokens(a.spend.tokens) + ' tok' })
    : metricCard({ label: 'Spend', value: '—', sub: fmtTokens(a.spend.tokens) + ' tok · ledger n/a' });
  const cards = [
    metricCard({ label: 'Progress', value: a.percent == null ? '—' : String(a.percent), unit: a.percent == null ? '' : '%', barPct: a.percent, barColor: 'var(--coral)', sub: `${a.complete} / ${a.total} phases` }),
    metricCard({ label: 'Complete', value: a.complete, unit: ` / ${a.total}` }),
    metricCard({ label: 'In flight', value: a.in_flight, sub: cur ? 'phase ' + cur.number : 'idle' }),
    spendCard,
  ].join('');
  return `
  <section class="panel mission">
    <div class="mhead">
      <div>
        <div class="kicker">pan · project timeline</div>
        <div class="title">${esc(d.project)}</div>
      </div>
      <div class="mmeta">${cur ? pill('phase ' + cur.number + ' in flight', 'info') : pill('all phases complete', 'ok')}</div>
    </div>
    <div class="metrics">${cards}</div>
  </section>`;
}

function indexTimeline(d) {
  const rows = d.phases.map((p, i) => {
    const color = STATUS_DOT[p.status] || '#C9C0AE';
    const isLast = i === d.phases.length - 1;
    const railColor = p.status === 'complete' ? 'var(--green)' : 'var(--faint)';
    const stages = ['research', 'plan', 'execute', 'verify'];
    const ci = stages.indexOf(p.stage);
    const mini = stages.map((s, j) => `<span class="s ${j < ci ? 'done' : j === ci ? 'on' : ''}">${esc(s[0].toUpperCase())}</span>`).join('');
    const kind = p.status === 'complete' ? 'ok' : p.status === 'partial' ? 'info' : p.status === 'planned' ? 'info' : 'muted';
    return `
    <div class="trow">
      <div class="rail"><span class="rd" style="background:${color}"></span>${isLast ? '' : `<span class="rl" style="background:${railColor}"></span>`}</div>
      <a class="tcard" href="${esc(p.href)}">
        <div>
          <div class="tt">${esc(p.number)}${p.name ? ' · ' + esc(p.name) : ''}</div>
          <div class="tsub"><span class="mini">${mini}</span><span>${p.plansTotal ? p.plansDone + ' / ' + p.plansTotal + ' plans' : 'no plans'}</span>${p.has_report ? '' : '<span>· report pending</span>'}</div>
        </div>
        ${pill(p.status, kind)}
      </a>
    </div>`;
  }).join('');
  return `<section class="panel"><div class="ph">phases</div><div class="tl">${rows}</div></section>`;
}

function renderIndexHtml(d) {
  const body = [indexTopBar(d), indexHero(d), indexTimeline(d)].join('\n');
  return docShell(`PanWizard · ${d.project} — timeline`, body, d.generated_at);
}

// ─── side effects (the only impure layer) ────────────────────────────────────────

/**
 * Strip the volatile generated-at ISO-8601 timestamp so an unchanged report is
 * not rewritten (no git churn). The timestamp is the ONLY non-deterministic part
 * of the output — everything else is a pure function of disk state — so removing
 * it yields a stable body to compare. Rendered timestamps are always raw ISO
 * (never toLocaleString) precisely so this single pattern catches every one.
 */
function stripVolatile(html) {
  return String(html).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '⌀');
}

function writeIfChanged(outPath, html) {
  let existing = null;
  try { if (fs.existsSync(outPath)) existing = fs.readFileSync(outPath, 'utf-8'); } catch { /* treat as new */ }
  if (existing !== null && stripVolatile(existing) === stripVolatile(html)) return { written: false };
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
  } catch (e) {
    error('Failed to write report: ' + e.message);
  }
  return { written: true };
}

// openInBrowser — byte-identical to hud.cjs (the inline allowlist regex is a
// CodeQL command-injection barrier that must NOT move into a shared helper;
// a CI test asserts the two copies never diverge).
function openInBrowser(filePath) {
  const { execFileSync } = require('child_process');
  // Only open a path we can resolve to an existing regular file, and refuse
  // anything carrying shell/cmd metacharacters — on Windows `start` is a cmd
  // builtin that re-parses its command line, so a crafted --out value must not
  // be able to reach it. The allowlist check is the taint barrier; `resolved`
  // is what actually gets opened.
  let resolved;
  try {
    resolved = path.resolve(filePath);
    if (!fs.statSync(resolved).isFile()) return false;
  } catch {
    return false;
  }
  // Allowlist barrier: only ordinary path characters may reach the opener.
  // Anything outside this set (shell/cmd metacharacters, quotes, newlines) is
  // rejected outright, so a crafted --out value cannot reach Windows `start`.
  if (!/^[A-Za-z0-9 _.:\\/()-]+$/.test(resolved)) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', resolved], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execFileSync('open', [resolved], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [resolved], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate phase report(s). Sub-actions: phase <N> | index | all.
 * @param {string} cwd
 * @param {{action?:string, phase?:string, out?:string, open?:boolean, stdout?:boolean, now?:Date}} opts
 * @param {boolean} raw
 */
function cmdReport(cwd, opts = {}, raw) {
  const action = opts.action || 'phase';
  const now = opts.now;

  if (action === 'phase') {
    if (!opts.phase) return error('Usage: report phase <N>');
    const data = collectPhaseData(cwd, opts.phase, { now });
    if (!data) return error(`Phase ${opts.phase} not found under .planning/phases/`);
    const html = renderPhaseHtml(data);
    if (opts.stdout) { process.stdout.write(html); return; }
    const outPath = opts.out ? path.resolve(cwd, opts.out) : path.join(data.phase.dir, `${data.phase.number}${REPORT_SUFFIX}`);
    const res = writeIfChanged(outPath, html);
    const opened = opts.open && res.written ? openInBrowser(outPath) : false;
    return output(
      { action, phase: data.phase.number, path: toPosix(outPath), bytes: Buffer.byteLength(html), status: data.status, written: res.written, opened },
      raw,
      `phase ${data.phase.number} report ${res.written ? 'written' : 'unchanged'}: ${toPosix(outPath)}`,
    );
  }

  if (action === 'index') {
    const data = collectIndexData(cwd, { now });
    if (!data) return error('No phases found — nothing to index (phase-less / focus-auto project). Use `pan-tools hud` instead.');
    const html = renderIndexHtml(data);
    if (opts.stdout) { process.stdout.write(html); return; }
    const outPath = opts.out ? path.resolve(cwd, opts.out) : path.join(planningPath(cwd), INDEX_FILE);
    const res = writeIfChanged(outPath, html);
    const opened = opts.open && res.written ? openInBrowser(outPath) : false;
    return output(
      { action, phases: data.phases.length, path: toPosix(outPath), bytes: Buffer.byteLength(html), written: res.written, opened },
      raw,
      `timeline index ${res.written ? 'written' : 'unchanged'}: ${toPosix(outPath)}`,
    );
  }

  if (action === 'all') {
    const dirs = listPhaseDirs(cwd);
    if (!dirs.length) return error('No phases found — nothing to report.');
    const reports = [];
    for (const dirName of dirs) {
      const { number } = parsePhaseDir(dirName);
      const data = collectPhaseData(cwd, number, { now });
      if (!data) continue;
      const outPath = path.join(data.phase.dir, `${data.phase.number}${REPORT_SUFFIX}`);
      const res = writeIfChanged(outPath, renderPhaseHtml(data));
      reports.push({ phase: data.phase.number, path: toPosix(outPath), written: res.written });
    }
    const idx = collectIndexData(cwd, { now });
    let index = { path: null, written: false };
    if (idx) {
      const outPath = path.join(planningPath(cwd), INDEX_FILE);
      const res = writeIfChanged(outPath, renderIndexHtml(idx));
      index = { path: toPosix(outPath), written: res.written };
    }
    return output(
      { action, reports, index },
      raw,
      `generated ${reports.length} phase report(s)${index.path ? ' + index' : ''}`,
    );
  }

  return error('Unknown report action. Available: phase <N>, index, all');
}

module.exports = {
  REPORT_SUFFIX,
  INDEX_FILE,
  collectPhaseData,
  collectIndexData,
  renderPhaseHtml,
  renderIndexHtml,
  cmdReport,
  // exported for focused unit tests
  resolvePhase,
  extractPhaseGoal,
  stripVolatile,
};
