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
 *   node scripts/test-surface.cjs --check    exit 1 when the committed registry differs from the code
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

// Hooks the installer wires outside HOOK_EVENT_MAP (bin/install.js: the Stop guard
// on the two runtimes with a Stop event, the statusline on Claude Code only).
const EXTRA_HOOK_ROWS = Object.freeze([
  { runtime: 'claude', hook: 'pan-stop-guard.js', event: 'Stop' },
  { runtime: 'gemini', hook: 'pan-stop-guard.js', event: 'Stop' },
  { runtime: 'claude', hook: 'pan-statusline.js', event: 'statusLine' },
]);
const EVENT_HOOKS = Object.freeze({
  sessionStart: ['pan-check-update.js'],
  postToolUse: ['pan-context-monitor.js'],
  subagentStop: ['pan-cost-logger.js', 'pan-trace-logger.js'],
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
  rows.push(...EXTRA_HOOK_ROWS.map((r) => ({ ...r, surface: 'settings.json' })));
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
    const d = diffSurface(committed, surface);
    if (!d.added.length && !d.removed.length) { console.log('surface registry matches the code'); return 0; }
    console.error(`surface registry is stale — run \`node scripts/test-surface.cjs --write\` and commit it`);
    for (const x of d.added) console.error(`  + ${x}`);
    for (const x of d.removed) console.error(`  - ${x}`);
    return 1;
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
};
