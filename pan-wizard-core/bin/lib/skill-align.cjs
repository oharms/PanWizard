/**
 * Skill-Align — Skill-Aligned Decomposition (SAD) pass for planning
 * (ADR-0038, spec: docs/specs/skill-aligned-decomposition.md).
 *
 * SkillWeaver's finding (arXiv 2606.18051): one-shot task decomposition
 * misaligns with the tool/skill library that actually exists; feeding
 * retrieved skill candidates back to the decomposer to realign vocabulary
 * and granularity lifted decomposition accuracy 51% → 92%.
 *
 * PAN's adoption is deliberately minimal and advisory:
 *   - index built on the fly (~140 small files; no persisted index, no
 *     staleness, no installer changes)
 *   - keyword scoring via knowledge.cjs scoreRelevance (no embeddings,
 *     no vector store — ADR-0036 guardrail)
 *   - output is names + one-line descriptions, budget-bounded, with
 *     explicit `dropped` reporting (no silent caps)
 *   - fail-open: missing roots are skipped, never thrown — the planner
 *     proceeds as today if anything is absent
 *
 * The "rewrite the decomposition" half of the loop stays in the
 * pan-planner agent (it is already an LLM); this module only retrieves.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, toPosix } = require('./core.cjs');
const {
  CHARS_PER_TOKEN,
  SKILL_ALIGN_TOP_K,
  SKILL_ALIGN_MIN_SCORE,
  SKILL_ALIGN_VOCAB_BUDGET_TOKENS,
  SKILL_ALIGN_MAX_TASKS,
  SKILL_ALIGN_CONTENT_CAP,
} = require('./constants.cjs');
const { scoreRelevance } = require('./knowledge.cjs');
const { readIndex } = require('./learn-index.cjs');

/**
 * Planning glue words stripped from task cues before scoring. Without this,
 * "Create the API" matches every skill file containing "create". Nouns that
 * carry skill signal (test, phase, plan, commit, ...) are deliberately kept.
 */
const SAD_STOPWORDS = new Set([
  'create', 'add', 'implement', 'update', 'write', 'make', 'build',
  'setup', 'set', 'ensure', 'use', 'using', 'new', 'the', 'and', 'for',
  'with', 'this', 'that', 'from', 'into', 'each', 'all', 'should', 'must',
  'task', 'tasks', 'file', 'files',
]);

/**
 * Skill roots walked by buildSkillIndex, relative to the resolved root.
 * The same relative layout holds in the source repo and in every install
 * (root = the directory containing pan-wizard-core/).
 */
const SKILL_ROOTS = [
  { kind: 'command', rel: path.join('commands', 'pan'), recursive: false },
  { kind: 'template', rel: path.join('pan-wizard-core', 'templates'), recursive: true },
  { kind: 'reference', rel: path.join('pan-wizard-core', 'references'), recursive: false },
];

/**
 * Default skill root: three levels up from lib/ — the install root
 * (~/.claude/) or the source repo root. Mirrors experiment.cjs
 * PAN_SOURCE_ROOT; both layouts keep commands/ and pan-wizard-core/
 * side by side.
 */
function resolveSkillRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Frontmatter is only needed for two scalar keys; a targeted line scan
 * avoids importing the full YAML parser for files that may not have
 * frontmatter at all.
 */
function readNameDescription(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description):\s*(.+)$/);
    if (kv && !(kv[1] in out)) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** First markdown heading, or first non-empty non-delimiter line. */
function firstHeading(content) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t === '---' || /^<\/?[\w-]+>$/.test(t)) continue;
    const h = t.match(/^#+\s+(.+)$/);
    return (h ? h[1] : t).slice(0, 120);
  }
  return '';
}

function listMdFiles(dir, recursive) {
  const files = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) files.push(...listMdFiles(abs, true));
    } else if (e.name.endsWith('.md')) {
      files.push(abs);
    }
  }
  return files;
}

/**
 * Build the skill index from the filesystem. Never throws: roots or
 * learnings that are missing/unreadable are skipped and reported in
 * stats.skipped_roots.
 *
 * @param {string} root - install root or source repo root
 * @returns {{entries: Array, stats: {entries: number, by_kind: Object, skipped_roots: string[]}}}
 */
