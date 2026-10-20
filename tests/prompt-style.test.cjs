/**
 * Program M35: the prompt-style pass (deferred from the M34 prompt audit).
 *
 * The static half of the gate. Shipped prompts carry no shouted "CRITICAL: Mandatory
 * Initial Read" block, no `## CRITICAL:` headings, and no context-management step a
 * model cannot carry out ("DISCARD raw tool output"). The behavioural half, a paired
 * A/B per changed prompt at non-inferiority δ 0.10, spends and waits for an approved run.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const r = `${d}/${e.name}`;
    if (e.isDirectory()) walk(r); else if (e.name.endsWith('.md')) files.push(r);
  }
};
for (const d of ['commands', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/references']) walk(d);

// harness/cassettes/executor-spawn-claude.json records the executor's prompt verbatim, so
// editing it drifts that cassette; re-recording spends. Exempt until the re-recorded run.
const WAITING_ON_RECORDING = new Set(['agents/pan-executor.md']);

function scan(re) {
  const hits = [];
  for (const f of files.filter((x) => !WAITING_ON_RECORDING.has(x))) fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`); });
  return hits;
}

describe('prompt style (M35)', () => {
  test('non-vacuity: the scan reads the shipped prompts', () => assert.ok(files.length > 100, String(files.length)));

  test('no shouted "Mandatory Initial Read" block', () => {
    assert.deepEqual(scan(/CRITICAL: Mandatory Initial Read|you MUST use the `Read` tool to load every file/), []);
  });

  test('no "## CRITICAL:" headings', () => {
    assert.deepEqual(scan(/^#{1,4} CRITICAL:/), []);
  });

  test('no context step a model cannot carry out (DISCARD raw output)', () => {
    assert.deepEqual(scan(/^\s*-\s*\*{0,2}DISCARD\b/), []);
  });

  test('the initial-read rule is still there, said plainly', () => {
    const t = fs.readFileSync(path.join(ROOT, 'agents', 'pan-debugger.md'), 'utf8');
    assert.match(t, /\*\*Initial read\.\*\* If the prompt contains a `<files_to_read>` block, read every file it lists before doing anything else\./);
  });
});
