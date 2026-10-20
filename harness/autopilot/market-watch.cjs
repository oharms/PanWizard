#!/usr/bin/env node
'use strict';
/**
 * The market watcher (program S1). Development only: nothing under harness/ ships.
 *
 * A WATCH row of the ideas ledger names a revisit trigger in prose. The rows that can be
 * checked by a machine also carry a predicate in docs/specs/watch-triggers.json:
 *
 *   npm_dist_tag        {package, tag, gt|gte}   a dist-tag has passed a version
 *   github_release      {repo, tag_matches}      a release whose tag matches exists
 *   changelog_contains  {file, pattern}          PAN's own changelog mentions it
 *   harness_result      {scenario, status}       a harness scenario's last result
 *
 * This script evaluates them with no model: the npm registry and the GitHub releases API
 * (conditional requests by ETag, so an unchanged answer costs nothing), and local files.
 * A predicate that turns true is a delta, written to the inbox
 * (harness/autopilot/state/inbox.md). /market-ideas reads the inbox and turns deltas into
 * candidate rows for a human; this script never writes the ledger or its status column.
 *
 *   node harness/autopilot/market-watch.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TRIGGERS_FILE = 'docs/specs/watch-triggers.json';
const STATE = 'harness/autopilot/state/market-watch.json';
const INBOX = 'harness/autopilot/state/inbox.md';
const PREDICATES = ['npm_dist_tag', 'github_release', 'changelog_contains', 'harness_result'];

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0; const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function urlFor(p) {
  if (p.kind === 'npm_dist_tag') return `https://registry.npmjs.org/${String(p.package).replace('/', '%2f')}`;
  if (p.kind === 'github_release') return `https://api.github.com/repos/${p.repo}/releases?per_page=20`;
  return null;
}

/** A fetch over recorded responses: url → {status, etag, body}. */
function fixtureFetch(map) {
  return (url) => map[url] || { status: 404 };
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function evaluate(root, t, get) {
  const p = t.predicate || {};
  if (p.kind === 'npm_dist_tag') {
    const body = get(urlFor(p));
    const v = body && body['dist-tags'] && body['dist-tags'][p.tag || 'latest'];
    if (!v) return { value: null, detail: 'no answer from the npm registry' };
    const value = p.gte != null ? cmpVersion(v, p.gte) >= 0 : cmpVersion(v, p.gt) > 0;
    return { value, detail: `${p.package}@${p.tag || 'latest'} is ${v}${body.time && body.time[v] ? ` (published ${String(body.time[v]).slice(0, 10)})` : ''}` };
  }
  if (p.kind === 'github_release') {
    const body = get(urlFor(p));
    if (!Array.isArray(body)) return { value: null, detail: 'no answer from the GitHub releases API' };
    const re = new RegExp(p.tag_matches);
    const hit = body.find((r) => re.test(r.tag_name || ''));
    return { value: !!hit, detail: hit ? `${p.repo} released ${hit.tag_name}` : `${p.repo}: no release matches ${p.tag_matches}` };
  }
  if (p.kind === 'changelog_contains') {
    let text = '';
    try { text = fs.readFileSync(path.join(root, p.file || 'CHANGELOG.md'), 'utf8'); } catch { return { value: null, detail: `${p.file} not found` }; }
    const value = new RegExp(p.pattern, 'i').test(text);
    return { value, detail: value ? `${p.file} mentions /${p.pattern}/` : `${p.file} does not mention /${p.pattern}/` };
  }
  if (p.kind === 'harness_result') {
    const results = readJson(path.join(root, 'harness', 'autopilot', 'state', 'harness-results.json'), {});
    const got = results[p.scenario];
    if (!got) return { value: null, detail: `${p.scenario} has not run` };
    return { value: got === p.status, detail: `${p.scenario} last ${got}` };
  }
  return { value: null, detail: `unknown predicate ${p.kind}` };
}

/**
 * Evaluate every trigger, write the deltas to the inbox, keep the state.
 * @param {{root?: string, triggers?: Array, fetch: Function, now?: string, dryRun?: boolean}} o
 */
function runWatch(o) {
  const root = o.root || ROOT;
  const triggers = o.triggers || readJson(path.join(root, TRIGGERS_FILE), []);
  const now = o.now || new Date().toISOString().slice(0, 10);
  const statePath = path.join(root, STATE);
  const state = readJson(statePath, { etags: {}, cache: {}, values: {}, fired: [] });
  state.etags = state.etags || {}; state.cache = state.cache || {}; state.values = state.values || {}; state.fired = state.fired || [];
  const answers = new Map();
  const get = (url) => {
    if (!url) return null;
    if (answers.has(url)) return answers.get(url);
    const r = o.fetch(url, state.etags[url]) || { status: 0 };
    let body = null;
    if (r.status === 304) body = state.cache[url] ?? null;
    else if (r.status === 200) { body = r.body; state.cache[url] = r.body; if (r.etag) state.etags[url] = r.etag; }
    answers.set(url, body);
    return body;
  };
  const results = [];
  const fired = [];
  for (const t of triggers) {
    const { value, detail } = evaluate(root, t, get);
    const before = state.values[t.id];
    results.push({ id: t.id, kind: t.predicate && t.predicate.kind, value, detail });
    if (value === true && before !== true) fired.push({ id: t.id, at: now, note: detail });
    if (value !== null) state.values[t.id] = value;
  }
  if (!o.dryRun) {
    state.fired.push(...fired);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    if (fired.length) {
      const inbox = path.join(root, INBOX);
      const head = fs.existsSync(inbox) ? '' : '# Market watch inbox\n\nDeltas from `harness/autopilot/market-watch.cjs`. Each is a WATCH trigger that fired: read the source, then decide the ledger row in `/market-ideas`. Nothing here is a verdict.\n';
      fs.appendFileSync(inbox, `${head}\n## ${now}\n\n${fired.map((f) => `- **${f.id}**: ${f.note}`).join('\n')}\n`);
    }
  }
  return { results, fired };
}

function httpsGet(url, etag) {
  const https = require('https');
  return new Promise((resolve) => {
    const headers = { 'user-agent': 'pan-wizard-market-watch', accept: 'application/json' };
    if (etag) headers['if-none-match'] = etag;
    if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const req = https.get(url, { headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch {}
        resolve({ status: res.statusCode, etag: res.headers.etag, body });
      });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
  });
}

module.exports = { runWatch, fixtureFetch, evaluate, cmpVersion, urlFor, PREDICATES, INBOX, STATE, TRIGGERS_FILE };

if (require.main === module) {
  (async () => {
    const triggers = readJson(path.join(ROOT, TRIGGERS_FILE), []);
    const state = readJson(path.join(ROOT, STATE), { etags: {} });
    const map = {};
    for (const url of [...new Set(triggers.map((t) => urlFor(t.predicate || {})).filter(Boolean))]) map[url] = await httpsGet(url, (state.etags || {})[url]);
    const r = runWatch({ root: ROOT, triggers, fetch: fixtureFetch(map), dryRun: process.argv.includes('--dry-run') });
    for (const x of r.results) console.log(`${x.id.padEnd(7)} ${x.value === null ? 'unknown' : x.value ? 'TRUE   ' : 'false  '} ${x.detail}`);
    console.log(r.fired.length ? `${r.fired.length} fired: see ${INBOX}` : 'nothing fired');
  })();
}
