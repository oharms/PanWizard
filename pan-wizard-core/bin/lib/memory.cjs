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
 *
 * Cited, verified, expiring entries (memory optimisation O4 — the Copilot Memory
 * pattern). An entry may end in a metadata comment:
 *
 *   - 2026-10-04: Batch inserts through the writer <!-- cites: src/db/writer.js#bulkInsert; used: 2026-10-12 -->
 *
 * `cites` names the code the lesson rests on (`path` or `path#symbol`, relative to
 * the project root). `memory select` checks every citation against the working
 * tree and leaves out an entry whose evidence is gone. `used` is the last day the
 * entry was injected (`memory select --mark-used`). An entry not used for
 * MEMORY_EXPIRE_DAYS is left out too, and `memory prune` archives both kinds to
 * `.planning/memory/archive/<agent>.md`, never deleting.
 *
 * Not every file in `.planning/memory/` is an agent log. RESERVED_MEMORY_NAMES
 * are PAN's own archives there, and they are never loaded as memory: the
 * quarantine holds directives PAN refused to follow (ADR-0040).
 */

const fs = require('fs');
const path = require('path');
const { output, error, toLf, dominantEol, withEol } = require('./core.cjs');
const { CHARS_PER_TOKEN, MEMORY_SELECT_BUDGET_TOKENS, MEMORY_RECENCY_FLOOR, MEMORY_SOFT_CAP_MULT, MEMORY_LOAD_WARN_TOKENS, MEMORY_LOAD_CRIT_TOKENS, MEMORY_LOAD_MAX_FRACTION, MEMORY_EXPIRE_DAYS, MEMORY_CITED_FILE_MAX_BYTES } = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');

const MEMORY_DIR = 'memory';
const MEMORY_ARCHIVE_DIR = 'archive';
const DEFAULT_MAX_ENTRIES = 500;
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
/**
 * Files PAN writes into `.planning/memory/` that are not agent logs: the ADR-0040
 * quarantine (memory-optimize QUARANTINE_FILE), the state.md archive
 * (STATE_ARCHIVE_FILE) and distill's patterns (distill PATTERNS_FILE). A test
 * pins these names to those constants.
 */
const RESERVED_MEMORY_NAMES = ['quarantine', 'state-archive', 'distill-patterns'];

function memoryDir(cwd) {
  return path.join(planningPath(cwd), MEMORY_DIR);
}

function memoryFile(cwd, agent) {
  return path.join(memoryDir(cwd), `${agent}.md`);
}

function isReservedMemoryName(name) {
  return RESERVED_MEMORY_NAMES.includes(String(name).toLowerCase());
}

function validateAgentName(agent) {
  if (typeof agent !== 'string' || !AGENT_NAME_RE.test(agent)) {
    return `Invalid agent name: ${agent}. Must match ${AGENT_NAME_RE}`;
  }
  if (isReservedMemoryName(agent)) {
    return `${agent}.md is one of PAN's archives in .planning/memory/, not an agent log; it is never read or written as memory`;
  }
  return null;
}

// ─── Entry metadata: citations and last use (O4) ────────────────────────────

const ENTRY_META_RE = /\s*<!--\s*((?:cites|used)\s*:[^>]*?)\s*-->\s*$/i;
const ENTRY_DATE_RE = /^(\d{4}-\d{2}-\d{2}):\s*/;

/** An entry's parts: `{ date, text, cites: string[], used }`. */
function parseEntryMeta(entry) {
  const s = String(entry == null ? '' : entry);
  const m = s.match(ENTRY_META_RE);
  const body = m ? s.slice(0, m.index) : s;
  const d = body.match(ENTRY_DATE_RE);
  const meta = { date: d ? d[1] : null, text: d ? body.slice(d[0].length) : body, cites: [], used: null };
  if (m) {
    for (const field of m[1].split(';')) {
      const kv = field.match(/^\s*(cites|used)\s*:\s*(.*?)\s*$/i);
      if (!kv) continue;
      if (kv[1].toLowerCase() === 'cites') meta.cites = kv[2].split(',').map(c => c.trim()).filter(Boolean);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(kv[2])) meta.used = kv[2];
    }
  }
  return meta;
}

/** The entry string for `meta` — the inverse of parseEntryMeta. */
function formatEntry(meta) {
  const fields = [];
  if (meta.cites && meta.cites.length) fields.push(`cites: ${meta.cites.join(', ')}`);
  if (meta.used) fields.push(`used: ${meta.used}`);
  const head = meta.date ? `${meta.date}: ${meta.text}` : meta.text;
  return fields.length ? `${head} <!-- ${fields.join('; ')} -->` : head;
}

