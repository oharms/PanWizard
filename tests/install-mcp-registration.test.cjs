/**
 * MCP registration after a REAL install — every runtime in MCP_REGISTRATION.
 *
 * Audit HIGH (spec docs/specs/testing-system-redesign-2026-09.md §3.2 item 6):
 * "MCP registration asserted after a real install for one runtime of five".
 * tests/mcp-registration.test.cjs pins the pure builders and the deployment
 * validator, so the SHAPES are covered — but nothing drove the installer and
 * then read the file a host would actually open. That is the gap PAN has fallen
 * into twice: a config that writes cleanly, verifies cleanly, and is silently
 * never read (Copilot's `.github/.github/mcp.json` doubling; the Codex skills
 * path that stopped being a read path).
 *
 * So the load-bearing assertion here is not "a file exists". It is: the command
 * and args the runtime's own config file carries RESOLVE TO A FILE ON DISK in
 * this install, and running them answers an MCP `initialize`. A path typo, a
 * cross-runtime path mix-up, a stale localPath or a core that never shipped all
 * fail that, where an existence check on the config alone passes.
 *
 * The runtime list comes from lib.MCP_REGISTRATION, not from a literal, so a
 * sixth runtime (or a `register` flag flip) lands here as a failure.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { installInto, withFakeHome, cleanup, RUNTIME_DIR } = require('./helpers.cjs');

const RUNTIMES = Object.keys(lib.MCP_REGISTRATION);
const REGISTERING = RUNTIMES.filter((rt) => lib.MCP_REGISTRATION[rt].register);
const SNIPPET_ONLY = RUNTIMES.filter((rt) => !lib.MCP_REGISTRATION[rt].register);

/** Installer output carries ANSI colour unconditionally; strip it before matching. */
function stripAnsi(s) { return String(s || '').replace(/\u001b\[[0-9;]*m/g, ''); }

/** Escape a literal path for use inside a RegExp. */
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

/**
 * Where a LOCAL install puts a runtime's MCP config, from the table's own
 * localPath. Mirrors bin/install.js mcpConfigPathFor: every runtime keeps its
 * MCP config inside its own config dir — except Claude, whose project surface
 * is `.mcp.json` at the REPO ROOT.
 */
function mcpConfigPath(projectDir, runtime) {
  const spec = lib.MCP_REGISTRATION[runtime];
  return runtime === 'claude'
    ? path.join(projectDir, spec.localPath)
    : path.join(projectDir, RUNTIME_DIR[runtime], spec.localPath);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** The `pan` entry out of the runtime's own container key. */
function panEntry(config, runtime) {
  const key = lib.MCP_REGISTRATION[runtime].key;
  const bag = config[key];
  assert.ok(bag && typeof bag === 'object', `${runtime}: no "${key}" block in the emitted config`);
  const entry = bag.pan;
  assert.ok(entry && typeof entry === 'object', `${runtime}: no "pan" server in the emitted config`);
  return entry;
}

/**
 * The launcher argv the host would run, from whichever shape this runtime uses:
 * opencode carries ONE `command` array, everyone else `command` + `args[]`.
 */
function launchArgv(entry, runtime) {
  if (runtime === 'opencode') {
    assert.ok(Array.isArray(entry.command), `${runtime}: command must be a single [cmd, ...args] array`);
    return entry.command;
  }
  assert.equal(typeof entry.command, 'string', `${runtime}: command must be a string`);
  assert.ok(Array.isArray(entry.args), `${runtime}: args[] must be an array`);
  return [entry.command, ...entry.args];
}

/** opencode names its env block `environment`; the others use `env`. */
function envOf(entry, runtime) {
  const env = runtime === 'opencode' ? entry.environment : entry.env;
  assert.ok(env && typeof env === 'object', `${runtime}: entry carries no env block`);
  return env;
}

describe('MCP registration after a real local install (every runtime in MCP_REGISTRATION)', () => {
  let projectDir;
  let output;

  before(() => {
    // macOS: os.tmpdir() is a symlink (/var → /private/var) and the installer records the
    // RESOLVED path, so the root is resolved here — otherwise every path comparison below
    // passes on Linux and Windows and fails on macOS.
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mcp-install-')));
    // Seed a FOREIGN server into Claude's surface before the install, so the
    // non-destructive merge (and the uninstall strip) is measured on a file PAN
    // did not create rather than asserted about an empty one.
    fs.writeFileSync(path.join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'node', args: ['other-server.js'] } } }, null, 2) + '\n');
    const r = installInto(projectDir, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`five-runtime install failed: ${r.error || r.output}`);
    output = stripAnsi(r.output);
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('the runtime split is the documented one, so the per-runtime loops below are not vacuous', () => {
    assert.deepEqual(REGISTERING.slice().sort(), ['claude', 'copilot', 'gemini', 'opencode'],
      'PAN registers MCP for exactly these four runtimes; a change here must be a deliberate table edit');
    assert.deepEqual(SNIPPET_ONLY, ['codex'],
      'codex is the only deliberate register:false runtime (TOML has no safe merge)');
  });

  for (const runtime of REGISTERING) {
    test(`${runtime}: the emitted config's pan entry points at a server.cjs that EXISTS in this install`, () => {
      const spec = lib.MCP_REGISTRATION[runtime];
      const configPath = mcpConfigPath(projectDir, runtime);
      assert.equal(fs.existsSync(configPath), true, `${runtime}: nothing written at the documented path ${spec.localPath}`);

      const config = readJson(configPath);
      const entry = panEntry(config, runtime);

      // Container key: the right one present AND the wrong spelling absent. A
      // config carrying both would "look registered" under either reader.
      const wrongKey = spec.key === 'mcp' ? 'mcpServers' : 'mcp';
      assert.equal(Object.prototype.hasOwnProperty.call(config, wrongKey), false,
        `${runtime}: config must not carry the other runtime family's container key "${wrongKey}"`);

      const argv = launchArgv(entry, runtime);
      assert.equal(argv[0], 'node', `${runtime}: PAN's bridge is launched with node`);
      const serverPath = argv[1];
      assert.equal(path.basename(serverPath), 'server.cjs', `${runtime}: argv[1] should be the MCP bridge entry point`);
      assert.equal(path.isAbsolute(serverPath), true, `${runtime}: a relative server path breaks whenever the host's cwd is not the project root`);

      // THE assertion this file exists for: the registered path is not dead.
      assert.equal(fs.existsSync(serverPath), true,
        `${runtime}: registered MCP server path does not exist on disk — ${serverPath}`);

      // …and it is THIS runtime's copy of the core, not another runtime's dir.
      const ownCore = path.join(projectDir, RUNTIME_DIR[runtime], 'pan-wizard-core');
      assert.equal(path.resolve(serverPath), path.resolve(path.join(ownCore, 'mcp', 'server.cjs')),
        `${runtime}: must point at its own installed core, not another runtime's`);

      const env = envOf(entry, runtime);
      assert.equal(fs.existsSync(env.PAN_TOOLS_PATH), true,
        `${runtime}: PAN_TOOLS_PATH points at a missing engine — ${env.PAN_TOOLS_PATH}`);
      assert.equal(path.resolve(env.PAN_TOOLS_PATH), path.resolve(path.join(ownCore, 'bin', 'pan-tools.cjs')),
        `${runtime}: PAN_TOOLS_PATH must be this install's engine`);
      // A LOCAL install pins the project root; only a global install omits it.
      assert.equal(path.resolve(env.PAN_PROJECT_ROOT), path.resolve(projectDir),
        `${runtime}: a local install must pin PAN_PROJECT_ROOT to the project`);

      // `type` is per-runtime and easy to get wrong in either direction:
      // copilot/opencode want "local"; Claude's type vocabulary has no such
      // value, and Gemini infers stdio from `command`.
      if (runtime === 'copilot' || runtime === 'opencode') {
        assert.equal(entry.type, 'local', `${runtime}: documented example carries type "local"`);
      } else {
        assert.equal(entry.type, undefined, `${runtime}: must NOT be given a type field`);
      }

      assert.match(output, new RegExp(`Registered MCP server \\(.*${esc(spec.localPath)}\\)`),
        `${runtime}: the installer should report the path it wrote`);
    });
  }

  for (const runtime of REGISTERING) {
    test(`${runtime}: running the registered command answers an MCP initialize`, () => {
      const entry = panEntry(readJson(mcpConfigPath(projectDir, runtime)), runtime);
      const argv = launchArgv(entry, runtime);
      assert.equal(argv[0], 'node', `${runtime}: the registered launcher is node`);
      // Spawn through process.execPath rather than resolving "node" on PATH —
      // same interpreter, no dependency on the test host's PATH; the registered
      // literal is asserted above.
      const r = spawnSync(process.execPath, argv.slice(1), {
        cwd: projectDir,
        input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }) + '\n',
        encoding: 'utf-8',
        timeout: 20000,
      });
      assert.equal(r.status, 0, `${runtime}: registered server exited ${r.status}: ${r.stderr}`);
      const first = (r.stdout || '').split('\n').filter((l) => l.trim())[0];
      assert.ok(first, `${runtime}: registered server answered nothing on stdout (stderr: ${r.stderr})`);
      const reply = JSON.parse(first);
      assert.equal(reply.jsonrpc, '2.0', `${runtime}: reply is not JSON-RPC 2.0`);
      assert.equal(reply.result.serverInfo.name, 'pan-mcp', `${runtime}: the registered command is not PAN's bridge`);
      assert.equal(reply.result.protocolVersion, '2025-03-26', `${runtime}: bridge did not echo the client protocol version`);
      assert.ok(reply.result.capabilities.tools, `${runtime}: bridge advertises no tools capability`);
    });
  }

  test('no runtime re-states its own config dir in the path it writes', () => {
    // REGRESSION: copilot's localPath was '.github/mcp.json' while its config dir
    // already IS .github/, so the installer wrote `.github/.github/mcp.json` — a
    // file Copilot never reads. Measured on the EMITTED tree, not on the table.
    for (const runtime of REGISTERING) {
      const dir = RUNTIME_DIR[runtime];
      const rel = path.relative(projectDir, mcpConfigPath(projectDir, runtime)).split(path.sep);
      assert.equal(rel.filter((seg) => seg === dir).length <= 1, true,
        `${runtime}: config path repeats ${dir} — ${rel.join('/')}`);
      assert.equal(fs.existsSync(path.join(projectDir, dir, dir)), false,
        `${runtime}: install created a doubled dir ${dir}/${dir}`);
    }
  });

  for (const runtime of SNIPPET_ONLY) {
    test(`${runtime}: PAN writes no config and prints a snippet whose server path exists`, () => {
      const spec = lib.MCP_REGISTRATION[runtime];
      const notWritten = path.join(projectDir, RUNTIME_DIR[runtime], spec.localPath);
      assert.equal(fs.existsSync(notWritten), false,
        `${runtime} is register:false — PAN must not touch ${spec.localPath} (no TOML merge exists)`);

      const where = `${RUNTIME_DIR[runtime]}/${spec.localPath}`;
      assert.match(output, new RegExp(`MCP: add PAN to ${esc(where)} by hand`),
        `${runtime}: the by-hand instruction must name the file the user has to edit`);
      assert.match(output, /^\s*\[mcp_servers\.pan\]\s*$/m, 'the printed snippet carries the verified TOML table header');
      assert.match(output, /^\s*\[mcp_servers\.pan\.env\]\s*$/m, 'the snippet carries the nested env table');

      // The snippet is the ONLY thing standing in for a write here, so its path
      // must resolve exactly like a written one would.
      const argsLine = output.split('\n').find((l) => /^\s*args = \[/.test(l));
      assert.ok(argsLine, 'the snippet should carry an args = [...] line');
      const snippetServer = JSON.parse(argsLine.slice(argsLine.indexOf('[')))[0];
      assert.equal(fs.existsSync(snippetServer), true,
        `${runtime}: the printed snippet's server path does not exist — ${snippetServer}`);
      assert.equal(path.resolve(snippetServer),
        path.resolve(path.join(projectDir, RUNTIME_DIR[runtime], 'pan-wizard-core', 'mcp', 'server.cjs')),
        `${runtime}: the snippet must point at this runtime's installed core`);
    });
  }

  test('claude: a foreign MCP server in .mcp.json survives the install alongside pan', () => {
    const config = readJson(mcpConfigPath(projectDir, 'claude'));
    assert.deepEqual(Object.keys(config.mcpServers).sort(), ['other', 'pan'],
      'the merge must add pan without evicting a server PAN did not write');
    assert.deepEqual(config.mcpServers.other, { command: 'node', args: ['other-server.js'] },
      'the foreign entry must come through byte-identical');
  });

  test('gemini: registering into the shared settings.json keeps the hooks PAN writes there', () => {
    // Gemini's MCP surface IS the settings file PAN also writes hooks and
    // experimental flags into; a clobbering merge would silently disable both.
    const settings = readJson(mcpConfigPath(projectDir, 'gemini'));
    assert.ok(settings.mcpServers.pan, 'gemini settings.json carries the pan server');
    assert.equal(settings.experimental.enableAgents, true, 'the MCP merge must not drop experimental.enableAgents');
    assert.ok(Array.isArray(settings.hooks.SessionStart), 'the MCP merge must not drop the hook registrations');
  });

  // LAST in this describe by design: --uninstall removes the core the tests
  // above resolve against, so it must run after them.
  test('uninstall strips the pan server: PAN-created files go, foreign content stays', () => {
    const existing = REGISTERING.map((rt) => ({ rt, p: mcpConfigPath(projectDir, rt) }));
    for (const { rt, p } of existing) {
      assert.equal(fs.existsSync(p), true, `${rt}: precondition — config must be present before uninstall`);
    }

    const u = installInto(projectDir, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local', '--uninstall']);
    assert.equal(u.success, true, `uninstall failed: ${u.error || u.output}`);

    for (const { rt, p } of existing) {
      if (!fs.existsSync(p)) continue; // PAN was the file's only content — removed wholesale
      const bag = readJson(p)[lib.MCP_REGISTRATION[rt].key] || {};
      assert.equal(Object.prototype.hasOwnProperty.call(bag, 'pan'), false,
        `${rt}: the pan server is still registered after uninstall`);
    }

    // The three PAN-created configs held nothing else, so they are removed
    // rather than left behind as `{"mcpServers":{}}`.
    for (const rt of ['copilot', 'gemini', 'opencode']) {
      assert.equal(fs.existsSync(mcpConfigPath(projectDir, rt)), false,
        `${rt}: a config PAN created and that held only PAN should be removed, not emptied`);
    }
    // Claude's was seeded with a foreign server, so it must SURVIVE with it.
    assert.deepEqual(Object.keys(readJson(mcpConfigPath(projectDir, 'claude')).mcpServers), ['other'],
      'uninstall must leave the foreign server and remove only pan');
  });
});

