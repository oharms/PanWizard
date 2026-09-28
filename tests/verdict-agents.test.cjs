/**
 * The judges' pan-verdict examples, as shipped and as each runtime receives them.
 *
 * An agent copies the example it was given, so a broken example is a broken verdict
 * on every run. Each example in the three text-returning judges and in the reference
 * must parse cleanly, with no warnings, under the agent's own name and verdict table.
 * The same must hold after the real installer converted the agent for each of the
 * five runtimes: Codex re-encodes the body as a TOML basic string, and the others
 * rewrite paths. The reference each agent points at must exist in that runtime's
 * core, or the agent is told to follow a file that is not there.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const v = require('../pan-wizard-core/bin/lib/verdict.cjs');
const { installInto, cleanup, RUNTIME_DIR } = require('./helpers.cjs');

const REPO = path.join(__dirname, '..');
const JUDGES = ['pan-plan-checker', 'pan-reviewer', 'pan-design-checker'];
const REFERENCE = 'pan-wizard-core/references/verdict-contract.md';

/** Every pan-verdict block in `text`, each parsed and validated as its agent's verdict. */
function examplesIn(text, agent) {
  return v.findVerdictBlocks(text).map((b) => {
    assert.equal(b.closed, true, `${agent}: every example block is closed`);
    const obj = JSON.parse(b.body);
    return { obj, result: v.validateVerdict(obj, { agent }) };
  });
}

function assertCleanExamples(text, agent, where, { min = 1 } = {}) {
  const examples = examplesIn(text, agent);
  assert.ok(examples.length >= min, `${where}: expected at least ${min} pan-verdict example(s), found ${examples.length}`);
  for (const { obj, result } of examples) {
    assert.equal(result.ok, true, `${where}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.warnings, [], `${where}: an example must parse without warnings`);
    assert.equal(obj.agent, agent, `${where}: the example names its own agent`);
    assert.equal(v.outcomeForVerdict(agent, obj.verdict), obj.outcome, `${where}: ${obj.verdict} must imply ${obj.outcome}`);
  }
  return examples;
}

/** Codex agents are TOML: the body is a `"""` basic string with backslashes escaped. */
function codexInstructions(toml) {
  const m = /developer_instructions = """\n([\s\S]*?)\n"""\s*$/.exec(toml);
  assert.ok(m, 'a Codex agent carries developer_instructions');
  return m[1].replace(/\\(["\\])/g, '$1');
}

describe('pan-verdict examples in the shipped judges and the reference', () => {
  for (const agent of JUDGES) {
    test(`${agent}: every example parses cleanly under its own verdict table and cites the reference`, () => {
      const text = fs.readFileSync(path.join(REPO, 'agents', `${agent}.md`), 'utf-8');
      const examples = assertCleanExamples(text, agent, `agents/${agent}.md`);
      assert.ok(text.includes('~/.claude/pan-wizard-core/references/verdict-contract.md'), `${agent} must point at the contract reference`);
      const outcomes = new Set(examples.map((e) => e.obj.outcome));
      if (agent === 'pan-plan-checker') assert.deepEqual([...outcomes].sort(), ['fail', 'pass'], 'both returns carry a block');
    });
  }

  test('the reference: every example parses cleanly, and its verdict table matches KNOWN_VERDICTS', () => {
    const text = fs.readFileSync(path.join(REPO, REFERENCE), 'utf-8');
    const blocks = v.findVerdictBlocks(text);
    assert.ok(blocks.length >= 3, 'the reference carries worked examples');
    for (const b of blocks) {
      const obj = JSON.parse(b.body);
      const r = v.validateVerdict(obj);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.warnings, []);
    }
    for (const [agent, table] of Object.entries(v.KNOWN_VERDICTS)) {
      if (agent === 'pan-verifier') {
        assert.match(text, /verifier does not emit this block/, 'the reference says where the verifier\'s verdict comes from');
        continue;
      }
      for (const [word, outcome] of Object.entries(table)) {
        assert.ok(text.includes(`\`${word}\` → \`${outcome}\``), `reference table row for ${agent}: ${word} → ${outcome}`);
      }
    }
    for (const cls of v.FINDING_CLASSES) assert.ok(text.includes(`| \`${cls}\` |`), `the class guide defines ${cls}`);
  });
});

describe('pan-verdict examples after conversion for each runtime', () => {
  let dir;
  before(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-verdict-agents-')));
    const r = installInto(dir, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`install failed: ${r.error || r.output}`);
  });
  after(() => { if (dir) cleanup(dir); });

  const agentFile = {
    claude: (a) => path.join(RUNTIME_DIR.claude, 'agents', `${a}.md`),
    codex: (a) => path.join(RUNTIME_DIR.codex, 'agents', `${a}.toml`),
    gemini: (a) => path.join(RUNTIME_DIR.gemini, 'agents', `${a}.md`),
    opencode: (a) => path.join(RUNTIME_DIR.opencode, 'agents', `${a}.md`),
    copilot: (a) => path.join(RUNTIME_DIR.copilot, 'agents', `${a}.agent.md`),
  };

  for (const runtime of Object.keys(agentFile)) {
    test(`${runtime}: the converted judges keep their examples intact and point at an installed reference`, () => {
      const reference = path.join(dir, RUNTIME_DIR[runtime], REFERENCE);
      assert.equal(fs.existsSync(reference), true, `${runtime} installs ${REFERENCE}`);
      for (const agent of JUDGES) {
        const file = path.join(dir, agentFile[runtime](agent));
        const raw = fs.readFileSync(file, 'utf-8');
        const text = runtime === 'codex' ? codexInstructions(raw) : raw;
        const source = fs.readFileSync(path.join(REPO, 'agents', `${agent}.md`), 'utf-8');
        const shipped = examplesIn(source, agent).map((e) => e.obj);
        const converted = assertCleanExamples(text, agent, `${runtime}/${agent}`).map((e) => e.obj);
        assert.deepEqual(converted, shipped, `${runtime}/${agent}: conversion must not change an example`);
        const pointer = new RegExp(`\\./${RUNTIME_DIR[runtime].replace('.', '\\.')}/pan-wizard-core/references/verdict-contract\\.md`);
        assert.match(text, pointer, `${runtime}/${agent} points at its own runtime's reference`);
      }
    });
  }
});
