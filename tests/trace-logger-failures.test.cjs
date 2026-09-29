/**
 * Tool-failure capture in the trace hook (evidence loop EL-9; spec D8, D9; ADR-0049).
 *
 * Built from the record shape of real failed tool calls (tests/fixtures/hooks/
 * subagent-tool-errors-claude.json and its .meta.json). The capture reads only the
 * subagent's OWN transcript slice. It groups a repeated failure into one event with a
 * count, redacts before writing (some projects commit their traces), and stays silent
 * where nothing is attributable: parent-transcript slices, the off switch, non-PAN
 * directories.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildTraceEvents, extractToolFailures, classifyToolError, redactErrorText, errorCaptureEnabled, agentTypeFromMeta, MAX_FAILURE_EVENTS,
} = require('../hooks/pan-trace-logger.js');
const { spawnHook, cleanup } = require('./helpers.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'hooks');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
function substitute(value, map) {
  if (typeof value === 'string') return value.replace(/\{\{[A-Z_]+\}\}/g, (m) => (m in map ? map[m] : m));
  if (Array.isArray(value)) return value.map((v) => substitute(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, map)]));
  return value;
}

const SESSION = 'c0ffee00-0000-4000-8000-000000000928';
// Built here, never committed as a literal: the repository's gitleaks scan flags one.
const FAKE_SECRET = ['sk', 'fixture0123456789abcdef'].join('-');
const AGENT = 'afixture0000tool1';
let project;

/** Lay out the parent + per-agent transcript pair and return the SubagentStop payload. */
function seed({ withAgentType = true, withMeta = true } = {}) {
  const dir = path.join(project, 'transcripts');
  const sub = path.join(dir, SESSION, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const parent = path.join(dir, `${SESSION}.jsonl`);
  const agentFile = path.join(sub, `agent-${AGENT}.jsonl`);
  const map = {
    '{{PROJECT_DIR}}': project, '{{SESSION_ID}}': SESSION, '{{AGENT_ID}}': AGENT, '{{TRANSCRIPT_PATH}}': parent,
    '{{AGENT_TRANSCRIPT_PATH}}': agentFile, '{{SCRATCHPAD_DIR}}': path.join(project, 'scratchpad'), '{{FAKE_SECRET}}': FAKE_SECRET,
  };
  const fx = substitute(fixture('subagent-tool-errors-claude.json'), map);
  fs.writeFileSync(parent, JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: 'parent' } }) + '\n');
  fs.writeFileSync(agentFile, fx.agent.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (withMeta) fs.writeFileSync(agentFile.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(fx.meta));
  const payload = substitute(fixture('subagent-stop-claude.json'), map);
  if (!withAgentType) delete payload.agent_type;
  return { payload, agentFile, records: fx.agent };
}

const failuresOf = (events) => events.filter((e) => e.category === 'tool_error');
const completionOf = (events) => events.find((e) => e.category === 'agent_completion');

beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tool-errors-')));
  fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
});
afterEach(() => cleanup(project));

