/**
 * MCP server registration (P3) — the pure builders in bin/install-lib.cjs.
 *
 * WHY THESE ARE PINNED HARD: every path and entry shape here was read off a
 * primary doc, and PAN has shipped DEAD config paths twice before (Copilot hooks
 * in the wrong file with the wrong schema; Codex skills in a location that was no
 * longer a read path). A wrong key or a wrong `type` value produces a file that
 * looks right, writes cleanly, and is silently never read. Tests are the only
 * thing standing between "we wrote a file" and "a runtime loaded it".
 *
 * The runtime-to-runtime differences are the whole risk surface:
 *   - opencode's container key is `mcp`, everyone else's is `mcpServers`
 *   - opencode takes ONE command array; the others take command + args[]
 *   - opencode's env block is `environment`; the others use `env`
 *   - copilot wants type:"local"; claude/gemini must NOT get a `type`
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');

const SERVER = '/proj/.claude/pan-wizard-core/mcp/server.cjs';
const ENGINE = '/proj/.claude/pan-wizard-core/bin/pan-tools.cjs';
const ROOT = '/proj';

describe('MCP_REGISTRATION table', () => {
  test('every runtime PAN installs to has an entry, and each carries a why', () => {
    for (const rt of ['claude', 'copilot', 'gemini', 'opencode', 'codex']) {
      const spec = lib.MCP_REGISTRATION[rt];
      assert.ok(spec, `${rt} missing from MCP_REGISTRATION`);
      assert.equal(typeof spec.register, 'boolean');
      assert.ok(spec.key, `${rt} needs a container key`);
      // A `why` is not decoration: it records the primary source the path came
      // from, which is what makes a stale path auditable rather than mysterious.
      assert.ok(spec.why && spec.why.length > 20, `${rt} needs a sourced rationale`);
    }
  });

  test('the container key is `mcp` for opencode and `mcpServers` for the rest', () => {
    assert.equal(lib.MCP_REGISTRATION.opencode.key, 'mcp');
    for (const rt of ['claude', 'copilot', 'gemini']) {
      assert.equal(lib.MCP_REGISTRATION[rt].key, 'mcpServers', `${rt} key`);
    }
  });

  test('codex is deliberately register:false and claude has no global path', () => {
    // Both are risk decisions recorded in the table's comment. If either flips,
    // it must be a deliberate change with a TOML merge / ~/.claude.json strategy
    // behind it — not an accident.
    assert.equal(lib.MCP_REGISTRATION.codex.register, false);
    assert.equal(lib.MCP_REGISTRATION.claude.globalPath, null);
    assert.equal(lib.MCP_REGISTRATION.claude.localPath, '.mcp.json');
  });

  test('paths are relative to the CONFIG DIR, so none re-states its own dir name', () => {
    // REGRESSION: copilot's localPath was '.github/mcp.json' while its config dir
    // already IS .github/, so the installer wrote `.github/.github/mcp.json` — a
    // path Copilot never reads. It installed and verified cleanly, which is the
    // whole danger: a dead config path looks exactly like a live one on disk.
    const dirNames = { claude: '.claude', copilot: '.github', gemini: '.gemini', opencode: '.opencode', codex: '.codex' };
    for (const [rt, dir] of Object.entries(dirNames)) {
      const spec = lib.MCP_REGISTRATION[rt];
      for (const p of [spec.localPath, spec.globalPath]) {
        if (!p) continue;
        // claude is the documented exception: its path is repo-root-relative and
        // the installer special-cases it away from targetDir entirely.
        if (rt === 'claude') continue;
        assert.ok(!p.startsWith(`${dir}/`) && !p.startsWith(`${dir}\\`),
          `${rt}: "${p}" re-states its own config dir "${dir}" — it will double`);
      }
    }
  });

  test('the table is frozen — mutation has NO EFFECT (deep, not just top level)', () => {
    // NB: this file is sloppy-mode CJS, so writing to a frozen property fails
    // SILENTLY rather than throwing. Assert the guarantee that actually holds —
    // the value is unchanged — or the test passes for the wrong reason.
    const beforePath = lib.MCP_REGISTRATION.claude.localPath;
    lib.MCP_REGISTRATION.claude = { hijacked: true };
    lib.MCP_REGISTRATION.claude.localPath = 'somewhere-else.json';
    lib.MCP_REGISTRATION.codex.register = true;
    assert.equal(lib.MCP_REGISTRATION.claude.localPath, beforePath, 'nested value held');
    assert.equal(lib.MCP_REGISTRATION.codex.register, false, 'the risk decision held');
    assert.ok(!('hijacked' in lib.MCP_REGISTRATION.claude), 'entry not replaced');
    assert.ok(Object.isFrozen(lib.MCP_REGISTRATION), 'table frozen');
    assert.ok(Object.isFrozen(lib.MCP_REGISTRATION.claude), 'entries frozen too');
  });
});

describe('buildMcpServerEntry — per-runtime shape', () => {
  test('claude: command + args, env, and NO type field', () => {
    const e = lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT);
    assert.equal(e.command, 'node');
    assert.deepEqual(e.args, [SERVER]);
    assert.equal(e.env.PAN_TOOLS_PATH, ENGINE);
    assert.equal(e.env.PAN_PROJECT_ROOT, ROOT);
    // Claude's `type` vocabulary has no "local"; adding one risks rejection.
    assert.ok(!('type' in e), 'claude entry must not carry a type');
  });

  test('gemini: identical shape to claude, still no type', () => {
    const e = lib.buildMcpServerEntry('gemini', SERVER, ENGINE, ROOT);
    assert.deepEqual(e, lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
    assert.ok(!('type' in e));
  });

  test('copilot: same as claude PLUS type "local"', () => {
    const e = lib.buildMcpServerEntry('copilot', SERVER, ENGINE, ROOT);
    assert.equal(e.type, 'local');
    assert.equal(e.command, 'node');
    assert.deepEqual(e.args, [SERVER]);
  });

  test('opencode: ONE command array, `environment` not `env`, enabled true', () => {
    const e = lib.buildMcpServerEntry('opencode', SERVER, ENGINE, ROOT);
    assert.equal(e.type, 'local');
    assert.deepEqual(e.command, ['node', SERVER], 'command must be a single array');
    assert.equal(e.enabled, true);
    assert.equal(e.environment.PAN_TOOLS_PATH, ENGINE);
    // The two failure shapes that would look fine in a diff:
    assert.ok(!('args' in e), 'opencode must not split out args');
    assert.ok(!('env' in e), 'opencode names its env block `environment`');
  });

  test('PAN_PROJECT_ROOT is omitted when no projectRoot is given', () => {
    const e = lib.buildMcpServerEntry('claude', SERVER, ENGINE, null);
    assert.equal(e.env.PAN_TOOLS_PATH, ENGINE);
    assert.ok(!('PAN_PROJECT_ROOT' in e.env), 'must not emit an undefined root');
  });

  test('every runtime embeds the SERVER path, never the engine path, as the command target', () => {
    // The two paths are siblings and easy to transpose; a swap yields a server
    // that "starts" and then answers nothing.
    for (const rt of ['claude', 'copilot', 'gemini', 'opencode']) {
      const e = lib.buildMcpServerEntry(rt, SERVER, ENGINE, ROOT);
      const target = Array.isArray(e.command) ? e.command[1] : e.args[0];
      assert.equal(target, SERVER, `${rt} must launch server.cjs`);
      assert.match(target, /mcp[\\/]server\.cjs$/, `${rt} target shape`);
    }
  });
});

describe('mergeMcpRegistration — non-destructive', () => {
  test('adds PAN under the right key for each runtime', () => {
    for (const rt of ['claude', 'copilot', 'gemini', 'opencode']) {
      const key = lib.MCP_REGISTRATION[rt].key;
      const out = lib.mergeMcpRegistration(null, rt, lib.buildMcpServerEntry(rt, SERVER, ENGINE, ROOT));
      assert.ok(out[key].pan, `${rt}: PAN entry under ${key}`);
    }
  });

  test("preserves a user's foreign servers and their other config", () => {
    const existing = {
      mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } },
      someUnrelatedSetting: { keep: true },
    };
    const out = lib.mergeMcpRegistration(existing, 'claude', lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
    assert.ok(out.mcpServers.playwright, 'foreign server survived');
    assert.deepEqual(out.someUnrelatedSetting, { keep: true }, 'unrelated config survived');
    assert.ok(out.mcpServers.pan);
  });

  test('is idempotent, and a re-register updates a changed path', () => {
    let cfg = lib.mergeMcpRegistration(null, 'claude', lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
    cfg = lib.mergeMcpRegistration(cfg, 'claude', lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
    assert.equal(Object.keys(cfg.mcpServers).length, 1, 'no duplicate on reinstall');
    const moved = '/new/pan-wizard-core/mcp/server.cjs';
    cfg = lib.mergeMcpRegistration(cfg, 'claude', lib.buildMcpServerEntry('claude', moved, ENGINE, ROOT));
    assert.deepEqual(cfg.mcpServers.pan.args, [moved], 'path change takes effect');
  });

  test('survives a corrupt container (key present but wrong type)', () => {
    // An unusable file must not crash the installer or destroy sibling config —
    // the readSettings null-vs-{} distinction exists for exactly this class.
    for (const bad of [{ mcpServers: 'nonsense' }, { mcpServers: ['a'] }, { mcpServers: null }]) {
      const out = lib.mergeMcpRegistration(bad, 'claude', lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
      assert.ok(out.mcpServers.pan, `recovered from ${JSON.stringify(bad.mcpServers)}`);
    }
    // A non-object root (array / string) is replaced rather than spread into.
    assert.ok(lib.mergeMcpRegistration(['x'], 'claude', { command: 'node' }).mcpServers.pan);
  });

  test('an unknown runtime throws rather than writing a silently wrong file', () => {
    assert.throws(() => lib.mergeMcpRegistration(null, 'notarealruntime', {}), /unknown runtime/);
  });
});

describe('stripMcpRegistration — uninstall', () => {
  test('removes PAN and reports it, leaving foreign servers intact', () => {
    const cfg = {
      mcpServers: {
        pan: { command: 'node', args: [SERVER] },
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    };
    const { config, removed } = lib.stripMcpRegistration(cfg, 'claude');
    assert.equal(removed, true);
    assert.ok(!config.mcpServers.pan, 'PAN gone');
    assert.ok(config.mcpServers.playwright, 'foreign server survived uninstall');
  });

  test('drops the container entirely when PAN was its only member', () => {
    const { config, removed } = lib.stripMcpRegistration({ mcpServers: { pan: {} } }, 'claude');
    assert.equal(removed, true);
    assert.ok(!('mcpServers' in config), 'no empty {mcpServers:{}} left behind');
  });

  test('reports removed:false when PAN was never there (no false positive)', () => {
    assert.equal(lib.stripMcpRegistration({ mcpServers: { other: {} } }, 'claude').removed, false);
    assert.equal(lib.stripMcpRegistration({}, 'claude').removed, false);
    assert.equal(lib.stripMcpRegistration(null, 'claude').removed, false);
  });

  test('strips from opencode`s `mcp` key, not `mcpServers`', () => {
    const cfg = { mcp: { pan: { type: 'local' }, other: { type: 'local' } } };
    const { config, removed } = lib.stripMcpRegistration(cfg, 'opencode');
    assert.equal(removed, true);
    assert.ok(!config.mcp.pan);
    assert.ok(config.mcp.other);
  });

  test('round-trips: merge then strip returns to the original config', () => {
    const original = { mcpServers: { playwright: { command: 'npx' } }, other: 1 };
    const merged = lib.mergeMcpRegistration(JSON.parse(JSON.stringify(original)), 'claude',
      lib.buildMcpServerEntry('claude', SERVER, ENGINE, ROOT));
    const { config } = lib.stripMcpRegistration(merged, 'claude');
    assert.deepEqual(config, original, 'install→uninstall is lossless');
  });
});

describe('validate deployment sees the MCP registration (audit finding 7)', () => {
  // Until 2026-08 `validate deployment` had no idea MCP existed, so a fresh
  // install reported `clean` whether registration succeeded, was skipped for a
  // missing server file, or was refused because the runtime's config was
  // unparseable JSON. The installer recorded those as warnings; nothing surfaced
  // them in the verdict, which is the only thing most callers check.
  const deploy = require('../pan-wizard-core/bin/lib/verify-deploy.cjs');

  test('the reader table agrees with the installer table (they must not drift)', () => {
    // verify-deploy.cjs deliberately DUPLICATES MCP_REGISTRATION rather than
    // importing it: install-lib.cjs is installer-side and is not shipped into an
    // install, while verify-deploy runs from inside one. That is a legitimate
    // copy — and every legitimate copy needs a guard, or the writer and the
    // reader silently disagree about where a file lives.
    for (const [runtime, expected] of Object.entries(deploy.MCP_EXPECTED)) {
      const spec = lib.MCP_REGISTRATION[runtime];
      assert.ok(spec, `${runtime} is read by verify-deploy but absent from MCP_REGISTRATION`);
      assert.equal(spec.register, true, `${runtime} is verified but the installer does not register it`);
      assert.equal(expected.key, spec.key, `${runtime}: container key disagrees`);
      const installerRel = spec.localPath;
      assert.equal(expected.rel, installerRel, `${runtime}: path disagrees (installer writes ${installerRel})`);
    }
    // Every register:true runtime must be verified; a new one must not be
    // silently unchecked.
    for (const [runtime, spec] of Object.entries(lib.MCP_REGISTRATION)) {
      if (spec.register) {
        assert.ok(deploy.MCP_EXPECTED[runtime], `${runtime} is registered but verify-deploy never checks it`);
      } else {
        assert.ok(!deploy.MCP_EXPECTED[runtime], `${runtime} is register:false — nothing to verify`);
      }
    }
  });

  test('a register:false runtime is skipped, not reported as broken', () => {
    const r = deploy.validateMcpRegistration(os.tmpdir(), '.codex', 'codex');
    assert.equal(r.ok, true);
    assert.equal(r.registered, false);
    assert.equal(r.skipped, 'no-registration-by-design');
  });

  test('an install that predates the bridge is skipped, not flagged', () => {
    // The false-alarm guard. A deployment made before the MCP bridge existed has
    // no .mcp.json and never should have; the first version of this check marked
    // every such install `modified`, which turned four unrelated green fixtures
    // red. The installed tree decides: no bridge shipped, nothing to verify.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-nobridge-'));
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'pan-wizard-core'), { recursive: true });
      const r = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(r.ok, true, 'a pre-MCP install must not be flagged');
      assert.equal(r.skipped, 'bridge-not-in-this-install');
      assert.deepEqual(r.issues, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('the three failure modes are distinguished, and a healthy one passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mcpdeploy-'));
    try {
      const cfg = path.join(dir, '.mcp.json');
      const realServer = path.join(dir, 'server.cjs');
      fs.writeFileSync(realServer, '// stand-in for the bridge\n');
      // The check only expects a registration when the install SHIPS the bridge,
      // so an install predating MCP is not flagged for lacking a file it never
      // had. That gate means this fixture must carry the bridge to be checked
      // at all — its absence is what the skip case below covers.
      fs.mkdirSync(path.join(dir, '.claude', 'pan-wizard-core', 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'pan-wizard-core', 'mcp', 'server.cjs'), '//\n');
      const write = (obj) => fs.writeFileSync(cfg, JSON.stringify(obj, null, 2));

      // healthy
      write({ mcpServers: { pan: { command: 'node', args: [realServer] } } });
      const ok = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(ok.ok, true, `healthy config should pass: ${ok.issues.join('; ')}`);
      assert.equal(ok.registered, true);

      // 1. absent — registration never happened
      fs.unlinkSync(cfg);
      const absent = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(absent.ok, false);
      assert.match(absent.issues[0], /missing/i);

      // 2. unparseable — PAN deliberately left a file it could not rewrite
      fs.writeFileSync(cfg, '{ not json');
      const bad = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(bad.ok, false);
      assert.match(bad.issues[0], /unreadable/i);
      // Absent and unparseable must NOT read the same — they are different faults.
      assert.notEqual(absent.issues[0], bad.issues[0]);

      // 3. present but pointing at nothing — the silent-dead case
      write({ mcpServers: { pan: { command: 'node', args: [path.join(dir, 'gone.cjs')] } } });
      const dangling = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(dangling.ok, false);
      assert.equal(dangling.registered, true, 'it IS registered — the path is what is wrong');
      assert.match(dangling.issues[0], /does not exist/i);

      // 4. no pan entry among foreign servers
      write({ mcpServers: { other: { command: 'node', args: [realServer] } } });
      const noPan = deploy.validateMcpRegistration(dir, '.claude', 'claude');
      assert.equal(noPan.ok, false);
      assert.match(noPan.issues[0], /no "pan" entry/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("opencode's single-array command shape is read correctly", () => {
    // The shape difference that has already caused one bug in this feature: the
    // server path is command[1], not args[0].
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mcpoc-'));
    try {
      const server = path.join(dir, 'server.cjs');
      fs.writeFileSync(server, '//\n');
      fs.mkdirSync(path.join(dir, '.opencode', 'pan-wizard-core', 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.opencode', 'pan-wizard-core', 'mcp', 'server.cjs'), '//\n');
      fs.writeFileSync(path.join(dir, '.opencode', 'opencode.json'),
        JSON.stringify({ mcp: { pan: { type: 'local', command: ['node', server] } } }, null, 2));
      const r = deploy.validateMcpRegistration(dir, '.opencode', 'opencode');
      assert.equal(r.ok, true, `opencode shape should read: ${r.issues.join('; ')}`);
      assert.equal(r.server, server);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('buildCodexMcpSnippet', () => {
  test('emits the verified [mcp_servers.NAME] TOML with a nested env table', () => {
    const toml = lib.buildCodexMcpSnippet(SERVER, ENGINE, ROOT);
    assert.match(toml, /^\[mcp_servers\.pan\]$/m);
    assert.match(toml, /^command = "node"$/m);
    assert.match(toml, /^\[mcp_servers\.pan\.env\]$/m);
    assert.match(toml, /^PAN_TOOLS_PATH = /m);
    assert.match(toml, /^PAN_PROJECT_ROOT = /m);
  });

  test('paths are JSON-quoted so a Windows backslash path stays valid TOML', () => {
    const winServer = 'C:\\proj\\.claude\\pan-wizard-core\\mcp\\server.cjs';
    const toml = lib.buildCodexMcpSnippet(winServer, ENGINE, ROOT);
    // JSON.stringify escapes the backslashes; a bare path would be an invalid
    // TOML basic string (and \p is not a legal escape).
    assert.ok(toml.includes(JSON.stringify(winServer)), 'backslashes escaped');
    assert.ok(!toml.includes(`args = [${winServer}]`), 'raw unescaped path must not appear');
  });

  test('omits PAN_PROJECT_ROOT when not supplied', () => {
    assert.ok(!lib.buildCodexMcpSnippet(SERVER, ENGINE, null).includes('PAN_PROJECT_ROOT'));
  });
});