function buildSkillIndex(root) {
  const entries = [];
  const skipped = [];

  for (const sr of SKILL_ROOTS) {
    const dir = path.join(root, sr.rel);
    const files = listMdFiles(dir, sr.recursive);
    if (files.length === 0) { skipped.push(toPosix(sr.rel)); continue; }
    for (const abs of files) {
      const content = safeReadFile(abs);
      if (!content) continue;
      const fm = readNameDescription(content);
      const relFile = toPosix(path.relative(root, abs));
      const name = fm.name
        || toPosix(path.relative(path.join(root, sr.rel), abs)).replace(/\.md$/, '');
      const description = fm.description || firstHeading(content);
      entries.push({
        kind: sr.kind,
        name,
        description,
        file: relFile,
        tokens_est: Math.ceil(content.length / CHARS_PER_TOKEN),
        // scoring head, not serialized in CLI output
        _head: `${name} ${description} ${content.slice(0, SKILL_ALIGN_CONTENT_CAP)}`,
      });
    }
  }

  // Learnings topics via the existing index (built on the fly if index.json
  // is absent). A root with no learnings yields zero topics, not an error.
  let topics = [];
  try { topics = readIndex(root).topics || []; } catch { topics = []; }
  if (topics.length === 0) skipped.push(toPosix(path.join('pan-wizard-core', 'learnings')));
  for (const t of topics) {
    const content = safeReadFile(path.join(root, t.file)) || '';
    const name = `${t.scope}/${t.name}`;
    const ids = (t.patterns || []).join(', ');
    const description = content
      ? `${firstHeading(content)}${ids ? ` (${ids})` : ''}`
      : ids;
    entries.push({
      kind: 'learning',
      name,
      description,
      file: toPosix(t.file),
      tokens_est: t.size_tokens_est || Math.ceil(content.length / CHARS_PER_TOKEN),
      _head: `${name} ${description} ${content.slice(0, SKILL_ALIGN_CONTENT_CAP)}`,
    });
  }

  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return {
    entries,
    stats: { entries: entries.length, by_kind: byKind, skipped_roots: skipped },
  };
}

/**
 * Parse a draft task blob into task strings. Accepts markdown bullets,
 * numbered lists, checkboxes, or plain lines; drops headings and blanks.
 */
function parseDraftTasks(text) {
  if (typeof text !== 'string') return [];
  const tasks = [];
  for (const line of text.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || /^#{1,6}\s/.test(t) || t === '---') continue;
    t = t.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '').trim();
    if (t.length < 3) continue;
    tasks.push(t);
  }
  return tasks;
}

/** Strip planning glue words so cues carry skill signal only. */
function cleanCue(task) {
  return task
    .split(/\W+/)
    .filter(w => w.length >= 3 && !SAD_STOPWORDS.has(w.toLowerCase()))
    .join(' ');
}

/**
 * The SAD retrieval pass: score each draft task against the skill index,
 * return per-task top-k matches plus a deduped, budget-packed vocabulary
 * hint list for the planner to realign against.
 *
 * @param {string} root - skill root (resolveSkillRoot() for callers without an override)
 * @param {string[]} tasks - draft task strings
 * @param {Object} [opts] - {topK, minScore, tokenBudget}
 * @returns {Object} result per docs/specs/skill-aligned-decomposition.md §3.3
 */
