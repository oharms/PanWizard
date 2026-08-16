#!/usr/bin/env node
/**
 * Print the absolute path of the built PAN plugin directory — the contract a
 * Claude Code plugin-marketplace `command` source requires (v2.1.229+).
 *
 * WHY THIS EXISTS. PAN builds a plugin (`npm run build:plugin`) and has shipped
 * it nowhere, because marketplace publishing is gated on one unverified
 * question: does `${CLAUDE_PLUGIN_ROOT}` expand inside *command markdown*? It is
 * documented as substituted in hook and MCP configs, not in content. A `command`
 * source needs no hosting, so it turns that question into a local experiment —
 * install the plugin from this script's output and run `/pan-plugin-selftest`.
 *
 * THE CONTRACT, verbatim from code.claude.com/docs/en/plugin-marketplaces:
 *   - Claude Code runs the command "through the platform shell, `sh` on macOS and
 *     Linux or `cmd.exe` on Windows, from the user's home directory". So NOTHING
 *     here may depend on the working directory; every path is derived from
 *     __dirname.
 *   - "The command must print exactly one line on stdout and exit with code 0."
 *     The plugin build is chatty, so its stdout is relayed to STDERR and only the
 *     path reaches stdout. A stray console.log here breaks the install.
 *   - The printed directory must hold plugin content at its top level, must not
 *     be the directory Claude Code started in or one of its parents, and on
 *     Windows must not be a UNC path.
 *
 * Rebuilding on every run is deliberate: Claude Code re-runs the command once per
 * session in the background, so a source edit is picked up without reinstalling.
 * In `copy` mode the version is a hash of the directory contents, so an unchanged
 * build counts as up to date.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'dist', 'pan-wizard-plugin');

// Top-level markers Claude Code accepts as proof of plugin content.
const PLUGIN_MARKERS = ['.claude-plugin', 'skills', 'commands', 'agents', 'hooks'];

function fail(message) {
  // stderr only — stdout is reserved for the single path line.
  process.stderr.write(`plugin-path: ${message}\n`);
  process.exit(1);
}

function build() {
  try {
    // Relay the builder's stdout to stderr so stdout stays single-line.
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-plugin.js')], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out) process.stderr.write(out);
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    fail(`plugin build failed: ${detail.split('\n').slice(-3).join(' | ')}`);
  }
}

function main() {
  build();

  if (!fs.existsSync(PLUGIN_DIR)) fail(`build produced no directory at ${PLUGIN_DIR}`);

  const top = fs.readdirSync(PLUGIN_DIR);
  if (!PLUGIN_MARKERS.some((m) => top.includes(m))) {
    fail(`no plugin content at the top level of ${PLUGIN_DIR} (need one of ${PLUGIN_MARKERS.join(', ')})`);
  }

  const resolved = path.resolve(PLUGIN_DIR);

  // Windows UNC paths are refused by Claude Code; catch it here with a clear
  // message rather than letting the install fail opaquely.
  if (process.platform === 'win32' && /^\\\\/.test(resolved)) {
    fail(`refusing a UNC path (Claude Code rejects it): ${resolved}`);
  }

  // Exactly one line, nothing else.
  process.stdout.write(`${resolved}\n`);
}

main();
