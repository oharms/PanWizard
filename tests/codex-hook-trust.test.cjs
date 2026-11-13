/**
 * Hygiene H-16 (`codex-hook-trust`, market-ideas M64 / MI-161).
 *
 * Codex runs a user hook only when its user-level config.toml carries
 * `[hooks.state."<hooks.json path>:<event>:<group>:<handler>"]` with a `trusted_hash`;
 * otherwise it lists the hook and skips it without a word. The key shape and the rule
 * that only the user layer carries trust come from Codex's own source (codex-rs/hooks
 * `hook_key`, `hook_trust_status`, `hook_states_from_stack`, read 2026-11-13).
 *
 * The hooks.json under test is built by the installer's own merge, so the check reads
 * the shape PAN actually writes.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const lib = require('../bin/install-lib.cjs');
const hygiene = require('../pan-wizard-core/bin/lib/hygiene.cjs');
const { installInto, cleanup } = require('./helpers.cjs');

const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

const COMMANDS = {
  updateCheckCommand: 'node "/x/hooks/pan-check-update.js"',
  guardCommand: 'node "/x/hooks/pan-guard.js"',
  contextMonitorCommand: 'node "/x/hooks/pan-context-monitor.js"',
  costLoggerCommand: 'node "/x/hooks/pan-cost-logger.js"',
  traceLoggerCommand: 'node "/x/hooks/pan-trace-logger.js"',
  stopGuardCommand: 'node "/x/hooks/pan-stop-guard.js"',
  stateReinjectCommand: 'node "/x/hooks/pan-state-reinject.js"',
};

/** Codex's `hook_event_key_label`: PascalCase event → snake_case. */
const label = (e) => e.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

/** Every handler key Codex would derive for a hooks.json at `hooksPath`, with its command. */
function keysFor(cfg, hooksPath) {
  const out = [];
  for (const [event, groups] of Object.entries(cfg.hooks)) {
    groups.forEach((g, gi) => g.hooks.forEach((h, hi) => out.push({ key: `${hooksPath}:${label(event)}:${gi}:${hi}`, command: h.command })));
  }
  return out;
}

/** A TOML basic string, escaped the way Codex's writer does. */
const tomlStr = (s) => JSON.stringify(s);

let project; let home; let hooksPath; let cfg;

function writeHooks(config) {
  fs.mkdirSync(path.join(project, '.codex'), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2));
}
function writeToml(text) {
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), text);
}
const scan = () => hygiene.checkCodexHookTrust(project, { homeDir: home });
const trustAll = (keys) => keys.map((k) => `[hooks.state.${tomlStr(k.key)}]\ntrusted_hash = "sha256:abc"\n`).join('\n');

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-codex-trust-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-codex-home-'));
  hooksPath = path.join(project, '.codex', 'hooks.json');
  cfg = lib.mergeCodexHooksConfig(null, COMMANDS);
});
afterEach(() => { cleanup(project); cleanup(home); });