describe('trace hook — failures from the subagent\'s own transcript', () => {
  test('each distinct failure is one error/tool_error event, a repeated failure carries its count', () => {
    const { payload } = seed();
    const events = buildTraceEvents(payload, 'sess1', project);
    const failures = failuresOf(events);
    assert.deepEqual(failures.map((e) => [e.context.tool, e.context.error_class, e.context.exit_code, e.context.count]), [
      ['Bash', 'exit_code', 1, 2],
      ['Read', 'not_found', null, 1],
      ['Bash', 'exit_code', 22, 1],
      ['Bash', 'permission_denied', null, 1],
    ]);
    const [tests] = failures;
    assert.equal(tests.type, 'error');
    assert.equal(tests.v, 5);
    assert.equal(tests.agent, 'pan-executor');
    assert.equal(tests.context.message, 'npm error Test failed. See above for more details.', 'the informative line after "Exit code", whitespace collapsed');
    assert.equal(tests.context.agent_id, AGENT);
    assert.match(tests.context.message_sig, /^[0-9a-f]{12}$/);
    assert.equal(tests.description, 'pan-executor: Bash failed (exit_code) x2');
  });

  test('the completion counts the slice\'s tool calls and failed results', () => {
    const { payload } = seed();
    const c = completionOf(buildTraceEvents(payload, 'sess1', project));
    assert.deepEqual([c.context.token_source, c.context.tool_calls, c.context.tool_errors], ['agent-transcript', 6, 5]);
  });

  test('messages are redacted before they are written: the query key, the token pair, the project path', () => {
    const { payload } = seed();
    const failures = failuresOf(buildTraceEvents(payload, 'sess1', project));
    const curl = failures.find((e) => e.context.exit_code === 22);
    assert.match(curl.context.message, /^curl: \(22\) The requested URL returned error: 401 https:\/\/api\.example\.invalid\/v1\/items\?<redacted>/);
    for (const secret of [FAKE_SECRET, 'fixturetoken123', 'key=']) {
      assert.ok(!curl.context.message.includes(secret), `${secret} must not reach the trace`);
    }
    const read = failures.find((e) => e.context.tool === 'Read');
    assert.ok(!read.context.message.includes(project), 'the project path is not written into the trace');
    assert.ok(read.context.message.length <= 160);
  });

  test('a resumed agent is not counted twice: the second stop sees only the records after the cursor', () => {
    const { payload, agentFile, records } = seed();
    buildTraceEvents(payload, 'sess1', project);
    const extra = [
      { ...records[1], uuid: 'u-201', message: { ...records[1].message, id: 'msg_resume_1', content: [{ type: 'tool_use', id: 'toolu_resume_1', name: 'Edit', input: {} }] } },
      { ...records[2], uuid: 'u-202', message: { role: 'user', content: [{ type: 'tool_result', content: 'String to replace not found in file.', is_error: true, tool_use_id: 'toolu_resume_1' }] } },
    ];
    fs.appendFileSync(agentFile, extra.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const second = buildTraceEvents({ ...payload, stop_hook_active: true }, 'sess1', project);
    assert.deepEqual(failuresOf(second).map((e) => [e.context.tool, e.context.error_class, e.context.count]), [['Edit', 'edit_precondition', 1]]);
    assert.deepEqual([completionOf(second).context.tool_calls, completionOf(second).context.tool_errors], [1, 1]);
  });

  test('a payload without an agent type is named from the host\'s agent-<id>.meta.json', () => {
    const { payload, agentFile } = seed({ withAgentType: false });
    const events = buildTraceEvents(payload, 'sess1', project);
    assert.equal(completionOf(events).agent, 'general-purpose');
    assert.equal(failuresOf(events)[0].agent, 'general-purpose');
    assert.equal(agentTypeFromMeta(agentFile), 'general-purpose');
    assert.equal(agentTypeFromMeta(path.join(project, 'nope.jsonl')), null);
  });
});

describe('trace hook — where nothing is attributable, nothing is captured', () => {
  test('a slice of the shared parent transcript records no failures and no counts', () => {
    const { payload, records } = seed();
    const parentOnly = path.join(project, 'parent-only.jsonl');
    fs.writeFileSync(parentOnly, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const events = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: parentOnly, session_id: SESSION }, 'sess1', project);
    assert.equal(completionOf(events).context.token_source, 'transcript');
    assert.deepEqual(failuresOf(events), []);
    assert.deepEqual([completionOf(events).context.tool_calls, completionOf(events).context.tool_errors], [null, null]);
  });

  test('execution.error_pattern_learning: false turns the capture off', () => {
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), JSON.stringify({ execution: { error_pattern_learning: false } }));
    assert.equal(errorCaptureEnabled(project), false);
    const events = buildTraceEvents(seed().payload, 'sess1', project);
    assert.deepEqual(failuresOf(events), []);
    assert.equal(completionOf(events).context.tool_errors, null);
  });

  test('the switch defaults on, and an unreadable config does not switch it off', () => {
    assert.equal(errorCaptureEnabled(project), true);
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), '{ not json');
    assert.equal(errorCaptureEnabled(project), true);
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), JSON.stringify({ execution: { error_pattern_learning: true } }));
    assert.equal(errorCaptureEnabled(project), true);
  });

  test('at most MAX_FAILURE_EVENTS events per spawn; the completion keeps the full count', () => {
    const records = [];
    for (let i = 0; i < MAX_FAILURE_EVENTS + 3; i++) {
      records.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: `Tool${i}` }] } });
      records.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: true, content: `failure number ${i}` }] } });
    }
    const r = extractToolFailures(records);
    assert.equal(r.groups.length, MAX_FAILURE_EVENTS);
    assert.equal(r.omitted, 3);
    assert.deepEqual([r.toolCalls, r.toolErrors], [MAX_FAILURE_EVENTS + 3, MAX_FAILURE_EVENTS + 3]);
  });
});

