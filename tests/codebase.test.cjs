/**
 * Tests for codebase.cjs — language detection, import parsing, dependency graph,
 * circular deps, entry points, orphans, Mermaid generation, best practices, lowercase fallback
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');

const {
  detectLanguages,
  parseImports,
  parseExports,
  buildDependencyGraph,
  findCircularDeps,
  findEntryPoints,
  findOrphanExports,
  generateMermaidGraph,
  detectBestPractices,
  findCodebaseDoc,
  stripComments,
  estimateRepoTokenSize,
} = require('../pan-wizard-core/bin/lib/codebase.cjs');

// ─── detectLanguages ────────────────────────────────────────────────────────

describe('detectLanguages', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty directory returns null primary', () => {
    const result = detectLanguages(tmpDir);
    assert.strictEqual(result.primary, null);
    assert.deepStrictEqual(result.secondary, []);
    assert.strictEqual(result.file_count, 0);
  });

  test('JS-only project detected as javascript', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(src, 'utils.js'), 'module.exports = {};');
    const result = detectLanguages(tmpDir);
    assert.strictEqual(result.primary, 'javascript');
    assert.strictEqual(result.file_count, 2);
  });

  test('TS project with tsconfig merges JS under typescript', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.ts'), 'export default {};');
    fs.writeFileSync(path.join(src, 'util.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    const result = detectLanguages(tmpDir);
    assert.strictEqual(result.primary, 'typescript');
    assert.ok(result.files_by_language.typescript.length >= 2);
    assert.strictEqual(result.files_by_language.javascript, undefined);
  });

  test('mixed project detects primary and secondary', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(src, `mod${i}.js`), 'x');
    fs.writeFileSync(path.join(src, 'main.py'), 'x');
    fs.writeFileSync(path.join(src, 'util.py'), 'x');
    const result = detectLanguages(tmpDir);
    assert.strictEqual(result.primary, 'javascript');
    assert.ok(result.secondary.includes('python'));
  });

  test('manifest detection adds language even without source files', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example');
    const result = detectLanguages(tmpDir);
    assert.ok('go' in result.files_by_language);
  });

  test('node_modules excluded from scan', () => {
    const nm = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'index.js'), 'x');
    const result = detectLanguages(tmpDir);
    assert.strictEqual(result.file_count, 0);
  });
});

// ─── parseImports ───────────────────────────────────────────────────────────

describe('parseImports', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('parses require()', () => {
    const fp = path.join(tmpDir, 'a.cjs');
    fs.writeFileSync(fp, "const fs = require('fs');\nconst x = require('./local');\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 2);
    assert.strictEqual(imports[0].source, 'fs');
    assert.strictEqual(imports[0].type, 'require');
    assert.strictEqual(imports[1].source, './local');
  });

  test('parses ESM import default', () => {
    const fp = path.join(tmpDir, 'b.mjs');
    fs.writeFileSync(fp, "import foo from './foo';\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, './foo');
    assert.strictEqual(imports[0].type, 'esm');
  });

  test('parses ESM named import', () => {
    const fp = path.join(tmpDir, 'c.js');
    fs.writeFileSync(fp, "import { a, b } from 'pkg';\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, 'pkg');
  });

  test('parses dynamic import', () => {
    const fp = path.join(tmpDir, 'd.js');
    fs.writeFileSync(fp, "const m = import('./lazy');\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, './lazy');
    assert.strictEqual(imports[0].type, 'dynamic');
  });

  test('ignores imports in single-line comments', () => {
    const fp = path.join(tmpDir, 'e.js');
    fs.writeFileSync(fp, "// const x = require('nope');\nconst y = require('./yes');\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, './yes');
  });

  test('ignores imports in multi-line comments', () => {
    const fp = path.join(tmpDir, 'f.js');
    fs.writeFileSync(fp, "/* const x = require('nope'); */\nconst y = require('./yes');\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, './yes');
  });

  test('handles typescript language', () => {
    const fp = path.join(tmpDir, 'g.ts');
    fs.writeFileSync(fp, "import { Component } from 'react';\n");
    const imports = parseImports(fp, 'typescript');
    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, 'react');
  });

  test('returns empty for nonexistent file', () => {
    const imports = parseImports(path.join(tmpDir, 'nope.js'), 'javascript');
    assert.deepStrictEqual(imports, []);
  });

  test('returns line numbers', () => {
    const fp = path.join(tmpDir, 'h.js');
    fs.writeFileSync(fp, "const a = 1;\nconst b = require('./b');\nconst c = 3;\n");
    const imports = parseImports(fp, 'javascript');
    assert.strictEqual(imports[0].line, 2);
  });
});

