#!/usr/bin/env node
/**
 * Print the npm dist-tag a version publishes under: `next` for a prerelease
 * (`3.31.0-rc.1`), `latest` otherwise.
 *
 * WHY. The release workflow ran `npm publish` with no `--tag`, and npm's default
 * tag is `latest` — so a release candidate would have become what
 * `npm install pan-wizard` resolves to for every user (market-ideas queue M1,
 * 2026-09-21). Publishing a candidate under `next` keeps it installable by name
 * (`pan-wizard@next`, `pan-wizard@3.31.0-rc.1`) without moving anyone onto it.
 *
 * A version that is not `major.minor.patch[-prerelease]` exits 1 rather than
 * guessing a tag: publishing junk under `latest` is the failure this prevents.
 *
 * Usage:
 *   node scripts/npm-dist-tag.js            # the tag for package.json's version
 *   node scripts/npm-dist-tag.js 3.31.0-rc.1
 */

'use strict';

const path = require('path');
const { parse } = require('./deprecate-old-versions.js');

/**
 * @param {string} version
 * @returns {'latest'|'next'|null} null when the version does not parse
 */
function distTagFor(version) {
  const v = parse(version);
  if (!v) return null;
  return v.pre === null ? 'latest' : 'next';
}

function main() {
  const version = process.argv[2] || require(path.join(__dirname, '..', 'package.json')).version;
  const tag = distTagFor(version);
  if (!tag) {
    process.stderr.write(`npm-dist-tag: '${version}' is not a semver version — refusing to pick a tag\n`);
    process.exit(1);
  }
  process.stdout.write(tag + '\n');
}

module.exports = { distTagFor };

if (require.main === module) main();
