'use strict';

/**
 * Local executor offload (ADR-0053): hand the implementation of one plan task to a
 * model served on the user's own hardware — Ollama, LM Studio, llama.cpp, vLLM, or a
 * LiteLLM gateway in front of them — through the OpenAI-compatible
 * `/v1/chat/completions` API every one of those speaks.
 *
 * The executor agent stays the engineer of record. It writes the task spec, names the
 * files the local model may write and the command that verifies the task, reviews the
 * diff, runs the verification itself and commits. This module only runs the local
 * model's tool loop and reports what happened; it never commits, never stages and
 * never touches `.git/` or the planning tree.
 *
 * What the local model can do, and nothing more:
 *   list_files  — list a directory inside the project
 *   read_file   — read a file inside the project (not .git/, not a sensitive file)
 *   write_file  — write a file the caller listed in --allow
 *   run_verify  — run the caller's --verify command (the model cannot choose a command)
 *   finish      — end the task as done or blocked, with a short report
 * There is no general shell. The endpoint must be on this machine unless the config
 * sets `allow_remote` (an office server on the LAN), and an API key is read from the
 * environment variable the config names, never from the config file.
 *
 * Zero dependencies: Node's own fetch (Node 18+) and child_process.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { planningPath } = require('./utils.cjs');
const { DEFAULT_SENSITIVE_PATTERNS } = require('./constants.cjs');

/** The `local_executor` section config-ensure-section writes. Off until a project opts in. */
const LOCAL_EXECUTOR_DEFAULTS = Object.freeze({
  enabled: false,
  // Base URL of an OpenAI-compatible API. Ollama's default.
  endpoint: 'http://127.0.0.1:11434/v1',
  // The served model's name, e.g. `qwen3.6:35b-a3b-coding`. Required when enabled.
  model: '',
  // Name of an environment variable that holds the API key (a LiteLLM key); '' = none.
  api_key_env: '',
  // false: refuse any endpoint that is not this machine (loopback).
  allow_remote: false,
  // Tool-loop turns per run, and the wall clock for the whole run.
  max_turns: 25,
  timeout_s: 900,
  // The --verify command's own time limit.
  verify_timeout_s: 300,
  // Failed rounds per task before the executor takes the task back.
  max_rounds: 3,
});

const READ_LIMIT = 200 * 1024;        // bytes of a file handed to the model
const WRITE_LIMIT = 512 * 1024;       // bytes the model may write in one file
const VERIFY_TAIL = 4000;             // chars of verify output kept
const LIST_LIMIT = 300;               // entries per list_files
const STATUS_TIMEOUT_MS = 5000;

/**
 * The machine-wide setting `/pan:local` writes by default: which local model THIS
 * computer serves is a property of the computer, not of one project, and a file
 * outside `.planning/` survives `/pan:new-project` writing a fresh config.json.
 */
function machineConfigPath(home = os.homedir()) {
  return path.join(home, '.pan-wizard', 'local-executor.json');
}

function readJsonObject(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * The effective setting: the defaults, then this machine's file, then the project's
 * `local_executor` section (a project can override the machine, e.g. switch it off
 * for a confidential repository). Each field is coerced to its type. `source` says
 * which layer set `enabled`.
 */
function readLocalConfig(cwd, { home } = {}) {
  let projectSection = null;
  let sensitive = DEFAULT_SENSITIVE_PATTERNS;
  const parsed = readJsonObject(planningPath(cwd, 'config.json'));
  if (parsed) {
    if (parsed.local_executor && typeof parsed.local_executor === 'object') projectSection = parsed.local_executor;
    const pats = parsed.commit && parsed.commit.sensitive_patterns;
    if (Array.isArray(pats) && pats.length) sensitive = pats;
  }
  const machine = readJsonObject(machineConfigPath(home));
  const section = { ...(machine || {}), ...(projectSection || {}) };
  const source = projectSection && projectSection.enabled !== undefined ? 'project'
    : (machine && machine.enabled !== undefined ? 'machine' : 'default');
  const d = LOCAL_EXECUTOR_DEFAULTS;
  const posInt = (v, def) => (Number.isInteger(v) && v > 0 ? v : def);
  return {
    enabled: section.enabled === true,
    endpoint: typeof section.endpoint === 'string' && section.endpoint.trim() ? section.endpoint.trim().replace(/\/+$/, '') : d.endpoint,
    model: typeof section.model === 'string' ? section.model.trim() : d.model,
    api_key_env: typeof section.api_key_env === 'string' ? section.api_key_env.trim() : d.api_key_env,
    allow_remote: section.allow_remote === true,
    max_turns: posInt(section.max_turns, d.max_turns),
    timeout_s: posInt(section.timeout_s, d.timeout_s),
    verify_timeout_s: posInt(section.verify_timeout_s, d.verify_timeout_s),
    max_rounds: posInt(section.max_rounds, d.max_rounds),
    sensitive_patterns: sensitive,
    source,
  };
}

/** Parameter count in billions from a model name (`qwen3.6:35b-a3b` → 35), else 0. */
function paramsFromName(id) {
  const m = String(id).toLowerCase().match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/);
  return m ? Number(m[1]) : 0;
}

