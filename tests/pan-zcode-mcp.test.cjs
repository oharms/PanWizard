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
const { spawn } = require('child_process');
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

describe('stdio transport — the framing loop a real client actually uses', () => {
  // Every other protocol test calls server.handle(req) directly, so main() — the
  // newline framing loop — had NO test at all: chunk buffering, split frames,
  // blank-line skipping, the -32700 reply to an unparseable line, and the
  // suppression of replies to notifications. It is the only code path a real MCP
  // client touches and the one with the most ways to fail silently, since a
  // dropped response reads to a client as a hung server.
  //
  // main() is not exported (it runs under require.main), so the honest test is
  // the one a client performs: spawn the server and speak to it over stdio.
  const SERVER = path.join(__dirname, '..', 'pan-wizard-core', 'mcp', 'server.cjs');

  /**
   * Feed raw chunks to a spawned server, collect stdout lines, resolve on idle.
   * A hard timeout is mandatory here — an unanswered frame would otherwise hang
   * the whole suite instead of failing this test.
   */
  function speak(chunks, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SERVER], {
        cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`stdio server did not settle in ${timeoutMs}ms. stdout so far: ${out}`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', () => {
        clearTimeout(timer);
        const lines = out.split('\n').filter((l) => l.trim());
        resolve({ lines, raw: out, stderr });
      });
      for (const c of chunks) child.stdin.write(c);
      child.stdin.end();
    });
  }

  const ping = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: {} });

  test('answers a single framed request', async () => {
    const { lines } = await speak([`${ping(1)}\n`]);
    assert.equal(lines.length, 1, `expected exactly one reply, got ${JSON.stringify(lines)}`);
    assert.equal(JSON.parse(lines[0]).id, 1);
  });

  test('handles several requests arriving in ONE chunk', async () => {
    const { lines } = await speak([`${ping(1)}\n${ping(2)}\n${ping(3)}\n`]);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2, 3]);
  });

  test('reassembles a request SPLIT ACROSS chunks (the buffering contract)', async () => {
    // The failure this catches: a loop that parsed per-chunk instead of per-line
    // would emit -32700 here, or drop the request entirely.
    const framed = `${ping(7)}\n`;
    const cut = Math.floor(framed.length / 2);
    const { lines } = await speak([framed.slice(0, cut), framed.slice(cut)]);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).id, 7);
  });

  test('skips blank lines without replying to them', async () => {
    const { lines } = await speak([`\n\n   \n${ping(1)}\n\n`]);
    assert.equal(lines.length, 1, 'blank lines must produce no frames');
    assert.equal(JSON.parse(lines[0]).id, 1);
  });

  test('replies -32700 to an unparseable line and KEEPS GOING', async () => {
    // Continuing matters as much as the code: a transport that dies on one bad
    // frame strands every later request, which a client sees as a hang.
    const { lines } = await speak([`not json at all\n${ping(9)}\n`]);
    assert.equal(lines.length, 2);
    const err = JSON.parse(lines[0]);
    assert.equal(err.error.code, -32700);
    assert.equal(err.id, null);
    assert.equal(JSON.parse(lines[1]).id, 9, 'the server must survive a bad frame');
  });

  test('sends NO reply to a notification (no id), per JSON-RPC', async () => {
    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: {} });
    const { lines } = await speak([`${notification}\n${ping(2)}\n`]);
    assert.equal(lines.length, 1, `a notification must not be answered; got ${JSON.stringify(lines)}`);
    assert.equal(JSON.parse(lines[0]).id, 2);
  });

  test('id 0 is a VALID request id and IS answered', async () => {
    // Guards the classic falsy-id bug: `if (req.id)` would treat 0 as a
    // notification and silently drop a legitimate response.
    const { lines } = await speak([`${ping(0)}\n`]);
    assert.equal(lines.length, 1, 'id 0 must be answered, not treated as a notification');
    assert.equal(JSON.parse(lines[0]).id, 0);
  });

  test('every reply is exactly one line of JSON (no interleaving)', async () => {
    const { raw } = await speak([`${ping(1)}\n${ping(2)}\n`]);
    for (const line of raw.split('\n').filter((l) => l.trim())) {
      assert.doesNotThrow(() => JSON.parse(line), `not one JSON object per line: ${line}`);
    }
  });
});

