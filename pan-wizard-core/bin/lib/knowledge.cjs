/**
 * Knowledge — grounded Q&A, multi-turn discussion, playbook generation
 * (Spec B v2 Y-3, v3.2).
 *
 * Three modes, one module:
 *   - ask      — retrieve candidate files + format citation context for the agent
 *   - discuss  — session state CRUD for multi-turn conversations on a phase
 *   - playbook — read all agents' memory and cluster into sections
 *
 * All three leverage Spec A infrastructure:
 *   - E-1 caching for stable input prefixes (ask, discuss)
 *   - E-4 memory for playbook source + discuss state
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, toPosix } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');
const { listMemoryAgents, readMemory } = require('./memory.cjs');

const CONVERSATIONS_DIR = 'conversations';
const PLAYBOOK_FILE = 'playbook.md';
const DEFAULT_MAX_SOURCES = 20;

// ─── Mode: ask — retrieval for grounded Q&A ────────────────────────────────

/**
 * Candidate source directories that pan-knowledge agent can cite.
 */
const CITATION_ROOTS = [
  '.planning/project.md',
  '.planning/requirements.md',
  '.planning/roadmap.md',
  '.planning/state.md',
  '.planning/standards.md',
  '.planning/patterns.md',
  '.planning/phases',
  '.planning/milestones',
  '.planning/memory',
  'docs',
  'CHANGELOG.md',
  'README.md',
  'CLAUDE.md',
];

/**
 * Score a candidate file by naive keyword matching against the question.
 * Not a vector index — just a frequency-based ranker so the agent reads
 * the most relevant files first.
 */
function scoreRelevance(question, content) {
  if (!content) return 0;
  const words = question.toLowerCase().split(/\W+/).filter(w => w.length >= 3);
  if (words.length === 0) return 0;
  const body = content.toLowerCase();
  let score = 0;
  for (const w of words) {
    const count = (body.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g')) || []).length;
    score += count;
  }
  return score;
}

/**
 * Walk a path (file or directory, 1 level deep for .md files) and return
 * {file, score} entries.
 */
function gatherCandidates(cwd, question, recallCue) {
  const candidates = [];
  const mk = (rel, content) => ({
    file: toPosix(rel),
    score: scoreRelevance(question, content),
    recall_score: recallCue ? scoreRelevance(recallCue, content) : 0,
    bytes: Buffer.byteLength(content || '', 'utf-8'),
  });
  for (const rel of CITATION_ROOTS) {
    const abs = path.join(cwd, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isFile()) {
      candidates.push(mk(rel, safeReadFile(abs)));
    } else if (stat.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(abs); } catch { continue; }
      for (const entry of entries) {
        const entryAbs = path.join(abs, entry);
        let entryStat;
        try { entryStat = fs.statSync(entryAbs); } catch { continue; }
        if (entryStat.isFile() && entry.endsWith('.md')) {
          candidates.push(mk(path.join(rel, entry), safeReadFile(entryAbs)));
        } else if (entryStat.isDirectory()) {
          // One more level for phases/<NN>/ and milestones/
          let sub = [];
          try { sub = fs.readdirSync(entryAbs); } catch { continue; }
          for (const s of sub) {
            if (!s.endsWith('.md')) continue;
            candidates.push(mk(path.join(rel, entry, s), safeReadFile(path.join(entryAbs, s))));
          }
        }
      }
    }
  }
  return candidates;
}

/**
 * Retrieve ranked candidate sources for a question.
 *
 * @param {string} cwd - Project root
 * @param {string} question - User's natural-language question
 * @param {Object} [opts] - {max_sources}
 * @returns {Object} {question, sources: Array<{file, score, bytes}>, total_candidates}
 */
