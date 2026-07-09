/**
 * HUD — single-page HTML dashboard of the bot army + project (ADR-0035).
 *
 * Aggregates state that already lives in PAN (state.md, roadmap/phases, the
 * squad registry, the campaign schedule, army worktrees, the cost ledger,
 * requirements, verification, git history) into ONE self-contained HTML file
 * — no server, no network, no external CSS/JS. This module is a *view*: it
 * owns no state and writes only the rendered file, so it can never corrupt
 * planning data.
 *
 * Graceful degradation: army-only panels (command stack, campaign, harness,
 * worktrees) render only when a campaign is scheduled or army worktrees
 * exist. A plain PAN project still gets mission, roadmap, telemetry,
 * requirements/quality and activity panels.
 *
 * collectHudData() and renderHud() are pure given their inputs (a `now` Date
 * is injected for testability); cmdHud() is the only side-effecting wrapper.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  output, error, loadConfig, safeReadFile, getMilestoneInfo,
  execGit, isGitRepo, escapeRegex, toPosix,
} = require('./core.cjs');
const {
  PLANNING_DIR, STATE_FILE, PROJECT_FILE, REQUIREMENTS_FILE, PAUSE_FILE,
} = require('./constants.cjs');
const {
  planningPath, phasesPath, listPhaseDirs, parsePhaseDir,
  classifyPhaseStatus, filterPlanFiles, filterSummaryFiles,
} = require('./utils.cjs');
const squads = require('./squads.cjs');
const campaign = require('./campaign.cjs');
const worktree = require('./worktree.cjs');
const cost = require('./cost.cjs');

const HUD_FILE = 'hud.html';

// ─── small parsing helpers ────────────────────────────────────────────────────

/** First non-empty line of a `## Heading` section, or null. */
function sectionFirstLine(content, heading) {
  if (!content) return null;
  const re = new RegExp('#{2,3}\\s*' + escapeRegex(heading) + '\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)', 'i');
  const m = content.match(re);
  if (!m) return null;
  const line = m[1].split('\n').map(s => s.trim()).filter(Boolean)[0];
  return line ? line.replace(/^[-*]\s+/, '') : null;
}

/** Extract a `**Field:** value` line from state.md content. */
function stateField(content, label) {
  if (!content) return null;
  const re = new RegExp('\\*\\*' + escapeRegex(label) + ':\\*\\*\\s*(.+)', 'i');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function parseBlockers(content) {
  if (!content) return [];
  const block = content.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!block) return [];
  const items = block[1].match(/^-\s+(.+)$/gm) || [];
  return items
    .map(i => i.replace(/^-\s+/, '').trim())
    .filter(t => t && !/^none$/i.test(t));
}

// ─── data collectors ──────────────────────────────────────────────────────────

function scanPhases(cwd) {
  const dirs = listPhaseDirs(cwd);
  const phases = [];
  let plansTotal = 0;
  let plansDone = 0;
  for (const dir of dirs) {
    const { number, name } = parsePhaseDir(dir);
    let files = [];
    try { files = fs.readdirSync(path.join(phasesPath(cwd), dir)); } catch { /* gone */ }
    const plans = filterPlanFiles(files);
    const summaries = filterSummaryFiles(files);
    const hasResearch = files.some(f => f.endsWith('-research.md') || f === 'research.md');
    const hasContext = files.some(f => f.endsWith('-context.md') || f === 'context.md');
    const status = classifyPhaseStatus(plans.length, summaries.length, { hasResearch, hasContext });
    plansTotal += plans.length;
    plansDone += Math.min(summaries.length, plans.length);
    phases.push({
      number,
      name: name ? name.replace(/-/g, ' ') : null,
      status,
      plans: plans.length,
      summaries: summaries.length,
    });
  }
  const completed = phases.filter(p => p.status === 'complete').length;
  const percent = phases.length ? Math.round((completed / phases.length) * 100) : null;
  return { phases, completed, total: phases.length, plansTotal, plansDone, percent };
}

