/**
 * Preview — foresight data layer (Spec B v2 Y-1, v3.1).
 *
 * Three builders that gather structured inputs for the pan-previewer agent:
 *   - buildPhasePreview(cwd, phaseNum) — blast radius of one phase
 *   - buildPhaseDependencyGraph(cwd)   — mermaid DAG + parallel batches
 *   - buildMilestoneETA(cwd)           — completion forecast with bottleneck
 *
 * Each builder is deterministic: it reads files from .planning/ and emits
 * JSON the agent analyzes. The agent is where actual *reasoning* happens.
 * The data layer's job is to hand the agent a clean, structured payload.
 */

const fs = require('fs');
const path = require('path');
const {
  output,
  error,
  safeReadFile,
  findPhaseInternal,
  getRoadmapPhaseInternal,
  toPosix,
} = require('./core.cjs');
const {
  PLANNING_DIR,
  ROADMAP_FILE,
  STATE_FILE,
  PHASES_DIR,
  PHASE_DIR_RE,
  isPlanFile,
  isSummaryFile,
} = require('./constants.cjs');
const { planningPath, phasesPath } = require('./utils.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { countRoadmapPhases } = require('./verify.cjs');

// ─── Shared helpers ─────────────────────────────────────────────────────────

const RISK_KEYWORDS = {
  drop: /\b(drop\s+(table|column|index)|DROP\s+TABLE|rm\s+-rf)\b/i,
  delete: /\b(delete\s+from|remove\s+the|unlink|rmdir)\b/i,
  migrate: /\b(migration|migrate|alter\s+table|rename\s+table)\b/i,
  rename: /\b(rename\s+(file|variable|function|class)|refactor.*rename)\b/i,
  breaking: /\b(breaking\s+change|incompatible|deprecat)/i,
  auth: /\b(authentication|authorization|credentials|secret|password|token|api.?key)\b/i,
};

/** Extract file-ish paths mentioned in a markdown blob (backtick-wrapped or prose). */
function extractFilePaths(text) {
  const paths = new Set();
  // Backtick-wrapped: `path/to/file.ext`
  const backtickRe = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g;
  let m;
  while ((m = backtickRe.exec(text)) !== null) {
    const p = m[1];
    if (p.includes('/') && !p.startsWith('http')) paths.add(p);
  }
  // Bare prose paths like `src/foo.js` or `tests/bar.test.cjs` (more conservative).
  const bareRe = /\b((?:src|tests|lib|agents|commands|hooks|pan-wizard-core|docs|scripts|bin)\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\b/g;
  while ((m = bareRe.exec(text)) !== null) {
    paths.add(m[1]);
  }
  return [...paths].sort();
}

/** Detect risk signals in plan/summary text. Returns a {keyword: boolean} map plus a 1-10 score. */
function detectRiskSignals(text) {
  const signals = {};
  let weight = 0;
  const weights = { drop: 3, delete: 2, migrate: 2, rename: 1, breaking: 2, auth: 1 };
  for (const [key, re] of Object.entries(RISK_KEYWORDS)) {
    const hit = re.test(text);
    signals[key] = hit;
    if (hit) weight += weights[key] || 1;
  }
  // Normalize to 1-10. Empty text → 1, all signals hit → ~10.
  const score = Math.max(1, Math.min(10, Math.round(weight + 1)));
  return { signals, risk_score: score };
}

/** Estimate days between two ISO timestamps. */
function daysBetween(startIso, endIso) {
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    return ms / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

// ─── Y-1 phase mode: buildPhasePreview ──────────────────────────────────────

/**
 * Gather blast-radius inputs for a single phase.
 *
 * @param {string} cwd - Project root
 * @param {string|number} phaseNum - Phase identifier (e.g. "07" or 7)
 * @returns {Object} Structured preview payload
 */
function buildPhasePreview(cwd, phaseNum) {
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo || !phaseInfo.found) {
    return { error: `Phase ${phaseNum} not found in .planning/phases/` };
  }

  const phaseDir = path.join(cwd, phaseInfo.directory);
  const planFiles = (phaseInfo.plans || []).sort();
  const summaryFiles = (phaseInfo.summaries || []).sort();

  const planTexts = [];
  const planContents = [];
  for (const f of planFiles) {
    const content = safeReadFile(path.join(phaseDir, f));
    if (content) {
      planTexts.push(content);
      planContents.push({ file: f, content });
    }
  }
  const combined = planTexts.join('\n\n');

  const files_mentioned = extractFilePaths(combined);
  const { signals: risk_signals, risk_score } = detectRiskSignals(combined);

  // Count test file mentions.
  const testFiles = files_mentioned.filter(p =>
    p.includes('.test.') || p.startsWith('tests/') || p.endsWith('.spec.js') || p.endsWith('.spec.ts')
  );

  // Roadmap context: is this phase already completed?
  const roadmapPhase = getRoadmapPhaseInternal(cwd, phaseNum);
  let status;
  if (summaryFiles.length === 0) {
    status = 'planned';
  } else if (phaseInfo.incomplete_plans && phaseInfo.incomplete_plans.length > 0) {
    status = 'in_progress';
  } else {
    status = 'completed';
  }

  return {
    phase: String(phaseNum),
    phase_name: phaseInfo.name || (roadmapPhase && roadmapPhase.phase_name) || null,
    directory: toPosix(phaseInfo.directory),
    status,
    plan_count: planFiles.length,
    summary_count: summaryFiles.length,
    goal: roadmapPhase ? roadmapPhase.goal : null,
    files_mentioned,
    test_files_mentioned: testFiles,
    files_mentioned_count: files_mentioned.length,
    test_files_count: testFiles.length,
    risk_signals,
    risk_score,
    plans: planContents.map(p => ({ file: p.file, bytes: Buffer.byteLength(p.content, 'utf-8') })),
  };
}

// ─── Y-1 phases mode: buildPhaseDependencyGraph ─────────────────────────────

/**
 * Produce a dependency graph + mermaid source + parallel-batch recommendation.
 *
 * Dependency detection:
 *  - plan frontmatter `depends_on: [phase:NN, phase:MM]` (explicit)
 *  - mentions of prior phases in plan text (heuristic, flagged as "hidden")
 *
 * @param {string} cwd - Project root
 * @returns {Object}
 */
function buildPhaseDependencyGraph(cwd) {
  const roadmapContent = safeReadFile(path.join(planningPath(cwd), ROADMAP_FILE));
  if (!roadmapContent) {
    return { error: 'roadmap.md not found' };
  }

  const counts = countRoadmapPhases(roadmapContent);
  const phaseList = extractPhaseListFromRoadmap(roadmapContent);

  // Build {num → {name, status, explicit_deps, hidden_deps}}
  const graph = {};
  const phaseDirs = {};
  const phasesRoot = phasesPath(cwd);
  let dirs = [];
  try {
    dirs = fs.readdirSync(phasesRoot).filter(d => PHASE_DIR_RE.test(d));
  } catch { /* no phases dir */ }
  for (const d of dirs) {
    const m = d.match(/^(\d+(?:\.\d+)?)-/);
    if (m) {
      // Index both the zero-padded and the stripped form so lookups from the
      // roadmap (which may be "1" or "01") both resolve.
      phaseDirs[m[1]] = d;
      const stripped = String(Number(m[1].split('.')[0])) + (m[1].includes('.') ? '.' + m[1].split('.')[1] : '');
      phaseDirs[stripped] = d;
    }
  }

  for (const p of phaseList) {
    graph[p.num] = {
      num: p.num,
      name: p.name,
      status: p.completed ? 'completed' : 'planned',
      explicit_deps: [],
      hidden_deps: [],
    };

    // Read plan files for depends_on frontmatter + prior-phase mentions.
    const dir = phaseDirs[p.num];
    if (!dir) continue;
    const fullDir = path.join(phasesRoot, dir);
    let files = [];
    try { files = fs.readdirSync(fullDir).filter(isPlanFile); } catch { continue; }

    const phaseText = files.map(f => safeReadFile(path.join(fullDir, f)) || '').join('\n');

    // Explicit via frontmatter. Parse depends_on as freeform string (either
    // inline `[phase:1, phase:2]`, or block-list). Extract all digit runs.
    const fmMatch = phaseText.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const depsLine = fmMatch[1].match(/^depends_on:\s*(.+)$/m);
      if (depsLine) {
        const digitRuns = depsLine[1].match(/\d+(?:\.\d+)?/g) || [];
        for (const d of digitRuns) {
          if (d !== p.num && !graph[p.num].explicit_deps.includes(d)) {
            graph[p.num].explicit_deps.push(d);
          }
        }
      }
      // Also support block-list form:
      //   depends_on:
      //     - phase:1
      //     - phase:2
      const blockMatch = fmMatch[1].match(/^depends_on:\s*\n((?:\s*-\s*.+\n?)*)/m);
      if (blockMatch && !depsLine) {
        const items = blockMatch[1].match(/^\s*-\s*(.+)$/gm) || [];
        for (const item of items) {
          const d = item.match(/\d+(?:\.\d+)?/);
          if (d && d[0] !== p.num && !graph[p.num].explicit_deps.includes(d[0])) {
            graph[p.num].explicit_deps.push(d[0]);
          }
        }
      }
    }

    // Hidden via mentions: "phase N", "from phase N", "as in phase N".
    const mentionRe = /\bphase\s+(\d+(?:\.\d+)?)/gi;
    let mm;
    const mentions = new Set();
    while ((mm = mentionRe.exec(phaseText)) !== null) {
      if (mm[1] !== p.num) mentions.add(mm[1]);
    }
    graph[p.num].hidden_deps = [...mentions].filter(d => !graph[p.num].explicit_deps.includes(d));
  }

  // Compute parallel batches via simple topo-like grouping.
  const parallel_batches = computeParallelBatches(graph);

  // Generate mermaid source.
  const mermaid = generateMermaid(graph);

  return {
    phase_count: counts.planned,
    completed_count: counts.completed,
    phases: Object.values(graph),
    parallel_batches,
    mermaid,
    hidden_coupling_count: Object.values(graph)
      .reduce((sum, p) => sum + p.hidden_deps.length, 0),
  };
}

function extractPhaseListFromRoadmap(content) {
  const phases = [];
  const re = /- \[([ x])\]\s*(?:\*\*)?Phase\s+(\d+(?:\.\d+)?)\s*[:\-—]?\s*([^\n*]+?)(?:\*\*)?\s*$/gim;
  let m;
  while ((m = re.exec(content)) !== null) {
    phases.push({
      num: m[2],
      name: m[3].trim(),
      completed: m[1] === 'x',
    });
  }
  return phases;
}

function computeParallelBatches(graph) {
  // Phases that share no explicit dependency can run in parallel.
  // Kahn's algorithm: pick phases with no unresolved explicit deps.
  const remaining = new Set(Object.keys(graph));
  const resolved = new Set();
  const batches = [];

  let guard = 100;
  while (remaining.size > 0 && guard-- > 0) {
    const batch = [];
    for (const num of remaining) {
      const unresolvedDeps = graph[num].explicit_deps.filter(d => !resolved.has(d) && remaining.has(d));
      if (unresolvedDeps.length === 0) batch.push(num);
    }
    if (batch.length === 0) {
      // Cycle or dangling dep — dump the rest into a single batch.
      batches.push([...remaining].sort());
      break;
    }
    batch.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    batches.push(batch);
    for (const n of batch) { resolved.add(n); remaining.delete(n); }
  }
  return batches;
}

function generateMermaid(graph) {
  const lines = ['graph TD'];
  for (const [num, node] of Object.entries(graph)) {
    const label = `P${num.replace('.', '_')}["${num}: ${node.name.slice(0, 30).replace(/"/g, '')}"]`;
    const cls = node.status === 'completed' ? ':::done' : '';
    lines.push(`  ${label}${cls}`);
  }
  for (const [num, node] of Object.entries(graph)) {
    for (const dep of node.explicit_deps) {
      lines.push(`  P${dep.replace('.', '_')} --> P${num.replace('.', '_')}`);
    }
    for (const dep of node.hidden_deps) {
      lines.push(`  P${dep.replace('.', '_')} -.-> P${num.replace('.', '_')}`);
    }
  }
  lines.push('  classDef done fill:#d4edda,stroke:#28a745');
  return lines.join('\n');
}

// ─── Y-1 milestone mode: buildMilestoneETA ──────────────────────────────────

/**
 * Forecast milestone completion based on historical phase durations.
 *
 * @param {string} cwd - Project root
 * @returns {Object}
 */
function buildMilestoneETA(cwd) {
  const roadmapContent = safeReadFile(path.join(planningPath(cwd), ROADMAP_FILE));
  if (!roadmapContent) {
    return { error: 'roadmap.md not found' };
  }

  const phaseList = extractPhaseListFromRoadmap(roadmapContent);
  const completed = phaseList.filter(p => p.completed);
  const remaining = phaseList.filter(p => !p.completed);

  // Sample phase durations from summary frontmatter or commit metadata.
  const durations = sampleCompletedPhaseDurations(cwd, completed);
  const avg = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 5.0; // default 5 days per phase when no history

  const avgDays = Math.round(avg * 10) / 10;
  const remainingDays = remaining.length * avgDays;
  const etaDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  // Confidence shrinks with small sample size and high variance.
  const confidence = durations.length >= 5
    ? 80
    : durations.length >= 3
      ? 65
      : durations.length >= 1
        ? 50
        : 35;

  // Bottleneck: phase with the most plans / largest slug, heuristic.
  const bottleneck = findBottleneckCandidate(cwd, remaining);

  // Current milestone from state.md.
  const stateContent = safeReadFile(path.join(planningPath(cwd), STATE_FILE)) || '';
  const msMatch = stateContent.match(/\*\*Current Milestone:\*\*\s*(\S+)/);
  const currentMilestone = msMatch ? msMatch[1] : null;

  return {
    current_milestone: currentMilestone,
    phases_total: phaseList.length,
    phases_completed: completed.length,
    phases_remaining: remaining.length,
    avg_phase_duration_days: avgDays,
    velocity_phases_per_week: avg > 0 ? Math.round((7 / avg) * 100) / 100 : 0,
    sample_size: durations.length,
    eta_date: etaDate,
    confidence_pct: confidence,
    bottleneck,
  };
}

function findPhaseDir(dirs, num) {
  // Match "1" against "01-foo" or "1-foo"; match "1.1" against "01.1-foo" or "1.1-foo".
  const padded = num.includes('.')
    ? num.split('.').map((s, i) => i === 0 ? s.padStart(2, '0') : s).join('.')
    : num.padStart(2, '0');
  return dirs.find(d => d.startsWith(`${num}-`) || d.startsWith(`${padded}-`));
}

function sampleCompletedPhaseDurations(cwd, completedPhases) {
  const durations = [];
  const phasesRoot = phasesPath(cwd);
  let dirs = [];
  try { dirs = fs.readdirSync(phasesRoot); } catch { return durations; }
  for (const p of completedPhases) {
    const dir = findPhaseDir(dirs, p.num);
    if (!dir) continue;
    // Read the latest summary.md for `completed` / `started` fields.
    const fullDir = path.join(phasesRoot, dir);
    let files = [];
    try { files = fs.readdirSync(fullDir).filter(isSummaryFile).sort(); } catch { continue; }
    if (files.length === 0) continue;
    const content = safeReadFile(path.join(fullDir, files[files.length - 1]));
    if (!content) continue;
    const fm = extractFrontmatter(content);
    if (!fm || Object.keys(fm).length === 0) continue;
    const started = fm.started || fm.start || fm.created;
    const completed_at = fm.completed || fm.finished || fm.done;
    if (started && completed_at) {
      const d = daysBetween(started, completed_at);
      if (d && d > 0 && d < 60) durations.push(d);
    }
  }
  return durations;
}

function findBottleneckCandidate(cwd, remainingPhases) {
  if (remainingPhases.length === 0) return null;
  const phasesRoot = phasesPath(cwd);
  let biggest = null;
  let biggestPlanCount = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(phasesRoot); } catch { return null; }
  for (const p of remainingPhases) {
    const dir = findPhaseDir(dirs, p.num);
    if (!dir) continue;
    const fullDir = path.join(phasesRoot, dir);
    let planCount = 0;
    try {
      planCount = fs.readdirSync(fullDir).filter(isPlanFile).length;
    } catch { /* skip */ }
    if (planCount > biggestPlanCount) {
      biggestPlanCount = planCount;
      biggest = { phase: p.num, name: p.name, plan_count: planCount };
    }
  }
  if (!biggest) return null;
  return { ...biggest, reason: `${biggestPlanCount} plan files — largest among remaining phases` };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdPreviewPhase(cwd, phaseNum, raw) {
  if (!phaseNum) error('Usage: preview phase <N>');
  output(buildPhasePreview(cwd, phaseNum), raw);
}

function cmdPreviewPhases(cwd, raw) {
  output(buildPhaseDependencyGraph(cwd), raw);
}

function cmdPreviewMilestone(cwd, raw) {
  output(buildMilestoneETA(cwd), raw);
}

module.exports = {
  buildPhasePreview,
  buildPhaseDependencyGraph,
  buildMilestoneETA,
  extractFilePaths,
  detectRiskSignals,
  extractPhaseListFromRoadmap,
  computeParallelBatches,
  generateMermaid,
  sampleCompletedPhaseDurations,
  findBottleneckCandidate,
  cmdPreviewPhase,
  cmdPreviewPhases,
  cmdPreviewMilestone,
  RISK_KEYWORDS,
};