// ─── parseExports ───────────────────────────────────────────────────────────

describe('parseExports', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('parses module.exports', () => {
    const fp = path.join(tmpDir, 'a.cjs');
    fs.writeFileSync(fp, 'module.exports = { fn };\n');
    const exports = parseExports(fp, 'javascript');
    assert.ok(exports.length >= 1);
    assert.ok(exports.some(e => e.default === true));
  });

  test('parses export default', () => {
    const fp = path.join(tmpDir, 'b.js');
    fs.writeFileSync(fp, 'export default class Foo {}\n');
    const exports = parseExports(fp, 'javascript');
    assert.ok(exports.some(e => e.name === 'Foo' && e.default === true));
  });

  test('parses named export function', () => {
    const fp = path.join(tmpDir, 'c.js');
    fs.writeFileSync(fp, 'export function bar() {}\n');
    const exports = parseExports(fp, 'javascript');
    assert.ok(exports.some(e => e.name === 'bar' && e.default === false));
  });

  test('parses destructured exports', () => {
    const fp = path.join(tmpDir, 'd.js');
    fs.writeFileSync(fp, 'export { alpha, beta };\n');
    const exports = parseExports(fp, 'javascript');
    assert.ok(exports.some(e => e.name === 'alpha'));
    assert.ok(exports.some(e => e.name === 'beta'));
  });

  test('returns empty for file with no exports', () => {
    const fp = path.join(tmpDir, 'e.js');
    fs.writeFileSync(fp, 'const x = 1;\n');
    const exports = parseExports(fp, 'javascript');
    assert.strictEqual(exports.length, 0);
  });
});

// ─── stripComments ──────────────────────────────────────────────────────────

describe('stripComments', () => {
  test('strips single-line comments', () => {
    const result = stripComments('const x = 1; // comment\nconst y = 2;');
    assert.ok(!result.includes('comment'));
    assert.ok(result.includes('const x'));
  });

  test('strips multi-line comments preserving line count', () => {
    const input = 'a\n/* line1\nline2\nline3 */\nb';
    const result = stripComments(input);
    assert.strictEqual(result.split('\n').length, input.split('\n').length);
    assert.ok(result.includes('b'));
  });
});

// ─── buildDependencyGraph ───────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('builds graph from simple A->B chain', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.cjs'), "const b = require('./b.cjs');\n");
    fs.writeFileSync(path.join(src, 'b.cjs'), "module.exports = {};\n");
    const graph = buildDependencyGraph(tmpDir);
    assert.ok(graph.nodes.length >= 2);
    assert.ok(graph.edges.some(e => e.from.includes('a.cjs') && e.to.includes('b.cjs')));
  });

  test('excludes node_modules imports from graph', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), "const lodash = require('lodash');\n");
    const graph = buildDependencyGraph(tmpDir);
    assert.ok(!graph.edges.some(e => e.to.includes('lodash')));
  });

  test('resolves relative imports to actual files', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), "const b = require('./b');\n");
    fs.writeFileSync(path.join(src, 'b.js'), "module.exports = {};\n");
    const graph = buildDependencyGraph(tmpDir);
    assert.ok(graph.edges.some(e => e.to.includes('b.js')));
  });

  test('empty project returns empty graph', () => {
    const graph = buildDependencyGraph(tmpDir);
    assert.strictEqual(graph.nodes.length, 0);
    assert.strictEqual(graph.edges.length, 0);
  });

  test('resolves index.js for directory imports', () => {
    const src = path.join(tmpDir, 'src');
    const sub = path.join(src, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), "const sub = require('./sub');\n");
    fs.writeFileSync(path.join(sub, 'index.js'), "module.exports = {};\n");
    const graph = buildDependencyGraph(tmpDir);
    assert.ok(graph.edges.some(e => e.to.includes('index.js')));
  });
});

