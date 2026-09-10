/**
 * Agent Plugins bundle — conformance of the EMITTED tree (ADR-0045 D8).
 *
 * Every rule here is enforced against the two schemas pinned under
 * tests/fixtures/agent-plugins/ (fetched from agent-plugins.org on 2026-09-10)
 * and against the Agent Skills discovery rules the spec incorporates. The
 * manifest schema is CLOSED: an unlisted key is a fatal rejection of the whole
 * plugin, so these checks are the difference between a bundle that loads and
 * one that silently does not.
 *
 * The validator below is a deliberately small JSON-Schema subset — exactly the
 * keywords the two pinned schemas use — because PAN is zero-dependency. If a
 * schema revision introduces a keyword it does not know, `unknownKeywords`
 * reports it rather than passing vacuously.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('../bin/install-lib.cjs');
const { buildAgentPluginInto, buildPluginInto, cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'agent-plugins');
const pluginSchema = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'plugin.schema.json'), 'utf8'));
const mcpSchema = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mcp.schema.json'), 'utf8'));

// ─── minimal JSON-Schema subset validator ────────────────────────────────────

const KNOWN_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'const', 'required', 'properties',
  'additionalProperties', 'propertyNames', 'not', 'enum', 'pattern', 'minLength', 'maxLength',
  'items', 'oneOf', '$ref', '$defs',
]);

function unknownKeywords(schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return seen;
  for (const k of Object.keys(schema)) if (!KNOWN_KEYWORDS.has(k)) seen.add(k);
  for (const sub of Object.values(schema.properties || {})) unknownKeywords(sub, seen);
  for (const sub of Object.values(schema.$defs || {})) unknownKeywords(sub, seen);
  for (const sub of schema.oneOf || []) unknownKeywords(sub, seen);
  if (schema.items) unknownKeywords(schema.items, seen);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') unknownKeywords(schema.additionalProperties, seen);
  if (schema.propertyNames) unknownKeywords(schema.propertyNames, seen);
  if (schema.not) unknownKeywords(schema.not, seen);
  return seen;
}

function resolveRef(ref, rootSchema) {
  assert.ok(ref.startsWith('#/'), `only local refs are supported: ${ref}`);
  return ref.slice(2).split('/').reduce((node, seg) => node[seg], rootSchema);
}

function validate(schema, value, rootSchema, where = '$') {
  const errors = [];
  if (schema.$ref) return validate(resolveRef(schema.$ref, rootSchema), value, rootSchema, where);
  if (schema.oneOf) {
    const passing = schema.oneOf.filter(s => validate(s, value, rootSchema, where).length === 0).length;
    if (passing !== 1) errors.push(`${where}: matched ${passing} of oneOf branches, expected exactly 1`);
    return errors;
  }
  if ('const' in schema && value !== schema.const) errors.push(`${where}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: not in enum`);
  if (schema.not && validate(schema.not, value, rootSchema, where).length === 0) errors.push(`${where}: matches a forbidden schema`);
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (t !== schema.type) { errors.push(`${where}: expected ${schema.type}, got ${t}`); return errors; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${where}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${where}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errors.push(...validate(schema.items, v, rootSchema, `${where}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required || []) if (!(req in value)) errors.push(`${where}: missing required "${req}"`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames) errors.push(...validate(schema.propertyNames, k, rootSchema, `${where}.<key ${k}>`));
      if (schema.properties && k in schema.properties) errors.push(...validate(schema.properties[k], v, rootSchema, `${where}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${where}: unexpected key "${k}" (closed schema)`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, v, rootSchema, `${where}.${k}`));
    }
  }
  return errors;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const frontmatterOf = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
};
const topLevelKeys = (fm) => fm.split(/\r?\n/).filter(l => /^[A-Za-z]/.test(l)).map(l => l.split(':')[0]);
const fieldOf = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : null;
};
const walkMd = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc); else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
};

// ─── the suite ───────────────────────────────────────────────────────────────

describe('Agent Plugins bundle (ADR-0045): emitted tree conforms to the pinned schemas', () => {
  const OUT = buildAgentPluginInto();
  after(() => cleanup(OUT));
  const skillsDir = path.join(OUT, 'skills');
  const coreDir = path.join(OUT, 'pan-wizard-core');

  test('non-vacuity: the bundle has skills, a core, a manifest and an mcp.json', () => {
    assert.ok(fs.existsSync(path.join(OUT, 'plugin.json')), 'plugin.json missing');
    assert.ok(fs.existsSync(path.join(OUT, 'mcp.json')), 'mcp.json missing');
    assert.ok(fs.readdirSync(skillsDir).length > 0, 'no skills emitted');
    assert.ok(fs.existsSync(path.join(coreDir, 'bin', 'pan-tools.cjs')), 'core missing pan-tools.cjs');
    assert.ok(fs.existsSync(path.join(coreDir, 'mcp', 'server.cjs')), 'core missing the MCP server');
    assert.ok(fs.readdirSync(path.join(coreDir, 'agents')).some(f => f.endsWith('.md')), 'no agent reference copies');
  });

  test('the validator knows every keyword the pinned schemas use (else it could pass vacuously)', () => {
    assert.deepEqual([...unknownKeywords(pluginSchema)], [], 'plugin.schema.json uses keywords the validator ignores');
    assert.deepEqual([...unknownKeywords(mcpSchema)], [], 'mcp.schema.json uses keywords the validator ignores');
    // And it actually rejects: a closed-schema violation must surface.
    assert.ok(validate(pluginSchema, { $schema: pluginSchema.properties.$schema.const, name: 'x', bogus: 1 }, pluginSchema).length > 0);
    assert.ok(validate(pluginSchema, { $schema: 'wrong', name: 'x' }, pluginSchema).length > 0);
    assert.ok(validate(pluginSchema, { $schema: pluginSchema.properties.$schema.const, name: 'Bad--Name' }, pluginSchema).length > 0);
  });

  test('plugin.json validates against the pinned Agent Plugins manifest schema', () => {
    const manifest = readJson(path.join(OUT, 'plugin.json'));
    assert.deepEqual(validate(pluginSchema, manifest, pluginSchema), []);
    assert.equal(manifest.$schema, lib.AGENT_PLUGIN_MANIFEST_SCHEMA);
    assert.equal(manifest.name, 'pan-wizard');
  });

  test('plugin.json mirrors package.json (the description propagated a false role claim once — pin the mirror)', () => {
    const pkg = readJson(path.join(ROOT, 'package.json'));
    const manifest = readJson(path.join(OUT, 'plugin.json'));
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.description, pkg.description);
    assert.equal(manifest.license, pkg.license);
  });

  test('mcp.json validates and declares the bundled bridge the way the spec allows', () => {
    const mcp = readJson(path.join(OUT, 'mcp.json'));
    assert.deepEqual(validate(mcpSchema, mcp, mcpSchema), []);
    const pan = mcp.mcpServers.pan;
    assert.equal(pan.type, 'stdio');
    // `command` must be a single executable token with no placeholder (spec).
    assert.equal(pan.command, 'node');
    assert.ok(!/\$\{/.test(pan.command), 'command may not carry a placeholder');
    // The script path lives in args, where ${PLUGIN_ROOT} expansion is defined,
    // and must resolve INSIDE the bundle once expanded.
    assert.ok(pan.args[0].startsWith('${PLUGIN_ROOT}/'), `args[0] must be PLUGIN_ROOT-anchored: ${pan.args[0]}`);
    const resolved = path.join(OUT, pan.args[0].replace('${PLUGIN_ROOT}/', ''));
    assert.ok(fs.existsSync(resolved), `declared server path missing in bundle: ${pan.args[0]}`);
    assert.equal(pan.env, undefined, 'no env block — a plugin serves whatever project the session is in');
  });

  test('every skill is discoverable: one immediate child dir per skill, name equals directory, closed key set, no angle brackets', () => {
    const problems = [];
    const ALLOWED = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
    for (const dir of fs.readdirSync(skillsDir)) {
      const skillMd = path.join(skillsDir, dir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) { problems.push(`${dir}: no SKILL.md`); continue; }
      const fm = frontmatterOf(fs.readFileSync(skillMd, 'utf8'));
      if (!fm) { problems.push(`${dir}: no frontmatter`); continue; }
      if (fieldOf(fm, 'name') !== dir) problems.push(`${dir}: name "${fieldOf(fm, 'name')}" does not equal its directory`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dir) || dir.length > 64) problems.push(`${dir}: name violates the Agent Skills pattern`);
      const desc = fieldOf(fm, 'description') || '';
      if (desc.length < 1 || desc.length > 1024) problems.push(`${dir}: description length ${desc.length}`);
      for (const k of topLevelKeys(fm)) if (!ALLOWED.has(k)) problems.push(`${dir}: unexpected frontmatter key "${k}"`);
      if (/[<>]/.test(fm)) problems.push(`${dir}: angle bracket in frontmatter (prompt-injection vector the spec warns about)`);
      if (!fm.includes('compatibility:')) problems.push(`${dir}: missing compatibility`);
    }
    assert.deepEqual(problems, [], `skill conformance problems:\n${problems.join('\n')}`);
  });

  test('every skill carries the bundle adapter note that defines the root token', () => {
    const note = lib.agentPluginSkillAdapterNote();
    for (const dir of fs.readdirSync(skillsDir)) {
      const body = fs.readFileSync(path.join(skillsDir, dir, 'SKILL.md'), 'utf8');
      assert.ok(body.includes(note), `${dir}: adapter note missing`);
      assert.ok(body.indexOf(note) < body.indexOf('</pan_skill_adapter>'), `${dir}: note must sit inside the adapter block`);
    }
  });

  test('every {{PAN_PLUGIN_ROOT}} reference in skills and core markdown resolves inside the bundle', () => {
    const token = lib.AGENT_PLUGIN_ROOT_TOKEN.replace(/[{}]/g, '\\$&');
    const re = new RegExp(`${token}/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])`, 'g');
    const dangling = new Map();
    let total = 0;
    for (const file of [...walkMd(skillsDir), ...walkMd(coreDir)]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        total++;
        const target = path.join(OUT, m[1]);
        if (!fs.existsSync(target)) dangling.set(m[1], (dangling.get(m[1]) || 0) + 1);
      }
    }
    assert.ok(total > 0, 'non-vacuity: no root-token references found at all');
    assert.deepEqual([...dangling.entries()], [],
      `references to paths absent from the bundle (path → occurrences):\n${[...dangling.entries()].map(([p, n]) => `  ${p} × ${n}`).join('\n')}`);
  });

  test('no install-path form survives in the bundle content (bare `.claude/` prose listing runtime dirs is fine)', () => {
    // These are the forms that mean "where PAN was installed" and can only be
    // wrong in a bundle. A bare `.claude/` in a sentence that lists all five
    // runtime directories is a description of a project layout, not a path
    // PAN will resolve — the installer leaves those too.
    const bad = [/~\/\.claude\//, /\.\/\.claude\//, /\.claude\/pan-wizard-core/, /\.agents\/pan-wizard-core/, /\$\{CLAUDE_PLUGIN_ROOT\}/];
    const leaks = [];
    for (const file of [...walkMd(skillsDir), ...walkMd(coreDir)]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const re of bad) if (re.test(text)) leaks.push(`${path.relative(OUT, file)}: ${re}`);
    }
    assert.deepEqual(leaks, [], `leaked install paths:\n${leaks.join('\n')}`);
  });

  test('runtime-directory references use the two runtime tokens, and the adapter note defines every token it emits', () => {
    const note = lib.agentPluginSkillAdapterNote();
    for (const tok of [lib.AGENT_PLUGIN_ROOT_TOKEN, lib.AGENT_PLUGIN_RUNTIME_HOME_TOKEN, lib.AGENT_PLUGIN_RUNTIME_DIR_TOKEN]) {
      assert.ok(note.includes(tok), `adapter note must define ${tok}`);
    }
    // Non-vacuity: the source really does carry runtime-config references
    // (update cache, settings.json, patches dir), so the home token must occur.
    const all = [...walkMd(skillsDir), ...walkMd(coreDir)].map(f => fs.readFileSync(f, 'utf8')).join('\n');
    assert.ok(all.includes(`${lib.AGENT_PLUGIN_RUNTIME_HOME_TOKEN}/`), 'expected at least one user-level runtime reference to be tokenised');
    // And no unknown {{PAN_…}} token slipped in: everything in double braces is
    // one of the three tokens or the long-standing {{PAN_ARGS}}.
    const known = new Set([lib.AGENT_PLUGIN_ROOT_TOKEN, lib.AGENT_PLUGIN_RUNTIME_HOME_TOKEN, lib.AGENT_PLUGIN_RUNTIME_DIR_TOKEN, '{{PAN_ARGS}}']);
    const unknown = [...new Set([...all.matchAll(/\{\{PAN_[A-Z_]+\}\}/g)].map(m => m[0]))].filter(t => !known.has(t));
    assert.deepEqual(unknown, [], 'undefined PAN tokens in bundle content');
  });

  test('internal learnings are stripped from both the files and the index', () => {
    assert.ok(!fs.existsSync(path.join(coreDir, 'learnings', 'internal')));
    const index = readJson(path.join(coreDir, 'learnings', 'index.json'));
    assert.ok(Array.isArray(index.topics) && index.topics.length > 0, 'non-vacuity: index has topics');
    assert.deepEqual(index.topics.filter(t => t.scope === 'internal'), []);
    assert.equal(index.totals.topics, index.topics.length, 'totals must be recomputed, not left stale');
  });

  test('the builder refuses to wipe a directory that is not a previous bundle build', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-notabundle-'));
    t.after(() => cleanup(dir));
    fs.writeFileSync(path.join(dir, 'precious.txt'), 'do not delete');
    assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-agent-plugin.js')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PAN_AGENT_PLUGIN_OUT: dir },
    }), /refusing to replace/);
    assert.ok(fs.existsSync(path.join(dir, 'precious.txt')));
    // Rebuilding over a previous bundle is fine.
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-agent-plugin.js')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PAN_AGENT_PLUGIN_OUT: OUT },
    });
    assert.ok(fs.existsSync(path.join(OUT, 'plugin.json')));
  });
});

describe('Agent Plugins bundle: the Claude plugin is untouched by the shared-compiler extraction', () => {
  test('the Claude plugin build carries no bundle token and no Agent Plugins schema', (t) => {
    const out = buildPluginInto();
    t.after(() => cleanup(out));
    const offenders = [];
    for (const file of walkMd(path.join(out, 'commands'))) {
      if (fs.readFileSync(file, 'utf8').includes(lib.AGENT_PLUGIN_ROOT_TOKEN)) offenders.push(path.relative(out, file));
    }
    assert.deepEqual(offenders, []);
    assert.ok(!fs.existsSync(path.join(out, 'plugin.json')), 'a root plugin.json belongs to the Agent Plugins bundle, not the Claude plugin');
    assert.ok(!fs.existsSync(path.join(out, 'mcp.json')), 'the Claude plugin declares MCP in .mcp.json, never mcp.json');
  });

  test('the unified-skill adapter header is byte-identical when no note is passed', () => {
    const plain = lib.getUnifiedSkillAdapterHeader('pan-x');
    assert.ok(!plain.includes('Plugin bundle'), 'no bundle text without a note');
    assert.ok(plain.endsWith('</pan_skill_adapter>'));
    assert.equal(lib.convertClaudeCommandToUnifiedSkill('---\ndescription: d\n---\nbody', 'pan-x'),
      lib.convertClaudeCommandToUnifiedSkill('---\ndescription: d\n---\nbody', 'pan-x', {}),
      'an empty options object must be indistinguishable from the two-argument call');
  });
});

describe('Agent Plugins bundle: pure builders and rewrites', () => {
  test('buildAgentPluginManifest emits only keys the closed schema permits', () => {
    const m = lib.buildAgentPluginManifest({ version: '1.2.3', description: 'd', license: 'MIT' });
    assert.deepEqual(validate(pluginSchema, m, pluginSchema), []);
    assert.equal(m.version, '1.2.3');
  });

  test('stripInternalLearningsTopics recomputes totals exactly and returns null when nothing is internal', () => {
    const idx = {
      topics: [
        { name: 'a', scope: 'universal', patterns: [1, 2], size_bytes: 10, size_tokens_est: 3 },
        { name: 'b', scope: 'internal', patterns: [1], size_bytes: 100, size_tokens_est: 30 },
      ],
      totals: { topics: 2, patterns: 3, size_bytes: 110, size_tokens_est: 33 },
    };
    const out = lib.stripInternalLearningsTopics(idx);
    assert.deepEqual(out.topics.map(t => t.name), ['a']);
    assert.deepEqual(out.totals, { topics: 1, patterns: 2, size_bytes: 10, size_tokens_est: 3 });
    assert.equal(idx.topics.length, 2, 'input must not be mutated');
    assert.equal(lib.stripInternalLearningsTopics({ topics: [{ scope: 'universal' }] }), null);
    assert.equal(lib.stripInternalLearningsTopics(null), null);
  });

  test('rewriteUnifiedSkillCommandContent reproduces the installer sequence (specific refs before generic)', () => {
    const src = 'See ~/.claude/pan-wizard-core/workflows/x.md and ~/.claude/agents/pan-planner.md; run pan-tools state; also ./.claude/settings.json and ~/.claude/other.md\n\nCo-Authored-By: Someone';
    const out = lib.rewriteUnifiedSkillCommandContent(src, { corePrefix: './.agents/', pathPrefix: 'P/', projectDirPrefix: './.codex/', attribution: null });
    assert.ok(out.includes('./.agents/pan-wizard-core/workflows/x.md'));
    assert.ok(out.includes('./.agents/pan-wizard-core/agents/pan-planner.md'), 'agent refs go to the canonical copies in the shared core');
    assert.ok(out.includes('node ./.agents/pan-wizard-core/bin/pan-tools.cjs state'));
    assert.ok(out.includes('./.codex/settings.json'));
    assert.ok(out.includes('P/other.md'));
    assert.ok(!out.includes('Co-Authored-By'), 'attribution null removes the trailer');
  });
});
