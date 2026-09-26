// A line-ending-only difference is not a local edit.
//
// The install manifest records sha256 over raw bytes. The 3.30.0 upgrade sweep
// found the installer backing up untouched files as "locally modified PAN
// files": 8 in each of three projects, 357 in one that commits `.claude/` to git
// with core.autocrlf=true — every one byte-identical to the release apart from
// CRLF. Two readers compare against those hashes: the installer's
// saveLocalPatches and `validate deployment` (verify-deploy.cjs). Both must
// accept a CRLF/LF-converted file and still catch a real edit.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { bytesMatchHashIgnoringEol } = require('../bin/install-lib.cjs');
const { installInto, runPanTools, cleanup } = require('./helpers.cjs');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const toCrlf = s => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

describe('bytesMatchHashIgnoringEol', () => {
  const lf = Buffer.from('---\nname: x\n---\nbody é ✓\n', 'utf8');
  const crlf = Buffer.from(toCrlf(lf.toString('utf8')), 'utf8');

  test('raw bytes match', () => {
    assert.equal(bytesMatchHashIgnoringEol(lf, sha(lf)), true);
  });

  test('a CRLF copy of an LF original matches, and the reverse', () => {
    assert.equal(bytesMatchHashIgnoringEol(crlf, sha(lf)), true);
    assert.equal(bytesMatchHashIgnoringEol(lf, sha(crlf)), true);
  });

  test('a mixed-EOL copy of an LF original matches', () => {
    const mixed = Buffer.from('---\r\nname: x\n---\r\nbody é ✓\n', 'utf8');
    assert.equal(bytesMatchHashIgnoringEol(mixed, sha(lf)), true);
  });

  test('a real edit does not match, with or without an EOL change', () => {
    const edited = Buffer.from('---\nname: y\n---\nbody é ✓\n', 'utf8');
    assert.equal(bytesMatchHashIgnoringEol(edited, sha(lf)), false);
    assert.equal(bytesMatchHashIgnoringEol(Buffer.from(toCrlf(edited.toString('utf8'))), sha(lf)), false);
  });

  test('a lone CR is content, not a line ending', () => {
    const cr = Buffer.from('a\rb\n');
    assert.equal(bytesMatchHashIgnoringEol(cr, sha(Buffer.from('a\nb\n'))), false);
  });

  test('a NUL-bearing buffer compares raw only', () => {
    const bin = Buffer.from([0x00, 0x0d, 0x0a, 0x41]);
    assert.equal(bytesMatchHashIgnoringEol(bin, sha(bin)), true);
    assert.equal(bytesMatchHashIgnoringEol(bin, sha(Buffer.from([0x00, 0x0a, 0x41]))), false);
  });

  test('a missing manifest hash never matches', () => {
    assert.equal(bytesMatchHashIgnoringEol(lf, null), false);
    assert.equal(bytesMatchHashIgnoringEol(lf, undefined), false);
  });
});

describe('an upgrade over CRLF-converted files backs up only the real edit', () => {
  let dir;
  let converted;
  const edited = 'commands/pan/help.md';
  let deploymentBefore;
  let upgradeOutput;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-eol-hash-'));
    const first = installInto(dir, ['--claude', '--local']);
    assert.ok(first.success, `first install failed: ${first.error}`);
    const cfg = path.join(dir, '.claude');
    const manifest = JSON.parse(fs.readFileSync(path.join(cfg, 'pan-file-manifest.json'), 'utf8'));
    // What git does to a committed .claude/ under core.autocrlf=true.
    converted = Object.keys(manifest.files).filter(k => /\.(md|cjs|js|json)$/.test(k) && k !== edited).slice(0, 40);
    for (const rel of converted) {
      const p = path.join(cfg, rel);
      fs.writeFileSync(p, toCrlf(fs.readFileSync(p, 'latin1')), 'latin1');
    }
    const helpPath = path.join(cfg, edited);
    fs.writeFileSync(helpPath, toCrlf(fs.readFileSync(helpPath, 'utf8') + '\nMy own note.\n'));

    const res = runPanTools('validate deployment', dir);
    deploymentBefore = JSON.parse(res.output);

    const second = installInto(dir, ['--claude', '--local']);
    assert.ok(second.success, `upgrade install failed: ${second.error}`);
    upgradeOutput = second.output;
  });

  after(() => cleanup(dir));

  test('the fixture converted files that really changed on disk', () => {
    assert.ok(converted.length >= 20, `expected 20+ converted files, got ${converted.length}`);
  });

  test('validate deployment reports only the edited file as modified', () => {
    assert.deepEqual(deploymentBefore.runtimes.claude.modified, [edited]);
  });

  test('the upgrade backs up only the edited file', () => {
    const meta = JSON.parse(fs.readFileSync(
      path.join(dir, '.claude', 'pan-local-patches', 'backup-meta.json'), 'utf8'));
    assert.deepEqual(meta.files, [edited]);
    assert.match(upgradeOutput, /Found 1 locally modified PAN file/);
  });
});
