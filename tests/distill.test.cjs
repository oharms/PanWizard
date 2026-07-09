'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');

const {
  findPhantomTryCatch,
  findUnusedImports,
  findMagicNumbers,
  findLongFunctions,
  findWideParamLists,
  findSingleInstanceFactories,
  findDeepNesting,
  findRepeatedBlocks,
  findUnreferencedExports,
  distillScan,
  computeBloatBudget,
  readPatternsMemory,
  writePatternsMemory,
  detectRegressedPatterns,
  SAFETY_TIERS,
  DEFAULT_BLOAT_THRESHOLD,
  MAX_FUNCTION_LOC,
  MAX_PARAM_COUNT,
  MIN_REPEATED_LINES,
} = require('../pan-wizard-core/bin/lib/distill.cjs');

// ─── Pass 1: Deterministic ────────────────────────────────────────────────────

describe('Pass 1 — findPhantomTryCatch', () => {
  test('detects try/catch around JSON.parse', () => {
    const code = 'try { return JSON.parse(input); } catch (e) { return null; }';
    const findings = findPhantomTryCatch(code, 'test.js');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].pattern, 'phantom_try_catch');
    assert.equal(findings[0].file, 'test.js');
  });

  test('does not flag try/catch around real I/O', () => {
    const code = 'try { return fs.readFileSync(path); } catch (e) { return null; }';
    const findings = findPhantomTryCatch(code, 'test.js');
    assert.equal(findings.length, 0);
  });

  test('catches multiple instances in one file', () => {
    const code = `
      try { return JSON.parse(a); } catch {}
      try { return JSON.stringify(b); } catch {}
      try { return parseInt(c); } catch {}
    `;
    const findings = findPhantomTryCatch(code, 'multi.js');
    assert.equal(findings.length, 3);
  });
});

describe('Pass 1 — findUnusedImports', () => {
  test('detects unused require import', () => {
    const code = `const fs = require('fs');\nconsole.log('hi');`;
    const findings = findUnusedImports(code, 'test.js');
    assert.ok(findings.some(f => f.span === 'fs'));
  });

  test('does not flag used imports', () => {
    const code = `const fs = require('fs');\nfs.readFileSync('x');`;
    const findings = findUnusedImports(code, 'test.js');
    assert.equal(findings.length, 0);
  });

  test('detects destructured unused imports', () => {
    const code = `const { foo, bar } = require('lib');\nfoo();`;
    const findings = findUnusedImports(code, 'test.js');
    assert.ok(findings.some(f => f.span === 'bar'));
  });
});

describe('Pass 1 — findMagicNumbers', () => {
  test('detects number repeated 3+ times', () => {
    const code = `const a = 5000;\nconst b = 5000;\nsetTimeout(fn, 5000);`;
    const findings = findMagicNumbers(code, 'test.js');
    assert.ok(findings.some(f => f.span === '5000'));
  });

  test('does not flag number used once', () => {
    const code = `const x = 7777;`;
    const findings = findMagicNumbers(code, 'test.js');
    assert.equal(findings.length, 0);
  });

  test('skips common round numbers (100, 1000)', () => {
    const code = `const a = 100;\nconst b = 100;\nconst c = 100;`;
    const findings = findMagicNumbers(code, 'test.js');
    assert.equal(findings.length, 0);
  });
});

describe('Pass 1 — findLongFunctions', () => {
  test('detects function exceeding LOC limit', () => {
    const body = Array(MAX_FUNCTION_LOC + 5).fill('  console.log("line");').join('\n');
    const code = `function bigFn() {\n${body}\n}`;
    const findings = findLongFunctions(code, 'big.js');
    assert.ok(findings.some(f => f.span === 'bigFn'));
  });

  test('does not flag short functions', () => {
    const code = `function smallFn() { return 42; }`;
    const findings = findLongFunctions(code, 'small.js');
    assert.equal(findings.length, 0);
  });
});