describe('EVERY spawn-backed tool runs against the REAL engine', () => {
  // WHY: an audit found that exactly ONE tool (pan_resolve_model) ever touched
  // real pan-tools; the other spawn-backed tools were exercised only through an
  // injected fakeSpawn, which asserts the argv the bridge WOULD send and nothing
  // about whether the engine accepts it. That is the precise hole that left
  // pan://roadmap and pan://phases DEAD FROM M1 — each named a bare verb needing
  // a subcommand, and no test ever ran one for real. Resources got a real-engine
  // guard afterwards; tools did not, and tools are the riskier surface because a
  // tool's argv is built from LLM input by an args() function rather than being a
  // static array.
  //
  // Every spawn-backed tool is enumerated from the registry, so a newly added one
  // is covered the day it lands rather than whenever someone remembers.
  test('each spawn tool is invoked for real and returns a usable answer', () => {
    const proj = createTempProject();
    try {
      // Minimal but non-empty project: a roadmap with the checklist shape the
      // shipped template prescribes, so roadmap/preview verbs have real input.
      fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
        '# Roadmap\n\n## Milestone v1\n\n- [ ] **Phase 1: Alpha** - first\n- [ ] **Phase 2: Beta** - second\n');
      fs.mkdirSync(path.join(proj, '.planning', 'phases', '01-alpha'), { recursive: true });

      const s = createServer({ cwd: proj });
      // Valid arguments per tool, keyed by name. A tool with no entry fails the
      // roster check below rather than being silently skipped.
      const ARGS = {
        pan_resolve_model: { agent: 'pan-planner' },
        pan_find_phase: { query: '1' },
        pan_roadmap_analyze: {},
        pan_preview_phases: {},
        pan_preview_phase: { phase: '01' },
        pan_report_phase: { phase: '01' },
      };
      const spawnTools = reg.SPAWN_TOOLS.map((t) => t.name);
      const missing = spawnTools.filter((n) => !(n in ARGS));
      assert.deepEqual(missing, [], `add real-engine arguments for: ${missing.join(', ')}`);

      const failures = [];
      for (const name of spawnTools) {
        const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: ARGS[name] } });
        if (r.error) { failures.push(`${name}: protocol error ${r.error.code} ${r.error.message}`); continue; }
        const text = r.result.content[0].text;
        // isError true means the verb ran and failed — the exact class fakeSpawn
        // cannot see, and what "Unknown <x> subcommand" looked like.
        if (r.result.isError) { failures.push(`${name}: engine rejected it -> ${String(text).slice(0, 120)}`); continue; }
        if (!text || !String(text).trim()) failures.push(`${name}: empty answer`);
      }
      assert.deepEqual(failures, [], `tools the real engine did not accept:\n${failures.join('\n')}`);
    } finally {
      cleanup(proj);
    }
  });

  test('a tool whose verb does not exist is reported as an engine error, not a pass', () => {
    // Proves the check above can actually fail: without this, a bridge that
    // swallowed engine failures would make the whole suite vacuous.
    const proj = createTempProject();
    try {
      const s = createServer({ cwd: proj });
      const r = s.handle({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'pan_resolve_model', arguments: { agent: 'no-such-agent-xyz' } },
      });
      // Either a protocol rejection or an engine error is acceptable; a clean
      // success on a nonsense agent would mean the bridge is not reporting truth.
      const cleanSuccess = !r.error && r.result && r.result.isError === false;
      assert.ok(!cleanSuccess || /error|unknown|invalid/i.test(r.result.content[0].text),
        'a nonsense argument must not read as a clean success');
    } finally {
      cleanup(proj);
    }
  });
});

