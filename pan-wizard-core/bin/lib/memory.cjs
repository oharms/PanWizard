/**
 * Memory — cross-phase agent memory layer
 *
 * Each agent has an append-only memory log at `.planning/memory/<agent>.md`.
 * Agents read their memory at start of each invocation and append lessons
 * learned at end. Compaction keeps file size bounded.
 *
 * File format: a markdown file with a stable YAML frontmatter header and
 * an append-only "## Entries" section containing one bullet per entry:
 *
 *   ---
 *   agent: pan-planner
 *   created: 2026-04-18
 *   ---
 *
 *   ## Entries
 *
 *   - 2026-04-18: Prefer bulk writes over per-row commits for Postgres
 *   - 2026-04-19: ...
 */

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');
const { PLANNING_DIR, CHARS_PER_TOKEN, MEMORY_SELECT_BUDGET_TOKENS, MEMORY_RECENCY_FLOOR, MEMORY_SOFT_CAP_MULT, MEMORY_LOAD_WARN_TOKENS, MEMORY_LOAD_CRIT_TOKENS, MEMORY_LOAD_MAX_FRACTION } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const MEMORY_DIR = 'memory';
const DEFAULT_MAX_ENTRIES = 500;
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function memoryDir(cwd) {
  return path.join(planningPath(cwd), MEMORY_DIR);
}

function memoryFile(cwd, agent) {
  return path.join(memoryDir(cwd), `${agent}.md`);
}

function validateAgentName(agent) {
  if (typeof agent !== 'string' || !AGENT_NAME_RE.test(agent)) {
    return `Invalid agent name: ${agent}. Must match ${AGENT_NAME_RE}`;
  }
  return null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read the memory file for an agent.
 * @param {string} cwd - Project root
 * @param {string} agent - Agent name
 * @returns {{agent: string, entries: string[], raw: string}|null}
 */
function readMemory(cwd, agent) {
  const err = validateAgentName(agent);
  if (err) return null;
  let raw;
  try {
    raw = fs.readFileSync(memoryFile(cwd, agent), 'utf-8');
  } catch {
    return null;
  }
  const entries = parseEntries(raw);
  return { agent, entries, raw };
}

/**
 * Parse bullet entries from a memory file's body.
 * @param {string} raw - File contents
 * @returns {string[]} ordered entries (oldest → newest, as stored)
 */
function parseEntries(raw) {
  const entries = [];
  const lines = raw.split(/\r?\n/);
  let inEntries = false;
  for (const line of lines) {
    if (/^##\s+Entries\s*$/.test(line)) { inEntries = true; continue; }
    if (inEntries && /^##\s+/.test(line)) break;
    if (!inEntries) continue;
    const match = line.match(/^-\s+(.+)$/);
    if (match) entries.push(match[1]);
  }
  return entries;
}

/**
 * Append a single entry to an agent's memory log. Creates file+dir if absent.
 * Entries are prefixed with today's date automatically unless already prefixed.
 * @param {string} cwd - Project root
 * @param {string} agent - Agent name
 * @param {string} entry - Single-line lesson (newlines will be collapsed)
 * @returns {{appended: true, file: string, count: number}|{error: string}}
 */
function appendMemory(cwd, agent, entry) {
  const err = validateAgentName(agent);
  if (err) return { error: err };
  if (typeof entry !== 'string' || !entry.trim()) {
    return { error: 'entry must be a non-empty string' };
  }

  const cleaned = entry.replace(/\r?\n/g, ' ').trim();
  const datePrefixed = /^\d{4}-\d{2}-\d{2}:/.test(cleaned);
  const finalEntry = datePrefixed ? cleaned : `${today()}: ${cleaned}`;

  try {
    fs.mkdirSync(memoryDir(cwd), { recursive: true });
  } catch (e) {
    return { error: `Failed to create memory dir: ${e.message}` };
  }

  const file = memoryFile(cwd, agent);
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf-8');
  } catch {
    // new file
  }

  let contents;
  if (!existing) {
    contents = buildHeader(agent) + '\n\n## Entries\n\n- ' + finalEntry + '\n';
  } else if (/##\s+Entries/.test(existing)) {
    // Ensure file ends with newline, then append bullet.
    const needsNl = !existing.endsWith('\n');
    contents = existing + (needsNl ? '\n' : '') + `- ${finalEntry}\n`;
  } else {
    const needsNl = !existing.endsWith('\n');
    contents = existing + (needsNl ? '\n' : '') + '\n## Entries\n\n- ' + finalEntry + '\n';
  }

  try {
    fs.writeFileSync(file, contents, 'utf-8');
  } catch (e) {
    return { error: `Failed to write memory file: ${e.message}` };
  }

  let count = parseEntries(contents).length;
  // Soft auto-compaction (ADR-0036): only above a HIGH soft cap (2× the manual
  // cap) so it never silently drops entries a user expects to survive; trims to
  // DEFAULT_MAX_ENTRIES and surfaces the result — never fully silent.
  let auto_compacted;
  if (count >= DEFAULT_MAX_ENTRIES * MEMORY_SOFT_CAP_MULT) {
    const c = compactMemory(cwd, agent, DEFAULT_MAX_ENTRIES);
    if (c && c.compacted) { auto_compacted = { kept: c.kept, removed: c.removed }; count = c.kept; }
  }
  return auto_compacted
    ? { appended: true, file, count, auto_compacted }
    : { appended: true, file, count };
}

function buildHeader(agent) {
  return `---\nagent: ${agent}\ncreated: ${today()}\n---`;
}

/**
 * Trim a memory file to the last N entries. Preserves frontmatter header.
 * @param {string} cwd - Project root
 * @param {string} agent - Agent name
 * @param {number} maxEntries - Keep this many most-recent entries
 * @returns {{compacted: true, kept: number, removed: number}|{error: string}}
 */
function compactMemory(cwd, agent, maxEntries = DEFAULT_MAX_ENTRIES) {
  const err = validateAgentName(agent);
  if (err) return { error: err };
  const max = Number(maxEntries);
  if (!Number.isFinite(max) || max < 1) {
    return { error: `maxEntries must be a positive integer, got ${maxEntries}` };
  }

  const file = memoryFile(cwd, agent);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return { error: `No memory file for agent: ${agent}` };
  }

  const entries = parseEntries(raw);
  if (entries.length <= max) {
    return { compacted: true, kept: entries.length, removed: 0 };
  }

  const keep = entries.slice(-max);
  const removed = entries.length - keep.length;

  const headerMatch = raw.match(/^---[\s\S]*?---/);
  const header = headerMatch ? headerMatch[0] : buildHeader(agent);
  const body = '\n\n## Entries\n\n' + keep.map(e => `- ${e}`).join('\n') + '\n';
  try {
    fs.writeFileSync(file, header + body, 'utf-8');
  } catch (e) {
    return { error: `Failed to write memory file: ${e.message}` };
  }
  return { compacted: true, kept: keep.length, removed };
}

/**
 * List all agents that have a memory file.
 * @param {string} cwd - Project root
 * @returns {{agents: Array<{agent: string, entries: number}>}}
 */
function listMemoryAgents(cwd) {
  let files;
  try {
    files = fs.readdirSync(memoryDir(cwd));
  } catch {
    return { agents: [] };
  }
  const agents = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const name = f.slice(0, -3);
    if (!AGENT_NAME_RE.test(name)) continue;
    const mem = readMemory(cwd, name);
    agents.push({ agent: name, entries: mem ? mem.entries.length : 0 });
  }
  agents.sort((a, b) => a.agent.localeCompare(b.agent));
  return { agents };
}