/**
 * Why a citation (`path` or `path#symbol`) does not hold in the working tree, or
 * null when it does. Paths are relative to the project root and may not leave it.
 * A symbol made of word characters must appear as a whole word; any other symbol
 * as a substring.
 */
function citationProblem(cwd, cite) {
  const s = String(cite || '');
  const hash = s.indexOf('#');
  const rel = hash === -1 ? s : s.slice(0, hash);
  const symbol = hash === -1 ? '' : s.slice(hash + 1);
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return 'not a project-relative path';
  const root = path.resolve(cwd);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return 'outside the project';
  let st;
  try { st = fs.statSync(abs); } catch { return 'file not found'; }
  if (!symbol) return null;
  if (!st.isFile()) return 'a symbol needs a file';
  if (st.size > MEMORY_CITED_FILE_MAX_BYTES) return null;
  let text;
  try { text = fs.readFileSync(abs, 'utf-8'); } catch { return 'unreadable'; }
  const found = /^\w+$/.test(symbol) ? new RegExp(`\\b${symbol}\\b`).test(text) : text.includes(symbol);
  return found ? null : `\`${symbol}\` not found`;
}

function daysSince(isoDate, now) {
  return Math.floor((now - Date.parse(`${isoDate}T00:00:00Z`)) / 86400000);
}

/**
 * Whether an entry may be injected: `valid`, `expired` (not used for `expireDays`;
 * checked first, it needs no file reads) or `stale` (a citation no longer holds).
 * An undated entry never expires; an uncited one is never stale.
 */
function entryStatus(cwd, entry, { now = Date.now(), expireDays = MEMORY_EXPIRE_DAYS } = {}) {
  const meta = parseEntryMeta(entry);
  const last = meta.used || meta.date;
  if (last && expireDays > 0) {
    const age = daysSince(last, now);
    if (age > expireDays) return { status: 'expired', meta, last_used: last, age_days: age };
  }
  const missing = [];
  for (const c of meta.cites) {
    const p = citationProblem(cwd, c);
    if (p) missing.push(`${c} (${p})`);
  }
  return missing.length ? { status: 'stale', meta, missing } : { status: 'valid', meta };
}

function isoDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function expireDaysFrom(v) {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n >= 0 ? n : MEMORY_EXPIRE_DAYS;
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
  const lines = toLf(raw).split('\n');
  return entryLineIndexes(lines).map(i => lines[i].match(/^-\s+(.+)$/)[1]);
}

/** Line indexes of the `## Entries` bullets in LF lines, in order — parseEntries' walk. */
function entryLineIndexes(lines) {
  const idx = [];
  let inEntries = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+Entries\s*$/.test(line)) { inEntries = true; continue; }
    if (inEntries && /^##\s+/.test(line)) break;
    if (inEntries && /^-\s+(.+)$/.test(line)) idx.push(i);
  }
  return idx;
}

/** Citations from `--cites a.js#x,b.js` (string) or an array. */
function citeList(cites) {
  if (Array.isArray(cites)) return cites.map(c => String(c).trim()).filter(Boolean);
  return typeof cites === 'string' ? cites.split(',').map(c => c.trim()).filter(Boolean) : [];
}

/**
 * Append a single entry to an agent's memory log. Creates file+dir if absent.
 * Entries are prefixed with today's date automatically unless already prefixed.
 * `opts.cites` attaches citations; each must hold in the working tree now, since a
 * lesson whose evidence is already missing would never be injected.
 * @param {string} cwd - Project root
 * @param {string} agent - Agent name
 * @param {string} entry - Single-line lesson (newlines will be collapsed)
 * @param {{cites?: string|string[]}} [opts]
 * @returns {{appended: true, file: string, count: number}|{error: string}}
 */