describe('Pass 1 — findWideParamLists', () => {
  test('detects function with > 4 params', () => {
    const code = `function wide(a, b, c, d, e, f) { return a; }`;
    const findings = findWideParamLists(code, 'wide.js');
    assert.ok(findings.some(f => f.span === 'wide'));
  });

  test('does not flag function with <= 4 params', () => {
    const code = `function narrow(a, b, c, d) { return a; }`;
    const findings = findWideParamLists(code, 'narrow.js');
    assert.equal(findings.length, 0);
  });
});

// ─── Pass 2: AST-style ────────────────────────────────────────────────────────

describe('Pass 2 — findSingleInstanceFactories', () => {
  test('detects Factory class with single instance', () => {
    const code = `class WidgetFactory { build() { return {}; } }\nconst w = new WidgetFactory();`;
    const findings = findSingleInstanceFactories(code, 'factory.js');
    assert.ok(findings.some(f => f.span === 'WidgetFactory'));
  });

  test('does not flag Factory with multiple uses', () => {
    const code = `class WidgetFactory {}\nconst a = new WidgetFactory();\nconst b = new WidgetFactory();`;
    const findings = findSingleInstanceFactories(code, 'factory.js');
    assert.equal(findings.length, 0);
  });
});

describe('Pass 2 — findDeepNesting', () => {
  test('detects nesting beyond limit', () => {
    const code = `        if (x) { /* depth 4 */ }`;
    const findings = findDeepNesting(code, 'nested.js');
    assert.ok(findings.length >= 1);
  });
});

// ─── Pass 3: Graph-based ──────────────────────────────────────────────────────

describe('Pass 3 — findRepeatedBlocks', () => {
  test('detects identical 5-line block in two files', () => {
    const block = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;', 'const e = 5;'].join('\n');
    const filesContent = {
      'a.js': block + '\nconsole.log(a);',
      'b.js': block + '\nconsole.log(b);',
    };
    const findings = findRepeatedBlocks(filesContent);
    assert.ok(findings.length >= 1);
    assert.equal(findings[0].pattern, 'repeated_block');
  });

  test('does not flag block appearing only once', () => {
    const filesContent = {
      'a.js': 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;',
    };
    const findings = findRepeatedBlocks(filesContent);
    assert.equal(findings.length, 0);
  });
});

describe('Pass 3 — findUnreferencedExports', () => {
  test('detects export not referenced elsewhere', () => {
    const filesContent = {
      'a.js': 'exports.unusedHelper = function () { return 1; };',
      'b.js': 'console.log("hello");',
    };
    const findings = findUnreferencedExports(filesContent);
    assert.ok(findings.some(f => f.span === 'unusedHelper'));
  });

  test('does not flag referenced export', () => {
    const filesContent = {
      'a.js': 'exports.helper = () => 1;',
      'b.js': 'const { helper } = require("./a");\nhelper();',
    };
    const findings = findUnreferencedExports(filesContent);
    assert.ok(!findings.some(f => f.span === 'helper'));
  });
});

// ─── Bloat Budget ─────────────────────────────────────────────────────────────

describe('computeBloatBudget', () => {
  test('computes ratio correctly', () => {
    const findings = [{ loc_saved: 100 }, { loc_saved: 100 }];
    const budget = computeBloatBudget(400, findings);
    assert.equal(budget.touched_loc, 400);
    assert.equal(budget.removable_loc, 200);
    assert.equal(budget.essential_loc, 200);
    assert.equal(budget.ratio, 2);
  });

  test('flags over-budget when ratio exceeds threshold', () => {
    const findings = [{ loc_saved: 500 }];
    const budget = computeBloatBudget(800, findings, 2.0);
    assert.equal(budget.over_budget, true);
  });

  test('uses default threshold when not provided', () => {
    const findings = [];
    const budget = computeBloatBudget(100, findings);
    assert.equal(budget.threshold, DEFAULT_BLOAT_THRESHOLD);
  });
});

