// Every distill / experiment / git-sync subcommand reaches its own handler through
// the CLI. These groups word their errors differently from the rest of the
// dispatcher, so until 2026-09-26 the typo index (suggest.cjs) and the surface
// registry never listed their subcommands, and nothing checked the routing end to
// end: tests/distill.test.cjs and tests/experiment.test.cjs call the modules
// in-process. Each case below runs the real CLI and checks the answer is the
// handler's own — never the group's "unknown subcommand" refusal.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTempProject, cleanup, runPanTools, withFakeHome } = require('./helpers.cjs');

let dir;
before(() => { dir = createTempProject(); });
after(() => cleanup(dir));

const text = (r) => `${r.output || ''}\n${r.error || ''}`;
const routed = (r, group) => assert.ok(!new RegExp(`[Uu]nknown ${group} subcommand`).test(text(r)), `refused as unknown: ${text(r)}`);

describe('distill subcommands', () => {
  for (const cmd of ['distill scan', 'distill analyze']) {
    test(`${cmd} returns a findings report for an empty project`, () => {
      const r = runPanTools(cmd, dir);
      routed(r, 'distill');
      assert.ok(r.success, r.error);
      const out = JSON.parse(r.output);
      assert.deepEqual(out.findings, []);
      assert.equal(out.files_scanned, 0);
    });
  }

  test('distill report summarises the (empty) findings', () => {
    const r = runPanTools('distill report', dir);
    routed(r, 'distill');
    assert.ok(r.success, r.error);
    assert.equal(JSON.parse(r.output).findings_count, 0);
  });
});

describe('experiment subcommands', () => {
  test('experiment list reads the experiments root under HOME', () => {
    withFakeHome(() => {
      const r = runPanTools('experiment list', dir);
      routed(r, 'experiment');
      assert.ok(r.success, r.error);
      assert.deepEqual(JSON.parse(r.output).experiments, [], 'a fresh HOME has no experiments');
    });
  });

  for (const cmd of ['experiment new', 'experiment manifest', 'experiment run', 'experiment status', 'experiment stop', 'experiment harvest', 'experiment prune']) {
    test(`${cmd} asks for its slug`, () => {
      const r = runPanTools(cmd, dir);
      routed(r, 'experiment');
      assert.match(text(r), new RegExp(`${cmd} <slug> required`));
    });
  }
});

describe('git subcommands', () => {
  test('git sync outside a repository says so', () => {
    const plain = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-nogit-'));
    try {
      const r = runPanTools('git sync', plain);
      routed(r, 'git');
      assert.equal(JSON.parse(r.output).error, 'not_a_git_repo');
    } finally {
      cleanup(plain);
    }
  });
});
