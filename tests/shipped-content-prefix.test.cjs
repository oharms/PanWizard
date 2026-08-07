/**
 * Shipped-content path-prefix lint (E2E audit 2026-08, Batch A / ADR audit).
 *
 * The installer's path-rewrite step only recognizes the canonical `~/.claude/`
 * prefix and rewrites it per runtime and install-type. Any other prefix in
 * shipped runtime content ships VERBATIM and breaks on the four non-Claude
 * runtimes (Codex/Gemini/OpenCode/Copilot) and on global installs — the root
 * cause of audit High findings H4 and H6 and Mediums M37/M41/M52/M54/M55.
 *
 * This lint asserts shipped content references PAN assets only via `~/.claude/`,
 * so the whole class can never regress. It scans the SHIPPED trees only
 * (commands/, agents/, pan-wizard-core/{workflows,templates,references}) — not
 * docs/ (prose may legitimately mention `.claude/` when explaining runtimes).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SCAN_DIRS = [
  'commands/pan',
  'agents',
  'pan-wizard-core/workflows',
  'pan-wizard-core/templates',
  'pan-wizard-core/references',
];

// Forbidden prefixes for PAN-asset paths. Each targets an asset path (not the
// bare word ".claude" in prose), so runtime-explaining sentences and the one
// legitimate parenthetical in update.md ("`./.claude/` for local") don't trip.
const ASSET = '(pan-wizard-core|agents|templates|references|workflows|commands|pan-local-patches)';
const FORBIDDEN = [
  { re: new RegExp(`\\./\\.claude/${ASSET}`), why: "'./.claude/<asset>' — use '~/.claude/' (installer rewrites it per runtime/install-type)" },
  { re: /@\.\/\.claude\//, why: "'@./.claude/' include — use '@~/.claude/'" },
  { re: new RegExp(`(^|[^~./\\w])\\.claude/${ASSET}`, 'm'), why: "bare '.claude/<asset>' — use '~/.claude/'" },
  { re: /\$HOME\/\.claude\//, why: "'$HOME/.claude/' — installer rewrite regex doesn't match it; use '~/.claude/'" },
  { re: /~\/\.pan-wizard-core\/defaults/, why: "'~/.pan-wizard-core/defaults.json' — code reads '~/.pan-wizard/defaults.json' (config.cjs)" },
  { re: /~\/\.gsd\b/, why: "stray '~/.gsd' — the defaults dir is '~/.pan-wizard'" },
];

function* mdFiles(dir) {
  const abs = path.join(ROOT, dir);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { yield* mdFiles(path.join(dir, e.name)); }
    else if (e.name.endsWith('.md')) { yield path.join(dir, e.name); }
  }
}

describe('shipped-content path-prefix lint (runtime parity — audit Batch A)', () => {
  test('shipped content references PAN assets only via the canonical ~/.claude/ prefix', () => {
    const violations = [];
    for (const dir of SCAN_DIRS) {
      for (const rel of mdFiles(dir)) {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
        const lines = text.split(/\r?\n/);
        lines.forEach((line, i) => {
          for (const { re, why } of FORBIDDEN) {
            if (re.test(line)) violations.push(`${rel.replace(/\\/g, '/')}:${i + 1} — ${why}\n    ${line.trim()}`);
          }
        });
      }
    }
    assert.equal(violations.length, 0,
      `Non-canonical PAN-asset path prefix in shipped content (breaks non-Claude runtimes / global installs):\n${violations.join('\n')}`);
  });
});