/** The tool loop needs room for the spec, several files and test output. */
const MIN_GOOD_CONTEXT = 32768;

/**
 * Order served models for coding work: coding-tuned names first, then the larger
 * configured context window (an agent loop runs out of room long before it runs out
 * of skill), then the larger model (Ollama's byte size when known, else the parameter
 * count in the name). Embedding and speech models are dropped, and aliases of one
 * model (same Ollama digest) are folded into the first-created name.
 * @param {string[]} ids
 * @param {Object<string,{size?:number,digest?:string,num_ctx?:number,modified?:string}>} details
 */
function rankModels(ids, details = {}) {
  const coding = (id) => /cod(?:er|ing|e)|devstral|starcoder/i.test(id);
  const rows = ids
    .filter((id) => !/embed|nomic|bge|clip|whisper/i.test(id))
    .map((id) => {
      const d = details[id] || details[id.replace(/:latest$/, '')] || {};
      return { id, coding: coding(id), size: Number(d.size) || 0, params: paramsFromName(id), num_ctx: Number(d.num_ctx) || 0, digest: d.digest || null, modified: d.modified || '' };
    });
  const byDigest = new Map();
  for (const r of rows) {
    if (!r.digest) continue;
    const kept = byDigest.get(r.digest);
    if (!kept || (r.modified && kept.modified && r.modified < kept.modified)) byDigest.set(r.digest, r);
  }
  return rows
    .filter((r) => !r.digest || byDigest.get(r.digest) === r)
    .sort((a, b) => (b.coding - a.coding) || (b.num_ctx - a.num_ctx) || (b.size - a.size) || (b.params - a.params) || a.id.localeCompare(b.id));
}

/**
 * What Ollama's native API knows and the OpenAI-compatible one leaves out: each
 * model's size, digest and configured context window (`num_ctx` in its parameters).
 * Best effort: any other server simply yields {}.
 */