describe('trace hook — classification and redaction', () => {
  test('classes follow the result shapes measured in real transcripts', () => {
    const cases = [
      ['Exit code 3', 'exit_code', 3, 'exit code 3'],
      // npm echoes the script it runs before its output (the first real run, 2026-09-28).
      ['Exit code 1\n\n> greetings-seed@0.1.0 test\n> node --test tests/\n\nCould not find tests/', 'exit_code', 1, 'Could not find tests/'],
      ['Exit code 1\n> only-an-echo@1.0.0 test', 'exit_code', 1, 'exit code 1'],
      ['<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>', 'edit_precondition', null, 'File has not been read yet. Read it first before writing to it.'],
      ['getaddrinfo ENOTFOUND example.invalid', 'network_or_timeout', null, 'getaddrinfo ENOTFOUND example.invalid'],
      ['Permission for this command was denied by a built-in rule', 'permission_denied', null, 'Permission for this command was denied by a built-in rule'],
      ["The user doesn't want to proceed with this tool use.", 'user_rejected', null, "The user doesn't want to proceed with this tool use."],
      ['InputValidationError: file_path is required', 'tool_input', null, 'InputValidationError: file_path is required'],
      ['something unexpected happened', 'other', null, 'something unexpected happened'],
      ['', 'other', null, '(no message)'],
    ];
    for (const [text, errorClass, exitCode, message] of cases) {
      assert.deepEqual(classifyToolError(text), { errorClass, exitCode, message }, text);
    }
  });

  test('secrets, tokens and the home directory never reach the trace; the message is capped', () => {
    const home = os.platform() === 'win32' ? 'C:\\Users\\someone' : '/home/someone';
    const cases = [
      ['Authorization: Bearer abc.def-ghi', /Bearer <redacted>/, 'abc.def-ghi'],
      ['password: hunter2 rejected', /password: <redacted>/, 'hunter2'],
      ['key AKIAABCDEFGHIJKLMNOP leaked', /<redacted>/, 'AKIAABCDEFGHIJKLMNOP'],
      ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N', /<redacted>/, 'eyJhbGci'],
      ['sha 3f786850e387550fdab836ed7e6dc881de23001b differs', /<redacted>/, '3f786850e387550fdab836ed7e6dc881de23001b'],
      ['GET https://x.invalid/p?sig=abc&t=1 failed', /https:\/\/x\.invalid\/p\?<redacted> failed/, 'sig=abc'],
      [`cannot open ${home}${path.sep}proj${path.sep}a.ts`, /cannot open ~/, 'someone'],
      ['\u001b[31mred\u001b[0m text', /^red text$/, '\u001b'],
    ];
    for (const [text, expected, secret] of cases) {
      const out = redactErrorText(text, home);
      assert.match(out, expected, text);
      assert.ok(!out.includes(secret), `${secret} leaked in: ${out}`);
    }
    assert.equal(redactErrorText('Unexpected token } in JSON at position 4', home), 'Unexpected token } in JSON at position 4', 'the word "token" alone is not a secret');
    assert.equal(redactErrorText('ThisIsAVeryLongIdentifierWithoutAnyDigitsInIt', home), 'ThisIsAVeryLongIdentifierWithoutAnyDigitsInIt', 'a long plain identifier is kept');
    assert.equal(redactErrorText('x'.repeat(400), home).length, 160);
  });
});

describe('trace hook — as the host runs it', () => {
  test('the hook process writes the tool_error events into the project\'s trace', () => {
    const { payload } = seed();
    const r = spawnHook('pan-trace-logger.js', payload, project);
    assert.equal(r.status, 0, r.stderr);
    const tracesDir = path.join(project, '.planning', 'optimization', 'traces');
    const [session] = fs.readdirSync(tracesDir);
    const events = fs.readFileSync(path.join(tracesDir, session, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(failuresOf(events).length, 4);
    assert.equal(completionOf(events).context.tool_errors, 5);
  });

  test('outside a PAN project the hook writes nothing at all', () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tool-errors-bare-')));
    try {
      const saved = project;
      project = bare;
      const { payload } = seed();
      project = saved;
      const r = spawnHook('pan-trace-logger.js', { ...payload, cwd: bare }, bare);
      assert.equal(r.status, 0);
      assert.equal(fs.existsSync(path.join(bare, '.planning')), false);
    } finally {
      cleanup(bare);
    }
  });
});
