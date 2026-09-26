/**
 * The dist-tag a release publishes under (market-ideas queue M1).
 *
 * npm's default dist-tag is `latest`, and the release workflow used to run
 * `npm publish` with no `--tag`: a release candidate would have become what every
 * `npm install pan-wizard` resolves to. The rule is pure and tested here; the
 * workflow half is pinned by reading release.yml, because a workflow that stops
 * passing the tag would publish a candidate as `latest` with every test green.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { distTagFor } = require('../scripts/npm-dist-tag.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'npm-dist-tag.js');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

/** The `run:` body of the named workflow step. */
function stepRun(name) {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, `release.yml has no step named "${name}"`);
  const next = WORKFLOW.indexOf('\n      - name: ', start + 1);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
}

describe('distTagFor', () => {
  test('a stable version publishes as latest', () => {
    assert.equal(distTagFor('3.30.0'), 'latest');
    assert.equal(distTagFor('10.0.12'), 'latest');
  });

  test('a prerelease publishes as next', () => {
    assert.equal(distTagFor('3.31.0-rc.1'), 'next');
    assert.equal(distTagFor('3.31.0-beta'), 'next');
  });

  test('junk is refused, not tagged', () => {
    assert.equal(distTagFor('3.31'), null);
    assert.equal(distTagFor(''), null);
    assert.equal(distTagFor(undefined), null);
  });
});

describe('npm-dist-tag CLI', () => {
  test('prints the tag for an explicit version', () => {
    assert.equal(execFileSync(process.execPath, [SCRIPT, '3.31.0-rc.2'], { encoding: 'utf8' }).trim(), 'next');
    assert.equal(execFileSync(process.execPath, [SCRIPT, '3.31.0'], { encoding: 'utf8' }).trim(), 'latest');
  });

  test('defaults to package.json’s version', () => {
    const version = require(path.join(ROOT, 'package.json')).version;
    assert.equal(execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).trim(), distTagFor(version));
  });

  test('exits 1 on a version it cannot parse', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'not-a-version'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /refusing to pick a tag/);
  });
});

describe('release.yml passes the tag', () => {
  test('the publish step publishes with --tag from the script', () => {
    const run = stepRun('Publish with provenance (OIDC)');
    assert.match(run, /DIST_TAG=\$\(node scripts\/npm-dist-tag\.js\)/);
    assert.match(run, /npm publish --provenance --access public --tag "\$DIST_TAG"/);
    assert.match(run, /set -euo pipefail/, 'a failing tag script must stop the publish');
  });

  test('no step publishes without a tag', () => {
    // A command position: line start (optionally after `run:`), or after && ; |
    const invocation = /(?:^\s*(?:run:\s*)?|&&\s*|;\s*|\|\s*)npm publish\b/;
    const publishes = WORKFLOW.split('\n').filter(line => invocation.test(line));
    assert.ok(publishes.length >= 1, 'release.yml must publish somewhere');
    for (const line of publishes) {
      assert.match(line, /--tag\b/, `untagged publish: ${line.trim()}`);
    }
  });

  test('a prerelease GitHub Release is not marked latest', () => {
    const run = stepRun('Create the GitHub Release');
    assert.match(run, /"\$\(node scripts\/npm-dist-tag\.js\)" = "next"/);
    assert.match(run, /--prerelease --latest=false/);
  });
});