// ─── Cue + recency scoped, token-budgeted read (ADR-0036 FW-2) ───────────────

/** Tokenize a cue into lowercase words of length >= 3. */
function cueTokens(cue) {
  return (typeof cue === 'string' ? cue.toLowerCase() : '').match(/[a-z0-9]{3,}/g) || [];
}

/** Whole-word keyword-frequency score of an entry against cue tokens. */
function scoreEntry(entry, tokens) {
  if (!tokens || !tokens.length) return 0;
  const lc = entry.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    s += (lc.match(re) || []).length;
  }
  return s;
}

function estMemoryTokens(str) {
  return Math.max(1, Math.ceil((str || '').length / CHARS_PER_TOKEN));
}

/**
 * Select a cue-relevant, recency-floored, token-budgeted slice of an agent's
 * memory instead of the whole log (ADR-0036 FW-2) — distill-and-select on the
 * memory axis, so per-agent memory injection can't flood context.
 *
 * Always keeps the newest `recencyFloor` entries (recall never returns empty on
 * a non-empty log); fills the remaining budget by cue relevance, falling back to
 * recency-only when the cue is empty or matches nothing; greedily packs under
 * `tokenBudget`. Output is in stored (chronological) order.
 *
 * @param {string} cwd
 * @param {string} agent
 * @param {{cue?: string, tokenBudget?: number, recencyFloor?: number}} [opts]
 * @returns {{agent, cue, selected: string[], total_tokens, considered, dropped, mode}|{error}}
 */
function selectMemory(cwd, agent, opts = {}) {
  const err = validateAgentName(agent);
  if (err) return { error: err };
  const mem = readMemory(cwd, agent);
  if (!mem || mem.entries.length === 0) {
    return { agent, cue: opts.cue || '', selected: [], total_tokens: 0, considered: 0, dropped: 0, mode: 'empty' };
  }
  const all = mem.entries; // oldest -> newest
  const bN = Number(opts.tokenBudget);
  const budget = Number.isFinite(bN) && bN > 0 ? bN : MEMORY_SELECT_BUDGET_TOKENS;
  const fN = Number(opts.recencyFloor);
  const recencyFloor = Number.isFinite(fN) && fN >= 0 ? fN : MEMORY_RECENCY_FLOOR;
  const tokens = cueTokens(opts.cue);

  const floorFrom = Math.max(0, all.length - recencyFloor);
  const scored = all.map((text, i) => ({
    text, i, tokens: estMemoryTokens(text),
    score: i >= floorFrom ? Infinity : scoreEntry(text, tokens),
  }));
  const anyCueHit = scored.some(e => Number.isFinite(e.score) && e.score > 0);
  // Priority: recency-floor first (Infinity), then cue score, then newest.
  scored.sort((a, b) => b.score - a.score || b.i - a.i);

  const chosen = [];
  let total = 0, dropped = 0;
  for (const e of scored) {
    if (total + e.tokens > budget) { dropped++; continue; }
    chosen.push(e); total += e.tokens;
  }
  // Guarantee non-empty on a non-empty log even if budget < the smallest entry.
  if (chosen.length === 0) {
    const newest = scored.reduce((a, b) => (b.i > a.i ? b : a));
    chosen.push(newest); total += newest.tokens; dropped = Math.max(0, dropped - 1);
  }
  chosen.sort((a, b) => a.i - b.i); // chronological for output
  const mode = tokens.length === 0 ? 'recency' : (anyCueHit ? 'cue' : 'recency');
  return { agent, cue: opts.cue || '', selected: chosen.map(e => e.text), total_tokens: total, considered: all.length, dropped, mode };
}

