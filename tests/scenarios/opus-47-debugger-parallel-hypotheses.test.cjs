/**
 * E-11 scenario test: pan-debugger agent has the Hypothesis Tree
 * (Parallel Investigation) section and the correct guidance.
 *
 * This is a doc-content test — debugger behavior is emergent from the
 * model reading the agent prompt, so we verify the prompt carries the
 * exact instructions the spec requires.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(__dirname, '..', '..', 'agents', 'pan-debugger.md');

describe('E-11 scenario: debugger parallel hypothesis tree', () => {
  const content = fs.readFileSync(AGENT_PATH, 'utf-8');

  test('agent frontmatter requests deep reasoning via effort (adaptive-thinking era)', () => {
    // Was thinking: enabled + thinking_budget: 8000; migrated 2026-06 to the
    // effort field (budget 8000 → xhigh) when budget_tokens was removed from
    // the API on Opus 4.7+ models.
    assert.match(content, /^effort:\s*xhigh$/m);
    assert.doesNotMatch(content, /^thinking_budget:/m);
  });

  test('has explicit "Hypothesis Tree" section', () => {
    assert.match(content, /##\s+Hypothesis Tree/i);
  });

  test('section instructs generating at least 3 hypotheses', () => {
    assert.match(content, /three independent hypotheses|3\+?\s+hypotheses|at least\s+three/i);
  });

  test('section describes Bayesian priors', () => {
    assert.match(content, /Bayesian prior/i);
  });

  test('section instructs parallel attack of top 2 hypotheses', () => {
    // Should encourage parallel tool use on the top-ranked hypotheses.
    assert.match(content, /parallel/i);
    assert.match(content, /top two|top 2/i);
  });

  test('section distinguishes parallel investigation from parallel fixes', () => {
    // Critical constraint: reads/greps in parallel are OK; mutations must serialize.
    assert.match(content, /parallel \*investigation\*/i);
    assert.match(content, /parallel \*fixes\*/i);
  });

  test('section documents stop rule when top hypothesis is confirmed', () => {
    // Don't waste cycles debugging lower-ranked hypotheses once top wins.
    assert.match(content, /don't also debug|stop|confirmed/i);
  });

  test('section limits investigation rounds (prevents DFS explosion)', () => {
    // Something like "at most 3 rounds" or "3 priors × 2-parallel".
    assert.match(content, /at most\s+\d+|3\s*rounds|bounded/i);
  });

  test('priors are recorded in the session file (traceable)', () => {
    assert.match(content, /record|debug session file|prior and final verdict/i);
  });
});
