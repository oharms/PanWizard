'use strict';

/**
 * PAN-Z MCP bridge server (M1).
 *
 * A dependency-free JSON-RPC 2.0 server over stdio implementing the small MCP
 * surface ZCode needs: server/discover / initialize / tools/list / tools/call /
 * resources/list / resources/read / ping. It is a DUAL-ERA server (see the MCP
 * 2026-07-28 versioning spec): legacy clients open with the `initialize`
 * handshake; modern clients (2026-07-28+) declare their protocol version in each
 * request's `_meta` and MAY probe `server/discover` first. Each pan-tools verb is
 * reached by spawning
 *   node <pan-tools.cjs> <verb> [args] --raw --cwd <root>
 * and returning its JSON — the CLI's JSON contract IS the tool contract, so the
 * PAN engine (pan-wizard-core) is reused byte-for-byte with no refactor.
 *
 * Zero runtime dependencies: PAN is a zero-dep project, so the MCP protocol is
 * hand-rolled rather than pulled from @modelcontextprotocol/sdk. `handle()` is a
 * pure function of the request given an injected spawn impl, which makes the whole
 * protocol layer unit-testable without stdio or a child process.
 *
 * Security: the child is launched with execFile (argv array, NO shell), the verb
 * is always chosen from the registry allowlist, and every tool argument is
 * validated to a strict shape by the registry before it becomes an argv element.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const reg = require('./tool-registry.cjs');

// Legacy `initialize` default: when a handshake-era client omits protocolVersion
// we answer with this (never a modern version — a legacy client can't speak it).
const PROTOCOL_VERSION = '2025-06-18';
// The modern (per-request `_meta`, stateless) revision this bridge speaks.
const MODERN_PROTOCOL_VERSION = '2026-07-28';
// `_meta` key a modern client uses to declare its protocol version per request.
const META_PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
// `_meta` key under which a server identifies itself in modern results.
const META_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
// Every version whose method shapes this server actually implements — the modern
// revision plus the legacy handshake revisions. Used both for the legacy
// `initialize` echo and for modern per-request version negotiation; we never
// claim to speak a version we don't. Newest first (the `server/discover` order).
const SUPPORTED_VERSIONS_LIST = [MODERN_PROTOCOL_VERSION, '2025-06-18', '2025-03-26', '2024-11-05'];
const SUPPORTED_PROTOCOL_VERSIONS = new Set(SUPPORTED_VERSIONS_LIST);
const SERVER_INFO = { name: 'pan-mcp', version: '0.1.0' };

/** Default engine location: pan-wizard-core is a sibling of pan-zcode/. */
function defaultPanToolsPath() {
  return path.join(__dirname, '..', '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
}

/** Real spawn: shell-less execFile of `node <argv...>`. */
function defaultSpawn(nodeArgs) {
  try {
    const stdout = execFileSync('node', nodeArgs, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: '' };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout).trim() : '',
      stderr: e.stderr ? String(e.stderr).trim() : (e.message || 'spawn failed'),
    };
  }
}

/**
 * Resolve pan-tools' large-payload overflow protocol. When a JSON result exceeds
 * ~50KB, `output()` (core.cjs) writes it to a private tmpfile and prints
 * `@file:<path>` instead. The bridge reads that file back so the MCP client always
 * receives the actual JSON. Only engine-written files under the system tmpdir named
 * out.json are honored (the path comes from our own engine, not from tool input,
 * but this keeps the read narrowly scoped); the tmp dir is cleaned up after read.
 */
function resolveOverflow(stdout) {
  if (typeof stdout !== 'string' || !stdout.startsWith('@file:')) return stdout;
  const real = path.resolve(stdout.slice(6).trim());
  const tmpRoot = path.resolve(os.tmpdir());
  if (!real.startsWith(tmpRoot + path.sep) || path.basename(real) !== 'out.json') return stdout;
  try {
    const text = fs.readFileSync(real, 'utf8');
    try { fs.rmSync(path.dirname(real), { recursive: true, force: true }); } catch { /* best effort */ }
    return text.trim();
  } catch {
    return stdout;
  }
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function toMcpTool(t) {
  return {
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive },
  };
}
function toMcpResource(r) {
  return { uri: r.uri, name: r.name, description: r.description, mimeType: 'application/json' };
}

