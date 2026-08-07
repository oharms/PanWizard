/**
 * config-set must refuse a config.json that is valid JSON of the wrong shape.
 *
 * Medium finding from the 2026-08 deployed stability test. cmdConfigSet accepted
 * whatever JSON.parse returned and assigned into it, which failed two different
 * silent ways:
 *
 *   `null`   crashed with a raw TypeError stack dump ("Cannot set properties of
 *            null"), which in an autonomous run is an unactionable crash rather
 *            than an error message.
 *   array,   took the assignment without complaint and then serialized without the
 *   string,  key — so the command reported {"updated": true} at exit 0 while
 *   number   persisting nothing. The user is told the setting took effect and PAN
 *            keeps using the old value forever.
 *
 * Refusing rather than overwriting is deliberate: a config.json in an unexpected
 * shape is still the user's data, and replacing it wholesale would be the
 * settings.json data-loss defect in a different file.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let proj;
let configPath;

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: proj, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-cfg-'));
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
  configPath = path.join(proj, '.planning', 'config.json');
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('config-set refuses a non-object config', () => {
  for (const [label, raw] of [['null', 'null'], ['an array', '[1,2]'], ['a string', '"text"'], ['a number', '42']]) {
    test(`${label} is refused with an actionable error, not a crash or a false success`, () => {
      fs.writeFileSync(configPath, raw);

      const { code, out } = pan(['config-set', 'commit_docs', 'false']);

      assert.equal(code, 1, 'must fail so a caller can detect it');
      assert.doesNotMatch(out, /TypeError|at Object\.|Cannot set properties/,
        'a stack dump is not an error message');
      assert.match(out, /not a JSON object/, 'must say what is wrong');
      assert.doesNotMatch(out, /"updated":\s*true/, 'must never claim success');
      // The user's file is theirs — refuse, do not replace.
      assert.equal(fs.readFileSync(configPath, 'utf-8'), raw, 'the file must be untouched');
    });
  }
});

describe('config-set still works on every legitimate shape', () => {
  test('a flat key on an existing object config persists', () => {
    fs.writeFileSync(configPath, '{"commit_docs":true}');

    const { code } = pan(['config-set', 'commit_docs', 'false']);

    assert.equal(code, 0);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf-8')).commit_docs, false,
      'the value must actually be persisted, not merely reported');
  });

  test('a nested dot-path creates intermediate objects', () => {
    fs.writeFileSync(configPath, '{}');
    const { code } = pan(['config-set', 'workflow.research', 'true']);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf-8')).workflow, { research: true });
  });

  test('an absent config.json is created', () => {
    const { code } = pan(['config-set', 'commit_docs', 'false']);
    assert.equal(code, 0);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf-8')).commit_docs, false);
  });

  test('an empty-object config is a normal starting point', () => {
    fs.writeFileSync(configPath, '{}');
    const { code } = pan(['config-set', 'model_profile', 'balanced']);
    assert.equal(code, 0);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf-8')).model_profile, 'balanced');
  });
});
