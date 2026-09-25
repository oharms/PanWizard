/**
 * Every model a target runtime documents as its default must price at an exact
 * rate row (reality check 2026-09-22, R31).
 *
 * The rate table's calendar check (`models check`, RATES_STALE_AFTER_DAYS) cannot
 * see a default change: on 2026-09-22 Claude Code made a new Opus-tier model the
 * default on every plan, twelve days after the table was verified, and
 * resolveRate priced it through the family-prefix fallback at the previous Opus
 * row — cache reads 2.5x high on the model almost every PAN agent then ran on.
 * Nothing failed. This fixture records each runtime's documented default (and
 * the targets of its default aliases) with the page it came from and the date it
 * was read; the test fails the day an entry has no exact row.
 *
 * When a runtime changes its default: add the id here with its source and read
 * date, add the rate row from the provider's pricing page (never without one),
 * and bump RATES_VERIFIED_AT only if every row was re-read that day.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { DEFAULT_RATES, resolveRate } = require('../pan-wizard-core/bin/lib/cost.cjs');

const FIXTURE = require(path.join(__dirname, 'fixtures', 'documented-default-models.json'));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('documented default models price at an exact rate row (R31)', () => {
  const entries = FIXTURE.defaults;

  test('the fixture is populated and every entry carries its evidence', () => {
    assert.ok(Array.isArray(entries) && entries.length > 0, 'non-vacuity: the fixture must list documented defaults');
    const runtimes = new Set(entries.map((e) => e.runtime));
    for (const rt of ['claude', 'codex']) {
      assert.ok(runtimes.has(rt), `${rt} documents a default model; the fixture must carry it`);
    }
    for (const e of entries) {
      const at = `${e.runtime}/${e.id}`;
      assert.match(String(e.source), /^https:\/\//, `${at}: source must be the primary page's URL`);
      assert.match(String(e.read), ISO_DATE, `${at}: read must be the ISO date the page was read`);
      assert.ok(typeof e.role === 'string' && e.role.length > 10, `${at}: role must say which default this is`);
      assert.ok(typeof e.id === 'string' && e.id.length > 0, `${at}: id must be the API model id`);
    }
  });

  for (const e of FIXTURE.defaults) {
    test(`${e.runtime}: ${e.id} (${e.role}) has its own row, not a family fallback`, () => {
      assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_RATES, e.id),
        `${e.id} has no exact row in DEFAULT_RATES — it would price through the family-prefix fallback. ` +
        'Add the row from the provider pricing page (with the page cited in the commit).');
      assert.equal(resolveRate(e.id), DEFAULT_RATES[e.id], `${e.id}: resolveRate must return the exact row`);
    });

    test(`${e.runtime}: versioned forms of ${e.id} resolve to the same row`, () => {
      // Transcripts and hooks record ids with a snapshot date or a context suffix;
      // the longest-prefix rule must land them on this row, not on a shorter family.
      for (const form of [`${e.id}-20260922`, `${e.id}[1m]`]) {
        assert.equal(resolveRate(form), DEFAULT_RATES[e.id], `${form} must resolve to the ${e.id} row`);
      }
    });
  }

  test('every runtime without a documented default says why it is absent', () => {
    for (const n of FIXTURE.no_documented_default || []) {
      assert.match(String(n.source), /^https:\/\//, `${n.runtime}: cite the page that shows no default`);
      assert.ok(typeof n.why === 'string' && n.why.length > 20, `${n.runtime}: say what the page shows instead`);
    }
  });
});

describe('every provider routing tier resolves to a model id the host accepts (R28)', () => {
  const { PROVIDER_MODELS } = require('../pan-wizard-core/bin/lib/core.cjs');
  // Claude Code's model aliases (code.claude.com/docs/en/model-config) — the Task tool
  // takes these directly; every other provider needs a concrete, priced API id.
  const CLAUDE_CODE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);
  const TIER_NAMES = new Set(['reasoning', 'mid', 'fast']);
  const ALIAS_PROVIDERS = new Set(['anthropic', 'default']);

  test('the provider table is populated (otherwise the checks below are vacuous)', () => {
    assert.ok(Object.keys(PROVIDER_MODELS).length >= 4, 'anthropic, openai, google and default must all be present');
  });

  for (const [provider, tiers] of Object.entries(PROVIDER_MODELS)) {
    for (const [tier, id] of Object.entries(tiers)) {
      test(`${provider}.${tier} resolves to "${id}", which is a model the host accepts`, () => {
        // Until 2026-09-22 openai.mid and openai.fast were the literal strings "mid"
        // and "fast": a budget-profile project on Codex was told to spawn a model
        // called "mid".
        assert.ok(!TIER_NAMES.has(id), `${provider}.${tier} resolves to the tier name "${id}", not a model`);
        const priced = Object.prototype.hasOwnProperty.call(DEFAULT_RATES, id);
        const accepted = id === 'inherit' || priced || (ALIAS_PROVIDERS.has(provider) && CLAUDE_CODE_ALIASES.has(id));
        assert.ok(accepted,
          `${provider}.${tier} → "${id}" is neither inherit, a Claude Code alias (anthropic/default only), ` +
          'nor an id with its own DEFAULT_RATES row');
      });
    }
  }
});
