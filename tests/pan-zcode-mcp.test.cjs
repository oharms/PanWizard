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
const { createServer } = require('../pan-zcode/mcp/server.cjs');
const reg = require('../pan-zcode/mcp/tool-registry.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

// A fake spawn that records the argv it was handed and returns canned stdout.
function fakeSpawn(recorder, out = '{"ok":true}') {
  return (args) => { recorder.push(args); return { ok: true, stdout: out, stderr: '' }; };
}

describe('pan-zcode registry', () => {
  test('every tool has name/verb/description/inputSchema and boolean hints', () => {
    for (const t of reg.TOOLS) {
      assert.match(t.name, /^pan_[a-z_]+$/);
      assert.ok(t.verb && t.description && t.inputSchema, `${t.name} well-formed`);
      assert.equal(typeof t.readOnly, 'boolean');
      assert.equal(typeof t.destructive, 'boolean');
    }
    for (const r of reg.RESOURCES) {
      assert.match(r.uri, /^pan:\/\//);
      assert.ok(r.verb && r.name && r.description);
    }
  });

  test('no tool or resource exposes a history-rewriting / force git verb', () => {
    for (const entry of [...reg.TOOLS, ...reg.RESOURCES]) {
      assert.ok(!reg.FORBIDDEN_VERB.test(entry.verb), `verb "${entry.verb}" must not be exposed`);
    }
    // and the guard actually bites
    assert.ok(reg.FORBIDDEN_VERB.test('push'));
    assert.ok(reg.FORBIDDEN_VERB.test('force-push'));
    assert.ok(reg.FORBIDDEN_VERB.test('reset'));
  });

  test('no M1 tool is destructive (gated mutators arrive in M2)', () => {
    assert.ok(reg.TOOLS.every((t) => t.destructive === false));
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
