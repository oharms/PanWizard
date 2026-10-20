'use strict';
/**
 * The verbs that write state.md wholesale or by section (program A7b).
 *
 * Agents used to Write or Edit state.md themselves: the roadmapper and new-project
 * composed it, milestone-new reset it, add-phase and insert-phase appended to it, quick
 * added rows, transition batched five edits into one. Every write now goes through
 * pan-tools and writeStateMd, which keeps the frontmatter in sync and writes atomically
 * under the lock, so the pre-tool guard's `enforce` can deny a direct write.
 *
 *   state init         a fresh state.md from the template's sections
 *   state section      append to or set one section, creating it when missing
 *   state quick-task   one row in the Quick Tasks Completed table
 *   state apply        bold fields and sections in one write (transition's batch)
 */

const fs = require('fs');
const path = require('path');
const { output, escapeRegex } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { writeStateMd } = require('./state.cjs');

const statePathOf = (cwd) => planningPath(cwd, 'state.md');
const today = () => new Date().toISOString().slice(0, 10);

function readBody(cwd) {
  try { return fs.readFileSync(statePathOf(cwd), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}

/** The body without its frontmatter (writeStateMd rebuilds the frontmatter). */
function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/** [start, end) of a section's body: the lines after its heading up to the next heading of its level or higher. */
function findSection(text, name) {
  const re = new RegExp(`^(#{2,3}) ${escapeRegex(name)}[ \\t]*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const level = m[1].length;
  const bodyStart = m.index + m[0].length + 1;
  const rest = text.slice(bodyStart);
  const next = new RegExp(`^#{2,${level}} `, 'm').exec(rest);
  return { level, headingStart: m.index, bodyStart, bodyEnd: next ? bodyStart + next.index : text.length };
}

const PLACEHOLDER_RE = /^(None yet\.|None\.?|\[.*\])\s*$/;

function editSection(text, name, op, under) {
  under = under || 'Accumulated Context';
  // The CLI's absent flags arrive as null.
  op = { append: op.append == null ? undefined : op.append, set: op.set == null ? undefined : op.set };
  let s = findSection(text, name);
  if (!s) {
    // Create it as an ### section at the end of `under`, else at the end of the file.
    const parent = findSection(text, under);
    const insertAt = parent ? parent.bodyEnd : text.length;
    const before = text.slice(0, insertAt).replace(/\n*$/, '\n\n');
    text = `${before}### ${name}\n\n${text.slice(insertAt).replace(/^\n*/, text.slice(insertAt) ? '\n' : '')}`;
    s = findSection(text, name);
  }
  const body = text.slice(s.bodyStart, s.bodyEnd);
  let lines = body.replace(/^\n+/, '').replace(/\n+$/, '').split('\n').filter((l, i, all) => !(all.length === 1 && l === ''));
  if (op.set !== undefined) {
    lines = String(op.set).split('\n');
  } else {
    const keep = lines.filter((l) => !PLACEHOLDER_RE.test(l.trim()));
    // Leading prose of the template ("[From .planning/todos/...]") is a placeholder too.
    lines = keep.concat([].concat(op.append || []));
  }
  const tail = s.bodyEnd < text.length ? '\n' : '';
  return `${text.slice(0, s.bodyStart)}\n${lines.join('\n')}\n${tail}${text.slice(s.bodyEnd)}`;
}

function setField(text, field, value) {
  const re = new RegExp(`(\\*\\*${escapeRegex(field)}:\\*\\*[ \\t]*)(.*)`, 'i');
  if (!re.test(text)) return null;
  return text.replace(re, (_m, prefix) => `${prefix}${value}`);
}

function renderInit(o) {
  const v = (x, d) => (x === undefined || x === null || x === '' ? d : x);
  return `# Project State

## Project Reference

See: .planning/project.md (updated ${today()})

**Core value:** ${v(o.coreValue, '[One-liner from project.md Core Value section]')}
**Current focus:** ${v(o.focus, v(o.phaseName, 'Not started'))}

## Current Position

**Current Phase:** ${v(o.phase, '1')}
**Current Phase Name:** ${v(o.phaseName, v(o.focus, '—'))}
**Current Plan:** —
**Total Plans in Phase:** 0
**Total Phases:** ${v(o.totalPhases, '0')}
**Status:** ${v(o.status, 'Ready to plan')}
**Last Activity:** ${today()}
**Last Activity Description:** ${v(o.activity, 'State initialized')}
**Progress:** [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Plan:** (one row per plan, written by \`state record-metric\`)

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| - | - | - | - |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in project.md Key Decisions table.

None yet.

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

**Last session:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
**Stopped At:** ${v(o.activity, 'State initialized')}
**Resume File:** None
`;
}

function stateInit(cwd, o = {}) {
  const p = statePathOf(cwd);
  const existing = readBody(cwd);
  if (existing !== null && !o.force) return { error: 'state_exists', reason: 'state.md exists; pass --force to replace it (a backup is kept)' };
  let body = renderInit(o);
  let backup = null;
  if (existing !== null) {
    if (o.keepContext) {
      const src = stripFrontmatter(existing);
      const old = findSection(src, 'Accumulated Context');
      const neu = findSection(body, 'Accumulated Context');
      if (old && neu) body = body.slice(0, neu.bodyStart) + src.slice(old.bodyStart, old.bodyEnd).replace(/\n*$/, '\n\n') + body.slice(neu.bodyEnd);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backup = `${p}.bak-${stamp}`;
    fs.copyFileSync(p, backup);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeStateMd(p, body, cwd);
  return { written: true, path: path.relative(cwd, p).replace(/\\/g, '/'), backup: backup && path.relative(cwd, backup).replace(/\\/g, '/'), kept_context: !!(o.keepContext && existing) };
}

function withState(cwd, fn) {
  const text = readBody(cwd);
  if (text === null) return { error: 'state_missing', reason: 'state.md not found; run `pan-tools state init` first' };
  const r = fn(stripFrontmatter(text));
  if (r.error) return r;
  writeStateMd(statePathOf(cwd), r.text, cwd);
  const { text: _t, ...rest } = r;
  return { written: true, ...rest };
}

function stateSection(cwd, name, op) {
  if (!name) return { error: 'section_required', reason: 'Usage: state section <name> (--append <line> | --set <text>) [--under <section>]' };
  if (op.append == null && op.set == null) return { error: 'op_required', reason: 'pass --append <line> or --set <text>' };
  return withState(cwd, (t) => ({ text: editSection(t, name, op, op.under), section: name }));
}

function stateQuickTask(cwd, o) {
  if (!o.description) return { error: 'description_required', reason: 'Usage: state quick-task --description D --commit SHA --directory DIR [--status S] [--date YYYY-MM-DD]' };
  return withState(cwd, (t) => {
    const withStatus = o.status != null;
    let s = findSection(t, 'Quick Tasks Completed');
    if (!s) {
      const header = withStatus
        ? '| # | Description | Date | Commit | Status | Directory |\n|---|-------------|------|--------|--------|-----------|'
        : '| # | Description | Date | Commit | Directory |\n|---|-------------|------|--------|-----------|';
      const anchor = findSection(t, 'Blockers/Concerns');
      const at = anchor ? anchor.bodyEnd : t.length;
      t = `${t.slice(0, at).replace(/\n*$/, '\n\n')}### Quick Tasks Completed\n\n${header}\n${t.slice(at) ? '\n' + t.slice(at).replace(/^\n*/, '') : ''}`;
      s = findSection(t, 'Quick Tasks Completed');
    }
    const body = t.slice(s.bodyStart, s.bodyEnd);
    const rows = body.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
    const hasStatusCol = /\|\s*Status\s*\|/.test(body);
    const n = rows.length + 1;
    // Escape a pipe once: init's description_cell arrives already escaped. Line breaks fold.
    const cell = (x) => String(x == null ? '' : x).replace(/\r?\n+/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|').replace(/(^|[^\\])\|/g, '$1\\|');
    const cols = [n, cell(o.description), o.date || today(), cell(o.commit || '')];
    if (hasStatusCol) cols.push(cell(o.status || ''));
    cols.push(cell(o.directory || ''));
    const row = `| ${cols.join(' | ')} |`;
    const lines = body.replace(/\n+$/, '').split('\n');
    const lastTable = lines.map((l, i) => (l.startsWith('|') ? i : -1)).filter((i) => i >= 0).pop();
    lines.splice(lastTable + 1, 0, row);
    const tail = s.bodyEnd < t.length ? '\n\n' : '\n';
    return { text: `${t.slice(0, s.bodyStart)}${lines.join('\n')}${tail}${t.slice(s.bodyEnd).replace(/^\n*/, '')}`, row: n };
  });
}

function stateApply(cwd, batch) {
  if (!batch || typeof batch !== 'object') return { error: 'invalid_batch', reason: 'pass --json \'{"fields": {...}, "sections": {"Name": {"append": [...]} | {"set": "..."}}}\'' };
  return withState(cwd, (t) => {
    const updated = [];
    const failed = [];
    for (const [field, value] of Object.entries(batch.fields || {})) {
      const next = setField(t, field, value);
      if (next === null) failed.push(field); else { t = next; updated.push(field); }
    }
    for (const [name, op] of Object.entries(batch.sections || {})) {
      t = editSection(t, name, op || {}, op && op.under);
      updated.push(name);
    }
    return { text: t, updated, failed };
  });
}

function cmdStateInit(cwd, o, raw) { const r = stateInit(cwd, o); output(r, raw, r.path || r.error); }
function cmdStateSection(cwd, name, op, raw) { const r = stateSection(cwd, name, op); output(r, raw, r.section || r.error); }
function cmdStateQuickTask(cwd, o, raw) { const r = stateQuickTask(cwd, o); output(r, raw, r.row ? String(r.row) : r.error); }
function cmdStateApply(cwd, json, raw) {
  let batch = null;
  try { batch = JSON.parse(json); } catch { /* reported below */ }
  const r = stateApply(cwd, batch);
  output(r, raw, r.error || String((r.updated || []).length));
}

module.exports = { stateInit, stateSection, stateQuickTask, stateApply, editSection, findSection, cmdStateInit, cmdStateSection, cmdStateQuickTask, cmdStateApply };