function scanRequirements(cwd) {
  const content = safeReadFile(path.join(planningPath(cwd), REQUIREMENTS_FILE));
  if (!content) return null;
  const checked = (content.match(/^\s*[-*]\s+\[x\]/gim) || []).length;
  const unchecked = (content.match(/^\s*[-*]\s+\[ \]/gim) || []).length;
  const total = checked + unchecked;
  if (total === 0) return null;
  const open = (content.match(/^\s*[-*]\s+\[ \]\s+(.+)$/gim) || [])
    .map(l => l.replace(/^\s*[-*]\s+\[ \]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return { total, done: checked, open };
}

function scanVerification(cwd) {
  // listPhaseDirs is sorted ascending — last hit wins (latest phase).
  let found = null;
  for (const dir of listPhaseDirs(cwd)) {
    let files = [];
    try { files = fs.readdirSync(path.join(phasesPath(cwd), dir)); } catch { /* gone */ }
    const vf = files.find(f => f.endsWith('-verification.md') || f === 'verification.md');
    const uf = files.find(f => f.endsWith('-uat.md') || f === 'uat.md');
    if (vf || uf) {
      const { number, name } = parsePhaseDir(dir);
      found = {
        phase: number,
        phase_name: name ? name.replace(/-/g, ' ') : null,
        verification: !!vf,
        uat: !!uf,
        file: vf || uf,
      };
    }
  }
  return found;
}

function recentCommits(cwd, limit) {
  if (!isGitRepo(cwd)) return [];
  const r = execGit(cwd, ['log', '-n', String(limit || 8), '--pretty=%h\x1f%s\x1f%cr']);
  if (r.exitCode !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [hash, subject, when] = line.split('\x1f');
    return { hash, subject, when };
  });
}

function buildArmy(agg, trees) {
  const byAgent = agg.by_agent || {};
  const squadList = squads.listSquads().map(s => {
    const full = squads.getSquad(s.name);
    const agents = full.agents.map(a => {
      const rec = byAgent[a];
      return {
        name: a,
        active: !!rec,
        calls: rec ? rec.calls : 0,
        tokens: rec ? (rec.input + rec.output) : 0,
        cost: rec ? Math.round((rec.cost || 0) * 10000) / 10000 : 0,
      };
    });
    let activeCount = agents.filter(a => a.active).length;
    if (s.name === 'build' && trees.length) activeCount = Math.max(activeCount, trees.length);
    return { ...s, agents, active_count: activeCount };
  });
  return { coordinator: squads.COORDINATOR, workers: [...squads.WORKERS], squads: squadList };
}

function telemetryBySquad(agg) {
  const out = {};
  const byAgent = agg.by_agent || {};
  for (const a of Object.keys(byAgent)) {
    const sq = squads.squadForAgent(a)
      || (a === squads.COORDINATOR ? 'command' : (squads.WORKERS.includes(a) ? 'workers' : 'other'));
    if (!out[sq]) out[sq] = { cost: 0, tokens: 0, calls: 0 };
    out[sq].cost += byAgent[a].cost || 0;
    out[sq].tokens += (byAgent[a].input || 0) + (byAgent[a].output || 0);
    out[sq].calls += byAgent[a].calls || 0;
  }
  for (const k of Object.keys(out)) out[k].cost = Math.round(out[k].cost * 10000) / 10000;
  return out;
}

/**
 * Collect every signal the HUD renders into one plain data object.
 * @param {string} cwd
 * @param {{now?: Date}} [opts]
 */
function collectHudData(cwd, opts = {}) {
  const now = opts.now || new Date();
  const config = loadConfig(cwd) || {};

  // project identity
  let name = null;
  let version = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    name = pkg.name || null;
    version = pkg.version || null;
  } catch { /* no package.json */ }
  let milestone = null;
  try { milestone = getMilestoneInfo(cwd); } catch { /* none */ }
  const projectMd = safeReadFile(path.join(planningPath(cwd), PROJECT_FILE));
  const coreValue = sectionFirstLine(projectMd, 'Core Value') || sectionFirstLine(projectMd, 'What This Is');

  // state
  const stateContent = safeReadFile(path.join(planningPath(cwd), STATE_FILE));
  const state = {
    current_phase: stateField(stateContent, 'Current Phase'),
    current_phase_name: stateField(stateContent, 'Current Phase Name'),
    status: stateField(stateContent, 'Status'),
    last_activity: stateField(stateContent, 'Last Activity'),
    last_activity_desc: stateField(stateContent, 'Last Activity Description'),
    blockers: parseBlockers(stateContent),
  };

  // progress / roadmap
  const phaseScan = scanPhases(cwd);

  // army
  const schedule = campaign.readSchedule(cwd);
  const due = campaign.isRunDue(schedule, now);
  const trees = worktree.listArmyWorktrees(cwd);
  const armyActive = !!schedule || trees.length > 0;
  const agg = cost.aggregate(cwd);
  const army = buildArmy(agg, trees);

  // campaign
  let campaignData = null;
  if (schedule) {
    campaignData = {
      enabled: schedule.enabled,
      paused: schedule.paused,
      cadence: schedule.cadence,
      daily_budget: schedule.daily_budget,
      next_due: schedule.next_due,
      last_run: schedule.last_run,
      spent_today: due.spent_today,
      due: due.due,
      reason: due.reason,
      goal: schedule.goal || null,
      source: schedule.source || null,
      runs: (schedule.history || []).length,
      history: (schedule.history || []).slice(-7),
    };
  }

  // safety harness
  const paused = !!safeReadFile(path.join(planningPath(cwd), PAUSE_FILE));
  const harness = {
    merge_gate: (config.build && config.build.merge_gate) || 'always-ask',
    abort: paused ? 'paused' : 'clear',
    active_worktrees: trees.length,
    daily_budget: schedule ? schedule.daily_budget : null,
    spent_today: schedule ? due.spent_today : null,
    concurrency: config.concurrency || null,
  };

  // telemetry
  const telemetry = {
    totals: agg.totals,
    cache_hit_rate_pct: agg.cache_hit_rate_pct,
    by_squad: telemetryBySquad(agg),
  };

  return {
    generated_at: now.toISOString(),
    army_active: armyActive,
    project: { name, version, dir_name: path.basename(cwd.replace(/[\\/]+$/, '')), milestone: milestone ? { version: milestone.version, name: milestone.name } : null, core_value: coreValue },
    state,
    progress: phaseScan,
    army,
    campaign: campaignData,
    harness,
    worktrees: trees,
    roadmap: phaseScan.phases,
    telemetry,
    requirements: scanRequirements(cwd),
    quality: scanVerification(cwd),
    activity: recentCommits(cwd, 8),
  };
}