/**
 * Build a server instance.
 * @param {{panToolsPath?:string, cwd?:string, spawnImpl?:Function}} opts
 *   spawnImpl(nodeArgs)->{ok,stdout,stderr} is injectable for tests.
 */
/** Shell-less git executor bound to a cwd, for native merge-gate tools. */
function makeDefaultGit(cwd) {
  return function git(gitArgs) {
    try {
      const stdout = execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, stdout: String(stdout).trim(), stderr: '' };
    } catch (e) {
      return { ok: false, stdout: '', stderr: e.stderr ? String(e.stderr).trim() : (e.message || 'git failed') };
    }
  };
}

function createServer(opts = {}) {
  const panToolsPath = opts.panToolsPath || process.env.PAN_TOOLS_PATH || defaultPanToolsPath();
  const cwd = opts.cwd || process.env.PAN_PROJECT_ROOT || process.cwd();
  const spawn = opts.spawnImpl || defaultSpawn;
  const gitImpl = opts.gitImpl || makeDefaultGit(cwd);
  const env = opts.env || process.env;

  function runVerb(verb, extraArgs) {
    // Defense in depth: the verb always comes from the registry, but re-check the
    // forbidden pattern here so no future caller can smuggle a force/reset op past it.
    if (reg.FORBIDDEN_VERB.test(verb)) {
      return { ok: false, stdout: '', stderr: `Refused: verb "${verb}" is not permitted` };
    }
    // No --raw: pan-tools' default output is structured JSON (which is what the MCP
    // client wants); --raw would instead emit a bare human scalar. Large results
    // arrive via the @file: overflow protocol, resolved here.
    const r = spawn([panToolsPath, verb, ...extraArgs, '--cwd', cwd]);
    if (r && r.ok) r.stdout = resolveOverflow(r.stdout);
    return r;
  }

  // Returns { error:{code,message} } for JSON-RPC protocol errors (unknown tool /
  // invalid arguments — a bad *request*), or { result:{content,isError} } where
  // isError:true signals a genuine tool *execution* failure (the verb ran and failed).
  function callTool(name, input) {
    const tool = reg.byToolName[name];
    if (!tool) return { error: { code: -32602, message: `Unknown tool: ${name}` } };
    // Native, in-process tools (orchestrator / merge gate) run a handler; a thrown
    // Error means bad params (-32602), matching the spawn-tool validation path.
    if (typeof tool.handler === 'function') {
      try {
        const out = tool.handler({ cwd, input: input || {}, env, gitImpl });
        const text = (out && out.text != null) ? out.text : JSON.stringify(out && out.json);
        return { result: { content: [{ type: 'text', text }], isError: !!(out && out.isError) } };
      } catch (e) {
        return { error: { code: -32602, message: String((e && e.message) || e) } };
      }
    }
    let extra;
    try { extra = tool.args ? tool.args(input || {}) : []; }
    catch (e) { return { error: { code: -32602, message: String((e && e.message) || e) } }; }
    const r = runVerb(tool.verb, extra);
    return { result: { content: [{ type: 'text', text: r.ok ? r.stdout : (r.stderr || 'error') }], isError: !r.ok } };
  }

  // Returns { unknown:true } for an unknown uri, { error:{code,message} } for an
  // engine failure, or { result:{contents} } on success — so handle() can emit a
  // real JSON-RPC error instead of a success frame carrying a stderr string
  // mislabeled as application/json.
  function readResource(uri) {
    const res = reg.byResourceUri[uri];
    if (!res) return { unknown: true };
    const r = runVerb(res.verb, []);
    if (!r.ok) return { error: { code: -32603, message: r.stderr || 'resource read failed' } };
    return { result: { contents: [{ uri, mimeType: 'application/json', text: r.stdout }] } };
  }

  function handle(req) {
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return rpcError(req && req.id != null ? req.id : null, -32600, 'Invalid Request');
    }
    const { id, method, params } = req;
    // A JSON-RPC notification has no id (id=0 is a VALID request id, not a
    // notification). The server must never reply to a notification, so bail before
    // the dispatch — this also stops any request-method sent id-less from emitting
    // an id-less response frame.
    if (id === undefined || id === null) return null;

    // Era detection: a modern client (2026-07-28+) declares its protocol version
    // in `_meta` on every request; a legacy client uses the `initialize` handshake
    // and carries no such field. Gating modern behavior on this presence keeps the
    // legacy path byte-for-byte unchanged.
    const requestedVersion = params && params._meta && params._meta[META_PROTOCOL_VERSION_KEY];
    const isModern = typeof requestedVersion === 'string';

    // Stateless per-request version negotiation: if a modern client asks for a
    // version we don't implement, answer with UnsupportedProtocolVersionError
    // listing what we do support, so it can retry on a mutually-supported version.
    if (isModern && !SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)) {
      return rpcError(id, -32022, 'Unsupported protocol version',
        { supported: SUPPORTED_VERSIONS_LIST, requested: requestedVersion });
    }

    // Modern results MUST carry a `resultType`; legacy results MUST NOT change
    // shape (clients treat an absent resultType as "complete"). Stamp it only on
    // the modern path.
    const reply = (result) => rpcResult(id,
      isModern && result && typeof result === 'object' && result.resultType === undefined
        ? { resultType: 'complete', ...result }
        : result);

    switch (method) {
      // Modern stateless discovery probe (MUST be implemented). Also the stdio
      // backward-compat probe: a dual-era client sends this first; a real
      // DiscoverResult identifies us as modern-capable, and its supportedVersions
      // let the client pick a version before issuing any tools/resources call.
      case 'server/discover':
        return rpcResult(id, {
          resultType: 'complete',
          supportedVersions: SUPPORTED_VERSIONS_LIST,
          capabilities: { tools: {}, resources: {} },
          instructions: 'PAN Wizard engine bridge: planning, verification, and orchestration tools backed by the pan-tools CLI. All tools are read-only except the gated pan_confirm_merge.',
          ttlMs: 3600000,
          cacheScope: 'public',
          _meta: { [META_SERVER_INFO_KEY]: SERVER_INFO },
        });
      case 'initialize': {
        const requested = params && params.protocolVersion;
        // A legacy handshake must not negotiate a modern (per-request `_meta`)
        // revision, so only echo legacy versions; anything else falls back.
        const negotiated = (requested && requested !== MODERN_PROTOCOL_VERSION
          && SUPPORTED_PROTOCOL_VERSIONS.has(requested)) ? requested : PROTOCOL_VERSION;
        return rpcResult(id, { protocolVersion: negotiated, capabilities: { tools: {}, resources: {} }, serverInfo: SERVER_INFO });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: reg.TOOLS.map(toMcpTool) });
      case 'resources/list':
        return reply({ resources: reg.RESOURCES.map(toMcpResource) });
      case 'tools/call': {
        const out = callTool(params && params.name, params && params.arguments);
        return out.error ? rpcError(id, out.error.code, out.error.message) : reply(out.result);
      }
      case 'resources/read': {
        const out = readResource(params && params.uri);
        if (out.unknown) return rpcError(id, -32602, `Unknown resource: ${params && params.uri}`);
        return out.error ? rpcError(id, out.error.code, out.error.message) : reply(out.result);
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  return { handle, panToolsPath, cwd, runVerb };
}

/** Wire the server to stdin/stdout as newline-delimited JSON-RPC (MCP stdio). */
function main() {
  const server = createServer();
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req;
      try { req = JSON.parse(line); }
      catch { process.stdout.write(JSON.stringify(rpcError(null, -32700, 'Parse error')) + '\n'); continue; }
      const resp = server.handle(req);
      if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (require.main === module) main();

module.exports = {
  createServer, defaultPanToolsPath, defaultSpawn, SERVER_INFO, toMcpTool, toMcpResource,
  PROTOCOL_VERSION, MODERN_PROTOCOL_VERSION, SUPPORTED_VERSIONS_LIST, META_PROTOCOL_VERSION_KEY,
};