async function ollamaDetails(endpoint, fetchImpl, limitShow = 8) {
  const out = {};
  let origin;
  try { origin = new URL(endpoint).origin; } catch { return out; }
  try {
    const res = await fetchImpl(`${origin}/api/tags`, {});
    if (!res.ok) return out;
    const body = await res.json();
    for (const m of (body && body.models) || []) {
      if (m && m.name) out[m.name] = { size: m.size, digest: m.digest, modified: m.modified_at };
    }
  } catch { return out; }
  const names = Object.keys(out).filter((n) => /cod(?:er|ing|e)|devstral|starcoder/i.test(n)).slice(0, limitShow);
  for (const name of names) {
    try {
      const res = await fetchImpl(`${origin}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }) });
      if (!res.ok) continue;
      const body = await res.json();
      const m = String((body && body.parameters) || '').match(/(?:^|\n)\s*num_ctx\s+(\d+)/);
      if (m) out[name].num_ctx = Number(m[1]);
    } catch { /* keep what tags gave */ }
  }
  return out;
}

/** True for a host that can only be this machine. */
function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * Check the endpoint before any request: a parseable http(s) URL, and on this machine
 * unless allow_remote. Returns null when it is fine, else an error code.
 */
function endpointProblem(cfg) {
  let url;
  try { url = new URL(cfg.endpoint); } catch { return 'endpoint_invalid'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'endpoint_invalid';
  if (!cfg.allow_remote && !isLoopbackHost(url.hostname)) return 'endpoint_not_local';
  return null;
}

function toPosixRel(p) {
  return String(p).split(path.sep).join('/');
}

/**
 * Resolve a model- or caller-supplied path inside the project root, following
 * symlinks for the part that exists. Throws on an escape. Returns {abs, rel}.
 */
function confine(root, p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) throw new Error('path must be a non-empty string');
  const rootReal = fs.realpathSync(root);
  const abs = path.resolve(rootReal, p.trim());
  // Resolve the deepest existing ancestor through realpath, so a symlinked directory
  // inside the project cannot point the write outside it.
  let probe = abs;
  const tail = [];
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  const real = path.join(fs.realpathSync(probe), ...tail);
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path is outside the project: ${p}`);
  return { abs: real, rel: toPosixRel(rel) || '.' };
}

function inGitDir(rel) {
  return rel === '.git' || rel.startsWith('.git/') || rel.includes('/.git/') || rel.endsWith('/.git');
}

function isSensitive(rel, patterns) {
  const base = path.posix.basename(rel);
  return patterns.some((src) => { try { return new RegExp(src, 'i').test(base); } catch { return false; } });
}

/**
 * Parse --allow: comma-separated project-relative files, or directories ending in `/`.
 * Every entry is confined to the project and may not name .git/ or the planning tree.
 */
function parseAllow(root, value, planningRelDir) {
  const out = [];
  for (const raw of String(value || '').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const isDir = /[\\/]$/.test(item);
    const { rel } = confine(root, item);
    if (rel === '.' || inGitDir(rel)) throw new Error(`--allow may not name the project root or .git: ${item}`);
    if (rel === planningRelDir || rel.startsWith(planningRelDir + '/')) throw new Error(`--allow may not name the planning tree: ${item}`);
    out.push(isDir ? rel.replace(/\/?$/, '/') : rel);
  }
  return out;
}

function writeAllowed(rel, allow) {
  return allow.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));
}

/** Run the caller's verify command in the project root. The model never supplies it. */
function runVerify(root, command, timeoutS) {
  const r = spawnSync(command, {
    cwd: root, shell: true, encoding: 'utf-8', timeout: timeoutS * 1000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const text = `${r.stdout || ''}${r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''}`;
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  return {
    command,
    passed: r.status === 0 && !timedOut,
    exit_code: r.status,
    timed_out: timedOut,
    output_tail: text.length > VERIFY_TAIL ? '…' + text.slice(-VERIFY_TAIL) : text,
  };
}

const TOOL_DEFS = [
  {
    name: 'list_files',
    description: 'List the entries of a directory inside the project. Directories end with "/".',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Project-relative directory; "." for the root' } }, required: ['path'] },
  },
  {
    name: 'read_file',
    description: 'Read a text file inside the project.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Project-relative file path' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the full new content. Only the files listed under "Files you may write" are accepted.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative file path' }, content: { type: 'string', description: 'The complete file content' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_verify',
    description: 'Run the task\'s verification command and get its exit code and output.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'finish',
    description: 'End the task. status "done" when the work is complete and verified, "blocked" when it cannot be done as specified.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string', description: 'What you changed and why, or what blocks you' } },
      required: ['status', 'summary'],
    },
  },
];

function systemPrompt(allow, verify) {
  return [
    'You are a careful software engineer implementing ONE task for a lead engineer, who will review your work and commit it.',
    'Work only through the tools. Read the relevant files before you write. Write complete file contents.',
    `Files you may write: ${allow.join(', ')}. Any other write is refused. Never edit tests you were not told to edit.`,
    verify
      ? 'When your change is written, call run_verify. If it fails, read the output, fix your code and run it again.'
      : 'There is no verification command for this task; check your work by reading the files you wrote.',
    'Follow the existing code style. Add no dependencies. Put no secrets in code.',
    'When you are finished, call finish with status "done", or "blocked" if the task cannot be done as specified.',
  ].join('\n');
}

/**
 * Execute one tool call from the model. Returns the text handed back to it and updates
 * the run's bookkeeping. Never throws: a refusal is a message the model can act on.
 */