// ─── rendering ────────────────────────────────────────────────────────────────
//
// Faithful to the PanWizard HUD design (docs/branding/PanWizard HUD.dc.html):
// light Sand/Paper page, a dark "now building" hero card, per-squad colored
// command stack, inline metric bars, spend-by-squad bars. Self-contained — no
// network fonts, no <script>, no external assets. Renderers are pure; every
// value that comes from project state is HTML-escaped.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Each squad reads as a distinct brand color (not by model tier).
const SQUAD_COLOR = {
  architecture: '#5B4BE6', build: '#FF5A3C', quality: '#1E8E5A', release: '#FFCE4A',
};
const SQUAD_PILL = { architecture: 'info', build: 'danger', quality: 'ok', release: 'warn' };

// Roadmap status → pill kind.
const STATUS_KIND = {
  complete: 'ok', partial: 'info', planned: 'muted',
  researched: 'muted', discussed: 'muted', empty: 'muted',
};
const STATUS_DOT = {
  complete: '#1E8E5A', partial: '#5B4BE6', planned: '#C9C0AE',
  researched: '#C9C0AE', discussed: '#C9C0AE', empty: '#C9C0AE',
};

// PanWizard node-graph mark + a checkmark glyph (inline, no xmlns → still
// self-contained: the HTML parser places them in the SVG namespace).
const MARK_SVG = '<svg class="mark" viewBox="0 0 100 100" aria-hidden="true">'
  + '<line x1="50" y1="26" x2="26" y2="74" stroke="#5B4BE6" stroke-width="7" stroke-linecap="round"/>'
  + '<line x1="50" y1="26" x2="74" y2="74" stroke="#5B4BE6" stroke-width="7" stroke-linecap="round"/>'
  + '<circle cx="50" cy="26" r="13" fill="#FF5A3C"/>'
  + '<circle cx="26" cy="74" r="11" fill="#FFCE4A"/>'
  + '<circle cx="74" cy="74" r="11" fill="#1E8E5A"/></svg>';
const CHECK_SVG = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" aria-hidden="true">'
  + '<path d="M5 12l5 5L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function pill(text, kind) {
  return `<span class="pill ${kind || 'muted'}">${esc(text)}</span>`;
}

