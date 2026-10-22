#!/usr/bin/env node
/**
 * install-pre-push.cjs — turn the local-CI pre-push hook on or off for this clone
 * (`npm run hooks:pre-push`, `npm run hooks:pre-push -- --off`).
 *
 * The hook itself is tracked at scripts/git-hooks/pre-push, where core.hooksPath already
 * points (scripts/install-git-hooks.js). It is inert until `pan.prePush` is true in this
 * clone's git config, so a fresh clone never runs the local CI on push unless its owner
 * asked for it. This script sets or clears that key, and makes sure core.hooksPath is set.
 *
 * Exit 0 on success, 1 when git refuses.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const off = process.argv.includes('--off');

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0 && !(off && args.includes('--unset'))) {
    console.error(`[pre-push] git ${args.join(' ')} failed: ${(r.stderr || r.error && r.error.message || '').trim()}`);
    process.exit(1);
  }
  return r;
}

if (off) {
  git(['config', '--local', '--unset', 'pan.prePush']);
  console.error('[pre-push] off — git push no longer runs the local CI.');
} else {
  git(['config', '--local', 'core.hooksPath', 'scripts/git-hooks']);
  git(['config', '--local', 'pan.prePush', 'true']);
  console.error('[pre-push] on — git push runs `node scripts/local-ci.cjs --fast` first (SKIP_PREPUSH=1 to bypass once; --off to remove).');
}
