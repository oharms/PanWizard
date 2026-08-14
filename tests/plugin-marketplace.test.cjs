/**
 * Plugin marketplace `command` source — the local distribution path.
 *
 * PAN builds a plugin and has shipped it nowhere, because publishing was gated on
 * an unverified question (does the plugin-root placeholder expand inside command
 * MARKDOWN?). A `command` source needs no hosting, so it turns that question into
 * a local experiment. These tests cover everything answerable WITHOUT a live
 * Claude Code session; the question itself needs one, and `/pan-plugin-selftest`
 * is the instrument.
 *
 * Every constraint asserted here is quoted from
 * code.claude.com/docs/en/plugin-marketplaces (read 2026-08-14). They are pinned
 * because a marketplace that violates one FAILS TO LOAD or refuses the install —
 * and this repo has twice shipped config that was written from a secondary source
 * and silently never read.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MARKETPLACE = path.join(ROOT, 'marketplace', '.claude-plugin', 'marketplace.json');
const PATH_SCRIPT = path.join(ROOT, 'scripts', 'plugin-path.js');
const lib = require('../bin/install-lib.cjs');

const readMarketplace = () => JSON.parse(fs.readFileSync(MARKETPLACE, 'utf8'));

describe('marketplace.json: required shape', () => {
  test('exists at <dir>/.claude-plugin/marketplace.json', () => {
    // The location is part of the contract: `/plugin marketplace add <dir>` looks
    // for the manifest at this exact sub-path.
    assert.ok(fs.existsSync(MARKETPLACE), `missing ${MARKETPLACE}`);
  });

  test('carries name, owner and a plugins array', () => {
    const m = readMarketplace();
    assert.ok(m.name && typeof m.name === 'string', 'marketplace needs a name');
    assert.ok(m.owner && m.owner.name, 'marketplace needs an owner.name');
    assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0, 'needs at least one plugin entry');
    for (const p of m.plugins) {
      assert.ok(p.name, 'plugin entry needs a name');
      assert.ok(p.description, 'plugin entry needs a description (it is the discovery signal)');
      assert.ok(p.source, 'plugin entry needs a source');
    }
  });
});

describe('marketplace.json: command-source constraints', () => {
  const entry = () => readMarketplace().plugins.find(p => p.source && p.source.source === 'command');

  test('the PAN entry is a command source', () => {
    assert.ok(entry(), 'expected a command-source plugin entry');
  });

  test('command is printable ASCII, <=500 chars, with no run of 4+ spaces', () => {
    // Verbatim constraint: "Must be printable ASCII, at most 500 characters, with
    // no runs of four or more spaces, so users can review the whole command
    // they're asked to accept."
    const cmd = entry().source.command;
    assert.ok(cmd.length <= 500, `command is ${cmd.length} chars (max 500)`);
    assert.ok(/^[\x20-\x7E]+$/.test(cmd), 'command must be printable ASCII only');
    assert.ok(!/ {4}/.test(cmd), 'command must not contain a run of 4+ spaces');
  });

  test('mode is "copy" — link mode is UNSUPPORTED ON WINDOWS', () => {
    // Verbatim: "Claude Code doesn't support link mode on Windows and refuses to
    // install a link-mode plugin there. Declare "mode": "copy" instead." PAN is
    // developed and tested on Windows, so link mode would make the primary
    // distribution path unusable for its own maintainer. This is a deliberate
    // choice, not an oversight — do not "optimise" it to link.
    assert.equal(entry().source.mode, 'copy');
  });

  test('timeout is a whole number of seconds within 1..600', () => {
    const t = entry().source.timeout;
    if (t === undefined) return; // optional, defaults to 60
    assert.ok(Number.isInteger(t) && t >= 1 && t <= 600, `timeout ${t} out of range`);
  });

  test('the command actually invokes the path script this repo ships', () => {
    // Guards against the entry drifting away from the script, which would make
    // the marketplace point at nothing while still looking well-formed.
    const cmd = entry().source.command;
    assert.match(cmd, /plugin-path\.js/, 'command should run scripts/plugin-path.js');
  });
});

describe('plugin-path.js: the stdout contract', () => {
  // "The command must print exactly one line on stdout and exit with code 0."
  let stdout;

  test('prints exactly one line and exits 0', () => {
    stdout = execFileSync(process.execPath, [PATH_SCRIPT], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = stdout.split('\n').filter(l => l.length > 0);
    assert.equal(lines.length, 1, `expected 1 stdout line, got ${lines.length}: ${JSON.stringify(stdout)}`);
  });

  test('the single line is an absolute path to an existing directory', () => {
    const p = stdout.trim();
    assert.ok(path.isAbsolute(p), `not absolute: ${p}`);
    assert.ok(fs.existsSync(p) && fs.statSync(p).isDirectory(), `not a directory: ${p}`);
  });

  test('the printed directory holds plugin content at its TOP level', () => {
    // Verbatim refusal condition: "The directory has no plugin content at its top
    // level, such as a `.claude-plugin/` directory or a `skills/`, `commands/`,
    // `agents/`, or `hooks/` directory".
    const top = fs.readdirSync(stdout.trim());
    const markers = ['.claude-plugin', 'skills', 'commands', 'agents', 'hooks'];
    assert.ok(markers.some(m => top.includes(m)),
      `no plugin marker at top level; found: ${top.join(', ')}`);
  });

  test('works when run from a DIFFERENT cwd (Claude Code runs it from $HOME)', () => {
    // Verbatim: the command runs "from the user's home directory". A script that
    // silently depended on cwd would pass every test run from the repo and fail
    // for every real user.
    const elsewhere = require('os').tmpdir();
    const out = execFileSync(process.execPath, [PATH_SCRIPT], {
      cwd: elsewhere, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(out.trim(), stdout.trim(), 'output must not depend on cwd');
  });

  test('the built plugin is within copy-mode limits (256 MiB / 20,000 entries)', () => {
    const dir = stdout.trim();
    let entries = 0;
    let bytes = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        entries += 1;
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else { try { bytes += fs.statSync(fp).size; } catch { /* raced */ } }
      }
    };
    walk(dir);
    assert.ok(entries <= 20000, `${entries} entries exceeds the 20,000 copy-mode limit`);
    assert.ok(bytes <= 256 * 1024 * 1024, `${bytes} bytes exceeds the 256 MiB copy-mode limit`);
  });
});

