'use strict';

/**
 * The harness's local model double (program H1; ADR-0047 D2 as amended 2026-10-12).
 *
 * One `node:http` server that answers a host CLI pointed at it (ANTHROPIC_BASE_URL for
 * Claude Code; the OpenAI and Gemini shapes for the hosts that take a base URL) so a
 * scenario can drive a real host end to end without a real model. Nothing is spent,
 * so a double-backed step is tier 0.
 *
 * Modes:
 *   capture  record every request; answer each with a short text turn
 *   script   answer from a script of turns (text, or a tool call), keyed per request by
 *            a header (Claude Code's `x-claude-code-agent-type` gateway hint, when sent),
 *            by text in the system prompt, or else by call order
 *   replay   answer from a cassette: recorded (normalised request → response turn)
 *            pairs; a request with no pair is a `drift` (H2), never an error of PAN
 *   record   proxy to an upstream and keep the pairs (needs a real key; tier >= 1)
 *
 * Captures are written to `<dir>/NNN.json` (headers that carry credentials stripped) and
 * kept in memory for the `wire:` assertions.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_HEADER_RE = /authorization|api-key|x-goog-api-key|cookie|token/i;

/** The text of a request's system prompt, whatever the protocol. */
function systemText(body) {
  if (!body || typeof body !== 'object') return '';
  const flat = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x && (x.text || (x.parts && flat(x.parts)) || ''))) || '').join('\n') : (v && v.text) || '');
  if (body.system !== undefined) return flat(body.system); // Anthropic
  if (body.instructions !== undefined) return flat(body.instructions); // OpenAI Responses
  if (Array.isArray(body.messages)) return flat(body.messages.filter((m) => m && m.role === 'system').map((m) => m.content)); // OpenAI Chat
  if (body.systemInstruction) return flat(body.systemInstruction.parts || body.systemInstruction); // Gemini
  return '';
}

/**
 * The conversation turns of a request (not the system prompt) as {role, text}, whatever
 * the protocol: text blocks only, so tool calls and tool results are left out. Pure.
 */
function messageTexts(body) {
  if (!body || typeof body !== 'object') return [];
  const flat = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x && (x.type === undefined || /text$/.test(x.type)) ? (x.text || '') : '')).filter(Boolean).join('\n') : '');
  if (Array.isArray(body.messages)) return body.messages.filter((m) => m && m.role !== 'system').map((m) => ({ role: m.role, text: flat(m.content) })); // Anthropic, OpenAI Chat
  if (Array.isArray(body.input)) return body.input.filter((m) => m && m.role).map((m) => ({ role: m.role, text: flat(m.content) })); // OpenAI Responses
  if (typeof body.input === 'string') return [{ role: 'user', text: body.input }];
  if (Array.isArray(body.contents)) return body.contents.map((c) => ({ role: c.role === 'model' ? 'assistant' : (c.role || 'user'), text: flat(c.parts) })); // Gemini
  return [];
}

/** The text of the latest user turn that carries text (a scripted user's answer, H9). Pure. */
function lastUserText(body) {
  const turns = messageTexts(body).filter((m) => m.role === 'user' && m.text);
  return turns.length ? turns[turns.length - 1].text : '';
}

/** Which wire protocol a request speaks, from its path. */
function protocolOf(url) {
  if (/\/v1\/messages(\?|$)/.test(url)) return 'anthropic';
  if (/\/responses(\?|$)/.test(url)) return 'openai-responses';
  if (/\/chat\/completions(\?|$)/.test(url)) return 'openai-chat';
  if (/:(stream)?[gG]enerateContent/.test(url)) return 'gemini';
  return null;
}

/** The tool names a request offers, whatever the protocol. */
function toolNames(body) {
  const tools = (body && body.tools) || [];
  const out = [];
  for (const t of tools) {
    if (!t) continue;
    if (t.name) out.push(t.name);
    else if (t.function && t.function.name) out.push(t.function.name);
    else if (Array.isArray(t.functionDeclarations)) for (const f of t.functionDeclarations) out.push(f.name);
  }
  return out;
}

/**
 * The normaliser cassette keys use (H2): the parts of a request that change from run to run
 * without the prompt changing. Claude Code puts a billing header line at the top of the
 * system prompt, ids in tool results (agent ids, tool-use ids), dates and durations; the
 * workspace and config paths differ per run directory and per machine.
 * @param {{ws?: string, other?: string, home?: string}} [ctx]
 */
