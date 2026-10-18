/**
 * research-lint.cjs — research claims with provenance and freshness (program P3).
 *
 * A research file records its load-bearing claims in a `## Claims` table:
 * claim · type · source · checked. `research lint` flags a claim with no source or no
 * date (errors: the planner cannot tell where it came from or when), and a claim
 * older than the freshness window for its type (stale: the plan-checker weighs it).
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../pan-wizard-core/bin/lib/research-lint.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const NOW = '2026-10-18';
let dir;
let phaseDir;

function research(rows, { claims = true } = {}) {
  const head = '# Phase 3: Auth - Research\n\n**Researched:** 2026-10-10\n\n## Summary\n\nprose\n\n';
  const table = ['## Claims', '', '| Claim | Type | Source | Checked |', '|-------|------|--------|---------|', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  fs.writeFileSync(path.join(phaseDir, '03-research.md'), head + (claims ? table + '\n' : ''));
}

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '').trim() };
  }
}

const codes = (list) => list.map((e) => e.code).sort();

beforeEach(() => {
  dir = createTempProject();
  phaseDir = path.join(dir, '.planning', 'phases', '03-auth');
  fs.mkdirSync(phaseDir, { recursive: true });
});
afterEach(() => cleanup(dir));

describe('research lint (P3)', () => {
  test('sourced, dated, fresh claims pass', () => {
    research([
      ['jose 6 supports EdDSA', 'version', 'https://github.com/panva/jose/releases', '2026-10-12'],
      ['Refresh tokens should rotate', 'practice', 'RFC 9700 §4.14', '2026-01-05'],
    ]);
    const r = R.lintResearch(dir, '3', { now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual([r.claims, r.stale.length], [2, 0]);
    assert.equal(r.file, '.planning/phases/03-auth/03-research.md');
  });

  test('a claim without a source or without a date is an error', () => {
    research([
      ['bcrypt cost 12 is the default', 'api', '', '2026-10-01'],
      ['argon2id is preferred', 'security', 'OWASP cheat sheet', ''],
      ['jose is maintained', 'version', '[Official docs URL]', 'last week'],
    ]);
    const r = R.lintResearch(dir, '3', { now: NOW });
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r.errors), ['claim_no_date', 'claim_no_date', 'claim_no_source', 'claim_no_source']);
    assert.equal(r.errors.find((e) => e.code === 'claim_no_source').row, 1);
  });

  test('a claim older than its type\'s window is stale; a stable kind of fact lasts longer', () => {
    research([
      ['express 5 is stable', 'version', 'https://expressjs.com', '2026-08-01'],
      ['Stripe charges 2.9%', 'pricing', 'https://stripe.com/pricing', '2026-09-01'],
      ['Use a queue for retries', 'practice', 'SRE book ch. 22', '2026-03-01'],
    ]);
    const r = R.lintResearch(dir, '3', { now: NOW });
    assert.equal(r.ok, true, 'stale is not an error');
    assert.deepEqual(r.stale.map((s) => [s.claim, s.type, s.age_days, s.window_days]), [
      ['express 5 is stable', 'version', 78, 30],
      ['Stripe charges 2.9%', 'pricing', 47, 30],
    ]);
  });

  test('an unknown type is a warning and uses the general window', () => {
    research([['something', 'vibes', 'a blog', '2026-10-01']]);
    const r = R.lintResearch(dir, '3', { now: NOW });
    assert.deepEqual(codes(r.warnings), ['claim_unknown_type']);
    assert.equal(r.ok, true);
  });

  test('a research file with no Claims section is an error; a date in the future is too', () => {
    research([], { claims: false });
    assert.deepEqual(codes(R.lintResearch(dir, '3', { now: NOW }).errors), ['claims_missing']);
    research([['x is true', 'api', 'docs', '2027-01-01']]);
    assert.deepEqual(codes(R.lintResearch(dir, '3', { now: NOW }).errors), ['claim_future_date']);
  });

  test('a path works as well as a phase; a phase with no research file says so', () => {
    research([['ok', 'api', 'docs', '2026-10-10']]);
    assert.equal(R.lintResearch(dir, '.planning/phases/03-auth/03-research.md', { now: NOW }).ok, true);
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '04-x'));
    assert.equal(R.lintResearch(dir, '4', { now: NOW }).error, 'no_research');
  });

  test('CLI: exit 1 and `invalid` on errors, exit 0 on stale only', () => {
    research([['no source here', 'api', '', '2026-10-10']]);
    assert.deepEqual(Object.values(cli(['research', 'lint', '3', '--now', NOW, '--raw'])), [1, 'invalid']);
    research([['old', 'version', 'docs', '2025-01-01']]);
    const r = cli(['research', 'lint', '3', '--now', NOW]);
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(r.out).stale.length, 1);
  });
});
