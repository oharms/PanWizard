#!/usr/bin/env node
/**
 * Copy PAN hooks from hooks/ to hooks/dist/ for installation.
 *
 * This is COPY-ONLY. PAN's hooks are pure Node.js with zero runtime
 * dependencies, so no bundling step is needed. The script is named
 * "build-hooks" for npm-script convention, but the work is `cp`.
 *
 * (See docs/IMPROVEMENT-TODO.md P2 for the rationale.)
 */

const fs = require('fs');
const path = require('path');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const DIST_DIR = path.join(HOOKS_DIR, 'dist');

// Hooks to copy (pure Node.js, no bundling needed)
const HOOKS_TO_COPY = [
  'pan-check-update.js',
  'pan-context-monitor.js',
  'pan-statusline.js',
  'pan-cost-logger.js',
  'pan-trace-logger.js'
];

function build() {
  // Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Copy hooks to dist
  for (const hook of HOOKS_TO_COPY) {
    const src = path.join(HOOKS_DIR, hook);
    const dest = path.join(DIST_DIR, hook);

    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${hook} not found, skipping`);
      continue;
    }

    console.log(`Copying ${hook}...`);
    fs.copyFileSync(src, dest);
    console.log(`  → ${dest}`);
  }

  console.log('\nBuild complete.');
}

build();