// ─── Cross-Session Memory (Pass 5) ────────────────────────────────────────────

describe('Pass 5 — pattern memory', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('writePatternsMemory creates the memory file', () => {
    cwd = createTempProject();
    const findings = [{ pattern: 'phantom_try_catch', file: 'src/a.js', message: 'phantom' }];
    const result = writePatternsMemory(cwd, findings);
    assert.equal(result.written, true);
    assert.ok(fs.existsSync(result.file));
  });

  test('readPatternsMemory parses written entries', () => {
    cwd = createTempProject();
    writePatternsMemory(cwd, [
      { pattern: 'phantom_try_catch', file: 'src/a.js', message: 'phantom' },
      { pattern: 'unused_import', file: 'src/b.js', message: 'unused' },
    ]);
    const memory = readPatternsMemory(cwd);
    assert.ok(memory.patterns.length >= 2);
    assert.ok(memory.patterns.some(p => p.pattern === 'phantom_try_catch'));
  });

  test('detectRegressedPatterns finds re-introduced bloat', () => {
    cwd = createTempProject();
    writePatternsMemory(cwd, [
      { pattern: 'phantom_try_catch', file: 'src/a.js', message: 'phantom' },
    ]);
    const memory = readPatternsMemory(cwd);
    const currentFindings = [
      { pattern: 'phantom_try_catch', file: 'src/a.js', tier: 'safe', message: 'still here' },
    ];
    const regressed = detectRegressedPatterns(currentFindings, memory);
    assert.equal(regressed.length, 1);
    assert.equal(regressed[0].regressed, true);
  });

  test('detectRegressedPatterns returns empty for new patterns', () => {
    cwd = createTempProject();
    const memory = { patterns: [] };
    const currentFindings = [{ pattern: 'unused_import', file: 'x.js' }];
    const regressed = detectRegressedPatterns(currentFindings, memory);
    assert.equal(regressed.length, 0);
  });
});

// ─── Full scan integration ────────────────────────────────────────────────────

describe('distillScan — integration', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns findings_count, by_pattern, by_tier shape', () => {
    cwd = createTempProject();
    fs.writeFileSync(path.join(cwd, 'a.js'), `try { return JSON.parse(x); } catch {}`);
    const result = distillScan(cwd);
    assert.ok(typeof result.files_scanned === 'number');
    assert.ok(Array.isArray(result.findings));
    assert.ok(typeof result.by_pattern === 'object');
    assert.ok(typeof result.by_tier === 'object');
  });

  test('skips PAN runtime directories', () => {
    cwd = createTempProject();
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'bad.js'), `try { return JSON.parse(x); } catch {}`);
    const result = distillScan(cwd);
    assert.ok(!result.findings.some(f => f.file.startsWith('.claude/')));
  });

  test('skips node_modules', () => {
    cwd = createTempProject();
    fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'node_modules', 'lib.js'), `try { return JSON.parse(x); } catch {}`);
    const result = distillScan(cwd);
    assert.ok(!result.findings.some(f => f.file.includes('node_modules')));
  });
});

// ─── Safety tiers + constants ─────────────────────────────────────────────────

describe('safety tier constants', () => {
  test('SAFETY_TIERS has expected keys', () => {
    assert.equal(SAFETY_TIERS.SAFE, 'safe');
    assert.equal(SAFETY_TIERS.REVIEW, 'review_required');
    assert.equal(SAFETY_TIERS.RISKY, 'risky');
  });

  test('DEFAULT_BLOAT_THRESHOLD is 2.0', () => {
    assert.equal(DEFAULT_BLOAT_THRESHOLD, 2.0);
  });

  test('MAX_PARAM_COUNT is 4', () => {
    assert.equal(MAX_PARAM_COUNT, 4);
  });

  test('MIN_REPEATED_LINES is 5', () => {
    assert.equal(MIN_REPEATED_LINES, 5);
  });
});