// ─── findCircularDeps ───────────────────────────────────────────────────────

describe('findCircularDeps', () => {
  test('no cycles returns empty', () => {
    const graph = { adjacency: { 'a': ['b'], 'b': ['c'], 'c': [] } };
    assert.strictEqual(findCircularDeps(graph).length, 0);
  });

  test('detects A->B->A cycle', () => {
    const graph = { adjacency: { 'a': ['b'], 'b': ['a'] } };
    const cycles = findCircularDeps(graph);
    assert.ok(cycles.length >= 1);
    assert.ok(cycles[0].includes('a'));
    assert.ok(cycles[0].includes('b'));
  });

  test('detects A->B->C->A cycle', () => {
    const graph = { adjacency: { 'a': ['b'], 'b': ['c'], 'c': ['a'] } };
    assert.ok(findCircularDeps(graph).length >= 1);
  });

  test('detects multiple independent cycles', () => {
    const graph = { adjacency: { 'a': ['b'], 'b': ['a'], 'c': ['d'], 'd': ['c'] } };
    assert.ok(findCircularDeps(graph).length >= 2);
  });
});

// ─── findEntryPoints ────────────────────────────────────────────────────────

describe('findEntryPoints', () => {
  test('file with no importers is entry point', () => {
    const graph = { nodes: ['a', 'b', 'c'], adjacency: { 'a': ['b'], 'b': ['c'], 'c': [] } };
    const entries = findEntryPoints(graph);
    assert.ok(entries.includes('a'));
    assert.ok(!entries.includes('b'));
    assert.ok(!entries.includes('c'));
  });

  test('all isolated files are entry points', () => {
    const graph = { nodes: ['a', 'b'], adjacency: { 'a': [], 'b': [] } };
    assert.strictEqual(findEntryPoints(graph).length, 2);
  });
});

// ─── findOrphanExports ──────────────────────────────────────────────────────

describe('findOrphanExports', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('file with exports but no importers is orphan', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    // main.js imports util.js (entry point with outgoing edge)
    fs.writeFileSync(path.join(src, 'main.js'), "const util = require('./util');\n");
    fs.writeFileSync(path.join(src, 'util.js'), 'module.exports = {};\n');
    // orphan.js exports but nobody imports it and it imports nothing
    fs.writeFileSync(path.join(src, 'orphan.js'), 'module.exports = { fn: () => {} };\n');
    const graph = buildDependencyGraph(tmpDir);
    const orphans = findOrphanExports(tmpDir, graph);
    assert.ok(orphans.some(o => o.includes('orphan.js')));
  });

  test('file imported by others is not orphan', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'used.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(src, 'main.js'), "const used = require('./used');\n");
    const graph = buildDependencyGraph(tmpDir);
    assert.ok(!findOrphanExports(tmpDir, graph).some(o => o.includes('used.js')));
  });
});

// ─── generateMermaidGraph ───────────────────────────────────────────────────

describe('generateMermaidGraph', () => {
  test('empty graph returns placeholder', () => {
    const mermaid = generateMermaidGraph({ nodes: [], edges: [] });
    assert.ok(mermaid.includes('graph LR'));
    assert.ok(mermaid.includes('No modules found'));
  });

  test('small graph produces valid Mermaid', () => {
    const graph = { nodes: ['a.js', 'b.js'], edges: [{ from: 'a.js', to: 'b.js' }] };
    const mermaid = generateMermaidGraph(graph);
    assert.ok(mermaid.includes('graph LR'));
    assert.ok(mermaid.includes('-->'));
  });

  test('large graph truncates with note', () => {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(`mod${i}.js`);
      if (i > 0) edges.push({ from: `mod${i}.js`, to: 'mod0.js' });
    }
    assert.ok(generateMermaidGraph({ nodes, edges }, 10).includes('more modules'));
  });
});

// ─── detectBestPractices ────────────────────────────────────────────────────

