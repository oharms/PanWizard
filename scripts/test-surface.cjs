#!/usr/bin/env node
'use strict';
/**
 * test-surface.cjs — the shipped surface derived from the code, and its map to the tests.
 *
 * What must be tested is read off the code, never off the tests (spec:
 * docs/specs/testing-system-redesign-2026-09.md). The surface is:
 *   - every top-level verb, from the dispatcher's own usage line;
 *   - every subcommand, from the dispatcher's "Unknown <group> subcommand. Available: …"
 *     strings (the same parse `suggest.cjs` and the doc-command-surface lint use);
 *   - every dispatcher `case` arm (dynamic coverage only — see coverage-gate.cjs);
 *   - every installer flag literal in bin/install.js;
 *   - every hook × runtime registration, from install-lib's HOOK_EVENT_MAP;
 *   - every MCP tool and resource, from the bridge's registry;
 *   - every config default key, from buildConfigDefaults();
 *   - the shipped content directories (commands, agents, workflows), one row each —
 *     a test that iterates the directory covers every file in it.
 *
 * Modes:
 *   node scripts/test-surface.cjs            summary
 *   node scripts/test-surface.cjs --write    write tests/fixtures/surface.json (the committed registry)
 *   node scripts/test-surface.cjs --check    exit 1 when the committed registry differs from the code, or
 *                                            a command, agent, verb or config key has no user (liveness, L1)
 *   node scripts/test-surface.cjs --liveness who uses each command, agent, verb, subcommand and config key
 *   node scripts/test-surface.cjs --map      which test files reference each surface row; lists the misses
 *   node scripts/test-surface.cjs --scaffold <dir>   one todo stub per unreferenced row (for a suite rebuilt from scratch)
 *
 * The static map here says "a test names this surface as the code names it". Whether
 * the code actually ran is the coverage gate's job. Both are needed: a test can name a
 * subcommand in a comment, and a subcommand can run without any test naming it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_REL = path.join('tests', 'fixtures', 'surface.json');
const ALLOWLIST_REL = path.join('tests', 'fixtures', 'surface-allowlist.json');

const SOURCES = Object.freeze({
  dispatcher: 'pan-wizard-core/bin/pan-tools.cjs',
  installer: 'bin/install.js',
  installLib: 'bin/install-lib.cjs',
  suggest: 'pan-wizard-core/bin/lib/suggest.cjs',
  config: 'pan-wizard-core/bin/lib/config.cjs',
  mcpRegistry: 'pan-wizard-core/mcp/tool-registry.cjs',
});

const CONTENT_DIRS = Object.freeze({
  'commands/pan': /\.md$/,
  agents: /\.md$/,
  'pan-wizard-core/workflows': /\.(md|js)$/,
});

// Registrations the installer wires outside HOOK_EVENT_MAP: the statuslines. (The
// stop guard moved INTO the table on 2026-09-23 as its `stop` slot, so its Gemini
// row follows Gemini's vocabulary — AfterAgent — instead of a hand-written `Stop`
// that Gemini never read.)
const EXTRA_HOOK_ROWS = Object.freeze([
  { runtime: 'claude', hook: 'pan-statusline.js', event: 'statusLine', surface: 'settings.json' },
  // Copilot registers a statusline too; it was missing here until a real install was
  // read back (2026-09-17) — the registry's whole purpose is that a shipped
  // registration cannot sit outside it, so a hand-maintained list is the weak point.
  // Copilot keeps its hooks in hooks/pan.json but its statusline in copilot/settings.json.
  // Gemini's row is gone: Gemini CLI has no statusline command, so PAN stopped
  // writing one there (R29).
  { runtime: 'copilot', hook: 'pan-statusline.js', event: 'statusLine', surface: 'copilot/settings.json' },
]);
const EVENT_HOOKS = Object.freeze({
  sessionStart: ['pan-check-update.js'],
  preToolUse: ['pan-guard.js'],
  postToolUse: ['pan-context-monitor.js'],
  subagentStop: ['pan-cost-logger.js', 'pan-trace-logger.js'],
  stop: ['pan-stop-guard.js'],
  compact: ['pan-state-reinject.js'],
  // Gemini and Copilot (market-ideas M33): the marker before a compaction, and the
  // block on the next tool result — the same script in two modes.
  compactMark: ['pan-state-reinject.js'],
  compactInject: ['pan-state-reinject.js'],
});

// ─── Parsers (pure) ─────────────────────────────────────────────────────────

function parseTopLevelCommands(src) {
  const m = src.match(/Commands: ([^']+)'/);
  if (!m) throw new Error('dispatcher source carries no "Commands: …" usage line');
  return [...new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean))].sort();
}

/**
 * Per-group subcommands from every "Unknown <group> subcommand … Available: …" string,
 * quoted or template literal (`state` and `links` interpolate the bad value, which
 * suggest.cjs's index skips). Entries like "phase <N>" contribute their first token.
 * The same parse tests/doc-command-surface.test.cjs uses.
 */
