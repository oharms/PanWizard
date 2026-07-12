/**
 * Guard test for scripts/release-check.js — locks in the fix for the v3.15.0
 * release outage.
 *
 * Root cause (diagnosed from the real CI log): under `npm publish`, the runner
 * routes the nested `npm pack`'s lifecycle-script output onto stdout
 * (foreground-scripts), so `npm pack --json`'s payload was preceded by a decoy
 * JSON object. Parsing that stdout for the tarball name grabbed the wrong
 * object — Gate 6 reported "0 files" and Gate 7 crashed on `packJson[0].filename`.
 *
 * The gates MUST derive the tarball from the FILE npm wrote to a
 * `--pack-destination` directory, never from parsing npm's stdout. This test
 * fails if that fragile stdout-parsing is ever reintroduced. It intentionally
 * asserts on code structure, not comment wording (the comments document the
 * anti-pattern on purpose).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Strip comments so the guards match real code, not the explanatory notes.
const RAW = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-check.js'), 'utf-8');
const CODE = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (leave scheme:// alone)

describe('release-check — pack gates read the tarball from disk (v3.15.0 regression)', () => {
  test('the fragile npm-stdout parser stays removed', () => {
    assert.ok(!/function\s+parseNpmJson/.test(CODE), 'parseNpmJson (the stdout parser) must not be redefined');
    assert.ok(!/packJson\s*\[/.test(CODE), 'the tarball must not be indexed out of a parsed pack-stdout object');
    assert.ok(!/pack['"]\s*,\s*\[[^\]]*--json/.test(CODE), 'the pack gates must not invoke npm pack with --json');
  });

  test('both pack gates pack to a directory and read the .tgz from disk', () => {
    const packDest = (CODE.match(/--pack-destination/g) || []).length;
    assert.ok(packDest >= 2, `Gate 6 (size) and Gate 7 (smoke) should each pack into a temp dir; found ${packDest} --pack-destination uses`);
    assert.match(
      CODE,
      /readdirSync\([^)]*\)\s*\.\s*find\([^)]*endsWith\(\s*['"]\.tgz['"]\s*\)/,
      'the tarball must be discovered by reading the pack-destination directory for a .tgz file',
    );
  });

  test('Gate 6 sizes the real tarball on disk and keeps the 50MB ceiling', () => {
    assert.match(CODE, /statSync[\s\S]{0,80}\.size/, 'Gate 6 should stat the produced tarball size on disk');
    assert.match(CODE, /50 \* 1024 \* 1024/, 'Gate 6 should keep the <50MB tarball-size ceiling');
  });
});
