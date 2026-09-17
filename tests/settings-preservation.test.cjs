/**
 * The installer must never destroy a settings.json it cannot parse.
 *
 * Regression guard for the 2026-08 deployed stability test's Critical finding:
 * `readSettings()` returned `{}` for BOTH "file absent" and "file exists but is
 * not valid JSON". Every caller merges PAN's keys into that object and writes it
 * back, so a settings.json containing a `//` comment — which people write even
 * though the format is strict JSON — was replaced by PAN's keys alone. The user's
 * model choice, permissions and auth settings were gone, with no warning, no
 * backup, and exit 0.
 *
 * These tests spawn the REAL installer against real files and compare bytes,
 * because the defect lived in the write path: asserting on readSettings() alone
 * would have passed while installs kept destroying data.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * What "PAN configured this file" actually means, measured against a real
 * `--claude --local` install on 2026-09-17: the four hook events plus a statusline
 * command. Asserting the shape rather than `hooks || statusLine` is the difference
 * between "something is there" and "the hooks that make PAN work are there" — an empty
 * `hooks: {}` satisfied the old form.
 */
function assertPanConfigured(after, what) {
  assert.ok(after.hooks, `${what}: no hooks block at all`);
  for (const event of ['SessionStart', 'PostToolUse', 'SubagentStop', 'Stop']) {
    assert.ok(Array.isArray(after.hooks[event]) && after.hooks[event].length > 0,
      `${what}: ${event} is not registered`);
  }
  const subagentStop = JSON.stringify(after.hooks.SubagentStop);
  assert.match(subagentStop, /pan-cost-logger/, `${what}: SubagentStop is missing the cost logger`);
  assert.match(subagentStop, /pan-trace-logger/, `${what}: SubagentStop is missing the trace logger`);
  assert.match(String(after.statusLine && after.statusLine.command), /pan-statusline/,
    `${what}: no PAN statusline`);
}

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');

let tempRoot;
let fakeHome;

/** Run the real installer in `cwd` with HOME redirected away from the real one. */
function install(cwd, flags) {
  const r = spawnSync('node', [INSTALLER, ...flags], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** A minimal but realistic host project. */
function makeProject(name, settingsRelPath, settingsContent) {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"host","version":"1.0.0"}\n');
  if (settingsRelPath !== null) {
    const p = path.join(dir, settingsRelPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, settingsContent);
  }
  return dir;
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-settings-'));
  fakeHome = path.join(tempRoot, 'fakehome');
  fs.mkdirSync(fakeHome, { recursive: true });
});

after(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* best effort — Windows can hold handles briefly */ }
});