function parseGroupSubcommands(src) {
  const groups = {};
  for (const m of src.matchAll(/Unknown ([a-z][a-z-]*) subcommand[^`']*Available: ([^`']+)/g)) {
    const subs = m[2].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    groups[m[1]] = [...new Set([...(groups[m[1]] || []), ...subs])];
  }
  return groups;
}

/** `case '<label>':` arms with nesting by indentation; returns [{ label, parent, line, indent }]. */
function parseCaseArms(src) {
  const arms = [];
  src.split(/\r?\n/).forEach((text, i) => {
    const m = /^(\s*)case\s+'([^']+)'\s*:/.exec(text);
    if (!m) return;
    const indent = m[1].length;
    const parent = [...arms].reverse().find((a) => a.indent < indent);
    arms.push({ label: m[2], parent: parent ? parent.label : null, line: i + 1, indent });
  });
  return arms;
}

function parseInstallerFlags(src) {
  return [...new Set([...src.matchAll(/'(--[a-z][a-z-]*)'/g)].map((m) => m[1]))].sort();
}

function flattenKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenKeys(v, key));
    else out.push(key);
  }
  return out;
}

function hookMatrix(hookEventMap) {
  const rows = [];
  for (const [runtime, spec] of Object.entries(hookEventMap || {})) {
    if (!spec) continue; // a runtime with no hook system (OpenCode)
    for (const [slot, hooks] of Object.entries(EVENT_HOOKS)) {
      if (!spec[slot]) continue;
      for (const hook of hooks) rows.push({ runtime, hook, event: spec[slot], surface: spec.surface });
    }
  }
  // Each extra row names its own surface; these registrations are not all in the file
  // the runtime's hooks live in.
  rows.push(...EXTRA_HOOK_ROWS.map((r) => ({ ...r })));
  return rows.sort((a, b) => `${a.runtime}/${a.hook}`.localeCompare(`${b.runtime}/${b.hook}`));
}