function ask(cwd, question, opts) {
  if (typeof question !== 'string' || !question.trim()) {
    return { error: 'question must be a non-empty string' };
  }
  const max = Math.max(1, Math.min(100, Number(opts?.max_sources) || DEFAULT_MAX_SOURCES));
  const recallCue = opts && typeof opts.recall_cue === 'string' && opts.recall_cue.trim()
    ? opts.recall_cue.trim() : null;
  const all = gatherCandidates(cwd, question, recallCue);
  const ranked = all
    .filter(c => c.score > 0 || c.file.endsWith('project.md') || c.file.endsWith('requirements.md'))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, max);
  const result = {
    question,
    // Strip the internal recall_score so `sources` keeps its {file, score, bytes} shape.
    sources: ranked.map(({ recall_score, ...rest }) => rest),
    total_candidates: all.length,
    returned: ranked.length,
  };
  if (recallCue) {
    // FW-1 (minimal, ADR-0036): re-score the SAME already-gathered candidates
    // against a follow-up cue and return a tighter recall slice — no second
    // filesystem walk, no new dependency, still distill-and-select.
    result.recall_cue = recallCue;
    result.recall_sources = all
      .filter(c => c.recall_score > 0)
      .sort((a, b) => b.recall_score - a.recall_score || a.file.localeCompare(b.file))
      .slice(0, max)
      .map(c => ({ file: c.file, recall_score: c.recall_score, bytes: c.bytes }));
  }
  return result;
}

// ─── Mode: discuss — session state for multi-turn conversations ────────────

function conversationsDir(cwd) {
  return path.join(planningPath(cwd), CONVERSATIONS_DIR);
}

function sessionFile(cwd, phaseNum) {
  return path.join(conversationsDir(cwd), String(phaseNum), 'session.json');
}

/**
 * Read or initialize a discussion session for a phase.
 */
function loadSession(cwd, phaseNum) {
  const file = sessionFile(cwd, phaseNum);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { phase: String(phaseNum), turns: [], created: new Date().toISOString() };
  }
}

/**
 * Append a user question + agent response turn.
 *
 * @param {string} cwd
 * @param {string} phaseNum
 * @param {{role: 'user'|'agent', content: string, cites?: string[]}} turn
 * @returns {{appended: true, turn_count: number, file: string}|{error: string}}
 */
function appendTurn(cwd, phaseNum, turn) {
  if (!phaseNum) return { error: 'phaseNum required' };
  if (!turn || !turn.role || !turn.content) return { error: 'turn requires role + content' };
  if (turn.role !== 'user' && turn.role !== 'agent') {
    return { error: 'turn.role must be "user" or "agent"' };
  }

  const session = loadSession(cwd, phaseNum);
  session.turns.push({
    ts: new Date().toISOString(),
    role: turn.role,
    content: turn.content,
    cites: Array.isArray(turn.cites) ? turn.cites : [],
  });
  session.last_updated = session.turns[session.turns.length - 1].ts;

  const file = sessionFile(cwd, phaseNum);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  } catch (e) {
    return { error: `Failed to write session: ${e.message}` };
  }

  return { appended: true, turn_count: session.turns.length, file: toPosix(path.relative(cwd, file)) };
}

// ─── Mode: playbook — cluster agent memory into sections ───────────────────

/**
 * Category heuristics. Maps keyword patterns to playbook sections.
 * Order matters — first match wins.
 */
