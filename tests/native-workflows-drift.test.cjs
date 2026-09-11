/**
 * Native Claude Code workflows — the §3.2 gate and the script ⇄ markdown drift pin
 * (docs/ECOSYSTEM-REVIEW-2026-08.md §3.2; plan items 5a/5b, 2026-09).
 *
 * Every native script is a deterministic PORT of a markdown protocol. The risk
 * the August review named is that the two diverge — two behaviours for one
 * command. So each script names its twin in a `// twin:` line right after the
 * meta block, and this file pins the pair the same way the squad roster is pinned:
 *
 *   - the twin exists;
 *   - every agent the script spawns is an agent the twin names (roster parity)
 *     and exists as a shipped agent definition;
 *   - meta.phases and the phase() calls agree in both directions;
 *   - the script parses as a module body, keeps `export const meta` first, and
 *     uses none of the constructs the runtime forbids or that break resume
 *     (import()/require, fs/shell, Date.now/Math.random/new Date());
 *   - fan-out results are null-filtered (an agent() resolves null when stopped).
 *
 * These are the checks the review called "the honest static gate". The
 * behavioural gate — chain completion under a harness against a deployed
 * install — is a harness job, not a unit test.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lib = require('../bin/install-lib.cjs');

const ROOT = path.join(__dirname, '..');
const scripts = lib.buildNativeWorkflowScripts();

const twinOf = (content) => {
  const m = content.match(/^\/\/ twin: (\S+)$/m);
  return m ? m[1] : null;
};
const agentTypesOf = (content) => [...new Set([...content.matchAll(/agentType:\s*'([^']+)'/g)].map(m => m[1]))];
const phaseCallsOf = (content) => [...new Set([...content.matchAll(/^phase\('([^']+)'\)/gm)].map(m => m[1]))];
const metaBlockOf = (content) => {
  // From the first line to the first line that is exactly `}` — the meta literal.
  const end = content.indexOf('\n}\n');
  assert.ok(end > 0, 'meta block must close with a bare `}` line');
  return content.slice(0, end + 2);
};
const metaPhaseTitlesOf = (content) => [...metaBlockOf(content).matchAll(/\{ title: '([^']+)'/g)].map(m => m[1]);

describe('native workflows: the emitted set', () => {
  test('non-vacuity: at least the four ported protocols are emitted, each named pan-*.js', () => {
    assert.ok(scripts.length >= 4, `expected ≥4 scripts, got ${scripts.length}`);
    for (const s of scripts) assert.match(s.name, /^pan-[a-z-]+\.js$/);
    const names = scripts.map(s => s.name);
    for (const expected of ['pan-review-pipeline.js', 'pan-map-codebase.js', 'pan-exec-waves.js', 'pan-diagnose-issues.js']) {
      assert.ok(names.includes(expected), `${expected} missing`);
    }
    assert.equal(new Set(names).size, names.length, 'script names must be unique');
  });

  test('meta.name equals the file stem (that is what /<name> resolves to)', () => {
    for (const s of scripts) {
      const m = s.content.match(/^\s*name: '([^']+)',$/m);
      assert.ok(m, `${s.name}: no meta.name`);
      assert.equal(m[1] + '.js', s.name);
    }
  });
});

describe('native workflows: static gate (§3.2)', () => {
  test('export const meta is the first statement and a literal-only object', () => {
    for (const s of scripts) {
      assert.ok(s.content.startsWith('export const meta = {'), `${s.name}: meta must be the first statement`);
      const meta = metaBlockOf(s.content);
      // A call, a template literal or a spread inside meta makes Claude Code drop
      // the command from autocomplete. Strings may contain "(" — strip them first.
      const noStrings = meta.replace(/'[^']*'/g, "''");
      assert.ok(!/[A-Za-z_]\s*\(/.test(noStrings), `${s.name}: meta contains a call expression`);
      assert.ok(!/`|\.\.\./.test(noStrings), `${s.name}: meta contains a template literal or spread`);
    }
  });

  test('parses as a module body (top-level await allowed)', () => {
    for (const s of scripts) {
      const body = s.content.replace(/^export const meta = /m, 'const meta = ');
      assert.doesNotThrow(() => new vm.Script(`(async () => {\n${body}\n})`), `${s.name} should parse`);
    }
  });

  test('uses no forbidden or resume-breaking construct', () => {
    const forbidden = [
      [/\bimport\s*\(/, 'import()'], [/\brequire\s*\(/, 'require()'], [/\bprocess\./, 'process.*'],
      [/\bfs\./, 'fs.*'], [/child_process/, 'child_process'], [/\bDate\.now\s*\(/, 'Date.now()'],
      [/\bMath\.random\s*\(/, 'Math.random()'], [/\bnew Date\s*\(\s*\)/, 'new Date()'], [/\bimport\s+[^(]/, 'import statement'],
    ];
    for (const s of scripts) {
      // Strip string literals first so a prompt that MENTIONS these words does not trip the gate.
      const code = s.content.replace(/'(?:[^'\\]|\\.)*'/g, "''");
      for (const [re, label] of forbidden) assert.ok(!re.test(code), `${s.name}: uses ${label}`);
    }
  });

  test('meta.phases titles and phase() calls agree in both directions', () => {
    for (const s of scripts) {
      const declared = metaPhaseTitlesOf(s.content).sort();
      const called = phaseCallsOf(s.content).sort();
      assert.ok(declared.length > 0, `${s.name}: declares no phases`);
      assert.deepEqual(called, declared, `${s.name}: phase() calls ${JSON.stringify(called)} vs meta.phases ${JSON.stringify(declared)}`);
    }
  });

  test('every fan-out filters null results (a stopped or errored agent() resolves null)', () => {
    for (const s of scripts) {
      if (/\bparallel\(/.test(s.content)) {
        assert.ok(s.content.includes('.filter(Boolean)'), `${s.name}: parallel() results are never null-filtered`);
      }
    }
  });

  test('every spawned agentType is a shipped agent definition', () => {
    for (const s of scripts) {
      const types = agentTypesOf(s.content);
      assert.ok(types.length > 0, `${s.name}: spawns no PAN agent`);
      for (const t of types) {
        assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${t}.md`)), `${s.name}: agentType '${t}' has no agents/${t}.md`);
      }
    }
  });
});

describe('native workflows: script ⇄ markdown twin drift pin (5b)', () => {
  test('every script names a twin that exists', () => {
    for (const s of scripts) {
      const twin = twinOf(s.content);
      assert.ok(twin, `${s.name}: no "// twin:" line after the meta block`);
      assert.ok(fs.existsSync(path.join(ROOT, twin)), `${s.name}: twin ${twin} does not exist`);
      assert.ok(/^(pan-wizard-core\/workflows|commands\/pan)\/[a-z-]+\.md$/.test(twin), `${s.name}: twin must be a shipped workflow or command: ${twin}`);
    }
  });

  test('roster parity: every agent a script spawns is one its twin names', () => {
    for (const s of scripts) {
      const twinText = fs.readFileSync(path.join(ROOT, twinOf(s.content)), 'utf8');
      for (const t of agentTypesOf(s.content)) {
        assert.ok(twinText.includes(t), `${s.name} spawns '${t}' but its twin never names that agent — the pair has diverged`);
      }
    }
  });

  test('the wave script refuses checkpoint phases rather than pretending to pause', () => {
    const s = scripts.find(x => x.name === 'pan-exec-waves.js');
    assert.ok(s.content.includes('has_checkpoints'), 'must read has_checkpoints from the index');
    assert.match(s.content, /if \(index\.has_checkpoints\) \{\s*\n\s*return \{ error:/, 'must return an error before any executor is spawned');
    assert.ok(s.content.indexOf('has_checkpoints) {') < s.content.indexOf("agentType: 'pan-executor'"), 'the refusal must precede the executor fan-out');
    assert.ok(s.content.includes("phase('Verify')"), 'the port carries the verification phase its twin performs');
  });

  test('the wave script honours parallelization=false with a sequential path', () => {
    const s = scripts.find(x => x.name === 'pan-exec-waves.js');
    assert.ok(s.content.includes('parallelWithinWave'), 'must branch on the parallelization flag');
    assert.match(s.content, /for \(const p of wavePlans\) \{\s*\n\s*results\.push\(await agent\(/, 'sequential branch awaits one executor at a time');
  });

  test('the diagnose script investigates only — it never spawns a fixer', () => {
    const s = scripts.find(x => x.name === 'pan-diagnose-issues.js');
    assert.deepEqual(agentTypesOf(s.content), ['pan-debugger']);
    assert.ok(s.content.includes('root cause ONLY'), 'the debugger prompt must forbid fixing');
  });

  test('the plugin copy scopes every one of these agents (namespaceWorkflowAgentTypes is total over the set)', () => {
    for (const s of scripts) {
      const scoped = lib.namespaceWorkflowAgentTypes(s.content, 'pan-wizard');
      for (const t of agentTypesOf(s.content)) assert.ok(scoped.includes(`agentType: 'pan-wizard:${t}'`), `${s.name}: '${t}' not scoped`);
      assert.deepEqual(agentTypesOf(scoped).filter(t => !t.startsWith('pan-wizard:')), [], `${s.name}: a bare agentType survived scoping`);
    }
  });
});
