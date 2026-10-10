// The reviewer's design-smell baseline (market-ideas MI-106).
//
// In a project that documents no standards, pan-reviewer's quality checks were a
// few size thresholds. It now carries a fixed baseline of named smells (Fowler,
// Refactoring ch. 3), each a judgement call: always INFO, phrased "possible …",
// suppressed where the project's own standards endorse the pattern, and never a
// verdict on its own. The meta-reviewer may dispute or drop one but never raise it.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const reviewer = read('agents/pan-reviewer.md');
const section = reviewer.slice(reviewer.indexOf('## Design smells (baseline)'), reviewer.indexOf('## Scope (unrequested work)'));

describe('pan-reviewer carries the smell baseline as judgement calls', () => {
  test('the section sits between Code Quality and Scope and names the twelve smells', () => {
    assert.ok(reviewer.indexOf('## Code Quality') < reviewer.indexOf('## Design smells (baseline)'));
    assert.ok(section.length > 0, 'the baseline section exists before Scope');
    const smells = ['Mysterious Name', 'Duplicated Code', 'Feature Envy', 'Data Clumps', 'Primitive Obsession', 'Repeated Switches',
      'Shotgun Surgery', 'Divergent Change', 'Speculative Generality', 'Message Chains', 'Middle Man', 'Refused Bequest'];
    for (const s of smells) assert.match(section, new RegExp(`^\\| ${s} \\|`, 'm'), s);
  });

  test('every smell is INFO, phrased as possible, and never decides the verdict', () => {
    assert.match(section, /always \*\*INFO\*\*, written as "possible <smell>", never a reason for a non-PASS verdict/);
    assert.doesNotMatch(section, /\| (WARNING|ERROR) \|/, 'no smell row carries a higher severity');
  });

  test('the project\'s own standards win, and Speculative Generality defers to Scope', () => {
    assert.match(section, /\*\*The project wins\.\*\*/);
    assert.match(section, /Speculative Generality[^\n]*Scope section's `Unrequested` finding/);
  });

  test('the meta-reviewer never raises a baseline smell', () => {
    assert.match(read('agents/pan-meta-reviewer.md'), /design-smell baseline[^\n]*never raise one above INFO/);
  });
});