function alignTasks(root, tasks, opts) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { error: 'no tasks to align — provide a non-empty draft task list' };
  }
  if (tasks.length > SKILL_ALIGN_MAX_TASKS) {
    return { error: `draft has ${tasks.length} tasks — max ${SKILL_ALIGN_MAX_TASKS}; a draft this large is a planning smell, split the phase` };
  }
  const topK = Math.max(1, Math.min(10, Number(opts?.topK) || SKILL_ALIGN_TOP_K));
  const minScore = Math.max(1, Number(opts?.minScore) || SKILL_ALIGN_MIN_SCORE);
  const budget = Math.max(100, Number(opts?.tokenBudget) || SKILL_ALIGN_VOCAB_BUDGET_TOKENS);

  const { entries, stats } = buildSkillIndex(root);

  const perTask = [];
  const aggregate = new Map(); // kind/name -> {entry, totalScore}
  for (const task of tasks) {
    const cue = cleanCue(String(task));
    const scored = [];
    if (cue) {
      for (const e of entries) {
        const score = scoreRelevance(cue, e._head);
        if (score >= minScore) scored.push({ e, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    const top = scored.slice(0, topK);
    for (const { e, score } of top) {
      const key = `${e.kind}/${e.name}`;
      const agg = aggregate.get(key) || { entry: e, totalScore: 0 };
      agg.totalScore += score;
      aggregate.set(key, agg);
    }
    perTask.push({
      task: String(task),
      matches: top.map(({ e, score }) => ({ kind: e.kind, name: e.name, file: e.file, score })),
      matched: top.length > 0,
    });
  }

  // Vocabulary: deduped union of all matches, ranked by aggregate score,
  // greedy-packed into the token budget. Overflow is reported, not hidden.
  const ranked = [...aggregate.values()]
    .sort((a, b) => b.totalScore - a.totalScore || a.entry.name.localeCompare(b.entry.name));
  const vocabulary = [];
  const dropped = [];
  let vocabTokens = 0;
  for (const { entry } of ranked) {
    const tokens = Math.ceil((entry.name.length + entry.description.length) / CHARS_PER_TOKEN);
    if (vocabTokens + tokens > budget) {
      dropped.push({ kind: entry.kind, name: entry.name, tokens });
      continue;
    }
    vocabulary.push({
      kind: entry.kind,
      name: entry.name,
      description: entry.description,
      file: entry.file,
      tokens,
    });
    vocabTokens += tokens;
  }

  const matchedCount = perTask.filter(t => t.matched).length;
  return {
    tasks: perTask,
    coverage: {
      matched: matchedCount,
      total: perTask.length,
      ratio: perTask.length ? Math.round((matchedCount / perTask.length) * 100) / 100 : 0,
    },
    vocabulary,
    vocabulary_tokens: vocabTokens,
    dropped,
    index_stats: stats,
    top_k: topK,
    min_score: minScore,
    token_budget: budget,
  };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdSkillsIndex(root, raw) {
  const { entries, stats } = buildSkillIndex(root);
  const result = {
    entries: entries.map(({ _head, ...rest }) => rest),
    total: stats.entries,
    by_kind: stats.by_kind,
    skipped_roots: stats.skipped_roots,
  };
  if (raw) {
    const lines = [`Skill index (${stats.entries} entries):`, ''];
    for (const e of result.entries) {
      lines.push(`  [${e.kind.padEnd(9)}] ${e.name.padEnd(36)} ${String(e.tokens_est).padStart(5)}t  ${e.description}`);
    }
    if (stats.skipped_roots.length > 0) {
      lines.push('', `Skipped roots (missing/empty): ${stats.skipped_roots.join(', ')}`);
    }
    output(result, true, lines.join('\n'));
  } else {
    output(result, false);
  }
}

function cmdSkillsAlign(root, opts, raw) {
  let draft = opts?.draft;
  if (!draft && opts?.draftFile) {
    draft = safeReadFile(opts.draftFile);
    if (draft === null) {
      output({ error: `draft file not found or unreadable: ${opts.draftFile}` }, raw);
      return;
    }
  }
  if (!draft || !draft.trim()) {
    error('Usage: skills align (--draft "<text>" | --draft-file <path>) [--top <k>] [--min-score <n>] [--token-budget <n>] [--source-root <path>]');
  }
  const tasks = parseDraftTasks(draft);
  const result = alignTasks(root, tasks, opts);
  if (result.error) { output(result, raw); return; }
  if (raw) {
    const lines = [`SAD alignment: ${result.coverage.matched}/${result.coverage.total} tasks matched (${result.index_stats.entries} skills indexed)`, ''];
    for (const t of result.tasks) {
      lines.push(`  ${t.matched ? '✓' : '✗'} ${t.task}`);
      for (const m of t.matches) {
        lines.push(`      [${m.kind}] ${m.name} (score ${m.score})`);
      }
    }
    lines.push('', `Vocabulary hints (${result.vocabulary.length} skills, ${result.vocabulary_tokens}t of ${result.token_budget}t budget):`);
    for (const v of result.vocabulary) {
      lines.push(`  [${v.kind.padEnd(9)}] ${v.name} — ${v.description}`);
    }
    if (result.dropped.length > 0) {
      lines.push(`Dropped (over budget): ${result.dropped.map(d => d.name).join(', ')}`);
    }
    output(result, true, lines.join('\n'));
  } else {
    output(result, false);
  }
}

module.exports = {
  resolveSkillRoot,
  buildSkillIndex,
  parseDraftTasks,
  alignTasks,
  cmdSkillsIndex,
  cmdSkillsAlign,
  SAD_STOPWORDS,
  SKILL_ROOTS,
};
