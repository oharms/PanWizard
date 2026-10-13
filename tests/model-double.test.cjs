/**
 * harness/src/model-double.cjs — the local model double (program H1).
 *
 * Each protocol's reply is what its client parses (Anthropic Messages SSE and JSON,
 * OpenAI Responses and Chat, Gemini); the script keys turns on the tools a request
 * offers and on its system prompt; captures strip credentials; replay reports drift for
 * an unrecorded request; record proxies to an upstream and keeps the pairs. Then the
 * `wire:` assertions, the scenario rules for double-backed steps, and the whole-body
 * check that turns a truncated agent red.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('../harness/src/model-double.cjs');
const { checkOne } = require('../harness/src/assert.cjs');
const { validateScenario, loadScenarios } = require('../harness/src/scenario.cjs');
const { runDoubledModelStep } = require('../harness/src/model.cjs');
const { cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
};
const sseEvents = (text) => text.split('\n\n').filter(Boolean).map((block) => {
  const data = block.split('\n').find((l) => l.startsWith('data: '));
  return data && data !== 'data: [DONE]' ? JSON.parse(data.slice(6)) : null;
}).filter(Boolean);

const SCRIPT = {
  rules: [
    { when: { toolsInclude: ['Agent', 'Task'] }, turns: [{ tool: { name: ['Agent', 'Task'], input: { subagent_type: 'pan-executor' } } }, { text: 'MAIN-DONE' }] },
    { when: { systemIncludes: 'You are a PAN plan executor' }, turns: [{ text: 'EXECUTOR-DONE' }] },
  ],
  fallback: { text: 'fallback' },
};

describe('model double — protocols', () => {
  test('Anthropic: a streamed tool turn the client can assemble, then the next text turn, then the fallback', async () => {
    const d = await D.startDouble({ mode: 'script', script: SCRIPT });
    try {
      const req = { model: 'm', stream: true, system: 'main', tools: [{ name: 'Read' }, { name: 'Agent' }], messages: [{ role: 'user', content: 'go' }] };
      const first = await post(`${d.url}/v1/messages?beta=true`, req, { 'x-api-key': 'k' });
      assert.match(first.type, /text\/event-stream/);
      const ev = sseEvents(first.text);
      const start = ev.find((e) => e.type === 'content_block_start');
      assert.deepEqual([start.content_block.type, start.content_block.name], ['tool_use', 'Agent'], 'the first offered name of the list');
      const delta = ev.find((e) => e.type === 'content_block_delta');
      assert.deepEqual(JSON.parse(delta.delta.partial_json), { subagent_type: 'pan-executor' });
      assert.equal(ev.find((e) => e.type === 'message_delta').delta.stop_reason, 'tool_use');
      const second = sseEvents((await post(`${d.url}/v1/messages`, req)).text);
      assert.equal(second.find((e) => e.type === 'content_block_delta').delta.text, 'MAIN-DONE');
      const third = sseEvents((await post(`${d.url}/v1/messages`, req)).text);
      assert.equal(third.find((e) => e.type === 'content_block_delta').delta.text, 'MAIN-DONE', 'a spent rule repeats its last turn');
      const sub = await post(`${d.url}/v1/messages`, { model: 'm', system: [{ type: 'text', text: 'You are a PAN plan executor.' }], tools: [{ name: 'Read' }], messages: [] });
      assert.equal(JSON.parse(sub.text).content[0].text, 'EXECUTOR-DONE', 'non-stream JSON, keyed by the system prompt');
      const other = await post(`${d.url}/v1/messages`, { model: 'm', system: 'a classifier', messages: [] });
      assert.equal(JSON.parse(other.text).content[0].text, 'fallback');
      assert.equal(d.captures[0].headers['x-api-key'], '<stripped>', 'credentials never reach a capture');
    } finally { await d.close(); }
  });

  test('OpenAI Responses and Chat, streamed and not', async () => {
    const d = await D.startDouble({ mode: 'script', script: { rules: [], fallback: { text: 'hi' } } });
    try {
      const resp = sseEvents((await post(`${d.url}/v1/responses`, { model: 'gpt', stream: true, instructions: 'x', input: [] })).text);
      assert.equal(resp.find((e) => e.type === 'response.output_text.delta').delta, 'hi');
      assert.equal(resp.find((e) => e.type === 'response.completed').response.status, 'completed');
      const flat = JSON.parse((await post(`${d.url}/v1/responses`, { model: 'gpt', input: [] })).text);
      assert.equal(flat.output[0].content[0].text, 'hi');
      const chat = sseEvents((await post(`${d.url}/v1/chat/completions`, { model: 'gpt', stream: true, messages: [{ role: 'system', content: 's' }] })).text);
      assert.equal(chat[0].choices[0].delta.content, 'hi');
      assert.equal(chat[1].choices[0].finish_reason, 'stop');
    } finally { await d.close(); }
  });

  test('OpenAI tool calls and Gemini function calls', async () => {
    const d = await D.startDouble({ mode: 'script', script: { rules: [{ when: {}, turns: [{ tool: { name: 'shell', input: { cmd: 'ls' } } }] }] } });
    try {
      const r = JSON.parse((await post(`${d.url}/v1/responses`, { model: 'gpt', tools: [{ type: 'function', name: 'shell' }], input: [] })).text);
      assert.deepEqual([r.output[0].type, r.output[0].name, JSON.parse(r.output[0].arguments).cmd], ['function_call', 'shell', 'ls']);
      const c = JSON.parse((await post(`${d.url}/v1/chat/completions`, { model: 'gpt', tools: [{ type: 'function', function: { name: 'shell' } }], messages: [] })).text);
      assert.equal(c.choices[0].finish_reason, 'tool_calls');
      const g = JSON.parse((await post(`${d.url}/v1beta/models/gemini:generateContent`, { contents: [], tools: [{ functionDeclarations: [{ name: 'shell' }] }] })).text);
      assert.deepEqual(g.candidates[0].content.parts[0].functionCall, { name: 'shell', args: { cmd: 'ls' } });
      assert.match((await post(`${d.url}/v1beta/models/gemini:streamGenerateContent?alt=sse`, { contents: [] })).text, /^data: \{/);
    } finally { await d.close(); }
  });

  test('non-model paths get an empty 200, and are captured without a protocol', async () => {
    const d = await D.startDouble({});
    try {
      const r = await fetch(`${d.url}/api/hello`, { method: 'HEAD' });
      assert.equal(r.status, 200);
      assert.equal(d.captures[0].protocol, null);
    } finally { await d.close(); }
  });
});

describe('model double — replay and record', () => {
  test('replay answers a recorded request and reports any other as drift', async () => {
    const body = { model: 'm', system: 'executor body v1', messages: [{ role: 'user', content: 'x' }] };
    const key = D.requestKey('anthropic', body);
    const d = await D.startDouble({ mode: 'replay', cassette: [{ key, status: 200, contentType: 'application/json', response: '{"recorded":true}' }] });
    try {
      assert.equal((await post(`${d.url}/v1/messages`, body)).text, '{"recorded":true}');
      const changed = await post(`${d.url}/v1/messages`, { ...body, system: 'executor body v2' });
      assert.equal(changed.status, 400, 'an error the clients do not retry');
      assert.match(changed.text, /cassette drift/);
      assert.equal(d.drift.length, 1);
      assert.match(d.drift[0].system, /v2/);
    } finally { await d.close(); }
  });

  test('record proxies to the upstream and keeps the pair a replay can serve', async () => {
    const upstream = await D.startDouble({ mode: 'script', script: { rules: [], fallback: { text: 'from upstream' } } });
    const rec = await D.startDouble({ mode: 'record', upstream: upstream.url });
    try {
      const body = { model: 'm', system: 's', messages: [] };
      const r = await post(`${rec.url}/v1/messages`, body, { 'x-api-key': 'k' });
      assert.equal(JSON.parse(r.text).content[0].text, 'from upstream');
      assert.equal(rec.recorded.length, 1);
      const replay = await D.startDouble({ mode: 'replay', cassette: rec.recorded });
      try {
        assert.equal(JSON.parse((await post(`${replay.url}/v1/messages`, body)).text).content[0].text, 'from upstream');
      } finally { await replay.close(); }
    } finally { await rec.close(); await upstream.close(); }
  });
});

describe('wire assertions and the scenario rules', () => {
  const o = { captures: [{ protocol: 'anthropic', system: 'executor TAIL', tools: ['Read', 'Write'], url: '/v1/messages' }, { protocol: null, url: '/api/hello', system: '', tools: [] }] };

  test('wire: and wire-count: pass and fail', () => {
    assert.equal(checkOne('wire:system~TAIL', o, '.'), null);
    assert.match(checkOne('wire:system~MISSING', o, '.'), /no request to the model double/);
    assert.equal(checkOne('wire-count:tools~Write=1', o, '.'), null);
    assert.match(checkOne('wire-count:url~messages=2', o, '.'), /1 request\(s\)/);
    assert.match(checkOne('wire:system~x', { stdout: '' }, '.'), /no model-double captures/);
  });

  test('a double-backed model step is tier 0; a malformed double is refused; it does not make a tier-1 scenario', () => {
    const step = { kind: 'model', prompt: 'p', double: { script: { rules: [{ when: {}, turns: [{ text: 'x' }] }] } }, expect: ['exit:0', 'wire:system~x'], why: 'w' };
    const base = { id: 'x', tier: 0, description: 'd', why: 'w', steps: [step, { kind: 'fs', expect: ['file:a'], why: 'w' }], controls: [{ id: 'c', delete: 'a', why: 'w' }] };
    assert.deepEqual(validateScenario(base), []);
    assert.ok(validateScenario({ ...base, steps: [{ ...step, double: { script: {} } }, base.steps[1]] }).length);
    assert.ok(validateScenario({ ...base, tier: 1 }).some((e) => /tier ≥1 scenario should contain a model step/.test(e)));
  });

  test('the shipped double scenario validates and carries its truncation control', () => {
    const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'double-executor-body-claude');
    assert.equal(s.tier, 0);
    assert.ok(s.steps[0].double);
    assert.equal(s.controls[0].id, 'truncated-agent');
  });

  test('a host the double cannot stand in for yet is refused, never run', () => {
    const r = runDoubledModelStep(os.tmpdir(), 'p', { runtime: 'copilot', script: {}, capturesDir: path.join(os.tmpdir(), 'x'), configDir: path.join(os.tmpdir(), 'y') });
    assert.equal(r.refused, true);
    assert.match(r.stderr, /takes no model base URL/);
  });
});

describe('CI runs the double-backed scenario, never skips it (CI1)', () => {
  const { unmetRuns, parseArgs } = require('../harness/src/run.cjs');

  test('--require-run: a skipped or unselected scenario is a run-level failure with its reason', () => {
    assert.deepEqual(parseArgs(['--require-run', 'a', '--require-run', 'b']).requireRun, ['a', 'b']);
    const out = unmetRuns([{ scenario: 'a', status: 'passed' }, { scenario: 'b', status: 'skipped', skipped: 'claude not installed on this machine' }, { scenario: 'c', status: 'failed' }], ['a', 'b', 'c', 'd']);
    assert.deepEqual(out.map((f) => f.scenario), ['b', 'd']);
    assert.match(out[0].failure, /claude not installed/);
    assert.match(out[1].failure, /not selected/);
    assert.ok(out.every((f) => f.step === 'require-run'));
  });

  test('the CI harness job installs a pinned Claude Code and requires the double scenario to run', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(ci, /npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+\b/, 'pinned to an exact version');
    assert.match(ci, /npm run harness -- --no-ledger --require-run double-executor-body-claude/);
    assert.ok(ci.indexOf('@anthropic-ai/claude-code@') < ci.indexOf('--require-run double-executor-body-claude'), 'installed before the harness runs');
  });

  test('a run-level failure (a survived control, an unmet --require-run) makes the harness exit 1', () => {
    const src = fs.readFileSync(path.join(ROOT, 'harness', 'src', 'run.cjs'), 'utf8');
    assert.match(src, /return \(failed \|\| errors \|\| runLevel\) \? 1 : 0;/);
    assert.match(src, /f\.step === 'control' \|\| f\.step === 'require-run'/);
  });
});

describe('wire-agent-body.cjs — the whole body, or not', () => {
  const SCRIPT_PATH = path.join(ROOT, 'harness', 'scripts', 'wire-agent-body.cjs');
  const run = (caps, src) => JSON.parse(spawnSync(process.execPath, [SCRIPT_PATH, caps, src], { encoding: 'utf8' }).stdout);

  test('whole when every body line arrives (after the installer\'s path and pan-tools rewrites); not when one is cut', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-wire-'));
    try {
      const src = path.join(dir, 'pan-x.md');
      fs.writeFileSync(src, '---\nname: pan-x\n---\n\nRead ~/.claude/pan-wizard-core/x.md first.\nRun `pan-tools state json`.\nThe last line.\n');
      const caps = path.join(dir, 'caps');
      fs.mkdirSync(caps);
      const sent = 'You are pan-x.\nRead ./.claude/pan-wizard-core/x.md first.\nRun `node ./.claude/pan-wizard-core/bin/pan-tools.cjs state json`.\nThe last line.\n';
      fs.writeFileSync(path.join(caps, '001.json'), JSON.stringify({ n: 1, protocol: 'anthropic', system: sent }));
      assert.deepEqual([run(caps, src).whole, run(caps, src).missing], [true, 0]);
      fs.writeFileSync(path.join(caps, '001.json'), JSON.stringify({ n: 1, protocol: 'anthropic', system: sent.replace('The last line.\n', '') }));
      const cut = run(caps, src);
      assert.deepEqual([cut.whole, cut.missing, cut.firstMissing], [false, 1, ['The last line.']]);
    } finally { cleanup(dir); }
  });
});

describe('cassettes: replay at $0, drift as prompt impact (H2)', () => {
  const { driftNote, unmetRuns, parseArgs } = require('../harness/src/run.cjs');
  const CASSETTE = path.join(ROOT, 'harness', 'cassettes', 'executor-spawn-claude.json');

  test('an agent request keys on the agent lines it carries, across runs and machines; an edit to them moves it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-key-'));
    try {
      const rules = ['You are pan-x, the executor of PAN plans.', 'Write your notes under the memory dir you are given.', 'Short line.'];
      const writeAgent = (extra = []) => fs.writeFileSync(path.join(dir, 'pan-x.md'), ['---', 'name: pan-x', '---', ...rules, ...extra, ''].join('\n'));
      const sys = (ws, home, slug, sep, eol, hostProse, extra = []) => [
        `x-anthropic-billing-header: cc_version=1; id=${Math.random()}`,
        'You are a Claude agent.',
        ...hostProse,
        `Memory lives at \`${home}${sep}projects${sep}${slug}${sep}memory\`.`,
        'Session 0b8e9c2a-1f3d-4e5a-9b7c-123456789abc, today 2026-10-13.',
        ...rules, ...extra,
      ].join(eol);
      const win = D.makeNormaliser({ ws: 'D:\\runs\\a\\ws', home: 'D:\\runs\\a\\double-0-home' });
      const nix = D.makeNormaliser({ ws: '/tmp/runs/b/ws', home: '/tmp/runs/b/double-0-home' });
      const body = (system) => ({ model: 'm', system, messages: [{ role: 'user', content: 'p' }] });
      writeAgent();
      const agents = D.loadAgents(dir);
      const a = D.requestKey('anthropic', body(sys('D:\\runs\\a\\ws', 'D:\\runs\\a\\double-0-home', 'D--runs-a-ws', '\\', '\r\n', ['A paragraph this host adds on Windows.'])), win, agents);
      const b = D.requestKey('anthropic', body(sys('/tmp/runs/b/ws', '/tmp/runs/b/double-0-home', '-tmp-runs-b-ws', '/', '\n', [])), nix, agents);
      assert.equal(a, b, 'paths, slugs, line endings, the billing line, uuids, dates and the host\'s own prose do not move the key');
      writeAgent(['Restate the objective.']);
      const edited = D.requestKey('anthropic', body(sys('/tmp/runs/b/ws', '/tmp/runs/b/double-0-home', '-tmp-runs-b-ws', '/', '\n', [], ['Restate the objective.'])), nix, D.loadAgents(dir));
      assert.notEqual(edited, b, 'a one-line agent edit (even a short line) moves it');
    } finally { cleanup(dir); }
  });

  test('a host request keys on its opening line', () => {
    const key = (system) => D.requestKey('anthropic', { model: 'm', system, messages: [] });
    assert.equal(key('x-anthropic-billing-header: a\nYou are a classifier.\nRule one.'), key('x-anthropic-billing-header: b\nYou are a classifier.\nRule one, reworded by the host.'));
    assert.notEqual(key('You are a classifier.'), key('You are a Claude agent.'));
  });

  test('the key counts turns, not the text of tool results', () => {
    const turn = (result, extra = []) => ({ model: 'm', system: 's', messages: [{ role: 'user', content: 'p' }, { role: 'assistant', content: 'a' }, { role: 'user', content: result }, ...extra] });
    assert.equal(D.requestKey('anthropic', turn('agent launched in 41ms')), D.requestKey('anthropic', turn('agent launched in 77ms, id 9')));
    assert.notEqual(D.requestKey('anthropic', turn('r')), D.requestKey('anthropic', turn('r', [{ role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }])));
  });

  test('drift is attributed to the agent whose body the request carries, or to none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-drift-'));
    try {
      fs.writeFileSync(path.join(dir, 'pan-a.md'), '---\nname: pan-a\n---\nThe first rule of agent A is a long line.\nThe second rule of agent A is a long line.\n');
      fs.writeFileSync(path.join(dir, 'pan-b.md'), '---\r\nname: pan-b\r\n---\r\nThe first rule of agent B is a long line.\r\nThe second rule of agent B is a long line.\r\n');
      assert.deepEqual(D.attributeDrift('preamble\nThe first rule of agent B is a long line.\nThe second rule of agent B is a long line.\nAn edit.', dir), { agent: 'pan-b', file: 'agents/pan-b.md', share: 1 });
      assert.equal(D.attributeDrift('You are the main session.', dir), null);
      assert.equal(D.attributeDrift('anything', path.join(dir, 'absent')), null);
    } finally { cleanup(dir); }
  });

  test('drift:none and drift:<agent> pass and fail', () => {
    const exec = { agent: 'pan-executor', file: 'agents/pan-executor.md', share: 1 };
    assert.equal(checkOne('drift:none', { drift: [] }, '.'), null);
    assert.match(checkOne('drift:none', { drift: [{ attributed: exec }] }, '.'), /1 drifted request/);
    assert.equal(checkOne('drift:^pan-executor$', { drift: [{ attributed: exec }] }, '.'), null);
    assert.match(checkOne('drift:^pan-executor$', { drift: [] }, '.'), /no drift/);
    assert.match(checkOne('drift:^pan-executor$', { drift: [{ attributed: exec }, { attributed: null }] }, '.'), /unattributed/);
    assert.match(checkOne('drift:none', { stdout: '' }, '.'), /no model-double replay/);
  });

  test('unexpected drift is a note naming the agent, never a finding; an expected one is an assertion', () => {
    const outcome = { doubled: true, drift: [{ key: 'k', attributed: { agent: 'pan-executor', file: 'agents/pan-executor.md', share: 1 } }, { key: 'k2', attributed: null }] };
    const note = driftNote({ kind: 'model', double: { cassette: 'c' }, expect: ['exit:0'] }, outcome);
    assert.match(note, /prompt impact/);
    assert.match(note, /pan-executor \(agents\/pan-executor\.md\)/);
    assert.match(note, /1 unattributed/);
    assert.match(note, /--record/);
    assert.equal(driftNote({ kind: 'model', double: {}, expect: ['drift:^pan-executor$'] }, outcome), null);
    assert.equal(driftNote({ kind: 'model', double: {}, expect: [] }, { doubled: true, drift: [] }), null);
    assert.equal(driftNote({ kind: 'sh', expect: [] }, outcome), null);
    assert.deepEqual(unmetRuns([{ scenario: 's', status: 'drift' }], ['s']), [], 'a drifted scenario ran');
  });

  test('--record re-records a step that carries a synthetic recipe; a real-model recording is refused', () => {
    assert.equal(parseArgs(['--record']).record, true);
    assert.notEqual(parseArgs([]).record, true);
    const r = runDoubledModelStep(os.tmpdir(), 'p', { double: { cassette: 'c.json', record: { upstream: 'https://api.anthropic.com' } }, capturesDir: path.join(os.tmpdir(), 'x'), configDir: path.join(os.tmpdir(), 'y') });
    assert.equal(r.refused, true);
    assert.match(r.stderr, /recording from a real model/);
  });

  test('scenario rules: a cassette step, a synthetic recipe, and what is refused', () => {
    const step = (double, expect = ['exit:0', 'drift:none']) => ({ kind: 'model', prompt: 'p', double, expect, why: 'w' });
    const scen = (st) => ({ id: 'x', tier: 0, description: 'd', why: 'w', steps: [st, { kind: 'fs', expect: ['file:a'], why: 'w' }], controls: [{ id: 'c', delete: 'a', why: 'w' }] });
    const recipe = { script: { rules: [{ when: {}, turns: [{ text: 'x' }] }] } };
    assert.deepEqual(validateScenario(scen(step({ cassette: '<repo>/c.json' }))), []);
    assert.deepEqual(validateScenario(scen(step({ cassette: '<repo>/c.json', record: recipe }, ['drift:^pan-executor$']))), []);
    assert.ok(validateScenario(scen(step({ record: recipe }))).some((e) => /record needs a cassette/.test(e)));
    assert.ok(validateScenario(scen(step({ cassette: 'c', record: { upstream: 'https://x' } }))).some((e) => /real model/.test(e)));
    assert.ok(validateScenario(scen(step({ cassette: 'c', script: recipe.script }))).some((e) => /either a script or a cassette/.test(e)));
  });

  test('the committed cassette is synthetic: no prompt text, no credentials, only keyed replies', () => {
    const pairs = JSON.parse(fs.readFileSync(CASSETTE, 'utf8'));
    assert.ok(pairs.length > 0);
    for (const p of pairs) {
      assert.deepEqual(Object.keys(p).sort(), ['contentType', 'key', 'protocol', 'response', 'status']);
      assert.match(p.key, /^[0-9a-f]{16}$/);
    }
    assert.doesNotMatch(fs.readFileSync(CASSETTE, 'utf8'), /x-api-key|authorization|sk-ant-|You are /i);
  });

  test('the shipped cassette scenario replays green, then expects drift for exactly the edited agent', () => {
    const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'cassette-drift-claude');
    assert.equal(s.tier, 0);
    const models = s.steps.filter((st) => st.kind === 'model');
    assert.equal(models.length, 2);
    for (const m of models) assert.equal(m.double.cassette, '<repo>/harness/cassettes/executor-spawn-claude.json');
    assert.ok(models[0].expect.includes('drift:none'));
    assert.ok(models[1].expect.includes('drift:^pan-executor$'));
    assert.ok(models[0].double.record && models[0].double.record.script, 'the synthetic recipe the cassette is re-recorded from');
    assert.match(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'), /--require-run cassette-drift-claude/, 'CI runs it, never skips it');
  });
});