/**
 * Memory-load telemetry gate (ADR-0036 acceptance signal). Estimates the tokens
 * of memory that would be injected whole (every agent log) and compares to the
 * median per-agent input from the trustworthy cost ledger (suspect records
 * quarantined). Read-only, non-blocking; degrades to an absolute-token check
 * when the ledger is thin.
 *
 * @returns {{memory_tokens, agents, median_input_tokens, fraction, status, advisory}}
 */
function memoryLoadBudget(cwd, opts = {}) {
  const { agents } = listMemoryAgents(cwd);
  let memoryTokens = 0;
  for (const a of agents) {
    const mem = readMemory(cwd, a.agent);
    if (mem) memoryTokens += estMemoryTokens(mem.raw);
  }
  let median = null;
  try {
    const cost = require('./cost.cjs');
    const inputs = (cost.readRecords(cwd) || [])
      .filter(r => !cost.isSuspectRecord(r))
      .map(r => Number(r.input_tokens) || 0)
      .filter(n => n > 0)
      .sort((a, b) => a - b);
    if (inputs.length) median = inputs[Math.floor(inputs.length / 2)];
  } catch { /* thin/absent ledger — absolute-token check only */ }

  const fraction = median ? memoryTokens / median : null;
  const warnT = opts.warnTokens || MEMORY_LOAD_WARN_TOKENS;
  const critT = opts.critTokens || MEMORY_LOAD_CRIT_TOKENS;
  const maxFrac = opts.maxFraction || MEMORY_LOAD_MAX_FRACTION;
  let status = 'ok';
  if (memoryTokens >= critT || (fraction != null && fraction >= maxFrac * 2)) status = 'critical';
  else if (memoryTokens >= warnT || (fraction != null && fraction >= maxFrac)) status = 'warning';
  const advisory = status === 'ok'
    ? 'Memory-load within budget.'
    : `Memory injection is ~${memoryTokens} tokens across ${agents.length} agent log(s)` +
      (fraction != null ? ` (~${Math.round(fraction * 100)}% of median agent input)` : '') +
      `. Bound it with cue-scoped 'memory select' or trim with 'memory compact <agent>'.`;
  return { memory_tokens: memoryTokens, agents: agents.length, median_input_tokens: median, fraction, status, advisory };
}

// ─── CLI command wrappers ────────────────────────────────────────────────────

function cmdMemoryRead(cwd, agent, raw) {
  if (!agent) { error('Usage: memory read <agent>'); }
  const result = readMemory(cwd, agent);
  if (!result) { output({ agent, entries: [], exists: false }, raw); return; }
  output({ agent, entries: result.entries, exists: true }, raw);
}

function cmdMemoryAppend(cwd, agent, entry, raw) {
  if (!agent || !entry) { error('Usage: memory append <agent> <entry>'); }
  const result = appendMemory(cwd, agent, entry);
  output(result, raw);
}

function cmdMemoryList(cwd, raw) {
  output(listMemoryAgents(cwd), raw);
}

function cmdMemoryCompact(cwd, agent, maxEntries, raw) {
  if (!agent) { error('Usage: memory compact <agent> [max]'); }
  const result = compactMemory(cwd, agent, maxEntries || DEFAULT_MAX_ENTRIES);
  output(result, raw);
}

function cmdMemorySelect(cwd, agent, opts, raw) {
  if (!agent) { error('Usage: memory select <agent> [--cue <text>] [--token-budget N] [--recency-floor N]'); }
  output(selectMemory(cwd, agent, opts || {}), raw);
}

function cmdMemoryBudget(cwd, raw) {
  output(memoryLoadBudget(cwd), raw);
}

module.exports = {
  readMemory,
  appendMemory,
  compactMemory,
  listMemoryAgents,
  selectMemory,
  memoryLoadBudget,
  scoreEntry,
  parseEntries,
  validateAgentName,
  cmdMemoryRead,
  cmdMemoryAppend,
  cmdMemoryList,
  cmdMemoryCompact,
  cmdMemorySelect,
  cmdMemoryBudget,
  MEMORY_DIR,
  DEFAULT_MAX_ENTRIES,
};