const PLAYBOOK_CATEGORIES = [
  { name: 'Conventions', pattern: /\b(convention|style|format|naming|prefer)\b/i },
  { name: 'Gotchas', pattern: /\b(gotcha|pitfall|edge\s*case|surprise|careful)\b/i },
  { name: 'Decisions', pattern: /\b(decision|decided|chose|picked|adopt)\b/i },
  { name: 'Tool choices', pattern: /\b(library|package|framework|tool|alternative)\b/i },
  { name: 'Anti-patterns', pattern: /\b(anti.?pattern|avoid|do not|don't|never)\b/i },
  { name: 'Recurring gaps', pattern: /\brecurring\s+(gap|plan\s+gap|issue)\b/i },
];

function categorizeEntry(entry) {
  for (const cat of PLAYBOOK_CATEGORIES) {
    if (cat.pattern.test(entry)) return cat.name;
  }
  return 'General';
}

/**
 * Generate a structured playbook from all agents' memory files.
 *
 * @param {string} cwd - Project root
 * @returns {Object} {sections: {name: [{agent, entry}]}, agent_count, entry_count}
 */
function buildPlaybook(cwd) {
  const { agents } = listMemoryAgents(cwd);
  const sections = {};
  let entryCount = 0;

  for (const a of agents) {
    const mem = readMemory(cwd, a.agent);
    if (!mem) continue;
    for (const entry of mem.entries) {
      const cat = categorizeEntry(entry);
      if (!sections[cat]) sections[cat] = [];
      sections[cat].push({ agent: a.agent, entry });
      entryCount += 1;
    }
  }

  return {
    sections,
    agent_count: agents.length,
    entry_count: entryCount,
    generated: new Date().toISOString(),
  };
}

/**
 * Serialize the playbook object to markdown and write to `.planning/playbook.md`.
 */
function writePlaybook(cwd, playbook) {
  const lines = [];
  lines.push('---');
  lines.push('type: playbook');
  lines.push(`generated: ${playbook.generated}`);
  lines.push(`source_agents: ${playbook.agent_count}`);
  lines.push(`entries: ${playbook.entry_count}`);
  lines.push('---');
  lines.push('');
  lines.push('# PAN Playbook');
  lines.push('');
  lines.push(`Accumulated lessons across ${playbook.agent_count} agents and ${playbook.entry_count} memory entries. Regenerated from \`.planning/memory/*.md\`.`);
  lines.push('');

  const sectionOrder = [
    ...PLAYBOOK_CATEGORIES.map(c => c.name),
    'General',
  ];

  for (const section of sectionOrder) {
    const items = playbook.sections[section];
    if (!items || items.length === 0) continue;
    lines.push(`## ${section}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item.entry} _— from \`${item.agent}\`_`);
    }
    lines.push('');
  }

  const file = path.join(planningPath(cwd), PLAYBOOK_FILE);
  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  } catch (e) {
    return { error: `Failed to write playbook: ${e.message}` };
  }
  return { written: true, file: toPosix(path.relative(cwd, file)) };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdKnowledgeAsk(cwd, question, opts, raw) {
  if (!question) error('Usage: knowledge ask <question>');
  output(ask(cwd, question, opts), raw);
}

function cmdKnowledgeDiscuss(cwd, phaseNum, opts, raw) {
  const subcmd = opts?.subcmd;
  if (subcmd === 'read') {
    output(loadSession(cwd, phaseNum), raw);
  } else if (subcmd === 'append') {
    output(appendTurn(cwd, phaseNum, {
      role: opts.role,
      content: opts.content,
      cites: opts.cites ? opts.cites.split(',') : [],
    }), raw);
  } else {
    error('Usage: knowledge discuss <phase> --subcmd read|append [--role user|agent --content "..."]');
  }
}

function cmdKnowledgePlaybook(cwd, opts, raw) {
  const playbook = buildPlaybook(cwd);
  if (opts?.preview) {
    output(playbook, raw);
    return;
  }
  const result = writePlaybook(cwd, playbook);
  if (result.error) { output(result, raw); return; }
  output({ ...result, agent_count: playbook.agent_count, entry_count: playbook.entry_count }, raw);
}

module.exports = {
  ask,
  loadSession,
  appendTurn,
  buildPlaybook,
  writePlaybook,
  scoreRelevance,
  categorizeEntry,
  cmdKnowledgeAsk,
  cmdKnowledgeDiscuss,
  cmdKnowledgePlaybook,
  CITATION_ROOTS,
  CONVERSATIONS_DIR,
  PLAYBOOK_FILE,
  PLAYBOOK_CATEGORIES,
};
