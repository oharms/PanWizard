/**
 * Executor concerns and cost-if-wrong (program P4, M42; MI-113): a static contract test.
 *
 * The executor can finish a plan and still have concerns. It returns
 * `## DONE_WITH_CONCERNS` instead of `## PLAN COMPLETE`, and every deviation and
 * concern records why and its cost if wrong. The summary template carries the same
 * fields, and exec-phase treats the return as complete and lists the concerns in its
 * phase report. These are prompt contracts, so the test reads the shipped files.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

/** The fenced block that follows a `## <heading>` line inside a markdown fence. */
function returnBlock(text, heading) {
  const at = text.indexOf(`## ${heading}\n`);
  assert.ok(at !== -1, `no "## ${heading}" return block`);
  const end = text.indexOf('```', at);
  return text.slice(at, end === -1 ? undefined : end);
}

describe('executor concerns (M42)', () => {
  const executor = read('agents/pan-executor.md');

  test('the executor has a DONE_WITH_CONCERNS return with plan, summary, commits and concerns', () => {
    const block = returnBlock(executor, 'DONE_WITH_CONCERNS');
    for (const field of ['**Plan:**', '**Tasks:**', '**SUMMARY:**', '**Commits:**', '**Concerns:**']) {
      assert.ok(block.includes(field), `DONE_WITH_CONCERNS lacks ${field}`);
    }
    assert.match(block, /Why:.*Cost if wrong:/, 'each concern records why and its cost if wrong');
  });

  test('the executor says when to return it instead of PLAN COMPLETE', () => {
    assert.match(executor, /DONE_WITH_CONCERNS[^\n]*instead of[^\n]*PLAN COMPLETE|PLAN COMPLETE[^\n]*or[^\n]*DONE_WITH_CONCERNS/);
  });

  test('every deviation the executor documents records its cost if wrong', () => {
    const dev = executor.slice(executor.indexOf('**Deviation documentation:**'));
    assert.match(dev.slice(0, 900), /\*\*Cost if wrong:\*\*/);
  });

  test('the summary template carries cost-if-wrong on deviations and a Concerns section', () => {
    const summary = read('pan-wizard-core/templates/summary.md');
    assert.match(summary, /- DV-1: .*Reason: .*Cost if wrong: /);
    assert.match(summary, /- \*\*Cost if wrong:\*\*/);
    assert.match(summary, /\n## Concerns\n/);
    assert.match(summary, /- C-1: .*Why: .*Cost if wrong: /);
  });

  test('exec-phase treats DONE_WITH_CONCERNS as complete and lists the concerns in its report', () => {
    const wf = read('pan-wizard-core/workflows/exec-phase.md');
    assert.match(wf, /`## DONE_WITH_CONCERNS`/);
    const agg = wf.slice(wf.indexOf('<step name="aggregate_results">'), wf.indexOf('</step>', wf.indexOf('<step name="aggregate_results">')));
    assert.match(agg, /### Concerns/);
    assert.match(agg, /Cost if wrong/);
  });
});