function listContent(root, dir, re) {
  try { return fs.readdirSync(path.join(root, dir)).filter((f) => re.test(f)).sort(); } catch { return []; }
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * The surface, from the code. `overrides` maps a SOURCES rel path to source text
 * (tests inject a modified dispatcher or installer); modules are always required.
 */
function extractSurface(root = ROOT, overrides = {}) {
  const read = (rel) => (overrides[rel] != null ? overrides[rel] : fs.readFileSync(path.join(root, rel), 'utf8'));
  const dispatcherSrc = read(SOURCES.dispatcher);
  const { buildSubcommandIndex } = require(path.join(root, SOURCES.suggest));
  // Union of the dispatcher's own index and the error-string parse: the index is what
  // `pan-tools` suggests on a typo, the parse is what the docs lint checks; a group
  // either misses is still a surface.
  const subIndex = buildSubcommandIndex(dispatcherSrc);
  for (const [group, subs] of Object.entries(parseGroupSubcommands(dispatcherSrc))) {
    subIndex[group] = [...new Set([...(subIndex[group] || []), ...subs])];
  }
  const { HOOK_EVENT_MAP } = require(path.join(root, SOURCES.installLib));
  const registry = require(path.join(root, SOURCES.mcpRegistry));
  const { buildConfigDefaults } = require(path.join(root, SOURCES.config));
  const content = {};
  for (const [dir, re] of Object.entries(CONTENT_DIRS)) content[dir] = listContent(root, dir, re);
  return {
    verbs: parseTopLevelCommands(dispatcherSrc),
    subcommands: Object.entries(subIndex).flatMap(([v, subs]) => subs.map((s) => `${v} ${s}`)).sort(),
    case_arms: parseCaseArms(dispatcherSrc).map((a) => (a.parent ? `${a.parent} > ${a.label}` : a.label)).sort(),
    installer_flags: parseInstallerFlags(read(SOURCES.installer)),
    hooks: hookMatrix(HOOK_EVENT_MAP),
    mcp: {
      tools: (registry.TOOLS || []).map((t) => t.name).sort(),
      resources: (registry.RESOURCES || []).map((r) => r.uri).sort(),
    },
    config_keys: flattenKeys(buildConfigDefaults(false, {})).sort(),
    content,
  };
}

/** Rows the static map checks (case arms are dynamic-only). */
function surfaceRows(surface) {
  const rows = [];
  for (const v of surface.verbs) rows.push({ id: `verb:${v}`, kind: 'verb', verb: v });
  for (const s of surface.subcommands) { const [verb, sub] = s.split(' '); rows.push({ id: `sub:${s}`, kind: 'sub', verb, sub }); }
  for (const f of surface.installer_flags) rows.push({ id: `flag:${f}`, kind: 'flag', flag: f });
  for (const h of surface.hooks) rows.push({ id: `hook:${h.runtime}/${h.hook}`, kind: 'hook', runtime: h.runtime, hook: h.hook });
  for (const t of surface.mcp.tools) rows.push({ id: `mcp-tool:${t}`, kind: 'mcp', name: t });
  for (const r of surface.mcp.resources) rows.push({ id: `mcp-resource:${r}`, kind: 'mcp', name: r });
  for (const k of surface.config_keys) rows.push({ id: `config:${k}`, kind: 'config', key: k });
  for (const dir of Object.keys(surface.content)) rows.push({ id: `content:${dir}`, kind: 'content', dir });
  return rows;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this test source name the row the way the code names it? */
function referencePattern(row) {
  switch (row.kind) {
    case 'verb': {
      const v = esc(row.verb);
      return new RegExp(`(['"\`])${v}\\1|[\`'"]${v}\\s+(?:--)?[a-z]|pan-tools(?:\\.cjs)?['"\`]?,?\\s*['"\`]?${v}\\b`);
    }
    case 'sub': {
      const v = esc(row.verb), s = esc(row.sub);
      return new RegExp(`['"\`]${v}['"\`]\\s*,\\s*['"\`]${s}['"\`]|${v}\\s+${s}\\b`);
    }
    case 'flag':
      // The flag as a CLI argument: quoted on its own, or inside a longer command string.
      return new RegExp(`(?:['"\`]|\\s)${esc(row.flag)}(?:['"\`]|\\s|=)`);
    case 'hook': {
      const rt = esc(row.runtime);
      const dir = { claude: '\\.claude', codex: '\\.codex', gemini: '\\.gemini', copilot: '\\.github', opencode: '\\.opencode' }[row.runtime] || rt;
      return { all: [new RegExp(esc(row.hook.replace(/\.js$/, ''))), new RegExp(`${dir}\\b|--${rt}\\b|['"\`]${rt}['"\`]`)] };
    }
    case 'mcp':
      return new RegExp(`['"\`]${esc(row.name)}['"\`]`);
    case 'config': {
      const last = esc(row.key.split('.').pop());
      return new RegExp(`['"\`]${esc(row.key)}['"\`]|\\b${last}\\s*:`);
    }
    case 'content': {
      const word = row.dir.split('/')[0] === 'commands' ? 'commands' : row.dir.split('/').pop();
      return new RegExp(`readdirSync\\([^)]*${esc(word)}`);
    }
    default:
      return /$^/;
  }
}

function matches(pattern, src) {
  if (pattern instanceof RegExp) return pattern.test(src);
  return pattern.all.every((re) => re.test(src));
}

function listTestFiles(root = ROOT) {
  const out = [];
  for (const dir of ['tests', 'tests/scenarios']) {
    try {
      for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.test.cjs')) out.push(path.posix.join(dir, f));
    } catch { /* no such dir */ }
  }
  return out.sort();
}

/** Map rows to the test files that reference them. `testSources` = [{ file, src }]. */
function mapSurface(rows, testSources) {
  return rows.map((row) => {
    const pattern = referencePattern(row);
    const hits = testSources.filter((t) => matches(pattern, t.src)).map((t) => t.file);
    return { ...row, hits };
  });
}

function loadTestSources(root = ROOT) {
  return listTestFiles(root).map((file) => ({ file, src: fs.readFileSync(path.join(root, file), 'utf8') }));
}

/** Registry diff by row id (case arms compared as their own list). */
function diffSurface(committed, fresh) {
  const ids = (s) => new Set([...surfaceRows(s).map((r) => r.id), ...(s.case_arms || []).map((a) => `arm:${a}`), ...Object.entries(s.content || {}).flatMap(([d, files]) => files.map((f) => `file:${d}/${f}`))]);
  const a = ids(committed), b = ids(fresh);
  return { added: [...b].filter((x) => !a.has(x)).sort(), removed: [...a].filter((x) => !b.has(x)).sort() };
}

function slug(id) { return id.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(); }

/** One todo stub per unreferenced row. Todo stubs fail the test-quality lint until filled. */
function scaffold(missingRows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const row of missingRows) {
    const file = path.join(outDir, `scaffold-${slug(row.id)}.test.cjs`);
    const hint = row.kind === 'sub' ? `run \`pan-tools ${row.verb} ${row.sub}\` through runPanTools and assert exit code + parsed JSON`
      : row.kind === 'verb' ? `run \`pan-tools ${row.verb}\` through runPanTools and assert the exit-code contract`
        : row.kind === 'flag' ? `install with ${row.flag} into a temp dir and assert the observable effect`
          : row.kind === 'hook' ? `spawn ${row.hook} through the ${row.runtime} install with a captured payload`
            : row.kind === 'mcp' ? `call ${row.name} through the stdio bridge and assert the payload`
              : row.kind === 'config' ? `set ${row.key} in .planning/config.json and assert the behaviour it governs`
                : `iterate ${row.dir} and assert every file's contract`;
    fs.writeFileSync(file, [
      "const { test } = require('node:test');",
      '',
      `// Surface row without a test: ${row.id}`,
      `// ${hint}`,
      `test.todo(${JSON.stringify(`${row.id} — ${hint}`)});`,
      '',
    ].join('\n'));
    written.push(file);
  }
  return written;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// ─── Liveness (program L1) ──────────────────────────────────────────────────
//
// The map above asks "does a test name it?". Liveness asks "does anything USE it?":
//   - every shipped command and agent is named by a harness scenario, so some behavioural
//     run exercises it as a user would;
//   - every pan-tools verb and subcommand has a caller in what PAN ships: a prompt
//     (commands, agents, workflows, references, templates), a native workflow's prompt
//     (bin/install-lib.cjs), or an MCP tool or resource (the bridge registry);
//   - every config default has a reader: code under the core, hooks, installer or MCP
//     bridge that reads the key, or a shipped prompt that runs `config-get <key>`.
// An orphan either gains a user or sits in tests/fixtures/liveness-allowlist.json with a
// reason; `--check` fails on an orphan without one, and on an entry no longer needed.

const LIVENESS_ALLOWLIST_REL = path.join('tests', 'fixtures', 'liveness-allowlist.json');
const PROMPT_DIRS = Object.freeze(['commands/pan', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/references', 'pan-wizard-core/templates']);
const NATIVE_WORKFLOW_SOURCES = Object.freeze(['bin/install-lib.cjs']);
const READER_DIRS = Object.freeze(['pan-wizard-core/bin', 'pan-wizard-core/mcp', 'pan-wizard-core/opencode', 'hooks', 'bin']);
const SCENARIO_DIR = 'harness/scenarios';

/** Every file under rel (recursively) whose name matches re, as posix paths; skips dist/ and node_modules/. */
function walkFiles(root, rel, re) {
  const out = [];
  const walk = (r) => {
    let ents;
    try { ents = fs.readdirSync(path.join(root, r), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.posix.join(r, e.name);
      if (e.isDirectory()) { if (e.name !== 'dist' && e.name !== 'node_modules') walk(p); } else if (re.test(e.name)) out.push(p);
    }
  };
  walk(rel);
  return out.sort();
}

/**
 * The verbs and `verb sub` pairs a text invokes: the script path (`pan-tools.cjs <verb>`),
 * a backticked `pan-tools <verb>`, or `pan-tools <verb>` as a shell command (opening a
 * line, or after `|`, `;`, `&` or `(`), then the verb and an optional subcommand. Prose
 * that mentions pan-tools is not a call.
 */
function pantoolsCalls(text) {
  const out = new Set();
  const re = /(?:pan-tools\.cjs["']?|`pan-tools|(?:^|[|;&(])[ \t]*pan-tools)[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([a-z][a-z0-9-]*))?/gm;
  let m;
  while ((m = re.exec(text))) { out.add(m[1]); if (m[2]) out.add(`${m[1]} ${m[2]}`); }
  return out;
}

/** The text a liveness check reads, from the tree. Tests pass a hand-built object instead. */
function loadLivenessInputs(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const prompts = PROMPT_DIRS.flatMap((d) => walkFiles(root, d, /\.(md|js)$/)).map((file) => ({ file, src: read(file) }));
  const native = NATIVE_WORKFLOW_SOURCES.filter((f) => fs.existsSync(path.join(root, f))).map((file) => ({ file, src: read(file) }));
  const registry = require(path.join(root, SOURCES.mcpRegistry));
  const mcp = [...(registry.TOOLS || []), ...(registry.RESOURCES || [])].map((t) => ({ name: t.name || t.uri, verb: t.verb, sub: (t.args && t.args[0]) || null }));
  const scenarios = walkFiles(root, SCENARIO_DIR, /\.json$/).map((file) => ({ file, src: read(file) }));
  const configSrc = path.posix.normalize(SOURCES.config);
  const readers = READER_DIRS.flatMap((d) => walkFiles(root, d, /\.(c?js|mjs)$/)).map((file) => ({ file, src: read(file), isConfig: file === configSrc }));
  return { prompts, native, mcp, scenarios, readers };
}

/** The body of buildConfigDefaults in config.cjs: where defaults are written, which is not a read. */
function stripDefaultsBuilder(src) {
  const start = src.indexOf('function buildConfigDefaults');
  if (start === -1) return src;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(0, start) + src.slice(i + 1);
  }
  return src;
}

/**
 * Who uses each piece of the surface. Pure over `surface` (extractSurface) and `inputs`
 * (loadLivenessInputs). Returns one row per command, agent, verb, subcommand and config
 * key: `{id, kind, users: string[]}`; a row with no users is an orphan.
 */
function liveness(surface, inputs) {
  const rows = [];
  const scen = inputs.scenarios;
  const named = (re) => scen.filter((s) => re.test(s.src)).map((s) => s.file);
  for (const f of surface.content['commands/pan'] || []) {
    const name = f.replace(/\.md$/, '');
    // /pan:<name> (Claude, Gemini), /pan-<name> or pan-<name> as a skill (Codex, Copilot, OpenCode), or the file itself.
    rows.push({ id: `command:${name}`, kind: 'command', users: named(new RegExp(`(?:/pan[:-]|commands/pan/|\\bpan-)${esc(name)}(?![a-z0-9-])`)) });
  }
  for (const f of surface.content.agents || []) {
    const name = f.replace(/\.md$/, '');
    rows.push({ id: `agent:${name}`, kind: 'agent', users: named(new RegExp(`(?<![a-z0-9-])${esc(name)}(?![a-z0-9-])`)) });
  }
  const callers = new Map();
  const add = (key, who) => { if (!callers.has(key)) callers.set(key, new Set()); callers.get(key).add(who); };
  for (const t of [...inputs.prompts, ...inputs.native]) for (const c of pantoolsCalls(t.src)) add(c, t.file);
  // A registry entry with no verb (one served by the bridge itself) calls nothing.
  for (const t of inputs.mcp.filter((x) => x.verb)) { add(t.verb, `mcp:${t.name}`); if (t.sub) add(`${t.verb} ${t.sub}`, `mcp:${t.name}`); }
  for (const v of surface.verbs) {
    const direct = callers.get(v) || new Set();
    // A verb is alive when it is called, bare or through any of its subcommands.
    const viaSub = [...callers.entries()].filter(([k]) => k.startsWith(`${v} `)).flatMap(([, s]) => [...s]);
    rows.push({ id: `caller:verb:${v}`, kind: 'verb', users: [...new Set([...direct, ...viaSub])].sort() });
  }
  for (const s of surface.subcommands) rows.push({ id: `caller:sub:${s}`, kind: 'sub', users: [...(callers.get(s) || [])].sort() });
  const readerText = inputs.readers.map((r) => ({ file: r.file, src: r.isConfig ? stripDefaultsBuilder(r.src) : r.src }));
  const promptText = [...inputs.prompts, ...inputs.native];
  for (const key of surface.config_keys) {
    const last = esc(key.split('.').pop());
    const codeRe = new RegExp(`['"\`]${esc(key)}['"\`]|\\.${last}\\b|\\[['"]${last}['"]\\]|['"]${last}['"]`);
    // A prompt reads a key with `config-get <key>`, or names the full dotted key in backticks
    // for the agent to check in the config or the init payload (`workflow.x: true`).
    const promptRe = new RegExp(`config-get[ \\t]+["']?${esc(key)}\\b|\`${esc(key)}[\`:= ]`);
    const users = [...readerText.filter((r) => codeRe.test(r.src)).map((r) => r.file), ...promptText.filter((p) => promptRe.test(p.src)).map((p) => p.file)];
    rows.push({ id: `reader:config:${key}`, kind: 'config', users: [...new Set(users)].sort() });
  }
  return rows;
}

/**
 * Orphans not allowlisted, and allowlist entries that are wrong (no reason, no such row, or
 * a row that has users now). `--check` fails when either list is non-empty.
 */
function livenessProblems(rows, allowlist) {
  const allow = new Map(allowlist.map((a) => [a.id, a]));
  const problems = [];
  for (const a of allowlist) {
    if (!a.reason || !String(a.reason).trim()) problems.push(`liveness allowlist entry ${a.id} has no reason`);
    const row = rows.find((r) => r.id === a.id);
    if (!row) problems.push(`liveness allowlist entry ${a.id} names nothing that exists — remove it`);
    else if (row.users.length) problems.push(`liveness allowlist entry ${a.id} has a user now (${row.users[0]}) — remove the entry`);
  }
  const hint = { command: 'name it in a harness scenario', agent: 'name it in a harness scenario', verb: 'call it from a shipped prompt', sub: 'call it from a shipped prompt', config: 'read it in code, or drop the default' };
  for (const r of rows) if (!r.users.length && !allow.has(r.id)) problems.push(`orphan ${r.id} — ${hint[r.kind]}, or allowlist it in ${LIVENESS_ALLOWLIST_REL} with a reason`);
  return problems;
}

/** What `--check` decides: registry drift plus liveness problems. Pure. */
function checkReport(committed, surface, inputs, allowlist) {
  const drift = diffSurface(committed, surface);
  const live = livenessProblems(liveness(surface, inputs), allowlist);
  return { drift, live, ok: !drift.added.length && !drift.removed.length && !live.length };
}

function readLivenessAllowlist(root = ROOT) {
  try { return readJson(path.join(root, LIVENESS_ALLOWLIST_REL)); } catch { return []; }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(argv) {
  const surface = extractSurface(ROOT);
  const registryPath = path.join(ROOT, REGISTRY_REL);
  if (argv.includes('--write')) {
    fs.writeFileSync(registryPath, JSON.stringify(surface, null, 2) + '\n');
    console.log(`wrote ${REGISTRY_REL}`);
    return 0;
  }
  if (argv.includes('--check')) {
    let committed;
    try { committed = readJson(registryPath); } catch { console.error(`no committed registry at ${REGISTRY_REL} — run --write`); return 1; }
    const { drift: d, live, ok: surfaceOk } = checkReport(committed, surface, loadLivenessInputs(ROOT), readLivenessAllowlist(ROOT));
    // H6: the prompt-rule rows. A rule that is neither grandfathered nor claimed by a
    // scenario's covers (or allowlisted with a reason) fails, as does a stale registry.
    const rules = require('./prompt-rules.cjs').checkRegistry(ROOT);
    const ok = surfaceOk && !rules.stale && !rules.unclaimed.length && !rules.dangling.length && !rules.staleAllowed.length;
    if (ok) { console.log('surface registry matches the code; every command, agent, verb and config key is alive; every new prompt rule is claimed'); return 0; }
    if (rules.stale) console.error('prompt-rule registry is stale — run `node scripts/prompt-rules.cjs --write` and commit it');
    for (const u of rules.unclaimed) console.error(`  unclaimed prompt rule ${u.id}: "${u.text.slice(0, 80)}"`);
    for (const x of rules.dangling) console.error(`  scenario ${x.scenario} covers ${x.id}, which is no rule`);
    for (const id of rules.staleAllowed) console.error(`  prompt-rule allowlist entry ${id} names no rule`);
    if (d.added.length || d.removed.length) {
      console.error(`surface registry is stale — run \`node scripts/test-surface.cjs --write\` and commit it`);
      for (const x of d.added) console.error(`  + ${x}`);
      for (const x of d.removed) console.error(`  - ${x}`);
    }
    if (live.length) {
      console.error('liveness: orphans without a user or an allowlist reason');
      for (const x of live) console.error(`  ${x}`);
    }
    return 1;
  }
  if (argv.includes('--liveness')) {
    const rows = liveness(surface, loadLivenessInputs(ROOT));
    for (const r of rows) console.log(`${r.users.length ? 'ok    ' : 'ORPHAN'} ${r.id.padEnd(48)} ${r.users.slice(0, 2).join(', ')}${r.users.length > 2 ? ` +${r.users.length - 2}` : ''}`);
    console.log(`liveness rows: ${rows.length} · orphans: ${rows.filter((r) => !r.users.length).length}`);
    return 0;
  }
  const rows = mapSurface(surfaceRows(surface), loadTestSources(ROOT));
  const missing = rows.filter((r) => !r.hits.length);
  if (argv.includes('--scaffold')) {
    const dir = argv[argv.indexOf('--scaffold') + 1];
    if (!dir) { console.error('--scaffold needs a directory'); return 1; }
    const written = scaffold(missing, path.resolve(dir));
    console.log(`${written.length} stub(s) written to ${path.resolve(dir)}`);
    return 0;
  }
  if (argv.includes('--map')) {
    for (const r of rows) console.log(`${r.hits.length ? 'ok  ' : 'MISS'} ${r.id.padEnd(44)} ${r.hits.slice(0, 3).join(', ')}${r.hits.length > 3 ? ` +${r.hits.length - 3}` : ''}`);
  }
  console.log(`surface rows: ${rows.length} · referenced: ${rows.length - missing.length} · unreferenced: ${missing.length} · case arms (dynamic): ${surface.case_arms.length}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  ROOT, REGISTRY_REL, ALLOWLIST_REL, SOURCES, EXTRA_HOOK_ROWS,
  parseTopLevelCommands, parseGroupSubcommands, parseCaseArms, parseInstallerFlags, flattenKeys, hookMatrix,
  extractSurface, surfaceRows, referencePattern, mapSurface, listTestFiles, loadTestSources, diffSurface, scaffold,
  LIVENESS_ALLOWLIST_REL, pantoolsCalls, loadLivenessInputs, stripDefaultsBuilder, liveness, livenessProblems, checkReport, readLivenessAllowlist,
};