describe('installer preserves an unparseable settings.json', () => {
  // Each shape a real user could have. All must survive byte-identical.
  const unusable = [
    ['a // comment (valid JSONC, invalid JSON)', '{\n  // my model choice\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n'],
    ['a trailing comma', '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls)"] },\n}\n'],
    ['a truncated file', '{\n  "model": "opus",\n  "permis'],
    ['valid JSON of the wrong shape (array)', '["not", "an", "object"]\n'],
    ['valid JSON that is null', 'null\n'],
  ];

  for (const [label, content] of unusable) {
    test(`--claude --local leaves settings.json containing ${label} byte-identical, warns, and still installs`, () => {
      const dir = makeProject(`claude-${label.replace(/\W+/g, '-')}`, path.join('.claude', 'settings.json'), content);
      const settingsPath = path.join(dir, '.claude', 'settings.json');

      const { code, out } = install(dir, ['--claude', '--local']);

      // REVERT CHECK: with readSettings() returning {} on a parse failure, this
      // is the assertion that fails — the file comes back as PAN's keys only.
      assert.equal(fs.readFileSync(settingsPath, 'utf-8'), content,
        'the user\'s settings.json must be untouched, byte for byte');

      // Silence would be its own bug: the stability test found an install that
      // printed success ticks while configuring nothing.
      assert.match(out, /Could not parse settings\.json/,
        'the installer must say it skipped the file');
      assert.match(out, /NOT modified/,
        'the warning must tell the user their file was left alone');

      // A file it cannot parse is not a reason to abort the whole install.
      assert.equal(code, 0, `install should still succeed (exit 0), got ${code}`);
      assert.doesNotMatch(out, /TypeError|Cannot read properties/,
        'skipping must not crash — settings:null once reached handleStatusline');
      assert.ok(fs.existsSync(path.join(dir, '.claude', 'commands', 'pan')),
        'the rest of the install must complete');
    });
  }

  test('Gemini and Copilot settings are protected too, not just Claude', () => {
    const dir = makeProject('multi', null, null);
    const gem = path.join(dir, '.gemini', 'settings.json');
    const cop = path.join(dir, '.github', 'copilot', 'settings.json');
    const gemContent = '{\n  // gemini theme\n  "theme": "GitHub",\n  "selectedAuthType": "oauth-personal"\n}\n';
    const copContent = '{\n  // copilot prefs\n  "trustedFolders": ["/work"],\n  "banner": "never"\n}\n';
    fs.mkdirSync(path.dirname(gem), { recursive: true });
    fs.mkdirSync(path.dirname(cop), { recursive: true });
    fs.writeFileSync(gem, gemContent);
    fs.writeFileSync(cop, copContent);

    const { code, out } = install(dir, ['--gemini', '--copilot', '--local']);

    assert.equal(fs.readFileSync(gem, 'utf-8'), gemContent, 'gemini settings.json must survive');
    assert.equal(fs.readFileSync(cop, 'utf-8'), copContent, 'copilot settings.json must survive');
    assert.equal(code, 0);
    assert.doesNotMatch(out, /TypeError/);
  });

  test('uninstall leaves an unparseable settings.json alone AND still finishes its other steps', () => {
    const content = '{\n  // keep me\n  "model": "opus"\n}\n';
    const dir = makeProject('uninstall-skip', path.join('.claude', 'settings.json'), content);
    const settingsPath = path.join(dir, '.claude', 'settings.json');

    install(dir, ['--claude', '--local']);
    const { code } = install(dir, ['--claude', '--local', '--uninstall']);

    assert.equal(fs.readFileSync(settingsPath, 'utf-8'), content,
      'uninstall rewrites settings.json to strip PAN keys — it must skip a file it cannot parse');
    assert.equal(code, 0);
    // REVERT CHECK: an early `return` in that step (rather than skipping just the
    // step) aborts the rest of the uninstall — this is what catches it.
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'pan-file-manifest.json')),
      'the manifest removal runs AFTER the settings step and must still happen');
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'pan-wizard-core')),
      'core removal must still happen');
  });
});

describe('installer still configures settings.json when it can', () => {
  test('a valid settings.json gains PAN keys and keeps the user\'s own', () => {
    const content = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';
    const dir = makeProject('valid', path.join('.claude', 'settings.json'), content);
    const settingsPath = path.join(dir, '.claude', 'settings.json');

    const { code, out } = install(dir, ['--claude', '--local']);
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Could not parse/, 'a valid file must not be reported as unusable');
    assert.equal(after.model, 'opus', 'user keys preserved');
    assert.deepEqual(after.permissions, { allow: ['Bash(ls)'] }, 'user keys preserved');
    assertPanConfigured(after, 'a valid settings.json');
  });

  test('an empty settings.json is treated as nothing-to-preserve and gets configured', () => {
    const dir = makeProject('empty', path.join('.claude', 'settings.json'), '');
    const settingsPath = path.join(dir, '.claude', 'settings.json');

    const { code, out } = install(dir, ['--claude', '--local']);

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Could not parse/, 'an empty file is not an unparseable one');
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assertPanConfigured(after, 'an empty settings.json');
  });

  test('an absent settings.json is created', () => {
    const dir = makeProject('absent', null, null);
    const { code } = install(dir, ['--claude', '--local']);
    assert.equal(code, 0);
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf-8'));
    assertPanConfigured(after, 'an absent settings.json');
  });
});