function executeTool(ctx, name, args) {
  try {
    switch (name) {
      case 'list_files': {
        const { abs, rel } = confine(ctx.root, (args && args.path) || '.');
        if (inGitDir(rel)) return 'Refused: .git is not available.';
        const entries = fs.readdirSync(abs, { withFileTypes: true })
          .filter((e) => e.name !== '.git')
          .map((e) => (e.isDirectory() ? e.name + '/' : e.name))
          .sort();
        const shown = entries.slice(0, LIST_LIMIT);
        return shown.join('\n') + (entries.length > shown.length ? `\n… ${entries.length - shown.length} more` : '') || '(empty)';
      }
      case 'read_file': {
        const { abs, rel } = confine(ctx.root, args && args.path);
        if (inGitDir(rel)) return 'Refused: .git is not available.';
        if (isSensitive(rel, ctx.cfg.sensitive_patterns)) return `Refused: ${rel} matches a sensitive-file pattern.`;
        const buf = fs.readFileSync(abs);
        ctx.files_read.add(rel);
        const text = buf.subarray(0, READ_LIMIT).toString('utf-8');
        return buf.length > READ_LIMIT ? `${text}\n… truncated at ${READ_LIMIT} bytes of ${buf.length}` : text;
      }
      case 'write_file': {
        const { abs, rel } = confine(ctx.root, args && args.path);
        if (!writeAllowed(rel, ctx.allow)) {
          ctx.refused_writes.add(rel);
          return `Refused: ${rel} is not in the files you may write (${ctx.allow.join(', ')}).`;
        }
        const content = args && typeof args.content === 'string' ? args.content : null;
        if (content === null) return 'Refused: content must be a string.';
        if (Buffer.byteLength(content, 'utf-8') > WRITE_LIMIT) return `Refused: content is larger than ${WRITE_LIMIT} bytes.`;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        ctx.files_changed.add(rel);
        return `Wrote ${rel} (${Buffer.byteLength(content, 'utf-8')} bytes).`;
      }
      case 'run_verify': {
        if (!ctx.verify) return 'There is no verification command for this task.';
        const v = runVerify(ctx.root, ctx.verify, ctx.cfg.verify_timeout_s);
        ctx.verify_runs++;
        return `exit code ${v.exit_code}${v.timed_out ? ' (timed out)' : ''}\n${v.output_tail}`;
      }
      case 'finish': {
        const status = args && args.status === 'blocked' ? 'blocked' : 'done';
        ctx.finished = { status, summary: String((args && args.summary) || '').slice(0, 4000) };
        return 'Recorded.';
      }
      default:
        return `Unknown tool: ${name}. Use list_files, read_file, write_file, run_verify or finish.`;
    }
  } catch (e) {
    return `Error: ${(e && e.message) || e}`;
  }
}

