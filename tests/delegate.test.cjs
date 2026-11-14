/**
 * Tests for delegate.cjs — local executor offload (ADR-0053): the guard rails on what
 * the local model may touch, its tool loop against a scripted model, and the
 * `pan-tools delegate status|run` CLI against a fake OpenAI-compatible server.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'delegate.cjs'));
const { buildConfigDefaults } = require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'config.cjs'));
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let dir;
let home;
const write = (rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const setConfig = (local) => write('.planning/config.json', JSON.stringify({ local_executor: local }, null, 2));
const cfgFor = (over = {}) => ({ ...D.readLocalConfig(dir, { home }), enabled: true, model: 'qwen-test', ...over });

// The CLI runs as a child while the fake server answers in this process, so the child
// must not block the event loop: execFile, not spawnSync.
const tools = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [TOOLS, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, HOME: home, USERPROFILE: home } }, (err, stdout) => {
    const text = String(stdout || '').trim();
    resolve({ status: err ? err.code : 0, json: text.startsWith('{') ? JSON.parse(text) : null, stdout: text });
  });
});

/** A fetch that answers chat requests from a script of assistant messages. */
function scriptedFetch(script, seen = []) {
  let i = 0;
  return async (url, init) => {
    seen.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    const message = script[Math.min(i++, script.length - 1)];
    const payload = { choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
  };
}
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const say = (...calls) => ({ role: 'assistant', content: '', tool_calls: calls });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-delegate-')));
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-delegate-home-')));
  write('src/keep.js', 'module.exports = 1;\n');
  write('tests/t.test.js', "require('node:assert').equal(require('../src/add.js').add(2, 3), 5);\n");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe('config', () => {
  test('config-ensure-section defaults carry local_executor, switched off', () => {
    const d = buildConfigDefaults(false, {});
    assert.equal(d.local_executor.enabled, false);
    assert.equal(d.local_executor.endpoint, 'http://127.0.0.1:11434/v1');
    assert.equal(d.local_executor.allow_remote, false);
    assert.equal(d.local_executor.max_rounds, 3);
  });

  test('a user default merges into the section instead of replacing it', () => {
    const d = buildConfigDefaults(false, { local_executor: { model: 'm' } });
    assert.equal(d.local_executor.model, 'm');
    assert.equal(d.local_executor.max_turns, 25);
  });

  test('readLocalConfig falls back to the defaults and ignores bad values', () => {
    assert.equal(D.readLocalConfig(dir, { home }).enabled, false);
    setConfig({ enabled: 'yes', max_turns: -4, endpoint: 'http://localhost:1234/v1/', model: ' m ' });
    const c = D.readLocalConfig(dir, { home });
    assert.equal(c.enabled, false, 'only the boolean true enables it');
    assert.equal(c.max_turns, 25);
    assert.equal(c.endpoint, 'http://localhost:1234/v1');
    assert.equal(c.model, 'm');
  });
});

describe('guard rails', () => {
  test('isLoopbackHost accepts only this machine', () => {
    for (const h of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '[::1]']) assert.equal(D.isLoopbackHost(h), true, h);
    for (const h of ['10.0.0.5', '192.168.1.20', 'ai.office.lan', 'example.com', '']) assert.equal(D.isLoopbackHost(h), false, h);
  });

  test('a remote endpoint is refused unless allow_remote', () => {
    assert.equal(D.endpointProblem({ endpoint: 'http://ai.office.lan:4000/v1', allow_remote: false }), 'endpoint_not_local');
    assert.equal(D.endpointProblem({ endpoint: 'http://ai.office.lan:4000/v1', allow_remote: true }), null);
    assert.equal(D.endpointProblem({ endpoint: 'file:///etc/passwd', allow_remote: true }), 'endpoint_invalid');
    assert.equal(D.endpointProblem({ endpoint: 'http://127.0.0.1:11434/v1', allow_remote: false }), null);
  });

  test('confine refuses traversal and a symlink that leaves the project', (t) => {
    assert.throws(() => D.confine(dir, '../outside.txt'), /outside the project/);
    assert.throws(() => D.confine(dir, '/etc/hosts'), /outside the project/);
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-delegate-out-')));
    try {
      try { fs.symlinkSync(outside, path.join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
      catch (e) { if (e.code === 'EPERM') { t.skip('no permission to create a link here'); return; } throw e; }
      assert.throws(() => D.confine(dir, 'link/new.js'), /outside the project/);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    assert.equal(D.confine(dir, 'src/new/file.js').rel, 'src/new/file.js');
  });

  test('--allow refuses the root, .git and the planning tree, and keeps directory entries', () => {
    assert.throws(() => D.parseAllow(dir, '.', '.planning'), /project root or \.git/);
    assert.throws(() => D.parseAllow(dir, '.git/config', '.planning'), /project root or \.git/);
    assert.throws(() => D.parseAllow(dir, '.planning/state.md', '.planning'), /planning tree/);
    assert.deepEqual(D.parseAllow(dir, 'src/a.js, src/lib/', '.planning'), ['src/a.js', 'src/lib/']);
    assert.equal(D.writeAllowed('src/lib/x.js', ['src/lib/']), true);
    assert.equal(D.writeAllowed('src/libx.js', ['src/lib/']), false);
  });

  test('the model cannot write outside --allow or read .git and sensitive files', () => {
    write('.env', 'SECRET=1\n');
    fs.mkdirSync(path.join(dir, '.git'));
    const ctx = {
      root: dir, cfg: cfgFor(), allow: ['src/add.js'], verify: '',
      files_changed: new Set(), files_read: new Set(), refused_writes: new Set(), verify_runs: 0, finished: null,
    };
    assert.match(D.executeTool(ctx, 'write_file', { path: 'src/keep.js', content: 'x' }), /^Refused/);
    assert.equal(fs.readFileSync(path.join(dir, 'src/keep.js'), 'utf-8'), 'module.exports = 1;\n');
    assert.deepEqual([...ctx.refused_writes], ['src/keep.js']);
    assert.match(D.executeTool(ctx, 'read_file', { path: '.env' }), /sensitive-file pattern/);
    assert.match(D.executeTool(ctx, 'read_file', { path: '.git/config' }), /\.git is not available/);
    assert.match(D.executeTool(ctx, 'read_file', { path: '../x' }), /outside the project/);
    assert.match(D.executeTool(ctx, 'write_file', { path: 'src/add.js', content: 'ok' }), /^Wrote src\/add\.js/);
    assert.deepEqual([...ctx.files_changed], ['src/add.js']);
    assert.doesNotMatch(D.executeTool(ctx, 'list_files', { path: '.' }), /\.git\//);
  });
});

describe('runLocalTask', () => {
  const ADD = "module.exports = { add: (a, b) => a + b };\n";
  const run = (script, over = {}) => D.runLocalTask({
    root: dir, cfg: cfgFor(over.cfg), spec: 'Add add(a, b).', allow: ['src/add.js'],
    verify: over.verify === undefined ? `"${process.execPath}" tests/t.test.js` : over.verify,
    fetchImpl: scriptedFetch(script, over.seen),
  });

  test('a task the model writes, verifies and finishes is done, and the final verify is our own run', async () => {
    const seen = [];
    const r = await run([
      say(call('read_file', { path: 'tests/t.test.js' })),
      say(call('write_file', { path: 'src/add.js', content: ADD })),
      say(call('run_verify', {})),
      say(call('finish', { status: 'done', summary: 'added add()' })),
    ], { seen });
    assert.equal(r.status, 'done');
    assert.equal(r.stop_reason, 'finish');
    assert.deepEqual(r.files_changed, ['src/add.js']);
    assert.equal(r.verify.passed, true);
    assert.equal(r.report, 'added add()');
    assert.equal(r.turns, 4);
    assert.deepEqual(r.usage, { prompt_tokens: 40, completion_tokens: 20 });
    assert.equal(seen[0].body.model, 'qwen-test');
    assert.deepEqual(seen[0].body.tools.map((t) => t.function.name), ['list_files', 'read_file', 'write_file', 'run_verify', 'finish']);
    assert.match(seen[0].url, /\/chat\/completions$/);
  });

  test('a "done" claim whose verification fails is failed_verify', async () => {
    const r = await run([
      say(call('write_file', { path: 'src/add.js', content: "module.exports = { add: (a, b) => a - b };\n" })),
      say(call('finish', { status: 'done', summary: 'looks fine' })),
    ]);
    assert.equal(r.status, 'failed_verify');
    assert.equal(r.verify.passed, false);
    assert.notEqual(r.verify.exit_code, 0);
  });

  test('blocked is reported as blocked', async () => {
    const r = await run([say(call('finish', { status: 'blocked', summary: 'the spec contradicts the test' }))]);
    assert.equal(r.status, 'blocked');
    assert.equal(r.report, 'the spec contradicts the test');
  });

  test('a model that never finishes stops at max_turns as incomplete', async () => {
    const r = await run([say(call('list_files', { path: '.' }))], { cfg: { max_turns: 3 } });
    assert.equal(r.status, 'incomplete');
    assert.equal(r.turns, 3);
    assert.equal(r.stop_reason, 'turn_limit');
  });

  test('two replies with no tool call stop the run instead of spinning', async () => {
    const r = await run([{ role: 'assistant', content: 'I think it is done.' }]);
    assert.equal(r.status, 'incomplete');
    assert.equal(r.stop_reason, 'no_tool_call');
    assert.equal(r.turns, 2);
  });

  test('malformed tool arguments are counted and answered, not fatal', async () => {
    const bad = { id: 'x', type: 'function', function: { name: 'write_file', arguments: '{not json' } };
    const r = await run([say(bad), say(call('finish', { status: 'blocked', summary: 'gave up' }))], { verify: '' });
    assert.equal(r.malformed_calls, 1);
    assert.equal(r.status, 'blocked');
  });

  test('local_executor.api_key_env sends the named variable as a bearer token, and nothing when unset', async () => {
    const headers = [];
    const fetchImpl = async (url, init) => {
      headers.push(init.headers);
      const payload = { choices: [{ message: say(call('finish', { status: 'blocked', summary: 'x' })) }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    };
    process.env.PAN_DELEGATE_TEST_KEY = 'sk-local-test';
    try {
      await D.runLocalTask({ root: dir, cfg: cfgFor({ api_key_env: 'PAN_DELEGATE_TEST_KEY' }), spec: 's', allow: ['src/add.js'], verify: '', fetchImpl });
      await D.runLocalTask({ root: dir, cfg: cfgFor({ api_key_env: '' }), spec: 's', allow: ['src/add.js'], verify: '', fetchImpl });
    } finally { delete process.env.PAN_DELEGATE_TEST_KEY; }
    assert.equal(headers[0].authorization, 'Bearer sk-local-test');
    assert.equal(headers[1].authorization, undefined);
  });

  test('local_executor.timeout_s bounds the whole run: a request that never answers ends it', async () => {
    const hanging = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    await assert.rejects(
      D.runLocalTask({ root: dir, cfg: cfgFor({ timeout_s: 1 }), spec: 's', allow: ['src/add.js'], verify: '', fetchImpl: hanging }),
      (e) => e.code === 'timeout',
    );
  });

  test('local_executor.verify_timeout_s stops a verify command that runs too long', () => {
    setConfig({ enabled: true, model: 'qwen-test', verify_timeout_s: 1 });
    const v = D.runVerify(dir, `"${process.execPath}" -e "setTimeout(() => {}, 20000)"`, D.readLocalConfig(dir, { home }).verify_timeout_s);
    assert.equal(v.timed_out, true);
    assert.equal(v.passed, false);
  });

  test('a timed-out verify command leaves no process running, and a normal exit code is kept', () => {
    // The sleeper is a grandchild (shell → node): spawnSync's own timeout used to kill
    // only the shell and leave it running, holding the project directory.
    const pidFile = path.join(dir, 'sleeper.pid');
    write('sleeper.js', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000);\n`);
    const v = D.runVerify(dir, `"${process.execPath}" sleeper.js`, 1);
    assert.equal(v.timed_out, true);
    const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
    const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const until = Date.now() + 3000;
    while (alive() && Date.now() < until) { /* taskkill and SIGKILL land within moments */ }
    assert.equal(alive(), false, `verify process ${pid} still running after the timeout`);

    const ok = D.runVerify(dir, `"${process.execPath}" -e "console.log('hi'); process.exit(3)"`, 30);
    assert.equal(ok.timed_out, false);
    assert.equal(ok.exit_code, 3);
    assert.match(ok.output_tail, /hi/);
  });

  test('local_executor.max_rounds is carried into every run report for the executor', async () => {
    const r = await run([say(call('finish', { status: 'blocked', summary: 'x' }))], { cfg: { max_rounds: 5 }, verify: '' });
    assert.equal(r.max_rounds, 5);
  });

  test('an endpoint failure on the first request rejects with its code', async () => {
    const failing = async () => { throw new Error('connect ECONNREFUSED'); };
    await assert.rejects(
      D.runLocalTask({ root: dir, cfg: cfgFor(), spec: 's', allow: ['src/add.js'], verify: '', fetchImpl: failing }),
      (e) => e.code === 'endpoint_unreachable',
    );
  });
});

describe('pan-tools delegate (CLI)', () => {
  let server;
  let port;
  let script;
  let models;
  beforeEach(async () => {
    script = [];
    models = ['qwen-test:latest'];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        if (req.url === '/v1/chat/completions') {
          const message = script.shift() || say(call('finish', { status: 'blocked', summary: 'script ran out' }));
          return res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
        }
        res.statusCode = 404;
        return res.end('{}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });

  test('status when off is an answer, exit 0', async () => {
    const r = await tools('delegate', 'status');
    assert.equal(r.status, 0);
    assert.equal(r.json.enabled, false);
    assert.equal(r.json.ready, false);
  });

  test('status is ready when the endpoint serves the model, and not when it does not', async () => {
    setConfig({ enabled: true, endpoint: `http://127.0.0.1:${port}/v1`, model: 'qwen-test' });
    let r = await tools('delegate', 'status');
    assert.equal(r.status, 0);
    assert.equal(r.json.ready, true);
    assert.equal(r.json.model_available, true);
    models = ['something-else'];
    r = await tools('delegate', 'status');
    assert.equal(r.json.ready, false);
    assert.match(r.json.reason, /not served/);
  });

  test('run writes only the allowed file and reports done with our verify result', async () => {
    setConfig({ enabled: true, endpoint: `http://127.0.0.1:${port}/v1`, model: 'qwen-test' });
    write('.planning/phases/01-x/01-01-task-1-delegate.md', 'Add add(a, b).\n');
    script = [
      say(call('write_file', { path: 'src/keep.js', content: 'hijack' }), call('write_file', { path: 'src/add.js', content: "module.exports = { add: (a, b) => a + b };\n" })),
      say(call('finish', { status: 'done', summary: 'ok' })),
    ];
    const r = await tools('delegate', 'run', '--spec', '.planning/phases/01-x/01-01-task-1-delegate.md',
      '--allow', 'src/add.js', '--verify', `"${process.execPath}" tests/t.test.js`);
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.json.status, 'done');
    assert.deepEqual(r.json.files_changed, ['src/add.js']);
    assert.deepEqual(r.json.refused_writes, ['src/keep.js']);
    assert.equal(r.json.verify.passed, true);
    assert.equal(fs.readFileSync(path.join(dir, 'src/keep.js'), 'utf-8'), 'module.exports = 1;\n');
  });

  test('run is refused when off, without a spec or allow list, or against a remote endpoint', async () => {
    let r = await tools('delegate', 'run', '--spec', 'x', '--allow', 'src/a.js');
    assert.equal(r.status, 1);
    assert.equal(r.json.error, 'local_executor_disabled');
    setConfig({ enabled: true, endpoint: `http://127.0.0.1:${port}/v1`, model: 'qwen-test' });
    r = await tools('delegate', 'run', '--allow', 'src/a.js');
    assert.equal(r.json.error, 'spec_required');
    write('spec.md', 'x');
    r = await tools('delegate', 'run', '--spec', 'spec.md');
    assert.equal(r.json.error, 'allow_required');
    r = await tools('delegate', 'run', '--spec', 'spec.md', '--allow', '.planning/x.md');
    assert.equal(r.json.error, 'invalid_arguments');
    setConfig({ enabled: true, endpoint: 'http://ai.office.lan:4000/v1', model: 'qwen-test' });
    r = await tools('delegate', 'run', '--spec', 'spec.md', '--allow', 'src/a.js');
    assert.equal(r.status, 1);
    assert.equal(r.json.error, 'endpoint_not_local');
  });

  test('an unreachable endpoint is an error key, exit 1', async () => {
    setConfig({ enabled: true, endpoint: 'http://127.0.0.1:9/v1', model: 'qwen-test' });
    write('spec.md', 'x');
    const r = await tools('delegate', 'run', '--spec', 'spec.md', '--allow', 'src/a.js');
    assert.equal(r.status, 1);
    assert.equal(r.json.error, 'endpoint_unreachable');
  });

  test('an unknown subcommand names the available ones', async () => {
    const r = await tools('delegate', 'nope');
    assert.equal(r.status, 1);
  });
});

describe('this computer vs this project, and model ranking', () => {
  test('readLocalConfig layers defaults, then this computer, then the project, and names the source', () => {
    assert.equal(D.readLocalConfig(dir, { home }).source, 'default');
    fs.mkdirSync(path.join(home, '.pan-wizard'), { recursive: true });
    fs.writeFileSync(D.machineConfigPath(home), JSON.stringify({ enabled: true, model: 'qwen-coder-64k' }));
    let c = D.readLocalConfig(dir, { home });
    assert.deepEqual([c.enabled, c.model, c.source], [true, 'qwen-coder-64k', 'machine']);
    setConfig({ enabled: false });
    c = D.readLocalConfig(dir, { home });
    assert.deepEqual([c.enabled, c.model, c.source], [false, 'qwen-coder-64k', 'project']);
  });

  test('rankModels: coding models first, then the larger context window, aliases folded to the first-created name', () => {
    const ids = ['llama3:8b', 'qwen3.6:35b-a3b-coding', 'qwen-coder-64k:latest', 'local-qwen-coder:latest', 'nomic-embed-text'];
    const details = {
      'qwen3.6:35b-a3b-coding': { size: 23e9, digest: 'base', modified: '2026-11-13T10:00' },
      'qwen-coder-64k:latest': { size: 23e9, digest: 'ctx', num_ctx: 65536, modified: '2026-11-13T11:00' },
      'local-qwen-coder:latest': { size: 23e9, digest: 'ctx', num_ctx: 65536, modified: '2026-11-13T12:00' },
      'llama3:8b': { size: 4e9, digest: 'llama' },
    };
    assert.deepEqual(D.rankModels(ids, details).map((m) => m.id), ['qwen-coder-64k:latest', 'qwen3.6:35b-a3b-coding', 'llama3:8b']);
    assert.equal(D.paramsFromName('qwen3.6:35b-a3b-coding'), 35);
    assert.equal(D.paramsFromName('qwen-coder-64k'), 0);
  });
});

describe('pan-tools delegate setup (CLI)', () => {
  let server;
  let port;
  let served;
  beforeEach(async () => {
    served = {
      'qwen3.6:35b-a3b-coding': { size: 23598465666, digest: 'base' },
      'qwen-coder-64k:latest': { size: 23598465682, digest: 'ctx', num_ctx: 65536 },
      'llama3:8b': { size: 4.7e9, digest: 'llama' },
    };
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: Object.keys(served).map((id) => ({ id })) }));
        if (req.url === '/api/tags') {
          return res.end(JSON.stringify({ models: Object.entries(served).map(([name, m]) => ({ name, size: m.size, digest: m.digest, modified_at: '2026-11-13T10:00' })) }));
        }
        if (req.url === '/api/show') {
          const m = served[JSON.parse(body || '{}').model] || {};
          return res.end(JSON.stringify({ parameters: m.num_ctx ? `top_p 0.95\nnum_ctx ${m.num_ctx}` : 'top_p 0.95' }));
        }
        res.statusCode = 404;
        return res.end('{}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });
  const ep = () => `http://127.0.0.1:${port}/v1`;

  test('--dry-run picks the coding model with the largest context and writes nothing', async () => {
    const r = await tools('delegate', 'setup', '--endpoint', ep(), '--dry-run');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.json.chosen, 'qwen-coder-64k');
    assert.deepEqual(r.json.candidates.map((c) => c.model), ['qwen-coder-64k', 'qwen3.6:35b-a3b-coding', 'llama3:8b']);
    assert.equal(r.json.candidates[0].context, 65536);
    assert.equal(r.json.context_hint, undefined);
    assert.equal(fs.existsSync(D.machineConfigPath(home)), false);
    assert.equal(fs.existsSync(path.join(dir, '.planning')), false);
  });

  test('setup turns offload on for this computer by default, and status then reports it ready from the machine', async () => {
    const r = await tools('delegate', 'setup', '--endpoint', ep());
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual([r.json.configured, r.json.scope, r.json.model], [true, 'machine', 'qwen-coder-64k']);
    const saved = JSON.parse(fs.readFileSync(D.machineConfigPath(home), 'utf-8'));
    assert.deepEqual(saved, { enabled: true, model: 'qwen-coder-64k', endpoint: ep(), allow_remote: false });
    const s = await tools('delegate', 'status');
    assert.deepEqual([s.json.ready, s.json.source, s.json.model], [true, 'machine', 'qwen-coder-64k']);
  });

  test('--scope project writes only the project, keeps its other settings, and --off switches the project off', async () => {
    write('.planning/config.json', JSON.stringify({ model_profile: 'budget' }));
    let r = await tools('delegate', 'setup', '--endpoint', ep(), '--scope', 'project', '--model', 'qwen3.6:35b-a3b-coding');
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.json.context_hint, /no configured context window/);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.planning/config.json'), 'utf-8'));
    assert.equal(cfg.model_profile, 'budget');
    assert.deepEqual([cfg.local_executor.enabled, cfg.local_executor.model], [true, 'qwen3.6:35b-a3b-coding']);
    assert.equal(fs.existsSync(D.machineConfigPath(home)), false);
    r = await tools('delegate', 'setup', '--scope', 'project', '--off');
    assert.equal(r.json.enabled, false);
    const s = await tools('delegate', 'status');
    assert.deepEqual([s.json.enabled, s.json.source], [false, 'project']);
  });

  test('a model the server does not serve, an unreachable server and an empty server are explained, exit 1', async () => {
    let r = await tools('delegate', 'setup', '--endpoint', ep(), '--model', 'nope');
    assert.equal(r.status, 1);
    assert.equal(r.json.error, 'model_not_served');
    assert.ok(r.json.served.includes('qwen-coder-64k'));
    r = await tools('delegate', 'setup', '--endpoint', 'http://127.0.0.1:9/v1');
    assert.equal(r.json.error, 'endpoint_unreachable');
    assert.match(r.json.hint, /ollama serve/);
    served = {};
    r = await tools('delegate', 'setup', '--endpoint', ep());
    assert.equal(r.json.error, 'no_models');
    r = await tools('delegate', 'setup', '--scope', 'everywhere');
    assert.equal(r.json.error, 'invalid_scope');
  });
});

describe('transport, thinking and reply size (live proof findings, 2026-11-13)', () => {
  const ok = { choices: [{ message: say(call('finish', { status: 'blocked', summary: 'x' })) }] };
  const capture = (bodies, statusFor = () => 200) => async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const status = statusFor(body, bodies.length);
    return { ok: status === 200, status, text: async () => (status === 200 ? JSON.stringify(ok) : '{"error":"unknown field reasoning_effort"}') };
  };

  test('local_executor.reasoning defaults to none and is sent as reasoning_effort; "default" sends nothing', async () => {
    const bodies = [];
    await D.runLocalTask({ root: dir, cfg: cfgFor(), spec: 's', allow: ['src/add.js'], verify: '', fetchImpl: capture(bodies) });
    assert.equal(bodies[0].reasoning_effort, 'none');
    setConfig({ enabled: true, model: 'qwen-test', reasoning: 'default' });
    await D.runLocalTask({ root: dir, cfg: { ...D.readLocalConfig(dir, { home }) }, spec: 's', allow: ['src/add.js'], verify: '', fetchImpl: capture(bodies) });
    assert.equal('reasoning_effort' in bodies[1], false);
    setConfig({ enabled: true, model: 'qwen-test', reasoning: 'loud' });
    assert.equal(D.readLocalConfig(dir, { home }).reasoning, 'none', 'an unknown level falls back to none');
  });

  test('a server that rejects reasoning_effort with 400 is asked again without it, and the run goes on', async () => {
    const bodies = [];
    const r = await D.runLocalTask({ root: dir, cfg: cfgFor(), spec: 's', allow: ['src/add.js'], verify: '',
      fetchImpl: capture(bodies, (b) => ('reasoning_effort' in b ? 400 : 200)) });
    assert.equal(r.status, 'blocked');
    assert.deepEqual(bodies.map((b) => 'reasoning_effort' in b), [true, false]);
  });

  test('local_executor.max_output_tokens bounds every reply', async () => {
    const bodies = [];
    setConfig({ enabled: true, model: 'qwen-test', max_output_tokens: 2048 });
    await D.runLocalTask({ root: dir, cfg: { ...D.readLocalConfig(dir, { home }) }, spec: 's', allow: ['src/add.js'], verify: '', fetchImpl: capture(bodies) });
    assert.equal(bodies[0].max_tokens, 2048);
    assert.equal(D.readLocalConfig(dir, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h-')) }).max_output_tokens !== undefined, true);
  });

  test('the chat transport waits for a slow reply instead of cutting it off, and still honours its own deadline', async () => {
    const slow = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(ok)); }, 1500));
    });
    await new Promise((r) => slow.listen(0, '127.0.0.1', r));
    const ep = `http://127.0.0.1:${slow.address().port}/v1`;
    try {
      const r = await D.runLocalTask({ root: dir, cfg: cfgFor({ endpoint: ep }), spec: 's', allow: ['src/add.js'], verify: '' });
      assert.equal(r.status, 'blocked', 'the default transport waited 1.5 s for the reply');
      await assert.rejects(
        D.runLocalTask({ root: dir, cfg: cfgFor({ endpoint: ep, timeout_s: 1 }), spec: 's', allow: ['src/add.js'], verify: '' }),
        (e) => e.code === 'timeout',
      );
    } finally { await new Promise((r) => slow.close(r)); }
  });

  test('a refused connection is endpoint_unreachable, not a raw system code', async () => {
    await assert.rejects(
      D.runLocalTask({ root: dir, cfg: cfgFor({ endpoint: 'http://127.0.0.1:9/v1' }), spec: 's', allow: ['src/add.js'], verify: '' }),
      (e) => e.code === 'endpoint_unreachable' && /ECONNREFUSED/.test(e.message),
    );
  });
});