describe('resources return real data on a project WITH CONTENT (not just a bare one)', () => {
  // The existing guard reads every resource on a BARE project, which proves
  // "readable on a young project" — worth having, and the rule the registry
  // states. What it cannot prove is that a resource returns CORRECT data once
  // there is content: a resource returning {} or a stale shape passes it.
  test('each resource reflects seeded content', () => {
    const proj = createTempProject();
    try {
      fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
        '# Roadmap\n\n## Milestone v1\n\n- [ ] **Phase 1: Alpha** - first\n- [ ] **Phase 2: Beta** - second\n');
      for (const d of ['01-alpha', '02-beta']) {
        fs.mkdirSync(path.join(proj, '.planning', 'phases', d), { recursive: true });
      }
      const s = createServer({ cwd: proj });
      const read = (uri) => JSON.parse(
        s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }).result.contents[0].text);

      // pan://phases must SEE the two phase directories — the concrete claim the
      // bare-project test cannot make, since there it correctly reports zero.
      const ph = read('pan://phases');
      assert.equal(ph.count, 2, `pan://phases should see 2 seeded dirs, got ${JSON.stringify(ph)}`);
      assert.ok(Array.isArray(ph.directories) && ph.directories.length === 2);

      // The rest must still be parseable and non-trivial with content present.
      for (const uri of ['pan://state', 'pan://progress', 'pan://health', 'pan://links', 'pan://cost']) {
        const body = read(uri);
        assert.ok(body && typeof body === 'object' && Object.keys(body).length > 0,
          `${uri} returned an empty object on a seeded project`);
      }
    } finally {
      cleanup(proj);
    }
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

describe('per-call project root — `cwd` on every tool (ADR-0045 D6)', () => {
  // Agent Plugins clients launch a stdio server in the PLUGIN root (spec default),
  // so the process cwd is never the project there. Every TOOL therefore accepts an
  // optional absolute `cwd`, honoured for that call only. Resources stay static.

  test('tools/list advertises `cwd` on every tool, never as required; resources are untouched', () => {
    const s = createServer({ spawnImpl: fakeSpawn([]) });
    const r = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(r.result.tools.length > 0, 'non-vacuity');
    for (const t of r.result.tools) {
      assert.equal(t.inputSchema.properties.cwd.type, 'string', `${t.name} must accept cwd`);
      assert.ok(!(t.inputSchema.required || []).includes('cwd'), `${t.name}: cwd must stay optional`);
      assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: schema stays closed`);
    }
    // The decoration is applied to COPIES — the source descriptors keep their shape.
    for (const t of [...reg.SPAWN_TOOLS, ...reg.NATIVE_TOOLS]) {
      assert.equal((t.inputSchema.properties || {}).cwd, undefined, `${t.name}: source descriptor must not be mutated`);
    }
    for (const res of reg.RESOURCES) assert.ok(!('inputSchema' in res), `${res.uri}: resources take no input`);
  });

  test('a call with cwd spawns the verb against THAT root, with cwd stripped from the tool input', () => {
    const rec = [];
    const given = os.tmpdir(); // exists; is not the server's cwd
    const s = createServer({ spawnImpl: fakeSpawn(rec, '{"model":"x"}'), panToolsPath: '/x/pan-tools.cjs', cwd: '/proj' });
    const r = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner', cwd: given } } });
    assert.equal(r.result.isError, false);
    assert.deepEqual(rec[0], ['/x/pan-tools.cjs', 'resolve-model', 'pan-planner', '--cwd', path.resolve(given)]);
    // And without cwd the server's own root is used, exactly as before.
    s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner' } } });
    assert.deepEqual(rec[1].slice(-2), ['--cwd', '/proj']);
  });

  test('a bad cwd is a bad REQUEST (-32602) and nothing is spawned', () => {
    const rec = [];
    const s = createServer({ spawnImpl: fakeSpawn(rec), cwd: '/proj' });
    const nope = path.join(os.tmpdir(), `pan-cwd-does-not-exist-${process.pid}-${Date.now()}`);
    for (const bad of ['relative/dir', './here', '', 5, nope, 'C:\\x\0y']) {
      const r = s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: { agent: 'pan-planner', cwd: bad } } });
      assert.equal(r.error && r.error.code, -32602, `cwd=${JSON.stringify(bad)} should be rejected`);
      assert.match(r.error.message, /cwd/);
    }
    assert.equal(rec.length, 0, 'no spawn may happen for a rejected root');
  });

  test('validateProjectCwd accepts absolute paths of both platform families and rejects the rest', () => {
    for (const ok of ['/srv/proj', 'C:\\Users\\me\\proj', 'D:/PanTesting/x', '\\\\server\\share\\proj']) {
      assert.equal(reg.validateProjectCwd(ok), ok);
    }
    for (const bad of ['proj', './proj', '../proj', '', 'C:relative', 'a'.repeat(1025), '/x\0']) {
      assert.throws(() => reg.validateProjectCwd(bad), /Invalid "cwd"/, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('native tools receive the per-call root too', () => {
    const tool = reg.byToolName.pan_next_action;
    const original = tool.handler;
    const seen = [];
    tool.handler = (ctx) => { seen.push(ctx); return { json: { ok: true } }; };
    try {
      const s = createServer({ spawnImpl: fakeSpawn([]), cwd: '/proj' });
      const given = os.tmpdir();
      const r = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'pan_next_action', arguments: { state: {}, cwd: given } } });
      assert.equal(r.result.isError, false);
      assert.equal(seen[0].cwd, path.resolve(given));
      assert.equal(seen[0].input.cwd, undefined, 'cwd is the server\'s concern, not the handler\'s input');
      assert.deepEqual(seen[0].input, { state: {} });
      assert.equal(typeof seen[0].gitImpl, 'function', 'a git executor bound to the per-call root is supplied');
    } finally {
      tool.handler = original;
    }
  });

  test('real engine: a server started in one project answers for ANOTHER project when cwd says so', () => {
    // The Agent Plugins scenario in miniature: the server's own cwd is a project
    // with the default profile; the call names a project on the budget profile.
    const home = createTempProject();
    const other = createTempProject();
    try {
      fs.mkdirSync(path.join(other, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(other, '.planning', 'config.json'), JSON.stringify({ model_profile: 'budget' }));
      const s = createServer({ cwd: home });
      const call = (args) => s.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'pan_resolve_model', arguments: args } });
      const viaHome = call({ agent: 'pan-verifier' });
      const viaOther = call({ agent: 'pan-verifier', cwd: other });
      assert.equal(viaHome.result.isError, false, viaHome.result.content[0].text);
      assert.equal(viaOther.result.isError, false, viaOther.result.content[0].text);
      const a = JSON.parse(viaHome.result.content[0].text);
      const b = JSON.parse(viaOther.result.content[0].text);
      assert.ok(a.model && b.model, 'both calls resolve a model');
      assert.notEqual(b.model, a.model, `the budget project must resolve differently (home=${a.model}, other=${b.model})`);
    } finally {
      cleanup(home); cleanup(other);
    }
  });
});