function appendMemory(cwd, agent, entry, opts = {}) {
  const err = validateAgentName(agent);
  if (err) return { error: err };
  if (typeof entry !== 'string' || !entry.trim()) {
    return { error: 'entry must be a non-empty string' };
  }

  const cleaned = entry.replace(/\r?\n/g, ' ').trim();
  const datePrefixed = /^\d{4}-\d{2}-\d{2}:/.test(cleaned);
  let finalEntry = datePrefixed ? cleaned : `${today()}: ${cleaned}`;
  const extra = citeList(opts.cites);
  if (extra.length) {
    const meta = parseEntryMeta(finalEntry);
    meta.cites = [...new Set([...meta.cites, ...extra])];
    finalEntry = formatEntry(meta);
  }
  for (const c of parseEntryMeta(finalEntry).cites) {
    const problem = citationProblem(cwd, c);
    if (problem) return { error: `citation ${c}: ${problem}` };
  }

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

  // Built on LF, written in the file's own line ending (a CRLF log stays CRLF).
  const eol = dominantEol(existing);
  let contents;
  if (!existing) {
    contents = buildHeader(agent) + '\n\n## Entries\n\n- ' + finalEntry + '\n';
  } else if (/##\s+Entries/.test(existing)) {
    // Ensure file ends with newline, then append bullet.
    const needsNl = !existing.endsWith('\n');
    contents = existing + (needsNl ? eol : '') + withEol(`- ${finalEntry}\n`, eol);
  } else {
    const needsNl = !existing.endsWith('\n');
    contents = existing + (needsNl ? eol : '') + withEol('\n## Entries\n\n- ' + finalEntry + '\n', eol);
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
    fs.writeFileSync(file, withEol(toLf(header) + body, dominantEol(raw)), 'utf-8');
  } catch (e) {
    return { error: `Failed to write memory file: ${e.message}` };
  }
  return { compacted: true, kept: keep.length, removed };
}

/**
 * List the agent logs in `.planning/memory/` — the files memory is loaded from.
 * Every other `.md` file there is listed under `not_loaded` with the reason: PAN's
 * own archives (RESERVED_MEMORY_NAMES; the quarantine holds directives PAN refused
 * to follow) and files with no `## Entries` list, whose text `memory select` can
 * neither verify nor expire.
 * @param {string} cwd - Project root
 * @returns {{agents: Array<{agent: string, entries: number}>, not_loaded: Array<{file: string, reason: string}>}}
 */
