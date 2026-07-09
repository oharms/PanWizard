/**
 * E-2 scenario test: map-codebase mode selection.
 *
 * Asserts that `pan-tools codebase estimate-size` correctly classifies
 * small repos as `single-shot` and large repos as `sharded` given the
 * default 700K-token threshold.
 *
 * These are fast data-layer tests — they don't spawn agents. They verify
 * the decision-surface the `/pan:map-codebase` Stage 0 consults.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('../helpers.cjs');
const { estimateRepoTokenSize } = require('../../pan-wizard-core/bin/lib/codebase.cjs');

describe('E-2 scenario: map-codebase single-shot mode', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('small project classifies as single-shot via direct call', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = { hello: "world" };');
    fs.writeFileSync(path.join(src, 'util.js'), 'module.exports = { sum: (a,b) => a+b };');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Tiny project\n');

    const r = estimateRepoTokenSize(tmpDir);
    assert.equal(r.mode, 'single-shot');
    assert.ok(r.total_tokens > 0);
    assert.ok(r.total_tokens < 700000);
  });

  test('small project classifies as single-shot via CLI', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'const x = 1;');

    const result = runPanTools('codebase estimate-size', tmpDir);
    assert.ok(result.success, result.error);
    const json = JSON.parse(result.output);
    assert.equal(json.mode, 'single-shot');
    assert.equal(json.threshold, 700000);
    assert.ok(json.file_count >= 1);
  });

  test('single-shot mode includes file_count and language breakdown', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'const x = 1;');
    fs.writeFileSync(path.join(src, 'b.py'), 'x = 1');

    const result = runPanTools('codebase estimate-size', tmpDir);
    const json = JSON.parse(result.output);
    assert.equal(json.mode, 'single-shot');
    assert.ok(json.file_count >= 2);
    assert.ok(json.languages.javascript > 0);
    assert.ok(json.languages.python > 0);
  });

  test('empty project classifies as single-shot with 0 tokens', () => {
    const r = estimateRepoTokenSize(tmpDir);
    assert.equal(r.mode, 'single-shot');
    assert.equal(r.total_tokens, 0);
    assert.equal(r.file_count, 0);
  });
});

describe('E-2 scenario: map-codebase sharded fallback', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('simulated large repo via low threshold classifies as sharded', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(5000));

    // Force sharded by forcing the threshold below what the repo has.
    const r = estimateRepoTokenSize(tmpDir, { threshold: 100 });
    assert.equal(r.mode, 'sharded');
    assert.equal(r.threshold, 100);
    assert.ok(r.total_tokens > r.threshold);
  });

  test('CLI --threshold flag forces sharded mode', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(10000));

    const result = runPanTools('codebase estimate-size --threshold 50', tmpDir);
    const json = JSON.parse(result.output);
    assert.equal(json.mode, 'sharded');
    assert.equal(json.threshold, 50);
  });

  test('large synthetic repo (>700K tokens) would classify as sharded at default', () => {
    // We don't actually materialize 700K tokens of source; instead, verify
    // that the mode field is a direct function of total_tokens vs threshold.
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    // 200K chars ≈ 50K tokens — well under 700K so naturally single-shot.
    fs.writeFileSync(path.join(src, 'big.js'), 'x'.repeat(200000));

    const atDefault = estimateRepoTokenSize(tmpDir);
    assert.equal(atDefault.mode, 'single-shot');

    const atSmall = estimateRepoTokenSize(tmpDir, { threshold: 10 });
    assert.equal(atSmall.mode, 'sharded');

    // Decision rule: mode flips at the threshold boundary.
    assert.ok(atSmall.total_tokens > 10);
    assert.ok(atDefault.total_tokens < 700000);
  });

  test('sharded decision is stable given the same input', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(1000));

    const r1 = estimateRepoTokenSize(tmpDir, { threshold: 50 });
    const r2 = estimateRepoTokenSize(tmpDir, { threshold: 50 });
    assert.equal(r1.mode, r2.mode);
    assert.equal(r1.total_tokens, r2.total_tokens);
  });
});

describe('E-2 scenario: agent Mode section is documented', () => {
  test('pan-document_code.md has a <mode> block describing both modes', () => {
    const agentPath = path.join(__dirname, '..', '..', 'agents', 'pan-document_code.md');
    const content = fs.readFileSync(agentPath, 'utf-8');
    assert.match(content, /<mode>/, 'agent should declare <mode> block');
    assert.match(content, /single-shot/, 'mode section mentions single-shot');
    assert.match(content, /sharded/, 'mode section mentions sharded');
    assert.match(content, /700K/, 'mode section references 700K threshold');
  });
});