function makeNormaliser(ctx = {}) {
  // Each path as written, with either separator, escaped, and as the host's project slug
  // (Claude Code names a project's memory dir after its path with every non-alphanumeric
  // turned into '-'), so a cassette recorded on one machine keys the same on another.
  const paths = [ctx.ws, ctx.other, ctx.home].filter(Boolean)
    .flatMap((p) => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), p.replace(/[^A-Za-z0-9]/g, '-')])
    .sort((a, b) => b.length - a.length);
  return (s) => {
    let t = String(s).replace(/\r\n/g, '\n');
    for (const p of paths) t = t.split(p).join('<path>');
    return t
      .replace(/<path>[^\s`'"]*/g, (m) => m.replace(/\\+/g, '/'))
      .replace(/x-anthropic-billing-header:[^\n]*\n?/g, '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
      .replace(/\b(?:toolu|msg|call|fc|resp|chatcmpl)_[A-Za-z0-9]+\b/g, '<id>')
      .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
      .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g, '<date>')
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, '<dur>')
      .replace(/\b(duration_ms|total_tokens|tool_uses|input_tokens|output_tokens)(["']?\s*[:=]\s*)\d+/g, '$1$2<n>');
  };
}

/**
 * The installed agents' body lines (H2), for keying and attributing requests: `lines` is
 * every non-empty body line, `long` the lines distinctive enough to identify the agent.
 * @param {string} agentsDir - the runtime's installed agents directory
 * @returns {{agent: string, file: string, lines: string[], long: string[]}[]}
 */
function loadAgents(agentsDir) {
  let names = [];
  try { names = fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort(); } catch { return []; }
  return names.map((n) => {
    const body = fs.readFileSync(path.join(agentsDir, n), 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    return { agent: n.replace(/\.md$/, ''), file: `agents/${n}`, lines, long: lines.filter((l) => l.length > 20) };
  }).filter((a) => a.long.length);
}

/** The agent whose distinctive lines a system prompt carries most of (over half), or null. */
function agentOf(system, agents) {
  const sys = String(system || '').replace(/\r\n/g, '\n');
  let best = null;
  for (const a of agents || []) {
    const share = a.long.filter((l) => sys.includes(l)).length / a.long.length;
    if (share > 0.5 && (!best || share > best.share)) best = { ...a, share: Math.round(share * 100) / 100 };
  }
  return best;
}

/**
 * Which installed agent a drifted request belongs to (H2). Null when none is close (the
 * main session, or a host-internal request).
 * @param {string} system - the drifted request's system prompt (as sent: the current body)
 * @param {string} agentsDir - the runtime's installed agents directory
 * @returns {{agent: string, file: string, share: number}|null}
 */
function attributeDrift(system, agentsDir) {
  const best = agentOf(system, loadAgents(agentsDir));
  return best ? { agent: best.agent, file: best.file, share: best.share } : null;
}

/** How many model turns a request's conversation already holds (assistant or model messages). */
function turnIndex(body) {
  const list = (body && (body.messages || body.input || body.contents)) || [];
  return Array.isArray(list) ? list.filter((m) => m && (m.role === 'assistant' || m.role === 'model' || m.type === 'function_call')).length : 0;
}

/**
 * A stable key for a request, for cassettes (H2): protocol, model, turn number, and the
 * part of the system prompt PAN owns. A request that carries an installed agent's body is
 * keyed on that agent's lines as sent, in order, so a one-line agent edit drifts it and
 * nothing else. Any other request (the main session, the host's own classifiers) is keyed
 * on its opening line: the rest is the host's prose, which varies with platform and host
 * flags (seen 2026-10-13: one paragraph on Windows, absent on Linux, same CLI version) and
 * is not PAN's prompt to measure.
 * Not the whole conversation either: Claude Code moves its `cache_control` breakpoints
 * between turns, and an async subagent's result arrives with timing-dependent text.
 * @param {Array} [agents] - loadAgents() of the runtime's installed agents
 */
function requestKey(protocol, body, normalise = (s) => s, agents = []) {
  const b = body && typeof body === 'object' ? body : {};
  const sys = systemText(b).replace(/\r\n/g, '\n');
  const lines = sys.split('\n').map((l) => l.trim()).filter((l) => l && !/^x-anthropic-billing-header:/.test(l));
  const who = agentOf(sys, agents);
  const own = who && new Set(who.lines);
  const prompt = who ? lines.filter((l) => own.has(l)).map(normalise) : normalise(lines[0] || '');
  const shape = { protocol, model: b.model || null, turn: turnIndex(b), agent: who ? who.agent : null, prompt };
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

/**
 * Pick the turn for a request from a script.
 * script: { rules: [{ when: {header?, toolsInclude?, toolsExclude?, systemIncludes?, systemExcludes?}, turns: [turn, ...] }], fallback: turn }
 * (Claude Code 2.1.288 sends no agent-type header; the main session is the request that
 * offers the spawn tool, and a subagent's system prompt carries its agent body.)
 * Each rule keeps its own cursor; a rule whose turns are spent answers its last turn again.
 * A turn is `{ text }` or `{ tool: { name: string|string[], input } }`.
 */
function scriptTurn(script, req, body, cursors) {
  const rules = (script && script.rules) || [];
  const system = systemText(body);
  for (let i = 0; i < rules.length; i++) {
    const w = rules[i].when || {};
    if (w.header) {
      const v = req.headers[String(w.header.name).toLowerCase()];
      if (typeof v !== 'string' || !v.includes(w.header.includes || '')) continue;
    }
    if (w.toolsInclude && !toolNames(body).some((t) => [].concat(w.toolsInclude).includes(t))) continue;
    if (w.toolsExclude && toolNames(body).some((t) => [].concat(w.toolsExclude).includes(t))) continue;
    if (w.systemIncludes && !system.includes(w.systemIncludes)) continue;
    if (w.systemExcludes && system.includes(w.systemExcludes)) continue;
    // H9: what the user just said, and what the whole conversation holds. A resumed session
    // carries the earlier answers; a fresh one does not.
    if (w.userIncludes && !lastUserText(body).includes(w.userIncludes)) continue;
    if (w.messagesInclude) {
      const all = messageTexts(body).map((m) => m.text).join('\n');
      if (![].concat(w.messagesInclude).every((t) => all.includes(t))) continue;
    }
    const turns = rules[i].turns || [];
    const at = cursors.get(i) || 0;
    cursors.set(i, at + 1);
    return turns[Math.min(at, turns.length - 1)] || { text: 'done' };
  }
  return (script && script.fallback) || { text: 'done' };
}

/** Resolve a tool turn's name against the tools the request offers (a list picks the first present). */
function resolveTool(turn, body) {
  if (!turn.tool) return null;
  const want = [].concat(turn.tool.name);
  const offered = toolNames(body);
  const name = want.find((n) => offered.includes(n)) || want[0];
  return { name, input: turn.tool.input || {} };
}

// ─── Responses per protocol ─────────────────────────────────────────────────

function anthropicReply(res, body, turn, id) {
  const model = (body && body.model) || 'double';
  const tool = resolveTool(turn, body);
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  if (!(body && body.stream)) {
    const content = tool ? [{ type: 'tool_use', id: `toolu_${id}`, name: tool.name, input: tool.input }] : [{ type: 'text', text: turn.text || '' }];
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: `msg_${id}`, type: 'message', role: 'assistant', model, content, stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: `msg_${id}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
  if (tool) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${id}`, name: tool.name, input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: turn.text || '' } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  res.end();
}

function openaiResponsesReply(res, body, turn, id) {
  const tool = resolveTool(turn, body);
  const item = tool
    ? { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name: tool.name, arguments: JSON.stringify(tool.input), status: 'completed' }
    : { type: 'message', id: `msg_${id}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: turn.text || '', annotations: [] }] };
  const response = { id: `resp_${id}`, object: 'response', status: 'completed', model: (body && body.model) || 'double', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  if (!(body && body.stream)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(response));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  ev('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
  if (!tool) ev('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: turn.text || '' });
  ev('response.output_item.done', { output_index: 0, item });
  ev('response.completed', { response });
  res.end();
}

function openaiChatReply(res, body, turn, id) {
  const tool = resolveTool(turn, body);
  const message = tool
    ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] }
    : { role: 'assistant', content: turn.text || '' };
  const finish = tool ? 'tool_calls' : 'stop';
  if (!(body && body.stream)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: `chatcmpl_${id}`, object: 'chat.completion', model: (body && body.model) || 'double', choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (delta, finishReason) => res.write(`data: ${JSON.stringify({ id: `chatcmpl_${id}`, object: 'chat.completion.chunk', model: (body && body.model) || 'double', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
  chunk(tool ? { role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls[0] }] } : { role: 'assistant', content: message.content }, null);
  chunk({}, finish);
  res.write('data: [DONE]\n\n');
  res.end();
}

function geminiReply(res, body, turn, url) {
  const tool = resolveTool(turn, body);
  const part = tool ? { functionCall: { name: tool.name, args: tool.input } } : { text: turn.text || '' };
  const payload = { candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
  if (/streamGenerateContent/.test(url)) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function reply(protocol, res, body, turn, id, url) {
  if (protocol === 'anthropic') return anthropicReply(res, body, turn, id);
  if (protocol === 'openai-responses') return openaiResponsesReply(res, body, turn, id);
  if (protocol === 'openai-chat') return openaiChatReply(res, body, turn, id);
  return geminiReply(res, body, turn, url);
}

// ─── The server ─────────────────────────────────────────────────────────────

/**
 * Start a double.
 * @param {{mode?: 'capture'|'script'|'replay'|'record', script?: object, cassette?: Array, upstream?: string,
 *          capturesDir?: string, normalise?: (s: string) => string, agents?: Array, port?: number}} opts
 * @returns {Promise<{url: string, port: number, captures: Array, drift: Array, recorded: Array, close: () => Promise<void>}>}
 */
function startDouble(opts = {}) {
  const mode = opts.mode || 'capture';
  const captures = [];
  const drift = [];
  const recorded = [];
  const cursors = new Map();
  const normalise = opts.normalise || ((s) => s);
  const agents = opts.agents || [];
  if (opts.capturesDir) fs.mkdirSync(opts.capturesDir, { recursive: true, mode: 0o700 });
  const cassette = new Map((opts.cassette || []).map((p) => [p.key, p]));

  const changed = () => { if (typeof opts.onChange === 'function') { try { opts.onChange({ captures, drift, recorded }); } catch { /* observer errors never break a reply */ } } };
  const server = http.createServer((req, res) => {
    res.on('finish', changed);
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const protocol = protocolOf(req.url);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = SECRET_HEADER_RE.test(k) ? '<stripped>' : v;
      const n = captures.length + 1;
      const entry = { n, method: req.method, url: req.url, protocol, headers, body, system: systemText(body), tools: toolNames(body) };
      captures.push(entry);
      if (opts.capturesDir) {
        try { fs.writeFileSync(path.join(opts.capturesDir, `${String(n).padStart(3, '0')}.json`), JSON.stringify(entry, null, 2), { mode: 0o600 }); } catch { /* captures are best effort */ }
      }
      if (!protocol || req.method !== 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      }
      const id = `${n}`;
      if (mode === 'record') {
        try {
          // Only a model API path goes upstream, and only to the upstream's own origin: an
          // absolute-form request target (`POST http://elsewhere/…`) would otherwise replace
          // the base URL and send the request, credentials included, anywhere.
          if (!/^\/[A-Za-z0-9._~\-/:]*(?:\?[A-Za-z0-9._~\-=&%]*)?$/.test(req.url) || req.url.startsWith('//')) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: { type: 'double_upstream', message: 'record mode proxies model API paths only' } }));
          }
          const up = await fetch(`${new URL(opts.upstream).origin}/${req.url.slice(1)}`, { method: 'POST', headers: forwardHeaders(req.headers), body: raw });
          const text = await up.text();
          recorded.push({ key: requestKey(protocol, body, normalise, agents), protocol, status: up.status, contentType: up.headers.get('content-type'), response: text });
          res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
          return res.end(text);
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { type: 'double_upstream', message: e.message } }));
        }
      }
      if (mode === 'replay') {
        const key = requestKey(protocol, body, normalise, agents);
        const pair = cassette.get(key);
        if (!pair) {
          drift.push({ n, key, protocol, system: entry.system.slice(0, 400) });
          // 400, not 409: the Anthropic and OpenAI clients retry a 409 with backoff (minutes of
          // dead time per drifted request); an invalid-request error ends the turn at once.
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `model double: cassette drift, no recorded answer for request ${key}` } }));
        }
        res.writeHead(pair.status || 200, { 'content-type': pair.contentType || 'application/json' });
        return res.end(pair.response);
      }
      const turn = mode === 'script' ? scriptTurn(opts.script, req, body, cursors) : { text: 'ok' };
      entry.answered = turn;
      reply(protocol, res, body, turn, id, req.url);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`, port, captures, drift, recorded, mode,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Headers to forward upstream in record mode: everything but hop-by-hop and host. */
function forwardHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) if (!/^(host|connection|content-length|transfer-encoding|accept-encoding)$/i.test(k)) out[k] = v;
  return out;
}

/**
 * The environment that points a host CLI at the double. Hosts whose CLI takes no base
 * URL from the environment get null (the step is skipped with that reason, never green).
 */
function hostEnv(runtime, url, base = process.env) {
  const env = { ...base };
  if (runtime === 'claude') {
    env.ANTHROPIC_BASE_URL = url;
    env.ANTHROPIC_API_KEY = 'double-not-a-real-key';
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    return env;
  }
  return null;
}

module.exports = { startDouble, hostEnv, systemText, messageTexts, lastUserText, protocolOf, toolNames, requestKey, turnIndex, scriptTurn, resolveTool, makeNormaliser, attributeDrift, loadAgents };
