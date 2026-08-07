'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Feedback: Unicode & Special Characters', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    // Section headings state.cjs actually matches (`### Decisions` /
    // `### Blockers/Concerns`). With `## Key Decisions` the add-decision write below
    // could never land, so the test asserted a boolean type and verified nothing
    // about the special characters it is named for.
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '# Project State', '',
      '**Status:** In progress', '**Current Phase:** 1', '',
      '## Accumulated Context', '',
      '### Decisions', '', 'None yet.', '',
      '### Blockers/Concerns', '', 'None yet.', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), '## Roadmap\n\n| Phase | Name | Status |\n|---|---|---|\n');
    fs.writeFileSync(path.join(pd, 'config.json'), '{}');
  });

  after(() => { runner.cleanup(); });

  test('phase add with hyphenated name produces valid slug', () => {
    const r = runner.run('phase add my-cool-feature');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(/^[a-z0-9-]+$/.test(p.slug), `slug should be valid: "${p.slug}"`);
  });

  test('generate-slug handles hyphenated input', () => {
    const r = runner.run('generate-slug Hello-World-Test');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.ok(p.slug.length > 0, 'slug should not be empty');
    assert.ok(/^[a-z0-9-]+$/.test(p.slug), `slug should be lowercase: "${p.slug}"`);
  });

  test('state add-decision with special chars preserved', () => {
    const r = runner.run('state add-decision --summary Use-UTF-8-encoding');
    assert.ok(r.success, `should succeed: ${r.error}`);
    assert.equal(JSON.parse(r.output).added, true, 'the decision must actually be added');
    assert.match(fs.readFileSync(path.join(runner.tmpDir, '.planning', 'state.md'), 'utf-8'),
      /Use-UTF-8-encoding/, 'and the characters must survive the round trip');
  });

  test('phase add with very long name truncates gracefully', () => {
    const longName = 'a-very-long-phase-name-that-exceeds-normal-length-limits-and-should-be-handled';
    const r = runner.run(`phase add ${longName}`);
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.directory, 'should create directory');
    // Directory should exist on disk
    const fullPath = path.join(runner.tmpDir, p.directory);
    assert.ok(fs.existsSync(fullPath), `directory should exist: ${p.directory}`);
  });

  test('generate-slug normalizes special characters', () => {
    const r = runner.run('generate-slug UPPER-Case-Mixed');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.ok(p.slug === p.slug.toLowerCase(), 'slug should be lowercase');
  });
});