describe('the self-test probe (the instrument for the gated question)', () => {
  const PLUGIN = path.join(ROOT, 'dist', 'pan-wizard-plugin');
  const probePath = path.join(PLUGIN, 'commands', 'pan-plugin-selftest.md');

  test('is emitted into the plugin build', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-plugin.js')], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(fs.existsSync(probePath), 'plugin build should emit the self-test command');
  });

  test('is NOT added to the shipped command set', () => {
    // The diagnostic belongs to the plugin only. If it leaked into commands/pan/
    // every one of the five runtimes would gain a self-test command, and the
    // CLAUDE.md command count would move.
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'pan', 'pan-plugin-selftest.md')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'pan', 'plugin-selftest.md')));
  });

  test('keeps the placeholder LITERAL — a pre-expanded probe measures nothing', () => {
    // If the build ever rewrote this file's placeholder to a real path, probe 1
    // would always report a path and always conclude "case A" regardless of the
    // truth. The whole experiment depends on the token surviving the build.
    const body = fs.readFileSync(probePath, 'utf8');
    assert.match(body, /PAN_PROBE_BEGIN>>>\$\{CLAUDE_PLUGIN_ROOT\}<<<PAN_PROBE_END/,
      'the sentinel-wrapped placeholder must reach the plugin unexpanded');
  });

  test('separates textual substitution from the environment variable', () => {
    // The probe is only sound if it distinguishes these. A body that merely ran a
    // shell command through the placeholder would pass whenever the env var is
    // exported, proving nothing about markdown.
    const body = fs.readFileSync(probePath, 'utf8');
    assert.match(body, /process\.env\.CLAUDE_PLUGIN_ROOT/, 'must probe the env var separately');
    assert.match(body, /Do not run a shell/i, 'probe 1 must forbid shell involvement');
    for (const c of ['case A', 'case B', 'case C']) {
      assert.ok(body.includes(c), `verdict table must define ${c}`);
    }
  });

  test('builder output is stable for a given placeholder (pure function)', () => {
    const a = lib.buildPluginSelfTestCommand('${X}');
    const b = lib.buildPluginSelfTestCommand('${X}');
    assert.equal(a, b);
    assert.ok(a.includes('PAN_PROBE_BEGIN>>>${X}<<<PAN_PROBE_END'));
  });
});
