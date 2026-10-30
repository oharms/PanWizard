/**
 * redact.cjs — what must never leave a project in a shared report (`/pan:feedback`).
 *
 * scanText names the rules a text breaks, never the text. Its token patterns are the
 * union of the trace logger's and the guard's, and a drift test keeps it that way.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../pan-wizard-core/bin/lib/redact.cjs');

const ROOT = path.join(__dirname, '..');

describe('redact.scanText', () => {
  const cases = [
    ['token', 'key sk-ant-api03-abcdefghijklmnop'],
    ['token', 'ghp_' + 'a'.repeat(36)],
    ['token', '-----BEGIN RSA PRIVATE KEY-----'],
    ['secret_key_value', 'password: hunter2x'],
    ['bearer', 'Authorization: Bearer abc.def.ghi123'],
    ['long_mixed_run', 'id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
    ['email', 'contact jane.doe@client.example'],
    ['url', 'see https://internal.client.example/wiki'],
    ['windows_path', 'at C:\\Users\\jane\\proj\\src\\a.js'],
    ['unix_path', 'at /home/jane/proj/src/a.js'],
    ['home_path', 'at ~/proj/src/a.js'],
    ['unc_path', 'share \\\\fileserver\\docs'],
    ['ipv4', 'host 10.20.30.40'],
  ];
  for (const [rule, text] of cases) {
    test(`flags ${rule}`, () => assert.ok(R.scanText(text).includes(rule), `${rule} not flagged in ${text}: ${R.scanText(text)}`));
  }

  test('a report made of counts, codes and PAN names passes', () => {
    const ok = '| pan-reviewer | quality | medium | dismissed | 12 |\nPAN 3.37.0 · claude · win32 · node 22 · no_verification: 3 · $5–10 · week 2026-W43';
    assert.deepEqual(R.scanText(ok), []);
  });

  test('names the rule, never the matched text', () => {
    const hits = R.scanText('token sk-ant-api03-SECRETSECRETSECRET');
    assert.ok(hits.every((h) => !h.includes('SECRET')));
  });

  test('canaries match whole words, case-insensitive; allowed substrings are skipped', () => {
    const canaries = [{ kind: 'project_dir', value: 'acme-billing' }];
    assert.deepEqual(R.scanText('phase for ACME-Billing done', { canaries }), ['canary:project_dir']);
    assert.deepEqual(R.scanText('acme-billingx is another word', { canaries }), []);
    assert.deepEqual(R.scanText('paste at https://github.com/oharms/PanWizard/issues/new', { allowed: ['https://github.com/oharms/PanWizard/issues/new'] }), []);
  });

  test('every token shape the trace logger and the guard know is in the shared pattern', () => {
    const shapes = (file) => {
      const src = fs.readFileSync(path.join(ROOT, 'hooks', file), 'utf8');
      const m = src.match(/const TOKEN_RE = \/(.+)\/[a-z]*;/);
      assert.ok(m, `${file} has no TOKEN_RE`);
      return m[1].replace(/^\\b\(\?:/, '').replace(/\)$/, '').split('|').map((s) => s.replace(/\[.*$|\\.*$|\{.*$/, '')).filter((s) => s.length >= 3);
    };
    for (const file of ['pan-trace-logger.js', 'pan-guard.js']) {
      for (const prefix of shapes(file)) assert.ok(R.TOKEN_RE.source.includes(prefix), `${file}: ${prefix} missing from redact.cjs`);
    }
  });
});

describe('redact.projectCanaries', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-billing-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    g('init', '-q', '-b', 'client-feature');
    g('config', 'user.name', 'Jane Doe');
    g('config', 'user.email', 'jane@acme.example');
    g('remote', 'add', 'origin', 'git@git.acme.example:acme-corp/billing-engine.git');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads the project, git and OS identifiers, and phase names', () => {
    const c = R.projectCanaries(dir, { phaseSlugs: ['invoice-export', 'ui'] });
    const kinds = Object.fromEntries(c.map((x) => [x.kind + ':' + x.value, true]));
    for (const k of ['git_owner:acme-corp', 'git_repo:billing-engine', 'git_host:git.acme.example', 'git_user:Jane Doe', 'git_email:jane@acme.example', 'phase_name:invoice-export']) {
      assert.ok(kinds[k], `missing ${k}: ${JSON.stringify(c)}`);
    }
    assert.ok(c.some((x) => x.kind === 'project_dir' && x.value.startsWith('acme-billing-')));
    assert.ok(!c.some((x) => x.value === 'ui'), 'values under four characters are left out');
  });
});
