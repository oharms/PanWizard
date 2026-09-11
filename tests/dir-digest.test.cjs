// Reality check R10 (2026-09-10): release Gate 8 refuses a stale dist/pan-agent-plugin
// by comparing content digests. These pin the digest: order-independent, content-
// sensitive, mtime-blind. Revert-proof: make dirDigest ignore file contents and the
// "one changed byte" test fails.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dirDigest } = require('../bin/install-lib.cjs');

function tree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-digest-'));
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

describe('dirDigest (R10)', () => {
  test('identical content in two directories → identical digest, regardless of mtimes', () => {
    const a = tree({ 'plugin.json': '{"a":1}', 'skills/x/SKILL.md': '# x' });
    const b = tree({ 'skills/x/SKILL.md': '# x', 'plugin.json': '{"a":1}' });
    fs.utimesSync(path.join(b, 'plugin.json'), new Date(0), new Date(0));
    assert.equal(dirDigest(a), dirDigest(b));
  });
  test('one changed byte → different digest', () => {
    const a = tree({ 'plugin.json': '{"a":1}' });
    const b = tree({ 'plugin.json': '{"a":2}' });
    assert.notEqual(dirDigest(a), dirDigest(b));
  });
  test('an extra or renamed file → different digest', () => {
    const a = tree({ 'plugin.json': '{}' });
    const b = tree({ 'plugin.json': '{}', 'extra.md': '' });
    const c = tree({ 'manifest.json': '{}' });
    assert.notEqual(dirDigest(a), dirDigest(b));
    assert.notEqual(dirDigest(a), dirDigest(c));
  });
  test('a missing directory throws (the gate treats an absent dist/ as nothing to compare)', () => {
    assert.throws(() => dirDigest(path.join(os.tmpdir(), 'pan-digest-does-not-exist-' + Date.now())));
  });
});