describe('detectBestPractices', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty codebase returns 5 categories', () => {
    const result = detectBestPractices(tmpDir);
    assert.ok(Array.isArray(result.categories));
    assert.strictEqual(result.categories.length, 5);
    assert.strictEqual(typeof result.score, 'number');
  });

  test('codebase with try-catch scores error handling', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'function foo() { try { x(); } catch(e) { } }\nfunction bar() { try { y(); } catch(e) { } }\n');
    const result = detectBestPractices(tmpDir);
    assert.ok(result.categories.find(c => c.name === 'Error Handling').score > 0);
  });

  test('codebase with test files scores testing', () => {
    const src = path.join(tmpDir, 'src');
    const tests = path.join(tmpDir, 'tests');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(tests, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x');
    fs.writeFileSync(path.join(tests, 'a.test.cjs'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const result = detectBestPractices(tmpDir);
    assert.ok(result.categories.find(c => c.name === 'Testing').score > 0);
  });

  test('consistent kebab-case naming scores high', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'my-module.js'), 'x');
    fs.writeFileSync(path.join(src, 'another-module.js'), 'x');
    fs.writeFileSync(path.join(src, 'third-module.js'), 'x');
    const result = detectBestPractices(tmpDir);
    assert.ok(result.categories.find(c => c.name === 'Naming Conventions').score >= 5);
  });

  test('gitignore with .env improves security score', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\nnode_modules/\n');
    const result = detectBestPractices(tmpDir);
    const secCat = result.categories.find(c => c.name === 'Security');
    assert.ok(secCat.detected_patterns.some(p => p.includes('.env')));
  });
});

// ─── findCodebaseDoc ────────────────────────────────────────────────────────

describe('findCodebaseDoc', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('finds lowercase file', () => {
    const codebaseDir = path.join(tmpDir, '.planning', 'codebase');
    fs.mkdirSync(codebaseDir, { recursive: true });
    fs.writeFileSync(path.join(codebaseDir, 'conventions.md'), '# Conventions');
    const result = findCodebaseDoc(tmpDir, 'conventions.md');
    assert.ok(result !== null);
    assert.ok(result.includes('conventions.md'));
  });

  test('falls back to UPPERCASE', () => {
    const codebaseDir = path.join(tmpDir, '.planning', 'codebase');
    fs.mkdirSync(codebaseDir, { recursive: true });
    fs.writeFileSync(path.join(codebaseDir, 'CONVENTIONS.MD'), '# Conventions');
    const result = findCodebaseDoc(tmpDir, 'conventions.md');
    assert.ok(result !== null);
    // On case-insensitive filesystems (Windows), lowercase check finds the UPPERCASE file
    // On case-sensitive filesystems (Linux), fallback to UPPERCASE path kicks in
    assert.ok(result.toLowerCase().includes('conventions.md'));
  });

  test('returns null when neither exists', () => {
    assert.strictEqual(findCodebaseDoc(tmpDir, 'conventions.md'), null);
  });
});

// ─── CLI dispatch tests (integration) ───────────────────────────────────────

describe('codebase CLI commands', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('codebase detect-languages returns valid JSON', () => {
    const result = runPanTools('codebase detect-languages', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('primary' in data);
    assert.ok('secondary' in data);
    assert.ok('files_by_language' in data);
    assert.ok('file_count' in data);
  });

  test('codebase analyze-imports returns valid JSON', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), "const b = require('./b');\n");
    fs.writeFileSync(path.join(src, 'b.js'), "module.exports = {};\n");
    const result = runPanTools('codebase analyze-imports', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('language' in data);
    assert.ok('modules' in data);
    assert.ok('imports' in data);
    assert.ok('circular_deps' in data);
    assert.ok('entry_points' in data);
    assert.ok('orphan_modules' in data);
    assert.ok('dependency_graph' in data);
  });

  test('codebase best-practices returns valid JSON', () => {
    const result = runPanTools('codebase best-practices', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('categories' in data);
    assert.ok('score' in data);
    assert.ok(Array.isArray(data.categories));
    assert.strictEqual(data.categories.length, 5);
  });

  test('codebase unknown-sub returns error', () => {
    const result = runPanTools('codebase unknown-sub', tmpDir);
    assert.strictEqual(result.success, false);
  });
});

