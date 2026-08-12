/**
 * PAN-Z MCP bridge (M1) — registry, JSON-RPC protocol, spawn routing, input
 * safety, and one real round-trip through the actual pan-tools engine.
 *
 * The protocol layer is tested with an INJECTED spawn (pure, no child process);
 * the final suite exercises the real engine against a scaffolded temp project.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createServer, defaultPanToolsPath, MODERN_PROTOCOL_VERSION, SUPPORTED_VERSIONS_LIST,
} = require('../pan-wizard-core/mcp/server.cjs');
const reg = require('../pan-wizard-core/mcp/tool-registry.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

// A fake spawn that records the argv it was handed and returns canned stdout.
function fakeSpawn(recorder, out = '{"ok":true}') {
  return (args) => { recorder.push(args); return { ok: true, stdout: out, stderr: '' }; };
}

describe('engine path resolution (default, i.e. no explicit panToolsPath)', () => {
  // WHY THIS SUITE EXISTS: every other test here either injects a spawn (so the
  // engine path is never used) or passes `panToolsPath` explicitly — including
  // the "real round-trip" one. So when the module moved from pan-zcode/mcp/ to
  // pan-wizard-core/mcp/, the whole suite stayed green WITHOUT covering the one
  // function whose meaning depends on the module's own location. A default that
  // silently pointed at nothing would have shipped: the server only spawns the
  // engine at tools/call time, so the failure surfaces per-call in a deployed
  // install, never at startup and never here.
  test('resolves to a pan-tools that EXISTS on disk', () => {
    const resolved = defaultPanToolsPath();
    assert.ok(fs.existsSync(resolved), `default engine path does not exist: ${resolved}`);
    assert.equal(path.basename(resolved), 'pan-tools.cjs');
  });

  test('resolves to the SAME file the suite reaches by an independent route', () => {
    // TOOLS_PATH is derived in helpers.cjs from tests/ upward; defaultPanToolsPath()
    // is derived from the mcp/ module downward. Two different anchors landing on one
    // file is what makes this more than a tautology — a wrong-but-existing path fails.
    assert.equal(path.resolve(defaultPanToolsPath()), path.resolve(TOOLS_PATH));
  });

  test('is anchored on the bin/ sibling relationship, not on an ancestor name', () => {
    // REVERT CHECK: the pre-move form was
    //   join(__dirname, '..', '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs')
    // which resolves IDENTICALLY from this directory (so it is not a bug), but
    // requires the grandparent to contain a dir *named* pan-wizard-core. This
    // asserts the surviving dependency is only the sibling layout, which is what
    // keeps a vendored or renamed core working.
    const resolved = path.resolve(defaultPanToolsPath());
    const mcpDir = path.resolve(__dirname, '..', 'pan-wizard-core', 'mcp');
    assert.equal(resolved, path.resolve(mcpDir, '..', 'bin', 'pan-tools.cjs'));
  });

  test('a real tools/call works with NO panToolsPath supplied', () => {
    // The end-to-end proof: default resolution + real spawn + real engine.
    const proj = createTempProject();
    try {
      const s = createServer({ cwd: proj });
      const r = s.handle({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner' } },
      });
      assert.equal(r.result.isError, false, r.result.content[0].text);
      assert.ok(JSON.parse(r.result.content[0].text).model, 'engine answered via the default path');
    } finally {
      cleanup(proj);
    }
  });
});

describe('pan-zcode registry', () => {
  test('every tool has a verb OR a handler, plus description/inputSchema and boolean hints', () => {
    for (const t of reg.TOOLS) {
      assert.match(t.name, /^pan_[a-z_]+$/);
      assert.ok((t.verb || typeof t.handler === 'function') && t.description && t.inputSchema, `${t.name} well-formed`);
      assert.equal(typeof t.readOnly, 'boolean');
      assert.equal(typeof t.destructive, 'boolean');
    }
    for (const r of reg.RESOURCES) {
      assert.match(r.uri, /^pan:\/\//);
      assert.ok(r.verb && r.name && r.description);
      // A resource's argv tail must be a STATIC array of strings — never a
      // function. A function would mean client input can reach the spawn, which
      // is exactly the property that makes a parameterless resource safe.
      if (r.args !== undefined) {
        assert.ok(Array.isArray(r.args), `${r.uri} args must be an array, not ${typeof r.args}`);
        assert.ok(r.args.every((a) => typeof a === 'string'), `${r.uri} args must be all strings`);
      }
    }
  });

  test('resource URIs are unique (a duplicate would silently shadow in byResourceUri)', () => {
    const uris = reg.RESOURCES.map((r) => r.uri);
    assert.equal(new Set(uris).size, uris.length, `duplicate resource uri in ${uris.join(', ')}`);
  });

  test('tool names are unique (a duplicate would silently shadow in byToolName)', () => {
    const names = reg.TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `duplicate tool name in ${names.join(', ')}`);
  });

  test('no spawn-backed verb exposes a history-rewriting / force git op', () => {
    for (const entry of [...reg.TOOLS, ...reg.RESOURCES]) {
      if (entry.verb) assert.ok(!reg.FORBIDDEN_VERB.test(entry.verb), `verb "${entry.verb}" must not be exposed`);
    }
    // and the guard actually bites
    assert.ok(reg.FORBIDDEN_VERB.test('push'));
    assert.ok(reg.FORBIDDEN_VERB.test('force-push'));
    assert.ok(reg.FORBIDDEN_VERB.test('reset'));
  });

  test('the only destructive tool is the gated merge; all spawn (M1) tools are non-destructive', () => {
    assert.ok(reg.SPAWN_TOOLS.every((t) => t.destructive === false));
    const destructive = reg.TOOLS.filter((t) => t.destructive).map((t) => t.name);
    assert.deepEqual(destructive, ['pan_confirm_merge']);
  });
});

describe('pan-zcode MCP protocol (injected spawn)', () => {
  test('initialize echoes the client protocolVersion and advertises capabilities', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.ok(r.result.capabilities.tools && r.result.capabilities.resources);
    assert.equal(r.result.serverInfo.name, 'pan-mcp');
  });

  test('initialize falls back to the server default protocolVersion when absent', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.match(r.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('initialize with an UNSUPPORTED protocolVersion falls back to a supported one', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
    assert.equal(r.result.protocolVersion, '2025-06-18', 'never claim to speak an unsupported version');
  });

  test('tools/list and resources/list return the full registry with hints', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const tl = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(tl.result.tools.length, reg.TOOLS.length);
    assert.ok(tl.result.tools.every((t) => typeof t.annotations.readOnlyHint === 'boolean'
      && typeof t.annotations.destructiveHint === 'boolean'));
    const rl = s.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    assert.equal(rl.result.resources.length, reg.RESOURCES.length);
    assert.ok(rl.result.resources.every((r) => r.mimeType === 'application/json'));
  });

  test('notifications/initialized returns no response; unknown method errors', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    assert.equal(s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const e = s.handle({ jsonrpc: '2.0', id: 9, method: 'no/such' });
    assert.equal(e.error.code, -32601);
  });

  test('any request-method sent id-less (a notification) gets NO response', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    assert.equal(s.handle({ jsonrpc: '2.0', method: 'ping' }), null);
    assert.equal(s.handle({ jsonrpc: '2.0', method: 'tools/list' }), null);
  });

  test('id=0 is a legal request id (not a notification) at the null boundary', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 0, method: 'ping' });
    assert.equal(r.id, 0);
    assert.deepEqual(r.result, {});
  });

  test('malformed envelope → Invalid Request', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const e = s.handle({ id: 1, method: 'initialize' }); // missing jsonrpc
    assert.equal(e.error.code, -32600);
  });

  test('tools/call routes to the pan-tools verb with --cwd, shell-less argv (JSON, no --raw)', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec, '{"model":"sonnet"}'), panToolsPath: '/x/pan-tools.cjs', cwd: '/proj' });
    const r = s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner' } } });
    assert.equal(r.result.isError, false);
    assert.match(r.result.content[0].text, /sonnet/);
    assert.deepEqual(rec[0], ['/x/pan-tools.cjs', 'resolve-model', 'pan-planner', '--cwd', '/proj']);
  });

  test('unknown tool → JSON-RPC -32602 (bad request), with no spawn', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec) });
    const r = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'pan_delete_everything', arguments: {} } });
    assert.equal(r.error.code, -32602);
    assert.equal(rec.length, 0);
  });

  test('a real tool-execution failure stays in-band as isError:true (not a protocol error)', () => {
    const s = createServer({ spawnImpl: () => ({ ok: false, stdout: '', stderr: 'verb blew up' }) });
    const r = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner' } } });
    assert.equal(r.result.isError, true, 'execution failure is a result, not an error');
    assert.match(r.result.content[0].text, /blew up/);
  });

  test('resources/read routes to the verb; unknown uri and engine failure both error', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec, '{"state":"ok"}') });
    const r = s.handle({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'pan://state' } });
    assert.equal(r.result.contents[0].mimeType, 'application/json');
    assert.equal(rec[0][1], 'state');
    const e = s.handle({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'pan://nope' } });
    assert.equal(e.error.code, -32602);
    // an engine failure is a JSON-RPC error, not a success frame with a stderr string mislabeled application/json
    const s2 = createServer({ spawnImpl: () => ({ ok: false, stdout: '', stderr: 'boom' }) });
    const f = s2.handle({ jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'pan://state' } });
    assert.equal(f.error.code, -32603);
    assert.match(f.error.message, /boom/);
  });
});

describe('pan-zcode MCP dual-era (2026-07-28 stateless spec)', () => {
  const meta = (version) => ({ _meta: { 'io.modelcontextprotocol/protocolVersion': version } });

  test('server/discover returns a DiscoverResult advertising the modern version', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: meta(MODERN_PROTOCOL_VERSION) });
    assert.equal(r.result.resultType, 'complete');
    assert.deepEqual(r.result.supportedVersions, SUPPORTED_VERSIONS_LIST);
    assert.ok(r.result.supportedVersions.includes(MODERN_PROTOCOL_VERSION));
    assert.ok(r.result.capabilities.tools && r.result.capabilities.resources);
    assert.equal(r.result._meta['io.modelcontextprotocol/serverInfo'].name, 'pan-mcp');
    // caching hints per the spec's CacheableResult contract
    assert.equal(typeof r.result.ttlMs, 'number');
    assert.equal(r.result.cacheScope, 'public');
  });

  test('a modern request on a supported version is served and its result carries resultType:complete', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: meta(MODERN_PROTOCOL_VERSION) });
    assert.equal(r.result.resultType, 'complete');
    assert.equal(r.result.tools.length, reg.TOOLS.length);
  });

  test('an unsupported modern version → UnsupportedProtocolVersionError (-32022) listing what we support', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: meta('1900-01-01') });
    assert.equal(r.error.code, -32022);
    assert.deepEqual(r.error.data.supported, SUPPORTED_VERSIONS_LIST);
    assert.equal(r.error.data.requested, '1900-01-01');
  });

  test('legacy requests (no _meta) keep the pre-2026 result shape — NO resultType stamped', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const ping = s.handle({ jsonrpc: '2.0', id: 4, method: 'ping' });
    assert.deepEqual(ping.result, {}, 'legacy ping result is unchanged');
    const tl = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    assert.equal(tl.result.resultType, undefined, 'legacy tools/list carries no resultType');
  });

  test('the legacy initialize handshake never negotiates the modern per-request revision', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 6, method: 'initialize', params: { protocolVersion: MODERN_PROTOCOL_VERSION } });
    assert.notEqual(r.result.protocolVersion, MODERN_PROTOCOL_VERSION,
      'a handshake cannot select a stateless-era version; falls back to a legacy one');
    assert.equal(r.result.protocolVersion, '2025-06-18');
  });

  test('server/discover is reachable by a legacy probe too (no _meta) and still lists modern support', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 7, method: 'server/discover' });
    assert.ok(r.result.supportedVersions.includes(MODERN_PROTOCOL_VERSION));
  });
});

describe('pan-zcode input safety', () => {
  test('malformed agent input is rejected before any spawn', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec) });
    for (const bad of ['a; rm -rf /', 'x && y', '../etc/passwd', '$(whoami)', 'A'.repeat(200), '']) {
      const r = s.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: bad } } });
      assert.equal(r.error.code, -32602, `should reject ${JSON.stringify(bad)} as invalid params`);
    }
    assert.equal(rec.length, 0, 'no spawn ever happened on invalid input');
  });

  test('phase input must be numeric; a valid phase routes verb+subarg literally', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec) });
    const bad = s.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'pan_report_phase', arguments: { phase: '3; ls' } } });
    assert.equal(bad.error.code, -32602);
    const ok = s.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'pan_report_phase', arguments: { phase: '03' } } });
    assert.equal(ok.result.isError, false);
    assert.deepEqual(rec[0].slice(1, 4), ['report', 'phase', '03']);
  });
});

describe('pan-zcode overflow (@file:) protocol', () => {
  test('reads and cleans up an engine-written overflow file under tmpdir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-'));
    const file = path.join(dir, 'out.json');
    fs.writeFileSync(file, '{"big":"payload"}');
    const s = createServer({ spawnImpl: () => ({ ok: true, stdout: '@file:' + file, stderr: '' }) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-x' } } });
    assert.match(r.result.content[0].text, /payload/);
    assert.ok(!fs.existsSync(dir), 'overflow tmp dir cleaned up after read');
  });

  test('refuses an @file: path outside tmpdir or not named out.json (returned unread)', () => {
    const s1 = createServer({ spawnImpl: () => ({ ok: true, stdout: '@file:/etc/passwd', stderr: '' }) });
    const r1 = s1.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-x' } } });
    assert.equal(r1.result.content[0].text, '@file:/etc/passwd', 'path outside tmpdir is not read');
    const oddPath = path.join(os.tmpdir(), 'pan-nope', 'secret.txt');
    const s2 = createServer({ spawnImpl: () => ({ ok: true, stdout: '@file:' + oddPath, stderr: '' }) });
    const r2 = s2.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-x' } } });
    assert.equal(r2.result.content[0].text, '@file:' + oddPath, 'non-out.json basename is not read');
  });
});

describe('every resource is readable on a bare project (the resource/tool rule)', () => {
  // THE INVARIANT: a client may list resources and read them all. On a young or
  // empty project that must yield DATA, not a pile of errors. A verb whose "no
  // data yet" is an error belongs in TOOLS instead (see the rule comment on
  // RESOURCES). This runs the REAL engine — an injected spawn would assert
  // nothing about actual exit codes, which is the whole subject here.
  test('resources/read returns parseable JSON for every registered resource', () => {
    const proj = createTempProject();
    try {
      const s = createServer({ cwd: proj });
      for (const r of reg.RESOURCES) {
        const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: r.uri } });
        assert.ok(!res.error, `${r.uri} failed to read: ${res.error && res.error.message}`);
        const text = res.result.contents[0].text;
        assert.doesNotThrow(() => JSON.parse(text), `${r.uri} did not return JSON: ${String(text).slice(0, 120)}`);
      }
    } finally {
      cleanup(proj);
    }
  });

  test('a multi-word resource verb routes its static subcommand, not a joined string', () => {
    // pan://health is `validate health` — regression guard for the bug shape where
    // a two-word verb is passed as ONE argv element and the engine rejects it.
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec, '{"status":"healthy"}'), panToolsPath: '/x/pt.cjs', cwd: '/proj' });
    const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'pan://health' } });
    assert.ok(!res.error);
    assert.deepEqual(rec[0], ['/x/pt.cjs', 'validate', 'health', '--cwd', '/proj']);
  });

  test('a resource with no args still spawns a bare verb (no undefined in argv)', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec), panToolsPath: '/x/pt.cjs', cwd: '/proj' });
    s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'pan://state' } });
    assert.deepEqual(rec[0], ['/x/pt.cjs', 'state', '--cwd', '/proj']);
    assert.ok(rec[0].every((a) => typeof a === 'string'), 'no undefined leaked into argv');
  });
});

describe('pan-zcode real round-trip (spawns actual pan-tools)', () => {
  test('resolve-model over MCP returns real JSON from the engine', () => {
    const proj = createTempProject();
    try {
      const s = createServer({ panToolsPath: TOOLS_PATH, cwd: proj });
      const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner' } } });
      assert.equal(r.result.isError, false, r.result.content[0].text);
      const payload = JSON.parse(r.result.content[0].text);
      assert.ok(payload.model, 'engine returned a resolved model');
    } finally {
      cleanup(proj);
    }
  });
});