function bar(pct, color) {
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="bar"><span style="width:${w}%;background:${color || 'var(--coral)'}"></span></div>`;
}

function fmtUsd(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}

function relDue(nextIso, nowIso) {
  const a = new Date(nextIso).getTime();
  const b = new Date(nowIso).getTime();
  if (isNaN(a) || isNaN(b)) return esc(nextIso || '—');
  const diff = a - b;
  if (diff <= 0) return 'due now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  return `in ${h}h ${m}m`;
}

function metricCard(o) {
  const num = `<div class="mnum">${esc(o.value)}${o.unit ? `<span class="munit">${esc(o.unit)}</span>` : ''}</div>`;
  const b = o.barPct != null
    ? `<div class="mbar"><span style="width:${Math.max(0, Math.min(100, o.barPct))}%;background:${o.barColor || 'var(--coral)'}"></span></div>`
    : '';
  return `<div class="metric"><div class="mlabel">${esc(o.label)}</div>${num}${b}<div class="msub">${esc(o.sub || '')}</div></div>`;
}

function currentPhase(d) {
  const curNum = d.state.current_phase
    || (d.roadmap.find(p => p.status !== 'complete') || {}).number;
  return d.roadmap.find(p => String(p.number) === String(curNum)) || d.roadmap[0] || null;
}

// Map a phase's on-disk status to its position in the pan pipeline.
function pipelineStage(p) {
  if (!p) return 'queued';
  if (p.status === 'complete') return 'verify';
  if (p.status === 'partial') return 'execute';
  if (p.status === 'researched') return 'plan';
  if (p.status === 'discussed') return 'research';
  return 'queued';
}

function renderTopBar(d) {
  const right = [
    d.army_active ? '<span class="tb-live"><span class="ld"></span>campaign active</span>' : '',
    '<span>pan-tools hud</span>',
    '<span class="sep">·</span>',
    `<span>${esc(new Date(d.generated_at).toLocaleString())}</span>`,
  ].filter(Boolean).join('');
  return `
  <div class="topbar">
    <div class="tb-brand">${MARK_SVG}<span class="tb-word"><span class="c">Pan</span>Wizard <span class="hud">HUD</span></span></div>
    <div class="tb-meta">${right}</div>
  </div>`;
}

function renderMission(d) {
  const p = d.project;
  const st = d.state;
  const prog = d.progress;
  const statusKind = /complete|done|green/i.test(st.status || '') ? 'ok'
    : /block|fail|error/i.test(st.status || '') ? 'danger'
      : st.status ? 'info' : 'muted';
  const req = d.requirements;
  const tok = d.telemetry.totals.input_tokens + d.telemetry.totals.output_tokens;
  const cache = d.telemetry.cache_hit_rate_pct;
  const cards = [
    metricCard({
      label: 'Progress', value: prog.percent == null ? '—' : String(prog.percent), unit: prog.percent == null ? '' : '%',
      barPct: prog.percent, barColor: 'var(--coral)', sub: prog.total ? `${prog.completed} / ${prog.total} phases` : 'no phases',
    }),
    metricCard({
      label: 'Phase', value: st.current_phase || prog.completed || 0, unit: prog.total ? ` / ${prog.total}` : '',
      sub: st.current_phase_name || '',
    }),
    req
      ? metricCard({ label: 'Requirements', value: req.done, unit: ` / ${req.total}`, barPct: Math.round((req.done / req.total) * 100), barColor: 'var(--indigo)', sub: `${req.total - req.done} open` })
      : metricCard({ label: 'Requirements', value: '—', sub: 'none tracked' }),
    metricCard({
      label: 'Spend', value: fmtUsd(d.telemetry.totals.cost_usd),
      sub: `${fmtTokens(tok)} tok${cache == null ? '' : ' · ' + cache + '% cache'}`,
    }),
  ].join('');
  return `
  <section class="panel mission">
    <div class="mhead">
      <div>
        <div class="kicker">pan army · mission control</div>
        <div class="title">${esc(p.name || p.dir_name || 'Untitled project')}</div>
        ${p.core_value ? `<div class="sub">${esc(p.core_value)}</div>` : ''}
      </div>
      <div class="mmeta">
        ${d.army_active ? pill('campaign active', 'info') : pill('no campaign', 'muted')}
        <div class="mono dim">${p.version ? 'v' + esc(p.version) : ''}${p.milestone && p.milestone.version ? ' · milestone ' + esc(p.milestone.version) : ''}</div>
      </div>
    </div>
    ${st.status ? `<div class="statusline">status ${pill(st.status, statusKind)}${st.blockers.length ? ' ' + pill(st.blockers.length + ' blocker' + (st.blockers.length > 1 ? 's' : ''), 'danger') : ' ' + pill('0 blockers', 'ok')}</div>` : ''}
    <div class="metrics">${cards}</div>
  </section>`;
}

function renderNowBuilding(d) {
  if (!d.roadmap.length) return '';
  const cur = currentPhase(d);
  const stage = pipelineStage(cur);
  const total = d.progress.total;
  const idx = d.roadmap.findIndex(p => cur && String(p.number) === String(cur.number));

  // WHERE — phase stepper
  const stepEls = [];
  d.roadmap.forEach((p, i) => {
    const done = p.status === 'complete';
    const active = cur && String(p.number) === String(cur.number);
    const dot = done ? `<span class="sdot done">${CHECK_SVG}</span>`
      : active ? `<span class="sdot now">${esc(p.number)}</span>`
        : `<span class="sdot todo">${esc(p.number)}</span>`;
    const lab = `<span class="slabel ${active ? 'now' : done ? 'done' : 'todo'}">${esc((p.name || '').split(' ')[0] || p.number)}</span>`;
    stepEls.push(`<div class="step">${dot}${lab}</div>`);
    if (i < d.roadmap.length - 1) {
      const next = d.roadmap[i + 1];
      const nextActive = cur && String(next.number) === String(cur.number);
      const cls = done && next.status === 'complete' ? 'done' : done && nextActive ? 'grad' : 'todo';
      stepEls.push(`<span class="sline ${cls}"></span>`);
    }
  });

  // WHAT — pipeline + in-flight tasks
  const stages = ['research', 'plan', 'execute', 'verify'];
  const ci = stages.indexOf(stage);
  const pipe = stages.map((s, i) => {
    const k = i < ci ? 'done' : i === ci ? 'on' : 'off';
    return `<span class="pstep ${k}">${esc(s)}${i < ci ? ' ✓' : i === ci ? ' ●' : ''}</span>`;
  }).join('<span class="pgt">›</span>');

  const tasks = d.worktrees.length
    ? d.worktrees.map(t => `<div class="task"><span class="tname"><span class="td"></span>${esc(t.branch.replace(/^army\//, ''))}</span>`
      + `<span class="tpath">${esc(t.worktree)}</span></div>`).join('')
    : `<div class="task"><span class="tname dim">${cur ? (cur.plans || 0) : 0} plan(s) · ${cur ? (cur.summaries || 0) : 0} done</span></div>`;
  const whatSub = d.worktrees.length
    ? `Build squad · ${d.worktrees.length} task${d.worktrees.length > 1 ? 's' : ''} in flight across isolated worktrees`
    : 'pan pipeline — no army worktrees active';

  return `
  <section class="nowbuilding">
    <div class="nbtop">
      <div class="ph dark">now building</div>
      <div class="nbphase"><span class="nd"></span>phase ${esc(cur ? cur.number : '—')} of ${esc(total)} · ${esc(stage)}</div>
    </div>
    <div class="stepper">${stepEls.join('')}</div>
    <div class="nbcard">
      <div class="nbhead">
        <div class="nbtitle">Phase ${esc(cur ? cur.number : '')} — ${esc(cur && cur.name ? cur.name : '')}</div>
        <div class="pipeline">${pipe}</div>
      </div>
      <div class="nbsub">${esc(whatSub)}</div>
      <div class="tasks">${tasks}</div>
    </div>
  </section>`;
}

function renderCommandStack(d) {
  if (!d.army_active) return '';
  const a = d.army;
  const anyActive = a.squads.some(s => s.active_count > 0);
  const squadCards = a.squads.map(s => {
    const color = SQUAD_COLOR[s.name] || '#5B4BE6';
    const pillEl = s.active_count > 0
      ? pill(`${s.active_count} active`, SQUAD_PILL[s.name] || 'info')
      : (s.name === 'release' ? pill('human gate', 'warn') : pill('idle', 'muted'));
    const drill = s.agents.length
      ? s.agents.map(ag => `<div class="ag"><span class="amono">↳ ${esc(ag.name)}</span>`
        + `<span class="amono ${ag.active ? 'okc' : 'dim'}">${ag.active ? `${ag.calls} calls · ${fmtTokens(ag.tokens)} tok` : 'idle'}</span></div>`).join('')
      : '<div class="ag"><span class="amono dim">git-tool driven · no agents</span></div>';
    return `
    <div class="squad" style="border-left:3px solid ${color}">
      <div class="squad-head">
        <span class="squad-name"><span class="dot" style="background:${color}"></span>${esc(s.label)}
          <span class="amono dim">· ${esc(s.tier)} · ${esc(s.access)}</span></span>
        ${pillEl}
      </div>
      <div class="squad-sum">${esc(s.summary)}</div>
      ${drill}
    </div>`;
  }).join('');
  return `
  <section class="panel">
    <div class="ph">command stack — live</div>
    <div class="coord">
      <span class="dot" style="background:var(--coral)"></span>
      <span class="cname">Mission Control</span>
      <span class="amono dim">· ${esc(a.coordinator)} · opus · reasoning · delegation-only</span>
      <span class="mc-state">${anyActive ? 'delegating' : 'idle'}</span>
    </div>
    <div class="squads">${squadCards}</div>
    <div class="workers amono dim"><span class="dot" style="background:var(--green)"></span>workers · ${a.workers.map(esc).join(', ')}</div>
  </section>`;
}

function renderCampaign(d) {
  if (!d.campaign) return '';
  const c = d.campaign;
  const budgetPct = c.daily_budget ? Math.round((c.spent_today / c.daily_budget) * 100) : 0;
  const runs = c.history.length
    ? c.history.map(h => `${h.items_landed || 0}↑${h.points_used || 0}p`).join(' · ')
    : 'no runs yet';
  return `
  <section class="panel">
    <div class="ph">campaign</div>
    <div class="row"><span class="rl">Status</span>${pill(c.enabled ? (c.paused ? 'paused' : 'active') : 'disabled', c.enabled && !c.paused ? 'ok' : 'muted')}</div>
    <div class="row"><span class="rl">Cadence</span><span class="amono">${esc(c.cadence)}</span></div>
    ${c.goal ? `<div class="row"><span class="rl">Goal</span><span class="amono">${esc(c.goal)}</span></div>` : ''}
    <div class="row"><span class="rl">Next due</span><span class="amono warnc">${c.due ? 'due now' : relDue(c.next_due, d.generated_at)}</span></div>
    <div class="row noborder"><span class="rl">Daily budget</span><span class="amono">${c.spent_today} / ${c.daily_budget} pts</span></div>
    ${bar(budgetPct, budgetPct >= 100 ? 'var(--red)' : 'var(--indigo)')}
    <div class="row noborder"><span class="rl">Runs</span><span class="amono dim">${esc(runs)}</span></div>
  </section>`;
}

function renderRoadmap(d) {
  if (!d.roadmap.length) return '';
  const rows = d.roadmap.map(p =>
    `<div class="row"><span><span class="dot" style="background:${STATUS_DOT[p.status] || '#C9C0AE'}"></span>${esc(p.number)}${p.name ? ' · ' + esc(p.name) : ''}</span>${pill(p.status, STATUS_KIND[p.status])}</div>`
  ).join('');
  return `
  <section class="panel">
    <div class="ph">roadmap</div>
    ${rows}
  </section>`;
}

function renderHarness(d) {
  if (!d.army_active) return '';
  const h = d.harness;
  const conc = h.concurrency
    ? ('serial_build' in h.concurrency ? `serial_build: ${Boolean(h.concurrency.serial_build)}` : esc(JSON.stringify(h.concurrency)))
    : 'default';
  return `
  <section class="panel">
    <div class="ph">safety harness — sentinel</div>
    <div class="row"><span class="rl">Merge gate</span>${pill(h.merge_gate, h.merge_gate === 'always-ask' ? 'warn' : 'info')}</div>
    <div class="row"><span class="rl">Abort switch</span>${pill(h.abort, h.abort === 'clear' ? 'ok' : 'warn')}</div>
    <div class="row"><span class="rl">Active worktrees</span><span class="amono">${h.active_worktrees}</span></div>
    <div class="row"><span class="rl">Nesting depth</span><span class="amono">2 (max)</span></div>
    <div class="row noborder"><span class="rl">Concurrency</span><span class="amono">${esc(conc)}</span></div>
  </section>`;
}

function renderTelemetry(d) {
  const t = d.telemetry;
  // A ledger where most records are implausible is the pre-v3.12.4 capture bug —
  // don't present salvaged numbers as if trustworthy; tell the user to reset it.
  if (t.totals.suspect_excluded > t.totals.calls) {
    const total = t.totals.suspect_excluded + t.totals.calls;
    return `
  <section class="panel">
    <div class="ph">telemetry</div>
    <div class="row noborder"><span class="rl">Status</span>${pill('legacy ledger — unreliable', 'warn')}</div>
    <div class="amono dim" style="margin-top:10px;line-height:1.6;">${t.totals.suspect_excluded} of ${total} cost records are implausible (the pre-v3.12.4 telemetry capture bug). Reset the ledger with <b>pan-tools cost clear</b> — records captured after the fix are accurate.</div>
  </section>`;
  }
  const keys = Object.keys(t.by_squad).sort((a, b) => t.by_squad[b].cost - t.by_squad[a].cost);
  const max = keys.reduce((m, k) => Math.max(m, t.by_squad[k].cost), 0) || 1;
  const bars = keys.length
    ? keys.map(k => {
      const color = SQUAD_COLOR[k] || (k === 'command' ? '#FFCE4A' : '#9A9180');
      const pct = Math.round((t.by_squad[k].cost / max) * 100);
      return `<div class="sqbar"><div class="sqbar-h"><span>${esc(k)}</span><span>${fmtUsd(t.by_squad[k].cost)}</span></div>`
        + `<div class="bar"><span style="width:${pct}%;background:${color}"></span></div></div>`;
    }).join('')
    : '<div class="row noborder dim amono">No cost records yet</div>';
  return `
  <section class="panel">
    <div class="ph">telemetry · spend by squad</div>
    <div class="row"><span class="rl">Total spend</span><span class="amono">${fmtUsd(t.totals.cost_usd)}</span></div>
    <div class="row"><span class="rl">Tokens</span><span class="amono">${fmtTokens(t.totals.input_tokens + t.totals.output_tokens)}</span></div>
    <div class="row"><span class="rl">Cache hit</span><span class="amono okc">${t.cache_hit_rate_pct == null ? 'n/a' : t.cache_hit_rate_pct + '%'}</span></div>
    ${t.totals.suspect_excluded ? `<div class="row"><span class="rl">Excluded</span>${pill(t.totals.suspect_excluded + ' implausible records', 'warn')}</div>` : ''}
    <div class="sqbars">${bars}</div>
  </section>`;
}

function renderWorktrees(d) {
  if (!d.army_active) return '';
  const rows = d.worktrees.length
    ? d.worktrees.map(t => `<div class="row"><span class="amono"><span class="dot" style="background:var(--coral)"></span>${esc(t.branch)}</span>`
      + `<span class="amono dim">${esc(t.worktree)}</span></div>`).join('')
    : '<div class="row noborder dim amono">No army worktrees</div>';
  return `
  <section class="panel">
    <div class="ph">active worktrees — build squad</div>
    ${rows}
  </section>`;
}

function renderQuality(d) {
  if (!d.requirements && !d.quality) return '';
  const req = d.requirements;
  const q = d.quality;
  const left = req
    ? `<div class="qcol">
        <div class="row noborder"><span class="rl">Requirements done</span><span class="amono">${req.done} / ${req.total}</span></div>
        ${bar(Math.round((req.done / req.total) * 100), 'var(--indigo)')}
        ${req.open.length ? `<div class="open">${req.open.map(o => `<div class="amono dim">• ${esc(o)}</div>`).join('')}</div>` : '<div class="amono dim">all requirements met</div>'}
      </div>`
    : '<div class="qcol amono dim">No requirements tracked</div>';
  const right = q
    ? `<div class="qcol">
        <div class="row"><span class="rl">Last verification</span>${pill('phase ' + q.phase, 'info')}</div>
        ${q.phase_name ? `<div class="row"><span class="rl">Phase</span><span class="amono">${esc(q.phase_name)}</span></div>` : ''}
        <div class="row noborder"><span class="rl">Artifacts</span><span class="amono">${q.verification ? 'verification' : ''}${q.verification && q.uat ? ' + ' : ''}${q.uat ? 'uat' : ''}</span></div>
      </div>`
    : '<div class="qcol amono dim">No verification yet</div>';
  return `
  <section class="panel">
    <div class="ph">requirements &amp; quality</div>
    <div class="qgrid">${left}${right}</div>
  </section>`;
}

function renderActivity(d) {
  if (!d.activity.length) return '';
  const rows = d.activity.map(c =>
    `<div class="row"><span class="amono"><span class="hash">${esc(c.hash)}</span> · ${esc(c.subject)}</span><span class="amono dim">${esc(c.when)}</span></div>`
  ).join('');
  return `
  <section class="panel">
    <div class="ph">recent activity</div>
    ${rows}
  </section>`;
}

const HUD_CSS = `
:root{
  --bg:#E7DBC2;--panel:#FBF7EE;--panel2:#F3ECDD;--border:#E4D8C0;--border2:#E8DDC6;--rowline:#EDE3D0;
  --text:#211E18;--text2:#5C5446;--muted:#9A9180;--faint:#C9C0AE;
  --coral:#FF5A3C;--indigo:#5B4BE6;--green:#1E8E5A;--butter:#FFCE4A;--gold:#C28A1E;--red:#D2431F;
  --font:"Gabarito","Segoe UI",system-ui,sans-serif;
  --mono:"JetBrains Mono","SFMono-Regular",Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;padding:28px;-webkit-font-smoothing:antialiased;}
::selection{background:var(--coral);color:#fff;}
.wrap{max-width:1120px;margin:0 auto;}
.mono,.amono{font-family:var(--mono);}
.amono{font-size:12px;}
.dim{color:var(--muted);}
.okc{color:var(--green);}
.warnc{color:#9A7A12;}
.hash{color:var(--gold);}

.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;}
.tb-brand{display:flex;align-items:center;gap:13px;}
.tb-brand .mark{width:34px;height:34px;}
.tb-word{font-weight:800;font-size:17px;letter-spacing:-0.01em;}
.tb-word .c{color:var(--coral);}
.tb-word .hud{color:var(--muted);font-weight:600;}
.tb-meta{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:11px;color:#8C8475;}
.tb-meta .sep{color:#C2B79E;}
.tb-live{display:inline-flex;align-items:center;gap:7px;background:#E4F3EB;color:var(--green);padding:6px 11px;border-radius:8px;}
.tb-live .ld{width:7px;height:7px;border-radius:50%;background:var(--green);}

.panel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 3px rgba(33,30,24,0.05);}
.ph{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--rowline);font-size:13px;}
.row.noborder,.row:last-child{border-bottom:none;}
.rl{color:var(--text2);}
.pill{font-family:var(--mono);font-size:11px;padding:3px 10px;border-radius:8px;white-space:nowrap;}
.pill.ok{background:#E4F3EB;color:#1E8E5A;}
.pill.info{background:#E9E6FB;color:#5B4BE6;}
.pill.warn{background:#FFF3D4;color:#9A7A12;}
.pill.danger{background:#FBE2DB;color:#D2431F;}
.pill.muted{background:#EDE8DC;color:#8C8475;}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle;}
.bar{height:7px;border-radius:6px;background:#EAE2D1;overflow:hidden;margin:8px 0;}
.bar>span{display:block;height:100%;border-radius:6px;}

.mission .mhead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
.title{font-size:27px;font-weight:800;letter-spacing:-0.02em;margin-top:4px;}
.sub{color:var(--text2);margin-top:4px;max-width:60ch;}
.mmeta{text-align:right;}
.statusline{margin-top:16px;color:var(--text2);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px;}
.metric{background:var(--panel2);border:1px solid var(--border2);border-radius:12px;padding:16px 18px;}
.mlabel{color:var(--text2);font-size:13px;}
.mnum{font-size:27px;font-weight:800;margin-top:2px;}
.munit{font-size:17px;color:var(--muted);font-weight:700;margin-left:2px;}
.mbar{height:6px;border-radius:5px;background:#E6DAC4;overflow:hidden;margin:9px 0 7px;}
.mbar>span{display:block;height:100%;}
.msub{font-family:var(--mono);font-size:11px;color:var(--muted);}

/* dark "now building" hero */
.nowbuilding{background:#211E18;border-radius:16px;padding:24px 26px;margin-bottom:16px;box-shadow:0 8px 24px -12px rgba(33,30,24,0.4);}
.nbtop{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.ph.dark{color:#8C8475;margin-bottom:0;}
.nbphase{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;color:#FF9077;}
.nbphase .nd{width:7px;height:7px;border-radius:50%;background:var(--coral);}
.stepper{display:flex;align-items:center;gap:0;margin-bottom:18px;}
.step{flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;width:64px;}
.sdot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;font-weight:700;}
.sdot.done{background:var(--green);color:#fff;}
.sdot.done .ck{width:13px;height:13px;}
.sdot.now{width:28px;height:28px;background:var(--coral);color:#fff;font-weight:800;box-shadow:0 0 0 4px rgba(255,90,60,0.22);}
.sdot.todo{background:#2E2A22;border:1.5px solid #4A4339;color:#8C8475;}
.slabel{font-family:var(--mono);font-size:10px;text-align:center;max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6E685B;}
.slabel.now{color:#FF9077;font-weight:600;}
.slabel.done{color:#8C8475;}
.sline{flex:1;height:3px;min-width:8px;background:#3A352C;margin-bottom:18px;}
.sline.done{background:var(--green);}
.sline.grad{background:linear-gradient(90deg,#1E8E5A,#FF5A3C);}
.nbcard{background:#2A251D;border:1px solid #3A352C;border-radius:13px;padding:18px 20px;}
.nbhead{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px;}
.nbtitle{font-size:20px;font-weight:800;color:#FBF7EE;}
.pipeline{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;}
.pstep{color:#6E685B;}
.pstep.done{color:#76D2A2;}
.pstep.on{color:#FF9077;font-weight:600;}
.pgt{color:#4A4339;}
.nbsub{color:#A7A091;font-size:13px;margin-bottom:14px;}
.tasks{display:flex;flex-direction:column;gap:10px;}
.task{background:#211E18;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
.tname{font-weight:600;font-size:14px;color:#FBF7EE;display:flex;align-items:center;gap:10px;min-width:0;}
.tname .td{width:8px;height:8px;border-radius:50%;background:var(--coral);flex:none;}
.tpath{font-family:var(--mono);font-size:10.5px;color:#8C8475;flex:none;}

.coord{border:1px solid var(--border2);background:var(--panel2);border-radius:11px;padding:13px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px;}
.cname{font-weight:700;}
.mc-state{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--indigo);}
.squads{display:flex;flex-direction:column;gap:11px;}
.squad{background:#fff;border:1px solid var(--rowline);border-radius:10px;padding:13px 15px;}
.squad-head{display:flex;justify-content:space-between;align-items:center;}
.squad-name{font-weight:700;}
.squad-sum{color:var(--text2);font-size:12px;margin:7px 0 6px;}
.ag{display:flex;justify-content:space-between;padding:4px 0 1px;border-top:1px solid var(--rowline);}
.ag:first-of-type{}
.workers{margin-top:13px;}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
.grid .panel{margin-bottom:0;}
.gcol{display:flex;flex-direction:column;gap:16px;}
.sqbars{display:flex;flex-direction:column;gap:9px;margin-top:8px;}
.sqbar-h{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text2);margin-bottom:5px;}

.qgrid{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
.open{margin-top:8px;display:flex;flex-direction:column;gap:5px;}
.foot{color:var(--muted);font-family:var(--mono);font-size:11px;text-align:center;margin-top:22px;}
@media(max-width:760px){.metrics,.grid,.qgrid{grid-template-columns:1fr;}.step{width:44px;}}
`;

/**
 * Render the collected data into one self-contained HTML document.
 * @param {object} d - from collectHudData()
 * @returns {string}
 */
function renderHud(d) {
  const leftCol = [renderCampaign(d), renderRoadmap(d)].filter(Boolean).join('');
  const rightCol = [renderHarness(d), renderTelemetry(d)].filter(Boolean).join('');
  const grid = (leftCol || rightCol)
    ? `<div class="grid"><div class="gcol">${leftCol}</div><div class="gcol">${rightCol}</div></div>`
    : '';
  const body = [
    renderTopBar(d),
    renderMission(d),
    renderNowBuilding(d),
    renderCommandStack(d),
    grid,
    renderWorktrees(d),
    renderQuality(d),
    renderActivity(d),
  ].filter(Boolean).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanWizard HUD — ${esc(d.project.name || 'project')}</title>
<style>${HUD_CSS}</style></head>
<body><div class="wrap">
${body}
<div class="foot">PanWizard · generated ${esc(d.generated_at)} · self-contained snapshot</div>
</div></body></html>`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

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
 * Generate the HUD. Default: write `.planning/hud.html`.
 * @param {string} cwd
 * @param {{out?:string, open?:boolean, stdout?:boolean, now?:Date}} opts
 * @param {boolean} raw
 */
function cmdHud(cwd, opts = {}, raw) {
  const data = collectHudData(cwd, opts);
  const html = renderHud(data);

  if (opts.stdout) {
    process.stdout.write(html);
    return;
  }

  const outPath = opts.out
    ? path.resolve(cwd, opts.out)
    : path.join(planningPath(cwd), HUD_FILE);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
  } catch (e) {
    return error('Failed to write HUD: ' + e.message);
  }

  let opened = false;
  if (opts.open) opened = openInBrowser(outPath);

  const sections = [
    'mission',
    data.roadmap.length && 'now-building',
    data.army_active && 'command-stack',
    data.campaign && 'campaign',
    data.army_active && 'safety-harness',
    data.army_active && 'worktrees',
    data.roadmap.length && 'roadmap',
    'telemetry',
    (data.requirements || data.quality) && 'requirements-quality',
    data.activity.length && 'activity',
  ].filter(Boolean);

  output(
    { path: toPosix(outPath), bytes: Buffer.byteLength(html), army_active: data.army_active, sections, opened },
    raw,
    `HUD written to ${toPosix(outPath)} (${sections.length} sections${opened ? ', opened' : ''})`,
  );
}

module.exports = {
  HUD_FILE,
  collectHudData,
  renderHud,
  cmdHud,
  // exported for focused unit tests
  scanPhases,
  scanRequirements,
  scanVerification,
  buildArmy,
  telemetryBySquad,
  esc,
};