describe('provenance: every run is recorded, and attribute measures who wrote a commit', () => {
  const { execFileSync } = require('child_process');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  let server;
  let port;
  let script;
  beforeEach(async () => {
    script = [];
    let n = 0;
    server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qwen-test:latest' }] }));
        const message = script.shift() || say(call('finish', { status: 'blocked', summary: 'script ran out' }));
        return res.end(JSON.stringify({ id: `chatcmpl-${++n}`, model: 'qwen-test', created: 1700000000 + n, choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    setConfig({ enabled: true, endpoint: `http://127.0.0.1:${port}/v1`, model: 'qwen-test' });
    write('.planning/spec.md', 'Add add(a, b).\n');
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });

  const ADD = "'use strict';\n\nfunction add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n";
  const runAdd = () => {
    script = [say(call('write_file', { path: 'src/add.js', content: ADD })), say(call('finish', { status: 'done', summary: 'ok' }))];
    return tools('delegate', 'run', '--spec', '.planning/spec.md', '--allow', 'src/add.js', '--verify', `"${process.execPath}" tests/t.test.js`);
  };

  test('a run saves its record: the server replies verbatim, every write with its SHA-256, the final content', async () => {
    const r = await runAdd();
    assert.equal(r.json.status, 'done', r.stdout);
    assert.match(r.json.run_id, /^d-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, r.json.provenance), 'utf-8'));
    assert.equal(rec.model, 'qwen-test');
    assert.deepEqual(rec.responses.map((x) => x.id), ['chatcmpl-1', 'chatcmpl-2']);
    assert.equal(rec.writes.length, 1);
    assert.equal(rec.writes[0].path, 'src/add.js');
    assert.equal(rec.writes[0].call_id, 'write_file');
    assert.equal(rec.writes[0].sha256, require('crypto').createHash('sha256').update(ADD).digest('hex'));
    assert.equal(rec.files['src/add.js'].content, fs.readFileSync(path.join(dir, 'src/add.js'), 'utf-8'));
    const transcript = fs.readFileSync(path.join(dir, '.planning/delegations', rec.transcript), 'utf-8').trim().split('\n').map(JSON.parse);
    assert.equal(transcript.length, 2);
    assert.equal(JSON.parse(transcript[0].response.choices[0].message.tool_calls[0].function.arguments).content, ADD);
    assert.equal(rec.verify_passed, true);
  });

  test('attribute --staged: the model\'s file as returned is all local, and the trailer says so', async () => {
    const r = await runAdd();
    git('add', 'src/add.js');
    const a = (await tools('delegate', 'attribute', '--staged')).json;
    assert.equal(a.files.length, 1);
    assert.equal(a.files[0].author, 'local');
    assert.equal(a.files[0].identical, true);
    assert.equal(a.local_lines, 4, 'the lone } is not counted');
    assert.equal(a.executor_lines, 0);
    assert.equal(a.trailer, `PAN-Delegated: qwen-test (4/4 added lines from the local model; run ${r.json.run_id})`);
  });

  test('attribute --ref: lines the executor changed or added are counted as the executor\'s', async () => {
    await runAdd();
    fs.writeFileSync(path.join(dir, 'src/add.js'), ADD.replace('return a + b;', 'return Number(a) + Number(b);'));
    write('src/extra.js', 'module.exports = 2;\n');
    git('add', '-A', 'src');
    git('commit', '-q', '-m', 'task');
    const a = (await tools('delegate', 'attribute', '--ref', 'HEAD')).json;
    const byPath = Object.fromEntries(a.files.map((f) => [f.path, f]));
    assert.equal(byPath['src/add.js'].author, 'mixed');
    assert.equal(byPath['src/add.js'].local_lines, 3);
    assert.equal(byPath['src/add.js'].executor_lines, 1);
    assert.equal(byPath['src/extra.js'].author, 'executor');
    assert.equal(a.local_lines, 3);
    assert.equal(a.added_lines, 5);
    assert.match(a.trailer, /^PAN-Delegated: qwen-test \(3\/5 added lines/);
  });

  test('attribute --ref credits only runs that finished before the commit', async () => {
    await runAdd();
    git('add', 'src/add.js');
    git('commit', '-q', '-m', 'task 1');
    // A later run rewrites the file, keeping task 1's lines: it must not be credited with commit 1.
    const dirRuns = path.join(dir, '.planning/delegations');
    const later = fs.readdirSync(dirRuns).find((n) => n.endsWith('.json') && !n.endsWith('.transcript.jsonl'));
    const rec = JSON.parse(fs.readFileSync(path.join(dirRuns, later), 'utf-8'));
    rec.run_id = 'd-later';
    rec.started_at = rec.finished_at = new Date(Date.now() + 3600e3).toISOString();
    rec.files['src/add.js'].content = ADD;
    fs.writeFileSync(path.join(dirRuns, 'd-later.json'), JSON.stringify(rec));
    fs.rmSync(path.join(dirRuns, later));
    const a = (await tools('delegate', 'attribute', '--ref', 'HEAD')).json;
    assert.equal(a.runs_on_record, 0);
    assert.equal(a.trailer, null);
  });

  test('a commit with no recorded run gets no trailer, and the planning tree is never counted', async () => {
    write('src/add.js', ADD);
    write('.planning/notes.md', 'x\n');
    git('add', '-A');
    const a = (await tools('delegate', 'attribute', '--staged')).json;
    assert.equal(a.runs_on_record, 0);
    assert.equal(a.trailer, null);
    assert.deepEqual(a.files.map((f) => f.path), ['src/add.js']);
    assert.equal(a.files[0].author, 'executor');
  });

  test('lines a file already had are not credited to the model that rewrote it', () => {
    const prev = 'a\nb\nc\n';
    const model = 'a\nb\nc\nd\n';
    const next = 'a\nb\nc\nd\ne\n';
    assert.deepEqual(D.attributeFile(prev, next, model), { added_lines: 2, local_lines: 1, executor_lines: 1, identical: false });
    assert.equal(D.attributeFile('', '}\n});\n\nx\n', '}\n});\n').added_lines, 1, 'punctuation-only and blank lines are not counted');
    assert.deepEqual(D.matchedLines(['x', 'y'], ['y', 'x', 'y']), [false, true, true]);
  });
});
