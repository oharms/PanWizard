// Tests for references/guardrails.md — behavioral guardrails reference doc.
// Ships in v3.6.0 from docs/specs/googlecli_adoption_featureai.md.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GUARDRAILS_PATH = path.join(
  __dirname,
  '..',
  'pan-wizard-core',
  'references',
  'guardrails.md'
);

describe('references/guardrails.md', () => {
  test('file exists at expected source path', () => {
    assert.ok(
      fs.existsSync(GUARDRAILS_PATH),
      `guardrails.md should exist at ${GUARDRAILS_PATH}`
    );
  });

  test('file is non-empty and within line budget (<=120 lines)', () => {
    const content = fs.readFileSync(GUARDRAILS_PATH, 'utf-8');
    const lineCount = content.split('\n').length;
    assert.ok(content.length > 0, 'file should be non-empty');
    assert.ok(
      lineCount <= 120,
      `file should be <=120 lines (50% slack from 80-line target), got ${lineCount}`
    );
  });

  test('contains required headings', () => {
    const content = fs.readFileSync(GUARDRAILS_PATH, 'utf-8');
    assert.match(
      content,
      /## Common Shortcuts to Resist/,
      'should have "Common Shortcuts to Resist" section'
    );
    assert.match(
      content,
      /## Code Preservation Principle/,
      'should have "Code Preservation Principle" section'
    );
    assert.match(
      content,
      /## Stop-the-Line Rule/,
      'should have "Stop-the-Line Rule" section'
    );
  });

  test('contains expected cross-references to other PAN docs', () => {
    const content = fs.readFileSync(GUARDRAILS_PATH, 'utf-8');
    assert.match(content, /workflows\/exec-phase\.md/, 'should reference exec-phase.md');
    assert.match(content, /workflows\/verify-phase\.md/, 'should reference verify-phase.md');
    assert.match(content, /references\//, 'should reference at least one other reference doc');
  });
});
