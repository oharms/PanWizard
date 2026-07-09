/**
 * Tests for campaign.cjs — scheduled self-resuming army campaigns (ADR-0034).
 * `now` is injected so schedule logic is deterministic.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const c = require('../pan-wizard-core/bin/lib/campaign.cjs');

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-campaign-'));
  fs.mkdirSync(path.join(cwd, '.planning', 'orchestration'), { recursive: true });
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

const T0 = new Date('2026-06-12T09:00:00Z');

describe('campaign — parseCadence', () => {
  test('named + numeric cadences', () => {
    assert.equal(c.parseCadence('hourly'), 3600000);
    assert.equal(c.parseCadence('daily'), 86400000);
    assert.equal(c.parseCadence('weekly'), 7 * 86400000);
    assert.equal(c.parseCadence('6h'), 6 * 3600000);
    assert.equal(c.parseCadence('3d'), 3 * 86400000);
  });
  test('rejects garbage', () => {
    assert.equal(c.parseCadence('nope'), null);
    assert.equal(c.parseCadence('0h'), null);
    assert.equal(c.parseCadence(''), null);
  });
});

describe('campaign — schedule + due', () => {
  test('writeSchedule sets defaults and next_due = now', () => {
    const s = c.writeSchedule(cwd, { goal: 'ship v1', cadence: 'daily' }, T0);
    assert.equal(s.goal, 'ship v1');
    assert.equal(s.source, 'backlog');
    assert.equal(s.daily_budget, 300);
    assert.equal(s.enabled, true);
    assert.equal(s.next_due, T0.toISOString());
  });

  test('rejects invalid cadence', () => {
    assert.ok(c.writeSchedule(cwd, { cadence: 'nope' }, T0).error);
  });

  test('isRunDue: due at/after next_due, not before', () => {
    c.writeSchedule(cwd, { cadence: 'daily' }, T0);
    const s = c.readSchedule(cwd);
    assert.equal(c.isRunDue(s, T0).due, true);
    const before = new Date(T0.getTime() - 1000);
    // next_due == T0, so a moment before T0 is not yet due
    assert.equal(c.isRunDue(s, before).reason, 'not_yet');
  });

  test('isRunDue: disabled / paused short-circuit', () => {
    c.writeSchedule(cwd, { cadence: 'daily', enabled: false }, T0);
    assert.equal(c.isRunDue(c.readSchedule(cwd), T0).reason, 'disabled');
    c.writeSchedule(cwd, { cadence: 'daily', enabled: true, paused: true }, T0);
    assert.equal(c.isRunDue(c.readSchedule(cwd), T0).reason, 'paused');
  });

  test('daily budget exhaustion blocks further runs same day', () => {
    c.writeSchedule(cwd, { cadence: 'hourly', daily_budget: 100 }, T0);
    c.recordRun(cwd, { items_landed: 1, points_used: 100 }, new Date('2026-06-12T09:30:00Z'));
    const s = c.readSchedule(cwd);
    const later = new Date('2026-06-12T11:00:00Z'); // past hourly next_due, same UTC day
    const d = c.isRunDue(s, later);
    assert.equal(d.due, false);
    assert.equal(d.reason, 'budget_exhausted_today');
    assert.equal(d.spent_today, 100);
  });

  test('budget resets next day', () => {
    c.writeSchedule(cwd, { cadence: 'hourly', daily_budget: 100 }, T0);
    c.recordRun(cwd, { points_used: 100 }, new Date('2026-06-12T09:30:00Z'));
    const nextDay = new Date('2026-06-13T10:00:00Z');
    const d = c.isRunDue(c.readSchedule(cwd), nextDay);
    assert.equal(d.spent_today, 0);
    assert.equal(d.due, true);
  });
});

describe('campaign — recordRun', () => {
  test('advances next_due by cadence and appends history', () => {
    c.writeSchedule(cwd, { cadence: 'daily' }, T0);
    const s = c.recordRun(cwd, { items_landed: 3, points_used: 120 }, T0);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].items_landed, 3);
    assert.equal(s.last_run, T0.toISOString());
    assert.equal(s.next_due, new Date(T0.getTime() + 86400000).toISOString());
  });

  test('history is capped', () => {
    c.writeSchedule(cwd, { cadence: 'hourly' }, T0);
    for (let i = 0; i < 60; i++) {
      c.recordRun(cwd, { points_used: 1 }, new Date(T0.getTime() + i * 3600000));
    }
    assert.ok(c.readSchedule(cwd).history.length <= 50);
  });

  test('errors with no schedule', () => {
    assert.ok(c.recordRun(cwd, { points_used: 1 }, T0).error);
  });
});

describe('campaign — isDreamDue', () => {
  test('false until first run; true after activity', () => {
    c.writeSchedule(cwd, { cadence: 'daily' }, T0);
    assert.equal(c.isDreamDue(c.readSchedule(cwd), T0), false);
    c.recordRun(cwd, { points_used: 10 }, T0);
    assert.equal(c.isDreamDue(c.readSchedule(cwd), T0), true);
  });
});
