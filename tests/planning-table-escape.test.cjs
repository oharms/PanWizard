/**
 * Free text written into a planning table must not break it (market-ideas M21).
 *
 * state.md's "Quick Tasks Completed" and "Performance Metrics" tables are appended
 * to for the life of a project. The quick workflow pasted the raw task description
 * into a row, so a `|` in a description split the row into an extra column and the
 * table stopped parsing for every later read; gsd-core shipped the same fix in
 * v1.15.0. The engine now escapes a cell in one place (core.escapeTableCell) and
 * hands the workflow a ready cell (`init quick` → `description_cell`). The lint at
 * the end keeps a shipped table-row template from substituting raw text again.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { escapeTableCell } = require('../pan-wizard-core/bin/lib/core.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');

// The cells of one markdown table row, honouring `\|` escapes.
function cellsOf(row) {
  return row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());
}

function panTools(args, cwd) {
  return execFileSync(process.execPath, [TOOLS_PATH, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('escapeTableCell', () => {
  test('leaves ordinary text alone', () => {
    assert.equal(escapeTableCell('Add dark mode toggle'), 'Add dark mode toggle');
  });

  test('escapes pipes, so the row keeps its column count', () => {
    const cell = escapeTableCell('compare a | b');
    assert.equal(cell, 'compare a \\| b');
    assert.equal(cellsOf(`| 3 | ${cell} | 2026-10-03 |`).length, 3);
    // The defect this closes: the raw text adds a column.
    assert.equal(cellsOf('| 3 | compare a | b | 2026-10-03 |').length, 4);
  });

  test('escapes backslashes first, so an escape in the text cannot unescape a pipe', () => {
    assert.equal(escapeTableCell('C:\\tmp|x'), 'C:\\\\tmp\\|x');
    assert.equal(cellsOf(`| ${escapeTableCell('ends with a backslash\\')} | next |`).length, 2);
  });

  test('folds every run of line breaks into one space', () => {
    assert.equal(escapeTableCell('one\ntwo\r\n\r\nthree'), 'one two three');
  });

  test('null and undefined are empty cells; other values are stringified', () => {
    assert.equal(escapeTableCell(null), '');
    assert.equal(escapeTableCell(undefined), '');
    assert.equal(escapeTableCell(12), '12');
  });
});

describe('the engine hands out escaped cells', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('init quick returns description_cell beside the raw description', () => {
    const desc = 'compare a | b\nthen ship';
    const out = JSON.parse(panTools(['init', 'quick', desc], dir));
    assert.equal(out.description, desc, 'the raw description is still returned for prose and commit messages');
    assert.equal(out.description_cell, 'compare a \\| b then ship');
  });

  test('init quick without a description has no cell', () => {
    const out = JSON.parse(panTools(['init', 'quick'], dir));
    assert.equal(out.description_cell, null);
  });

  test('state record-metric escapes a free-text duration in the Performance Metrics row', () => {
    const statePath = path.join(dir, '.planning', 'state.md');
    fs.writeFileSync(statePath, [
      '# Project State', '',
      '## Performance Metrics',
      '| Phase | Duration | Tasks | Files |',
      '|-------|----------|-------|-------|',
      '| None yet | | | |', '',
    ].join('\n'));
    panTools(['state', 'record-metric', '--phase', '01', '--plan', '01', '--duration', '5 min | rough', '--tasks', '3', '--files', '4'], dir);
    const row = fs.readFileSync(statePath, 'utf8').split('\n').find(l => l.startsWith('| Phase 01 P01'));
    assert.ok(row, 'the metric row was written');
    assert.deepEqual(cellsOf(row), ['Phase 01 P01', '5 min \\| rough', '3 tasks', '4 files']);
  });
});

// ─── Lint: shipped table-row templates substitute only safe fields ──────────────

// Engine-computed values that cannot hold a raw `|` or a line break: numbers,
// ISO dates, short hashes, generated slugs, a fixed status vocabulary, and the
// cells the engine escaped. Free text gets a `*_cell` field from the engine, or
// stays out of table rows.
const SAFE_TABLE_FIELDS = new Set(['next_num', 'date', 'commit_hash', 'slug', 'VERIFICATION_STATUS', 'description_cell']);
const SHIPPED_PROSE = ['pan-wizard-core/workflows', 'commands/pan', 'agents', 'pan-wizard-core/templates', 'pan-wizard-core/references'];

function mdFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Every `${name}` substituted into a markdown table row (a line that starts with `|`).
function tableRowPlaceholders(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/^\s*\|/.test(line)) return;
    for (const m of line.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.push({ line: i + 1, name: m[1] });
  });
  return found;
}

describe('table-row templates in shipped prose', () => {
  test('the lint flags a raw free-text placeholder (the template this fix replaced)', () => {
    const old = '| ${next_num} | ${DESCRIPTION} | ${date} | ${commit_hash} |';
    const bad = tableRowPlaceholders(old).filter(p => !SAFE_TABLE_FIELDS.has(p.name));
    assert.deepEqual(bad.map(p => p.name), ['DESCRIPTION']);
  });

  test('every placeholder in a shipped table row is an engine-escaped or engine-computed field', () => {
    const offenders = [];
    let rows = 0;
    for (const rel of SHIPPED_PROSE) {
      for (const file of mdFiles(path.join(ROOT, rel))) {
        const hits = tableRowPlaceholders(fs.readFileSync(file, 'utf8'));
        rows += hits.length;
        for (const h of hits) {
          if (!SAFE_TABLE_FIELDS.has(h.name)) offenders.push(`${path.relative(ROOT, file)}:${h.line} \${${h.name}}`);
        }
      }
    }
    assert.ok(rows > 0, 'non-vacuity: the quick workflow writes templated table rows');
    assert.deepEqual(offenders, [], 'free text must reach a table row through an escaped *_cell field from the engine:\n' + offenders.join('\n'));
  });
});
