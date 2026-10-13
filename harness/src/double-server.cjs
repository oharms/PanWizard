#!/usr/bin/env node
'use strict';

/**
 * The model double as its own process (H1). The harness's step runner is synchronous,
 * and a double started in the same process could never answer while a `spawnSync`ed
 * host CLI waits for it: the event loop is blocked. So a double-backed step starts this
 * script, waits for the port file, runs the host, then stops it.
 *
 *   node double-server.cjs --mode script --script <file.json> --captures <dir> --port-file <file>
 *                          [--cassette <file.json>] [--upstream <url>]
 */

const fs = require('fs');
const { startDouble } = require('./model-double.cjs');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

(async () => {
  const readJson = (p) => (p ? JSON.parse(fs.readFileSync(p, 'utf8')) : undefined);
  const d = await startDouble({
    mode: arg('--mode') || 'capture',
    script: readJson(arg('--script')),
    cassette: readJson(arg('--cassette')),
    upstream: arg('--upstream') || undefined,
    capturesDir: arg('--captures') || undefined,
    onChange: () => flush(),
  });
  const portFile = arg('--port-file');
  function flush() {
    // Replay drift and record pairs are written beside the captures for the runner to read.
    const dir = arg('--captures');
    if (!dir) return;
    try { fs.writeFileSync(`${dir}/drift.json`, JSON.stringify(d.drift, null, 2), { mode: 0o600 }); } catch { /* best effort */ }
    if (d.recorded.length) try { fs.writeFileSync(`${dir}/recorded.json`, JSON.stringify(d.recorded, null, 2), { mode: 0o600 }); } catch { /* best effort */ }
  }
  if (portFile) fs.writeFileSync(portFile, String(d.port), { mode: 0o600 });
  const stop = () => { flush(); d.close().then(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // A parent that dies without signalling (Windows has no SIGTERM delivery to node) closes stdin.
  process.stdin.on('end', stop);
  process.stdin.resume();
})().catch((e) => { process.stderr.write(`double: ${e.message}\n`); process.exit(1); });
