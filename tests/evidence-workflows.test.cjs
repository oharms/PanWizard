/**
 * Workflow drift for the evidence loop (docs/specs/evidence-loop-plan.md EL-3, EL-4, EL-7).
 *
 * Workflows are prose the orchestrating model follows, so what these tests pin is the
 * contract between steps: which file a step writes, which verb a later step reads it
 * with, and which branch runs on what. The defects that motivated them were exactly
 * such broken contracts: review-deep read a review.md that nothing wrote, from a path
 * no phase directory has, and exec-phase documented a --deep-review flag that no step
 * read.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8').replace(/\r\n/g, '\n');

/** The text of one `<step name="…">` block of a workflow. */
function step(workflowText, name) {
  const start = workflowText.indexOf(`<step name="${name}"`);
  assert.notEqual(start, -1, `step ${name} exists`);
  const end = workflowText.indexOf('</step>', start);
  assert.notEqual(end, -1, `step ${name} is closed`);
  return workflowText.slice(start, end);
}

describe('review chain: the reviewer report is saved where review-deep reads it (EL-3)', () => {
  const exec = read('pan-wizard-core/workflows/exec-phase.md');
  const reviewDeep = read('commands/pan/review-deep.md');

  test('exec-phase saves the reviewer\'s verbatim return as {phase_dir}/{phase_number}-review.md', () => {
    const review = step(exec, 'code_review');
    assert.match(review, /\*\*Save the report\.\*\*[^\n]*Write tool[^\n]*verbatim[^\n]*`\{phase_dir\}\/\{phase_number\}-review\.md`/);
    assert.ok(review.indexOf('Save the report') > review.indexOf('subagent_type="pan-reviewer"'), 'saved after the reviewer returns');
  });

  test('review-deep reads that same path, and the phantom .planning/phases/<N>/review.md is gone', () => {
    assert.match(reviewDeep, /--reviewer-file \{directory\}\/\{phase_number\}-review\.md/);
    assert.match(reviewDeep, /\{directory\}\/\{phase_number\}-review\.md`, which exec-phase's code-review step wrote/);
    for (const phantom of ['.planning/phases/<N>/review.md', '.planning/phases/07/review.md']) {
      assert.ok(!reviewDeep.includes(phantom), `review-deep must not name ${phantom}`);
    }
  });
});

describe('M11: unrequested work has a check, a record and a lens (EL-6)', () => {
  const verifier = read('agents/pan-verifier.md');
  const reviewer = read('agents/pan-reviewer.md');

  test('the verifier runs the mechanical scope check and records its judgement as unrequested:', () => {
    const s = verifier.slice(verifier.indexOf('## Step 7c'), verifier.indexOf('## Step 8'));
    assert.match(s, /pan-tools\.cjs verify scope "\$PHASE_NUM"/);
    assert.match(s, /hint: test_for_declared/);
    assert.match(s, /never changes the status on its own/);
    assert.ok(verifier.indexOf('## Step 7c') < verifier.indexOf('## Step 9'), 'scope is judged before the status is decided');
  });

  test('the verifier\'s own verification.md template carries unrequested: with path and what', () => {
    const tpl = verifier.slice(verifier.indexOf('## Create verification.md'));
    assert.match(tpl, /\nunrequested: # Only if Step 7c found work no plan asked for\n {2}- path: "[^"]+"\n {4}what: "[^"]+"\n/);
    assert.match(tpl, /### Unrequested Work/);
  });

  test('the reviewer has the same lens and maps it to the unrequested class', () => {
    assert.match(reviewer, /## Scope \(unrequested work\)/);
    assert.match(reviewer, /Unrequested → `unrequested`/);
  });
});

describe('workflows record verdicts on the critical path and dispose what they continue past (EL-7)', () => {
  const exec = read('pan-wizard-core/workflows/exec-phase.md');
  const plan = read('pan-wizard-core/workflows/plan-phase.md');
  const verify = read('pan-wizard-core/workflows/verify-phase.md');
  const design = read('commands/pan/design-phase.md');
  const audit = read('pan-wizard-core/workflows/milestone-audit.md');

  test('exec-phase branches on the recorded review verdict, with the old reading as the fallback', () => {
    const review = step(exec, 'code_review');
    assert.match(review, /REVIEW_VERDICT=\$\(node ~\/\.claude\/pan-wizard-core\/bin\/pan-tools\.cjs findings record --phase "\$\{PHASE_NUMBER\}" --agent pan-reviewer --file "\$REVIEW_FILE" --raw 2>\/dev\/null\) \\\n {2}\|\| REVIEW_VERDICT=\$\(grep -A1 '\^### Verdict' "\$REVIEW_FILE"/);
    assert.ok(review.indexOf('findings record') > review.indexOf('**Save the report.**'), 'recorded after it is saved');
  });

  test('exec-phase never continues past review findings silently', () => {
    const review = step(exec, 'code_review');
    assert.match(review, /findings dispose --phase "\$\{PHASE_NUMBER\}" --agent pan-reviewer --open --as deferred --reason "accepted at review: PASS_WITH_WARNINGS"/);
    assert.match(review, /"Continue anyway"[^\n]*`--reason "continued past NEEDS_FIXES at the user's choice"`/);
    assert.match(review, /run the review once more \(steps 2–4\)/);
    assert.ok(!review.includes('$REVIEW_OUTPUT'), 'no step reads a shell variable nothing sets');
  });

  test('exec-phase reads the verification status through the record, grep kept as the fallback', () => {
    assert.match(exec, /VERIF_STATUS=\$\(node ~\/\.claude\/pan-wizard-core\/bin\/pan-tools\.cjs findings record --phase "\$\{PHASE_NUMBER\}" --file "\$VERIF_FILE" --raw 2>\/dev\/null\) \\\n {2}\|\| VERIF_STATUS=\$\(grep "\^status:" "\$VERIF_FILE"/);
  });

  test('plan-phase saves the checker report, records it, and branches on the record', () => {
    const s = plan.slice(plan.indexOf('## 11. Handle Checker Return'), plan.indexOf('## 12. Revision Loop'));
    assert.match(s, /`\{phase_dir\}\/\{padded_phase\}-plan-check\.md` with the Write tool/);
    assert.match(s, /CHECK_VERDICT=\$\(node [^\n]*findings record --phase "\$\{PHASE_NUMBER\}" --agent pan-plan-checker --file "\$CHECK_FILE" --raw 2>\/dev\/null\) \\\n {2}\|\| CHECK_VERDICT=\$\(grep -q '\^## VERIFICATION PASSED'/);
    assert.match(s, /- \*\*`passed`:\*\* Display confirmation, proceed to step 13\./);
    assert.match(s, /- \*\*`issues_found`:\*\* Display issues, check iteration count, proceed to step 12\./);
  });

  test('plan-phase records a force-proceed past the remaining issues as a deferral', () => {
    const s = plan.slice(plan.indexOf('**If iteration_count >= 3:**'), plan.indexOf('## 13. Present Final Status'));
    assert.match(s, /findings dispose --phase "\$\{PHASE_NUMBER\}" --agent pan-plan-checker --open --as deferred --reason "force proceed after 3 plan revision iterations"/);
  });

  test('verify-phase records its report; design-phase records each check and defers its final caveats', () => {
    assert.match(step(verify, 'return_to_orchestrator'), /findings record --phase "\$\{PHASE_NUMBER\}" --file "\$REPORT_PATH"/);
    assert.match(design, /`\{phase_dir\}\/\{padded_phase\}-design-check\.md` with the Write tool/);
    assert.match(design, /findings record --phase "\{phase\}" --agent pan-design-checker --file "\{phase_dir\}\/\{padded_phase\}-design-check\.md" --raw/);
    assert.match(design, /findings dispose --phase "\{phase\}" --agent pan-design-checker --open --as deferred --reason "design caveat after 2 revision iterations"/);
  });

  test('milestone-audit takes tech debt and undisposed findings from the ledger', () => {
    const s = audit.slice(audit.indexOf('### 2b. Read the Recorded Findings'), audit.indexOf('## 3.'));
    assert.match(s, /findings debt --milestone "\{version\}"/);
    assert.match(s, /\*\*`deferred`\*\*[^\n]*tech debt[^\n]*id and reason/);
    assert.match(s, /\*\*`open`\*\*[^\n]*never disposed/);
    assert.match(audit, /recorded findings were never disposed/);
  });

  test('no shipped workflow or command still logs a verdict by hand — the record does it', () => {
    const LEGACY = ['plan_verified', 'plan_checker_issues', 'verification_passed', 'verification_gaps', 'verification_human_needed', 'reviewer_correction', 'reviewer_warnings'];
    const dirs = ['pan-wizard-core/workflows', 'commands/pan', 'agents'];
    const hits = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(REPO, d)).filter((x) => x.endsWith('.md'))) {
        const text = read(`${d}/${f}`);
        for (const cat of LEGACY) if (new RegExp(`--category ${cat}\\b`).test(text)) hits.push(`${d}/${f}: ${cat}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test('every deferral, dismissal or decision a shipped file teaches carries a reason', () => {
    const missing = [];
    for (const d of ['pan-wizard-core/workflows', 'commands/pan', 'agents']) {
      for (const f of fs.readdirSync(path.join(REPO, d)).filter((x) => x.endsWith('.md'))) {
        for (const line of read(`${d}/${f}`).split('\n')) {
          if (/findings dispose/.test(line) && /--as (deferred|dismissed|decision)/.test(line) && !/--reason "/.test(line)) missing.push(`${d}/${f}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(missing, [], 'the verb refuses these without --reason, so a file teaching them would teach a failing command');
  });
});

describe('exec-phase --deep-review is a real step (EL-4)', () => {
  const exec = read('pan-wizard-core/workflows/exec-phase.md');
  const review = step(exec, 'code_review');
  const deep = review.slice(review.indexOf('**Deep review'));

  test('the deep review runs only on the flag, and not without the review it builds on', () => {
    assert.match(deep, /^\*\*Deep review — only when `--deep-review` is in \$ARGUMENTS\.\*\*/);
    assert.match(deep, /`--skip-review` or `--fast`/);
  });

  test('it spawns the hardener, then the meta-reviewer, then merges all three reports', () => {
    const hardener = deep.indexOf('subagent_type="pan-hardener"');
    const meta = deep.indexOf('subagent_type="pan-meta-reviewer"');
    const merge = deep.indexOf('review-deep merge "${PHASE_NUMBER}"');
    assert.ok(hardener > -1 && meta > hardener && merge > meta, 'hardener → meta-reviewer → merge');
    for (const file of ['{phase_dir}/{phase_number}-review.md', '.planning/reviews/${PHASE_NUMBER}/hardener.md', '.planning/reviews/${PHASE_NUMBER}/meta.md']) {
      assert.ok(deep.slice(merge).includes(file), `the merge reads ${file}`);
    }
  });

  test('a review_required or block verdict stops before verification', () => {
    assert.match(deep, /On `review_required` or `block`, stop before verification/);
  });

  test('the command documents the flag as what it now does', () => {
    const cmd = read('commands/pan/exec-phase.md');
    const line = cmd.split('\n').find((l) => l.startsWith('- `--deep-review`'));
    assert.ok(line, 'the flag is documented');
    assert.doesNotMatch(line, /v3\.4\+/, 'no version claim for a flag that never ran before this change');
    assert.match(line, /skipped with `--skip-review` or `--fast`/);
  });
});
