/**
 * Tests for bus.cjs — file-backed message channels (Spec B v2 Y-7).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  publish,
  readChannel,
  drain,
  listChannels,
  validateName,
  BUS_DIR,
} = require('../pan-wizard-core/bin/lib/bus.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

function channelPath(tmpDir, channel) {
  return path.join(tmpDir, '.planning', BUS_DIR, `${channel}.jsonl`);
}

describe('bus — validateName', () => {
  test('accepts valid names', () => {
    assert.equal(validateName('orchestrator', 'channel'), null);
    assert.equal(validateName('review-handoff', 'channel'), null);
    assert.equal(validateName('pan-conductor', 'source'), null);
    assert.equal(validateName('phase_events_42', 'channel'), null);
  });

  test('rejects path traversal', () => {
    assert.ok(validateName('../escape', 'channel').includes('Invalid'));
    assert.ok(validateName('a/b', 'channel').includes('Invalid'));
    assert.ok(validateName('..\\x', 'source').includes('Invalid'));
  });

  test('rejects empty / non-string', () => {
    assert.ok(validateName('', 'channel').includes('Invalid'));
    assert.ok(validateName(null, 'channel').includes('Invalid'));
    assert.ok(validateName(42, 'channel').includes('Invalid'));
  });
});

describe('bus — publish', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('creates file and directory on first publish', () => {
    const r = publish(tmpDir, 'test', { hello: 'world' });
    assert.equal(r.published, true);
    assert.ok(r.ts);
    assert.ok(fs.existsSync(r.file));
  });

  test('appends multiple messages, each one line', () => {
    publish(tmpDir, 'test', 'one');
    publish(tmpDir, 'test', 'two');
    publish(tmpDir, 'test', 'three');
    const lines = fs.readFileSync(channelPath(tmpDir, 'test'), 'utf-8')
      .split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
    assert.ok(JSON.parse(lines[0]).payload === 'one');
    assert.ok(JSON.parse(lines[2]).payload === 'three');
  });

  test('records source when provided', () => {
    publish(tmpDir, 'ch', { x: 1 }, { source: 'pan-conductor' });
    const line = JSON.parse(fs.readFileSync(channelPath(tmpDir, 'ch'), 'utf-8').trim());
    assert.equal(line.source, 'pan-conductor');
  });

  test('source null when not provided', () => {
    publish(tmpDir, 'ch', 'x');
    const line = JSON.parse(fs.readFileSync(channelPath(tmpDir, 'ch'), 'utf-8').trim());
    assert.equal(line.source, null);
  });

  test('ts is ISO-8601', () => {
    const r = publish(tmpDir, 'ch', 'x');
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('rejects invalid channel name', () => {
    const r = publish(tmpDir, '../escape', 'x');
    assert.ok(r.error);
    assert.equal(r.published, undefined);
  });

  test('rejects invalid source name', () => {
    const r = publish(tmpDir, 'ch', 'x', { source: '../bad' });
    assert.ok(r.error);
  });

  test('handles non-JSON-serializable payload gracefully', () => {
    const circular = {};
    circular.self = circular;
    const r = publish(tmpDir, 'ch', circular);
    assert.ok(r.error);
    assert.ok(r.error.includes('payload'));
  });

  test('separate channels have separate files', () => {
    publish(tmpDir, 'alpha', 1);
    publish(tmpDir, 'beta', 2);
    assert.ok(fs.existsSync(channelPath(tmpDir, 'alpha')));
    assert.ok(fs.existsSync(channelPath(tmpDir, 'beta')));
  });
});

describe('bus — readChannel', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty for missing channel', () => {
    const r = readChannel(tmpDir, 'ghost');
    assert.deepEqual(r.entries, []);
    assert.equal(r.total, 0);
    assert.equal(r.more, false);
  });

  test('returns all entries in order', () => {
    for (let i = 0; i < 5; i++) publish(tmpDir, 'ch', `e${i}`);
    const r = readChannel(tmpDir, 'ch');
    assert.equal(r.entries.length, 5);
    assert.equal(r.entries[0].payload, 'e0');
    assert.equal(r.entries[4].payload, 'e4');
  });

  test('respects offset + limit', () => {
    for (let i = 0; i < 10; i++) publish(tmpDir, 'ch', i);
    const r = readChannel(tmpDir, 'ch', { offset: 3, limit: 4 });
    assert.equal(r.entries.length, 4);
    assert.equal(r.entries[0].payload, 3);
    assert.equal(r.entries[3].payload, 6);
    assert.equal(r.total, 10);
    assert.equal(r.more, true);
  });

  test('more=false when offset+limit covers all entries', () => {
    for (let i = 0; i < 3; i++) publish(tmpDir, 'ch', i);
    const r = readChannel(tmpDir, 'ch', { offset: 0, limit: 10 });
    assert.equal(r.more, false);
  });

  test('handles malformed lines without crashing', () => {
    publish(tmpDir, 'ch', 'good1');
    fs.appendFileSync(channelPath(tmpDir, 'ch'), 'not-json\n');
    publish(tmpDir, 'ch', 'good2');
    const r = readChannel(tmpDir, 'ch');
    assert.equal(r.entries.length, 3);
    assert.equal(r.entries[1].malformed, true);
    assert.equal(r.entries[2].payload, 'good2');
  });

  test('rejects invalid channel name', () => {
    const r = readChannel(tmpDir, '../evil');
    assert.ok(r.error);
  });
});

describe('bus — drain', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('peek mode is non-destructive', () => {
    publish(tmpDir, 'ch', 'msg');
    const r = drain(tmpDir, 'ch', { mode: 'peek' });
    assert.equal(r.entries.length, 1);
    assert.equal(r.mode, 'peek');
    // File still has content.
    const size = fs.statSync(channelPath(tmpDir, 'ch')).size;
    assert.ok(size > 0);
  });

  test('peek is default mode', () => {
    publish(tmpDir, 'ch', 'msg');
    const r = drain(tmpDir, 'ch');
    assert.equal(r.mode, 'peek');
  });

  test('consume mode truncates file', () => {
    publish(tmpDir, 'ch', 'a');
    publish(tmpDir, 'ch', 'b');
    const r = drain(tmpDir, 'ch', { mode: 'consume' });
    assert.equal(r.entries.length, 2);
    assert.equal(r.mode, 'consume');
    assert.equal(fs.statSync(channelPath(tmpDir, 'ch')).size, 0);
  });

  test('archive mode renames file with timestamp', () => {
    publish(tmpDir, 'ch', 'x');
    const r = drain(tmpDir, 'ch', { mode: 'archive' });
    assert.equal(r.mode, 'archive');
    assert.equal(fs.existsSync(channelPath(tmpDir, 'ch')), false);
    const files = fs.readdirSync(path.join(tmpDir, '.planning', BUS_DIR));
    const archive = files.find(f => f.startsWith('ch-') && f.endsWith('.archive.jsonl'));
    assert.ok(archive, 'archive file should exist');
  });

  test('drain on empty channel is a no-op', () => {
    const r = drain(tmpDir, 'ghost', { mode: 'consume' });
    assert.equal(r.total, 0);
    assert.equal(r.entries.length, 0);
    assert.equal(r.mode, 'consume');
  });

  test('unknown drain mode errors', () => {
    publish(tmpDir, 'ch', 'x');
    const r = drain(tmpDir, 'ch', { mode: 'explode' });
    assert.ok(r.error);
  });
});

describe('bus — listChannels', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty when no bus dir', () => {
    assert.deepEqual(listChannels(tmpDir), { channels: [] });
  });

  test('lists active channels with counts', () => {
    publish(tmpDir, 'alpha', 1);
    publish(tmpDir, 'alpha', 2);
    publish(tmpDir, 'beta', 'x');
    const r = listChannels(tmpDir);
    assert.equal(r.channels.length, 2);
    const alpha = r.channels.find(c => c.channel === 'alpha' && !c.archive);
    assert.equal(alpha.messages, 2);
    assert.ok(alpha.bytes > 0);
  });

  test('includes archived channels with flag', () => {
    publish(tmpDir, 'ch', 'x');
    drain(tmpDir, 'ch', { mode: 'archive' });
    publish(tmpDir, 'ch', 'new');
    const r = listChannels(tmpDir);
    const archived = r.channels.find(c => c.archive);
    const active = r.channels.find(c => !c.archive);
    assert.ok(archived);
    assert.ok(active);
    assert.equal(active.channel, 'ch');
  });
});

describe('bus — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  // Note: JSON payloads with double-quotes round-trip cleanly through
  // publish()/drain() when called as library functions (see earlier suites),
  // but cmd.exe on Windows strips or mangles inner quotes in a test harness
  // like runPanTools. The CLI tests below use plain-string payloads — the
  // dispatcher's fallback treats a non-JSON arg as a raw string payload,
  // which exercises the same code paths without the quoting hazard.

  test('publish + drain round-trip via CLI (plain payload)', () => {
    const p = runPanTools('bus publish orchestrator spawn-executor', tmpDir);
    assert.ok(p.success, p.error);
    const pJson = JSON.parse(p.output);
    assert.equal(pJson.published, true);

    const d = runPanTools('bus drain orchestrator --mode peek', tmpDir);
    assert.ok(d.success, d.error);
    const dJson = JSON.parse(d.output);
    assert.equal(dJson.entries.length, 1);
    assert.equal(dJson.entries[0].payload, 'spawn-executor');
  });

  test('bus list shows published channels', () => {
    runPanTools('bus publish ch1 hello', tmpDir);
    runPanTools('bus publish ch2 world', tmpDir);
    const r = runPanTools('bus list', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.channels.length, 2);
  });

  test('drain --mode consume truncates via CLI', () => {
    runPanTools('bus publish ch hello', tmpDir);
    runPanTools('bus drain ch --mode consume', tmpDir);
    const after = runPanTools('bus drain ch --mode peek', tmpDir);
    const json = JSON.parse(after.output);
    assert.equal(json.total, 0);
  });

  test('publish with --source flag records attribution', () => {
    runPanTools('bus publish ch hello --source pan-conductor', tmpDir);
    const r = runPanTools('bus drain ch', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.entries[0].source, 'pan-conductor');
  });
});