describe('H-16 codex-hook-trust', () => {
  test('no .codex/hooks.json: nothing to report', () => {
    const r = scan();
    assert.deepEqual(r.findings, []);
  });

  test('PAN hooks and no config.toml: one warn naming every PAN hook as untrusted', () => {
    writeHooks(cfg);
    const r = scan();
    const pan = keysFor(cfg, hooksPath).length;
    assert.equal(r.findings.length, 1);
    const f = r.findings[0];
    assert.equal(f.check, 'codex-hook-trust');
    assert.equal(f.severity, 'warn');
    assert.equal(f.path, '.codex/hooks.json');
    assert.equal(f.fixable, false);
    assert.match(f.detail, new RegExp(`^${pan} of ${pan} PAN hooks`));
    assert.match(f.detail, /pan-cost-logger/);
    assert.match(f.detail, /run \/hooks/);
    assert.deepEqual(r.codex_hooks, { config: '~/.codex/config.toml', pan_hooks: pan, untrusted: pan });
  });

  test('every PAN handler trusted under its exact key: no finding', () => {
    writeHooks(cfg);
    writeToml(trustAll(keysFor(cfg, hooksPath)));
    const r = scan();
    assert.deepEqual(r.findings, []);
    assert.equal(r.codex_hooks.untrusted, 0);
  });

  test('partly trusted: the finding counts and names only the untrusted ones', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    const left = keys.filter((k) => /pan-stop-guard/.test(k.command));
    writeToml(trustAll(keys.filter((k) => !/pan-stop-guard/.test(k.command))));
    const [f] = scan().findings;
    assert.match(f.detail, new RegExp(`^${left.length} of ${keys.length} PAN hooks? .* ha(s|ve) no trust entry`));
    assert.match(f.detail, /\(pan-stop-guard\)/);
  });

  test('a hook the user disabled is their choice, not an untrusted hook', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    const [off, ...rest] = keys;
    writeToml(trustAll(rest) + `\n[hooks.state.${tomlStr(off.key)}]\nenabled = false\n`);
    assert.deepEqual(scan().findings, []);
  });

  test('an entry with no trusted_hash does not count as trust', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    writeToml(keys.map((k) => `[hooks.state.${tomlStr(k.key)}]\nenabled = true\n`).join('\n'));
    assert.equal(scan().codex_hooks.untrusted, keys.length);
  });

  test("another project's keys do not trust this project's hooks", () => {
    writeHooks(cfg);
    const other = path.join(os.tmpdir(), 'some-other-project', '.codex', 'hooks.json');
    writeToml(trustAll(keysFor(cfg, other)));
    assert.equal(scan().findings.length, 1);
  });

  test('a key trusted for a different group index does not count (Codex keys by position)', () => {
    writeHooks(cfg);
    const shifted = keysFor(cfg, hooksPath).map((k) => ({ ...k, key: k.key.replace(/:(\d+):(\d+)$/, (_, g, h) => `:${Number(g) + 5}:${h}`) }));
    writeToml(trustAll(shifted));
    assert.equal(scan().findings.length, 1);
  });

  test('foreign hooks in the same file are not PAN\'s to report', () => {
    const foreign = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
    writeHooks(foreign);
    assert.deepEqual(scan().findings, []);
    // PAN merged in beside it: only PAN's handlers are counted.
    const merged = lib.mergeCodexHooksConfig(JSON.parse(JSON.stringify(foreign)), COMMANDS);
    writeHooks(merged);
    const pan = keysFor(merged, hooksPath).filter((k) => /pan-/.test(k.command));
    assert.equal(scan().codex_hooks.pan_hooks, pan.length);
  });

  test('the dotted and inline forms a person might type are read too', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    const half = Math.ceil(keys.length / 2);
    const text = ['[hooks]', ...keys.slice(0, half).map((k) => `state.${tomlStr(k.key)}.trusted_hash = "sha256:a"`), '',
      '[hooks.state]', ...keys.slice(half).map((k) => `${tomlStr(k.key)} = { trusted_hash = "sha256:b" }`)].join('\n');
    writeToml(text);
    assert.deepEqual(scan().findings, []);
  });

  test('a top-level dotted key is read, and the key decodes TOML escapes (Windows backslashes)', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    // JSON.stringify escapes backslashes as a TOML basic string does; force one \u escape too.
    const enc = (s) => tomlStr(s).replace(/s/, '\\u0073');
    writeToml(keys.map((k) => `hooks.state.${enc(k.key)}.trusted_hash = "x"`).join('\n'));
    assert.deepEqual(scan().findings, []);
  });

  test('literal-string keys and comments', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    writeToml(['# trusted by hand', ...keys.map((k) => `[hooks.state.'${k.key}'] # pan\ntrusted_hash = 'x'`)].join('\n'));
    assert.deepEqual(scan().findings, []);
  });

  test('a trust entry in a section other than hooks.state is ignored', () => {
    writeHooks(cfg);
    const keys = keysFor(cfg, hooksPath);
    writeToml(['[projects]', ...keys.map((k) => `state.${tomlStr(k.key)}.trusted_hash = "x"`)].join('\n'));
    assert.equal(scan().findings.length, 1);
  });

  test('CODEX_HOME moves the config.toml the check reads, and the finding names it', () => {
    writeHooks(cfg);
    const codexHome = path.join(home, 'elsewhere');
    fs.mkdirSync(codexHome, { recursive: true });
    const r1 = hygiene.checkCodexHookTrust(project, { codexHome });
    assert.match(r1.findings[0].detail, /elsewhere\/config\.toml/);
    fs.writeFileSync(path.join(codexHome, 'config.toml'), trustAll(keysFor(cfg, hooksPath)));
    assert.deepEqual(hygiene.checkCodexHookTrust(project, { codexHome }).findings, []);
  });

  test('a malformed hooks.json is not reported as untrusted hooks', () => {
    fs.mkdirSync(path.join(project, '.codex'), { recursive: true });
    fs.writeFileSync(hooksPath, '{ not json');
    assert.deepEqual(scan().findings, []);
  });

  test('hygiene scan never writes config.toml', () => {
    writeHooks(cfg);
    writeToml('# untouched\n');
    const before = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    hygiene.scanHygiene(project, { homeDir: home });
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), before);
  });
});

describe('H-16 end to end: a real Codex install, then hygiene scan', () => {
  test('an untrusted install warns; trusting each handler key clears it', () => {
    const r = installInto(project, ['--codex', '--local']);
    assert.ok(r.success, r.error);
    const installed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const codexHome = path.join(home, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const env = { ...process.env, CODEX_HOME: codexHome, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
    const run = () => {
      const out = spawnSync(process.execPath, [TOOLS, 'hygiene', 'scan'], { cwd: project, encoding: 'utf8', env });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout).findings.filter((f) => f.check === 'codex-hook-trust');
    };
    const before = run();
    assert.equal(before.length, 1);
    assert.equal(before[0].severity, 'warn');
    fs.writeFileSync(path.join(codexHome, 'config.toml'), trustAll(keysFor(installed, hooksPath)));
    assert.deepEqual(run(), []);
  });
});
