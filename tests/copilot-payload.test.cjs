/**
 * Copilot CLI's camelCase subagentStop payload in the cost and trace loggers (plan item Q-4).
 *
 * Copilot's hooks reference names the payload fields in camelCase (sessionId,
 * transcriptPath, agentId, agentType, agentName). Both loggers read only the
 * snake_case names, so every Copilot spawn was booked as `unknown`, with no session
 * and no transcript. The fixture is DOCUMENTED, not observed (see its .meta.json).
 * What is pinned here is the mapping and its limits:
 *   - the agent's configured NAME is recorded, never its kind;
 *   - there is no per-agent transcript, so no parent-slice tokens are booked and no
 *     tool failures are captured;
 *   - a Claude payload passes through untouched.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const costLogger = require('../hooks/pan-cost-logger.js');
const traceLogger = require('../hooks/pan-trace-logger.js');
const { cleanup } = require('./helpers.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'hooks');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
function substitute(value, map) {
  if (typeof value === 'string') return value.replace(/\{\{[A-Z_]+\}\}/g, (m) => (m in map ? map[m] : m));
  if (Array.isArray(value)) return value.map((v) => substitute(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, map)]));
  return value;
}

let project;
let payload;
beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-payload-')));
  fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
  const transcript = path.join(project, 'copilot-session.jsonl');
  // A session transcript with usage-shaped lines: if the loggers sliced it, they would book these.
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5000, output_tokens: 7000 } } }) + '\n');
  payload = substitute(fixture('subagent-stop-copilot.json'), {
    '{{SESSION_ID}}': 'copilot-session-0001', '{{PROJECT_DIR}}': project, '{{TRANSCRIPT_PATH}}': transcript, '{{AGENT_ID}}': 'copilot-agent-0001',
  });
});
afterEach(() => cleanup(project));

describe('Copilot camelCase payloads in the loggers', () => {
  test('both hooks carry the same normalizer', () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'hooks', f), 'utf8').replace(/\r\n/g, '\n');
    const fn = (text) => {
      const start = text.indexOf('function normalizeHookPayload(');
      assert.notEqual(start, -1);
      return text.slice(start, text.indexOf('\n}\n', start) + 2);
    };
    assert.equal(fn(src('pan-trace-logger.js')), fn(src('pan-cost-logger.js')));
  });

  test('the cost row names the configured agent and books no tokens from the session transcript', () => {
    const rec = costLogger.buildCostRecord(payload, project);
    assert.ok(rec, 'a Copilot spawn is recorded');
    assert.equal(rec.agent, 'pan-executor', 'agentName, not the agentType classification');
    assert.equal(rec.agent_id, 'copilot-agent-0001');
    assert.equal(rec.session, 'copilot-session-0001');
    assert.equal(rec.token_source, 'agent-transcript-missing', 'no per-agent transcript exists on Copilot');
    assert.deepEqual([rec.input_tokens, rec.output_tokens], [0, 0], 'the session transcript is never sliced into one spawn');
  });

  test('the trace completion names the agent and captures no tool failures', () => {
    const events = traceLogger.buildTraceEvents(payload, 'sess1', project);
    const completion = events.find((e) => e.category === 'agent_completion');
    assert.equal(completion.agent, 'pan-executor');
    assert.equal(completion.context.token_source, 'agent-transcript-missing');
    assert.equal(completion.context.tool_calls, null);
    assert.deepEqual(events.filter((e) => e.category === 'tool_error'), []);
  });

  test('without an agentName the kind is recorded; a Claude payload passes through unchanged', () => {
    const noName = { ...payload };
    delete noName.agentName;
    assert.equal(traceLogger.normalizeHookPayload(noName).agent_type, 'custom');
    const claude = fixture('subagent-stop-claude.json');
    assert.deepEqual(traceLogger.normalizeHookPayload(claude), claude);
    assert.deepEqual(costLogger.normalizeHookPayload(claude), claude);
  });

  test('explicit snake_case fields win over camelCase ones', () => {
    const both = { ...payload, session_id: 'snake', transcript_path: '/x', agent_id: 'snake-agent' };
    const n = costLogger.normalizeHookPayload(both);
    assert.deepEqual([n.session_id, n.transcript_path, n.agent_id], ['snake', '/x', 'snake-agent']);
  });
});