async function postChat(cfg, body, deadline, fetchImpl) {
  const headers = { 'content-type': 'application/json' };
  const key = cfg.api_key_env ? process.env[cfg.api_key_env] : '';
  if (key) headers.authorization = `Bearer ${key}`;
  const remaining = deadline - Date.now();
  if (remaining <= 0) { const e = new Error('run timed out'); e.code = 'timeout'; throw e; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), remaining);
  try {
    const res = await fetchImpl(`${cfg.endpoint}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`); e.code = 'endpoint_http_error'; throw e; }
    return JSON.parse(text);
  } catch (e) {
    if (e && e.name === 'AbortError') { const t = new Error('run timed out'); t.code = 'timeout'; throw t; }
    if (e && !e.code) e.code = 'endpoint_unreachable';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

/**
 * Run the local model's tool loop for one task. Resolves to the run report; rejects
 * only for an endpoint failure on the FIRST request (nothing was done yet).
 */
async function runLocalTask({ root, cfg, spec, allow, verify, fetchImpl = globalThis.fetch }) {
  const started = Date.now();
  const deadline = started + cfg.timeout_s * 1000;
  const ctx = {
    root, cfg, allow, verify,
    files_changed: new Set(), files_read: new Set(), refused_writes: new Set(),
    verify_runs: 0, finished: null,
  };
  const messages = [
    { role: 'system', content: systemPrompt(allow, verify) },
    { role: 'user', content: spec },
  ];
  const tools = TOOL_DEFS.map((t) => ({ type: 'function', function: t }));
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let turns = 0;
  let toolCalls = 0;
  let malformed = 0;
  let lastText = '';
  let stop = null;

  while (turns < cfg.max_turns && !ctx.finished) {
    let data;
    try {
      data = await postChat(cfg, { model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0.2, stream: false }, deadline, fetchImpl);
    } catch (e) {
      if (turns === 0) throw e;
      stop = e.code === 'timeout' ? 'timeout' : 'endpoint_error';
      break;
    }
    turns++;
    if (data && data.usage) {
      usage.prompt_tokens += Number(data.usage.prompt_tokens) || 0;
      usage.completion_tokens += Number(data.usage.completion_tokens) || 0;
    }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) { stop = 'empty_response'; break; }
    if (typeof msg.content === 'string' && msg.content.trim()) lastText = msg.content.trim();
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    messages.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      // A reply with no tool call: nudge once toward finish, then stop.
      if (stop === 'nudged') { stop = 'no_tool_call'; break; }
      stop = 'nudged';
      messages.push({ role: 'user', content: 'Continue with the tools. When the task is complete call finish.' });
      continue;
    }
    for (const call of calls) {
      toolCalls++;
      const fn = call && call.function ? call.function : {};
      const args = parseArgs(fn.arguments);
      let result;
      if (args === null) { malformed++; result = 'Error: the arguments were not valid JSON.'; }
      else result = executeTool(ctx, fn.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id || `call_${toolCalls}`, content: result });
      if (ctx.finished) break;
    }
  }

  // The authoritative check: run the verify command once more after the loop, whatever
  // the model said, so the report never rests on the model's own claim.
  const finalVerify = verify && (ctx.files_changed.size || (ctx.finished && ctx.finished.status === 'done'))
    ? runVerify(root, verify, cfg.verify_timeout_s) : null;

  let status;
  if (ctx.finished && ctx.finished.status === 'blocked') status = 'blocked';
  else if (ctx.finished) status = finalVerify && !finalVerify.passed ? 'failed_verify' : 'done';
  else status = 'incomplete';

  return {
    status,
    model: cfg.model,
    endpoint: cfg.endpoint,
    report: ctx.finished ? ctx.finished.summary : lastText.slice(0, 4000),
    stop_reason: ctx.finished ? 'finish' : (stop === 'nudged' ? 'turn_limit' : stop || 'turn_limit'),
    files_changed: [...ctx.files_changed].sort(),
    refused_writes: [...ctx.refused_writes].sort(),
    verify: finalVerify,
    turns,
    tool_calls: toolCalls,
    malformed_calls: malformed,
    usage,
    elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    max_rounds: cfg.max_rounds,
  };
}