function listMemoryAgents(cwd) {
  let files;
  try {
    files = fs.readdirSync(memoryDir(cwd));
  } catch {
    return { agents: [], not_loaded: [] };
  }
  const agents = [];
  const notLoaded = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const name = f.slice(0, -3);
    if (isReservedMemoryName(name)) { notLoaded.push({ file: f, reason: 'PAN archive, never loaded as memory' }); continue; }
    if (!AGENT_NAME_RE.test(name)) { notLoaded.push({ file: f, reason: 'not a valid agent name' }); continue; }
    const mem = readMemory(cwd, name);
    if (!mem || !/^##\s+Entries\s*$/m.test(mem.raw)) { notLoaded.push({ file: f, reason: 'no `## Entries` list' }); continue; }
    agents.push({ agent: name, entries: mem.entries.length });
  }
  agents.sort((a, b) => a.agent.localeCompare(b.agent));
  notLoaded.sort((a, b) => a.file.localeCompare(b.file));
  return { agents, not_loaded: notLoaded };
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
 * Only valid entries are candidates (O4): an entry whose cited code is gone
 * (`stale`) or that was not used for `expireDays` (`expired`) is left out and
 * reported. `all` takes every valid entry with no budget. `markUsed` records
 * today as the last use of each selected entry, in the file.
 *
 * @param {string} cwd
 * @param {string} agent
 * @param {{cue?: string, tokenBudget?: number, recencyFloor?: number, all?: boolean,
 *   markUsed?: boolean, expireDays?: number, now?: number}} [opts]
 * @returns {{agent, cue, selected: string[], total_tokens, considered, dropped, mode,
 *   stale: Array<{entry, missing}>, expired: Array<{entry, last_used}>, marked_used?: number}|{error}}
 */
function selectMemory(cwd, agent, opts = {}) {
  const err = validateAgentName(agent);
  if (err) return { error: err };
  const mem = readMemory(cwd, agent);
  if (!mem || mem.entries.length === 0) {
    return { agent, cue: opts.cue || '', selected: [], total_tokens: 0, considered: 0, dropped: 0, mode: 'empty', stale: [], expired: [] };
  }
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const expireDays = expireDaysFrom(opts.expireDays);
  const stale = [];
  const expired = [];
  const valid = []; // { text, i } with i the entry's index in the log
  mem.entries.forEach((text, i) => {
    const s = entryStatus(cwd, text, { now, expireDays });
    if (s.status === 'expired') expired.push({ entry: text, last_used: s.last_used });
    else if (s.status === 'stale') stale.push({ entry: text, missing: s.missing });
    else valid.push({ text, i });
  });
  const base = { agent, cue: opts.cue || '', considered: mem.entries.length, stale, expired };
  if (valid.length === 0) {
    return { ...base, selected: [], total_tokens: 0, dropped: 0, mode: 'empty' };
  }

  const bN = Number(opts.tokenBudget);
  const budget = opts.all ? Infinity : (Number.isFinite(bN) && bN > 0 ? bN : MEMORY_SELECT_BUDGET_TOKENS);
  const fN = Number(opts.recencyFloor);
  const recencyFloor = Number.isFinite(fN) && fN >= 0 ? fN : MEMORY_RECENCY_FLOOR;
  const tokens = cueTokens(opts.cue);

  const floorFrom = Math.max(0, valid.length - recencyFloor);
  const scored = valid.map((v, k) => ({
    text: v.text, i: v.i, tokens: estMemoryTokens(v.text),
    score: k >= floorFrom ? Infinity : scoreEntry(v.text, tokens),
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
  const mode = opts.all ? 'all' : tokens.length === 0 ? 'recency' : (anyCueHit ? 'cue' : 'recency');
  const result = { ...base, selected: chosen.map(e => e.text), total_tokens: total, dropped, mode };
  if (opts.markUsed) result.marked_used = markEntriesUsed(cwd, agent, chosen.map(e => e.i), isoDay(now));
  return result;
}

/**
 * Record `day` as the last use of the entries at `indexes` (positions in the log),
 * rewriting only those bullet lines, in the file's own line ending. Returns how
 * many changed; an entry already marked for `day` is left alone.
 */
function markEntriesUsed(cwd, agent, indexes, day) {
  const file = memoryFile(cwd, agent);
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return 0; }
  const lines = toLf(raw).split('\n');
  const at = entryLineIndexes(lines);
  let changed = 0;
  for (const k of indexes) {
    const li = at[k];
    if (li === undefined) continue;
    const meta = parseEntryMeta(lines[li].replace(/^-\s+/, ''));
    if (meta.used === day) continue;
    meta.used = day;
    lines[li] = `- ${formatEntry(meta)}`;
    changed++;
  }
  if (changed) fs.writeFileSync(file, withEol(lines.join('\n'), dominantEol(raw)), 'utf-8');
  return changed;
}

/**
 * Archive the entries memory no longer injects — stale (cited code gone) and
 * expired (unused for `days`) — from one agent's log or all of them. The archive
 * at `.planning/memory/archive/<agent>.md` is written FIRST, then only those
 * bullet lines leave the log, so an interruption can duplicate and never lose.
 * Dry-run unless `apply`.
 * @param {string} cwd
 * @param {string|null} agent - one agent, or null for every agent log
 * @param {{apply?: boolean, days?: number, now?: number}} [opts]
 */
function pruneMemory(cwd, agent, opts = {}) {
  const names = agent ? [agent] : listMemoryAgents(cwd).agents.map(a => a.agent);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const expireDays = expireDaysFrom(opts.days);
  const day = isoDay(now);
  const agents = [];
  for (const name of names) {
    const err = validateAgentName(name);
    if (err) return { error: err };
    const mem = readMemory(cwd, name);
    if (!mem) {
      if (agent) return { error: `No memory file for agent: ${name}` };
      continue;
    }
    const archive = [];
    mem.entries.forEach((text, i) => {
      const s = entryStatus(cwd, text, { now, expireDays });
      if (s.status === 'expired') archive.push({ i, entry: text, reason: `not used since ${s.last_used}` });
      else if (s.status === 'stale') archive.push({ i, entry: text, reason: `cited code gone: ${s.missing.join(', ')}` });
    });
    agents.push({ agent: name, archive, kept: mem.entries.length - archive.length, raw: mem.raw });
  }
  const total = agents.reduce((n, a) => n + a.archive.length, 0);
  const summary = {
    expire_days: expireDays,
    archive_dir: planningRel(MEMORY_DIR, MEMORY_ARCHIVE_DIR),
    agents: agents.map(a => ({ agent: a.agent, kept: a.kept, archive: a.archive.map(({ entry, reason }) => ({ entry, reason })) })),
    archivable: total,
    applied: false,
    dry_run: !opts.apply,
  };
  if (!opts.apply || total === 0) return summary;

  fs.mkdirSync(path.join(memoryDir(cwd), MEMORY_ARCHIVE_DIR), { recursive: true });
  for (const a of agents) {
    if (!a.archive.length) continue;
    // 1. The archive first.
    const archivePath = path.join(memoryDir(cwd), MEMORY_ARCHIVE_DIR, `${a.agent}.md`);
    const preamble = `# Archived memory: ${a.agent}\n\nEntries \`memory prune\` moved out of \`${planningRel(MEMORY_DIR, `${a.agent}.md`)}\`: their cited code was gone, or they went unused for the expiry window. To restore one, move its line back under \`## Entries\` there.\n`;
    try {
      fs.writeFileSync(archivePath, preamble, { flag: 'wx', encoding: 'utf-8' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const block = `\n<!-- pruned on ${day} -->\n` + a.archive.map(x => `- ${x.entry}\n  - pruned: ${x.reason}`).join('\n') + '\n';
    fs.appendFileSync(archivePath, withEol(block, dominantEol(fs.readFileSync(archivePath, 'utf-8'))), 'utf-8');
    // 2. Only then take those bullet lines out of the log.
    const lines = toLf(a.raw).split('\n');
    const at = entryLineIndexes(lines);
    const drop = new Set(a.archive.map(x => at[x.i]));
    fs.writeFileSync(memoryFile(cwd, a.agent), withEol(lines.filter((_, li) => !drop.has(li)).join('\n'), dominantEol(a.raw)), 'utf-8');
  }
  return { ...summary, applied: true, dry_run: false };
}

/**
 * Memory-load telemetry gate (ADR-0036 acceptance signal). Estimates the tokens
 * of memory that would be injected whole (every agent log) and compares to the
 * median per-agent PROMPT from the trustworthy cost ledger (suspect records
 * quarantined). Read-only, non-blocking; degrades to an absolute-token check
 * when the ledger is thin.
 *
 * The prompt is `input + cache_read + cache_write`, not `input` alone: under prompt
 * caching the uncached remainder is tens of tokens, so dividing by it reported 1.8k
 * of memory as 8,940% of a "median agent input" and called it critical (field sweep
 * 2026-09-17). Memory is injected into the whole prompt, so the whole prompt is what
 * it must be measured against.
 *
 * @returns {{memory_tokens, agents, median_prompt_tokens, fraction, status, advisory}}
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
    const prompts = (cost.readRecords(cwd) || [])
      .filter(r => !cost.isSuspectRecord(r) && !cost.isEmptyRecord(r))
      .map(r => (Number(r.input_tokens) || 0) + (Number(r.cache_read_tokens) || 0) + (Number(r.cache_write_tokens) || 0))
      .filter(n => n > 0)
      .sort((a, b) => a - b);
    if (prompts.length) median = prompts[Math.floor(prompts.length / 2)];
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
      (fraction != null ? ` (~${Math.round(fraction * 100)}% of a median agent prompt)` : '') +
      `. Bound it with cue-scoped 'memory select' or trim with 'memory compact <agent>'.`;
  return { memory_tokens: memoryTokens, agents: agents.length, median_prompt_tokens: median, fraction, status, advisory };
}

// ─── CLI command wrappers ────────────────────────────────────────────────────

function cmdMemoryRead(cwd, agent, raw) {
  if (!agent) { error('Usage: memory read <agent>'); }
  const result = readMemory(cwd, agent);
  if (!result) { output({ agent, entries: [], exists: false }, raw); return; }
  output({ agent, entries: result.entries, exists: true }, raw);
}

function cmdMemoryAppend(cwd, agent, entry, raw, opts = {}) {
  if (!agent || !entry) { error('Usage: memory append <agent> <entry> [--cites <path[#symbol]>,...]'); }
  // A refused entry is reported as `{ error }` on stdout, like every append error.
  output(appendMemory(cwd, agent, entry, opts), raw);
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
  if (!agent) { error('Usage: memory select <agent> [--cue <text>] [--token-budget N] [--recency-floor N] [--all] [--mark-used] [--days N]'); }
  output(selectMemory(cwd, agent, opts || {}), raw);
}

/** `memory prune [<agent>] [--apply] [--days N]` */
function cmdMemoryPrune(cwd, agent, opts, raw) {
  const r = pruneMemory(cwd, agent || null, opts || {});
  if (r.error) { error(r.error); }
  const text = r.applied
    ? `archived ${r.archivable} entr${r.archivable === 1 ? 'y' : 'ies'} to ${r.archive_dir}/`
    : r.archivable
      ? `would archive ${r.archivable} entr${r.archivable === 1 ? 'y' : 'ies'} (stale or unused for ${r.expire_days} days) — rerun with --apply`
      : 'nothing to prune — every entry is cited correctly and was used recently';
  output(r, raw, text);
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
  pruneMemory,
  memoryLoadBudget,
  scoreEntry,
  parseEntries,
  parseEntryMeta,
  formatEntry,
  citationProblem,
  entryStatus,
  validateAgentName,
  cmdMemoryRead,
  cmdMemoryAppend,
  cmdMemoryList,
  cmdMemoryCompact,
  cmdMemorySelect,
  cmdMemoryPrune,
  cmdMemoryBudget,
  MEMORY_DIR,
  MEMORY_ARCHIVE_DIR,
  RESERVED_MEMORY_NAMES,
  DEFAULT_MAX_ENTRIES,
};