// ─── init map-codebase enhanced output tests ────────────────────────────────

describe('init map-codebase enhanced', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns supported_languages field', () => {
    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('supported_languages' in data);
    assert.ok(Array.isArray(data.supported_languages));
  });

  test('returns file_count field', () => {
    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('file_count' in data);
    assert.strictEqual(typeof data.file_count, 'number');
  });

  test('returns focus_areas with 6 entries', () => {
    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.focus_areas.length, 6);
    assert.ok(data.focus_areas.includes('relationships'));
    assert.ok(data.focus_areas.includes('practices'));
  });
});

// ─── E-2: estimateRepoTokenSize ─────────────────────────────────────────────

describe('estimateRepoTokenSize (E-2)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty project returns zero tokens + single-shot mode', () => {
    const r = estimateRepoTokenSize(tmpDir);
    assert.equal(r.total_tokens, 0);
    assert.equal(r.total_bytes, 0);
    assert.equal(r.file_count, 0);
    assert.equal(r.mode, 'single-shot');
    assert.equal(r.threshold, 700000);
  });

  test('small project classifies as single-shot', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = { hello: "world" };');
    fs.writeFileSync(path.join(src, 'util.js'), 'module.exports = { sum: (a,b) => a+b };');
    const r = estimateRepoTokenSize(tmpDir);
    assert.equal(r.mode, 'single-shot');
    assert.equal(r.file_count, 2);
    assert.ok(r.total_bytes > 0);
    assert.ok(r.total_tokens > 0);
    assert.ok(r.languages.javascript > 0);
  });

  test('threshold override is respected', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(500));
    // 500 bytes ≈ ~125 tokens. Force sharded by setting tiny threshold.
    const r = estimateRepoTokenSize(tmpDir, { threshold: 10 });
    assert.equal(r.mode, 'sharded');
    assert.equal(r.threshold, 10);
  });

  test('invalid threshold falls back to default', () => {
    const r = estimateRepoTokenSize(tmpDir, { threshold: -100 });
    assert.equal(r.threshold, 700000);
  });

  test('includes top-level README + package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\nHello.');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');
    const r = estimateRepoTokenSize(tmpDir);
    assert.ok(r.file_count >= 2);
    assert.ok(r.languages.docs > 0);
  });

  test('--no-docs skips docs/*.md scan', () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'guide.md'), 'a'.repeat(1000));
    const withDocs = estimateRepoTokenSize(tmpDir, { include_docs: true });
    const withoutDocs = estimateRepoTokenSize(tmpDir, { include_docs: false });
    assert.ok(withDocs.total_bytes > withoutDocs.total_bytes);
  });

  test('skips SKIP_DIRS like node_modules', () => {
    const src = path.join(tmpDir, 'src');
    const nm = path.join(tmpDir, 'node_modules', 'foo');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'small');
    fs.writeFileSync(path.join(nm, 'big.js'), 'x'.repeat(100000));
    const r = estimateRepoTokenSize(tmpDir);
    // node_modules must be excluded — total_bytes stays small.
    assert.ok(r.total_bytes < 1000, `expected <1000 bytes, got ${r.total_bytes}`);
  });

  test('languages breakdown aggregates per extension', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(100));
    fs.writeFileSync(path.join(src, 'b.py'), 'y'.repeat(200));
    const r = estimateRepoTokenSize(tmpDir);
    assert.ok(r.languages.javascript >= 100);
    assert.ok(r.languages.python >= 200);
  });

  test('CLI dispatch returns parseable JSON', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'hello');
    const result = runPanTools('codebase estimate-size', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('mode' in data);
    assert.ok('total_tokens' in data);
    assert.ok('file_count' in data);
  });

  test('CLI respects --threshold flag', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.js'), 'x'.repeat(5000));
    const result = runPanTools('codebase estimate-size --threshold 10', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.threshold, 10);
    assert.equal(data.mode, 'sharded');
  });
});
