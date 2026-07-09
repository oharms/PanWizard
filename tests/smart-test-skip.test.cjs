/**
 * PAN Tools Tests - shouldSkipTests helper
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipTests } = require('../pan-wizard-core/bin/lib/commands.cjs');

describe('shouldSkipTests', () => {

  test('all .md files → true', () => {
    assert.strictEqual(shouldSkipTests(['README.md', 'CHANGELOG.md', 'docs/guide.md']), true);
  });

  test('mix of .md and .cjs → false', () => {
    assert.strictEqual(shouldSkipTests(['README.md', 'src/main.cjs']), false);
  });

  test('single .js file → false', () => {
    assert.strictEqual(shouldSkipTests(['index.js']), false);
  });

  test('empty array → true (nothing to test)', () => {
    assert.strictEqual(shouldSkipTests([]), true);
  });

  test('files with paths still detected', () => {
    assert.strictEqual(shouldSkipTests(['docs/README.md', 'CHANGELOG.md']), true);
  });

  test('uppercase .MD → true (case insensitive)', () => {
    assert.strictEqual(shouldSkipTests(['README.MD', 'NOTES.Md']), true);
  });

  test('null input → true (safe default)', () => {
    assert.strictEqual(shouldSkipTests(null), true);
  });

  test('undefined input → true (safe default)', () => {
    assert.strictEqual(shouldSkipTests(undefined), true);
  });

  test('single .md file → true', () => {
    assert.strictEqual(shouldSkipTests(['only.md']), true);
  });

  test('.mdx file → false (not plain markdown)', () => {
    assert.strictEqual(shouldSkipTests(['component.mdx']), false);
  });

  test('.markdown extension → false (only .md)', () => {
    assert.strictEqual(shouldSkipTests(['file.markdown']), false);
  });

  test('file named md without extension → false', () => {
    assert.strictEqual(shouldSkipTests(['md']), false);
  });
});