/** GET {endpoint}/models: is the server up, and does it serve the configured model? */
async function probeEndpoint(cfg, fetchImpl = globalThis.fetch) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STATUS_TIMEOUT_MS);
  try {
    const headers = {};
    const key = cfg.api_key_env ? process.env[cfg.api_key_env] : '';
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await fetchImpl(`${cfg.endpoint}/models`, { headers, signal: ac.signal });
    if (!res.ok) return { reachable: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    const ids = Array.isArray(body && body.data) ? body.data.map((m) => m && m.id).filter(Boolean) : [];
    const want = cfg.model;
    const available = !!want && ids.some((id) => id === want || id === `${want}:latest` || (!want.includes(':') && id.startsWith(`${want}:`)));
    return { reachable: true, models: ids.slice(0, 50), model_available: available };
  } catch (e) {
    return { reachable: false, detail: (e && e.name === 'AbortError') ? 'timed out' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `pan-tools delegate status|run`.
 * @param {string} cwd
 * @param {string} sub - status | run
 * @param {{spec?:string, allow?:string, verify?:string}} opts
 * @param {boolean} raw
 * @param {{output:Function, fetchImpl?:Function}} io
 */
async function cmdDelegate(cwd, sub, opts, raw, io) {
  const { output } = io;
  const fetchImpl = io.fetchImpl || globalThis.fetch;
  const home = io.home || os.homedir();
  const cfg = readLocalConfig(cwd, { home });
  const pub = { enabled: cfg.enabled, endpoint: cfg.endpoint, model: cfg.model, allow_remote: cfg.allow_remote, max_rounds: cfg.max_rounds, source: cfg.source };

  if (sub === 'setup') return cmdDelegateSetup(cwd, cfg, opts, raw, { output, fetchImpl, home });

  if (sub === 'status') {
    // Off is an answer, not a failure: callers run the task themselves (exit 0).
    if (!cfg.enabled) return output({ ...pub, ready: false, reason: 'local_executor.enabled is false' }, raw, 'off');
    const problem = endpointProblem(cfg);
    if (problem) return output({ ...pub, ready: false, reason: problem }, raw, 'off');
    if (!cfg.model) return output({ ...pub, ready: false, reason: 'local_executor.model is not set' }, raw, 'off');
    if (typeof fetchImpl !== 'function') return output({ ...pub, ready: false, reason: 'this Node has no fetch (Node 18+ needed)' }, raw, 'off');
    const probe = await probeEndpoint(cfg, fetchImpl);
    const ready = probe.reachable && probe.model_available;
    const reason = !probe.reachable ? `endpoint unreachable: ${probe.detail}` : (!probe.model_available ? `model ${cfg.model} is not served by the endpoint` : undefined);
    return output({ ...pub, ready, reachable: probe.reachable, model_available: !!probe.model_available, ...(reason ? { reason } : {}) }, raw, ready ? 'ready' : 'off');
  }

  // sub === 'run'
  if (!cfg.enabled) return output({ error: 'local_executor_disabled', ...pub }, raw);
  const problem = endpointProblem(cfg);
  if (problem) return output({ error: problem, ...pub }, raw);
  if (!cfg.model) return output({ error: 'model_not_set', ...pub }, raw);
  if (typeof fetchImpl !== 'function') return output({ error: 'fetch_unavailable', detail: 'Node 18+ is needed' }, raw);
  if (!opts.spec) return output({ error: 'spec_required', usage: 'delegate run --spec <file> --allow <files> [--verify <command>]' }, raw);
  if (!opts.allow) return output({ error: 'allow_required', usage: 'delegate run --spec <file> --allow <files> [--verify <command>]' }, raw);

  const root = fs.realpathSync(cwd);
  const planningRelDir = toPosixRel(path.relative(root, planningPath(root))) || '.planning';
  let spec;
  let allow;
  try {
    const s = confine(root, opts.spec);
    spec = fs.readFileSync(s.abs, 'utf-8');
    allow = parseAllow(root, opts.allow, planningRelDir);
  } catch (e) {
    return output({ error: 'invalid_arguments', detail: String((e && e.message) || e) }, raw);
  }
  if (!spec.trim()) return output({ error: 'spec_empty' }, raw);
  if (!allow.length) return output({ error: 'allow_required' }, raw);

  try {
    const report = await runLocalTask({ root, cfg, spec, allow, verify: opts.verify || '', fetchImpl });
    return output(report, raw, report.status);
  } catch (e) {
    return output({ error: e.code || 'endpoint_unreachable', detail: String((e && e.message) || e), ...pub }, raw);
  }
}

/** Write `patch` into the local_executor section of the chosen scope's file. */
function writeScope(cwd, scope, patch, home) {
  if (scope === 'machine') {
    const file = machineConfigPath(home);
    const current = readJsonObject(file) || {};
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
    return file;
  }
  const file = planningPath(cwd, 'config.json');
  let config = {};
  if (fs.existsSync(file)) {
    config = readJsonObject(file);
    if (!config) { const e = new Error('.planning/config.json is not a JSON object'); e.code = 'config_unreadable'; throw e; }
  }
  config.local_executor = { ...(config.local_executor || {}), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}

/**
 * `delegate setup`: find the local server's models, pick one for coding, and turn
 * offload on for this machine (default) or this project. `--dry-run` reports what it
 * would choose without writing; `--off` turns offload off in the chosen scope.
 */
async function cmdDelegateSetup(cwd, cfg, opts, raw, { output, fetchImpl, home }) {
  const scope = opts.scope || 'machine';
  if (scope !== 'machine' && scope !== 'project') return output({ error: 'invalid_scope', allowed: ['machine', 'project'] }, raw);

  if (opts.off) {
    if (opts.dryRun) return output({ dry_run: true, scope, would_write: { enabled: false } }, raw, 'off');
    try {
      const file = writeScope(cwd, scope, { enabled: false }, home);
      return output({ configured: true, scope, enabled: false, file }, raw, 'off');
    } catch (e) { return output({ error: e.code || 'write_failed', detail: e.message }, raw); }
  }

  const endpoint = (opts.endpoint || cfg.endpoint).replace(/\/+$/, '');
  const probeCfg = { ...cfg, endpoint, allow_remote: cfg.allow_remote || !!opts.endpoint };
  const problem = endpointProblem(probeCfg);
  if (problem) return output({ error: problem, endpoint }, raw);
  if (typeof fetchImpl !== 'function') return output({ error: 'fetch_unavailable', detail: 'Node 18+ is needed' }, raw);

  const probe = await probeEndpoint({ ...probeCfg, model: '' }, fetchImpl);
  if (!probe.reachable) {
    return output({
      error: 'endpoint_unreachable', endpoint, detail: probe.detail,
      hint: 'Start your local model server (for Ollama: open the Ollama app, or run `ollama serve`), then run this again.',
    }, raw);
  }
  const details = await ollamaDetails(endpoint, fetchImpl);
  const ranked = rankModels(probe.models, details);
  if (!ranked.length) {
    return output({ error: 'no_models', endpoint, hint: 'Download a coding model first, e.g. `ollama pull qwen3.6:35b-a3b-coding`.' }, raw);
  }
  const clean = (id) => id.replace(/:latest$/, '');
  let chosen;
  if (opts.model) {
    const want = opts.model;
    const hit = probe.models.find((id) => id === want || id === `${want}:latest` || clean(id) === clean(want));
    if (!hit) return output({ error: 'model_not_served', model: want, served: probe.models.map(clean) }, raw);
    chosen = clean(hit);
  } else {
    chosen = clean(ranked[0].id);
  }
  const candidates = ranked.slice(0, 4).map((m) => ({
    model: clean(m.id), coding: m.coding, ...(m.size ? { size_gb: Math.round(m.size / 1e8) / 10 } : {}),
    ...(m.params ? { params_b: m.params } : {}), context: m.num_ctx || null,
  }));
  const chosenRow = ranked.find((m) => clean(m.id) === chosen);
  const ctx = chosenRow ? chosenRow.num_ctx : 0;
  const contextHint = ctx >= MIN_GOOD_CONTEXT ? undefined
    : `${chosen} has ${ctx ? `a ${ctx}-token` : 'no configured'} context window; the coding loop works best with ${MIN_GOOD_CONTEXT} or more. For Ollama: put "FROM ${chosen}" and "PARAMETER num_ctx 65536" in a file named Modelfile, run \`ollama create ${chosen.split(':')[0]}-64k -f Modelfile\`, then run setup again.`;
  // An endpoint typed on the command line is the user's explicit choice; one that is
  // not this machine (an office server) is recorded with allow_remote so it is honoured.
  const patch = { enabled: true, model: chosen };
  if (opts.endpoint) { patch.endpoint = endpoint; patch.allow_remote = !isLoopbackHost(new URL(endpoint).hostname); }

  if (opts.dryRun) return output({ dry_run: true, scope, endpoint, chosen, candidates, would_write: patch, ...(contextHint ? { context_hint: contextHint } : {}) }, raw, chosen);
  try {
    const file = writeScope(cwd, scope, patch, home);
    const note = scope === 'project' && cfg.source === 'machine' ? 'This project now overrides the setting for this machine.' : undefined;
    return output({ configured: true, scope, enabled: true, model: chosen, endpoint, candidates, file, ...(note ? { note } : {}), ...(contextHint ? { context_hint: contextHint } : {}) }, raw, chosen);
  } catch (e) {
    return output({ error: e.code || 'write_failed', detail: e.message }, raw);
  }
}

module.exports = {
  LOCAL_EXECUTOR_DEFAULTS,
  machineConfigPath,
  rankModels,
  paramsFromName,
  readLocalConfig,
  isLoopbackHost,
  endpointProblem,
  confine,
  parseAllow,
  writeAllowed,
  isSensitive,
  runVerify,
  executeTool,
  runLocalTask,
  probeEndpoint,
  cmdDelegate,
  TOOL_DEFS,
};