describe('MCP registration at global scope (claude is deliberately register-by-hand)', () => {
  let projectDir;
  // Every filesystem fact is captured INSIDE the withFakeHome sandbox: the helper
  // removes the fake home when it returns, so a later existsSync() against it
  // would be vacuously false.
  const facts = {};

  before(() => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mcp-global-')));
    withFakeHome((home) => {
      const r = installInto(projectDir, ['--claude', '--global', '--skip-warnings']);
      if (!r.success) throw new Error(`global claude install failed: ${r.error || r.output}`);
      facts.output = stripAnsi(r.output);
      facts.projectMcpJsonExists = fs.existsSync(path.join(projectDir, '.mcp.json'));
      facts.homeEntries = fs.readdirSync(home);
      const printed = /claude mcp add pan --scope user -- node "([^"]+)"/.exec(facts.output);
      facts.printedServer = printed ? printed[1] : null;
      facts.printedServerExists = printed ? fs.existsSync(printed[1]) : false;
      facts.expectedServer = path.join(home, '.claude', 'pan-wizard-core', 'mcp', 'server.cjs');
    });
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  test('no config file is written for a global install — not in the project, not in the home dir', () => {
    // MCP_REGISTRATION.claude.globalPath is null on purpose: user scope is
    // ~/.claude.json, a file keyed by every project the user has ever opened.
    assert.equal(lib.MCP_REGISTRATION.claude.globalPath, null, 'the table records claude global as un-writable');
    assert.equal(facts.projectMcpJsonExists, false,
      'a --global install must not drop a project-scoped .mcp.json into the cwd');
    assert.ok(facts.homeEntries.includes('.claude'),
      `positive control: the global install should have created .claude in the sandboxed home (saw ${facts.homeEntries.join(', ')})`);
    assert.equal(facts.homeEntries.includes('.claude.json'), false,
      'PAN must not create or touch the user-scope ~/.claude.json');
  });

  test('the printed fallback is the claude CLI command, and its server path exists', () => {
    assert.match(facts.output, /claude mcp add pan --scope user -- node "/,
      'a global install must print the user-scope registration command instead of writing a file');
    assert.ok(facts.printedServer, 'the printed command should quote the server path');
    assert.equal(facts.printedServerExists, true,
      `the printed server path did not exist at install time — ${facts.printedServer}`);
    assert.equal(path.resolve(facts.printedServer), path.resolve(facts.expectedServer),
      "the printed path must be the global install's own bridge");
  });
});
