const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../pan-wizard-core/bin/lib/constants.cjs');

// ─── Directory constants ────────────────────────────────────────────────────

describe('directory constants', () => {
  it('PLANNING_DIR is .planning', () => {
    assert.equal(C.PLANNING_DIR, '.planning');
  });

  it('PHASES_DIR is phases', () => {
    assert.equal(C.PHASES_DIR, 'phases');
  });

  it('MILESTONES_DIR is milestones', () => {
    assert.equal(C.MILESTONES_DIR, 'milestones');
  });

  it('CODEBASE_DIR is codebase', () => {
    assert.equal(C.CODEBASE_DIR, 'codebase');
  });

  it('QUICK_DIR is quick', () => {
    assert.equal(C.QUICK_DIR, 'quick');
  });
});

// ─── File constants ─────────────────────────────────────────────────────────

describe('file constants', () => {
  it('STATE_FILE is state.md', () => {
    assert.equal(C.STATE_FILE, 'state.md');
  });

  it('ROADMAP_FILE is roadmap.md', () => {
    assert.equal(C.ROADMAP_FILE, 'roadmap.md');
  });

  it('CONFIG_FILE is config.json', () => {
    assert.equal(C.CONFIG_FILE, 'config.json');
  });

  it('PROJECT_FILE is project.md', () => {
    assert.equal(C.PROJECT_FILE, 'project.md');
  });

  it('REQUIREMENTS_FILE is requirements.md', () => {
    assert.equal(C.REQUIREMENTS_FILE, 'requirements.md');
  });

  it('PAUSE_FILE is pause.md', () => {
    assert.equal(C.PAUSE_FILE, 'pause.md');
  });
});

// ─── Suffix constants ───────────────────────────────────────────────────────

describe('suffix constants', () => {
  it('PLAN_SUFFIX ends with -plan.md', () => {
    assert.equal(C.PLAN_SUFFIX, '-plan.md');
  });

  it('SUMMARY_SUFFIX ends with -summary.md', () => {
    assert.equal(C.SUMMARY_SUFFIX, '-summary.md');
  });

  it('CONTEXT_SUFFIX ends with -context.md', () => {
    assert.equal(C.CONTEXT_SUFFIX, '-context.md');
  });

  it('RESEARCH_SUFFIX ends with -research.md', () => {
    assert.equal(C.RESEARCH_SUFFIX, '-research.md');
  });

  it('VERIFICATION_SUFFIX ends with -verification.md', () => {
    assert.equal(C.VERIFICATION_SUFFIX, '-verification.md');
  });

  it('UAT_SUFFIX ends with -uat.md', () => {
    assert.equal(C.UAT_SUFFIX, '-uat.md');
  });
});

// ─── isPlanFile ─────────────────────────────────────────────────────────────

describe('isPlanFile', () => {
  it('matches plan.md', () => {
    assert.equal(C.isPlanFile('plan.md'), true);
  });

  it('matches 01-plan.md', () => {
    assert.equal(C.isPlanFile('01-plan.md'), true);
  });

  it('matches 03-02-plan.md', () => {
    assert.equal(C.isPlanFile('03-02-plan.md'), true);
  });

  it('rejects summary.md', () => {
    assert.equal(C.isPlanFile('summary.md'), false);
  });

  it('rejects README.md', () => {
    assert.equal(C.isPlanFile('README.md'), false);
  });

  it('rejects PLAN.md (wrong case)', () => {
    assert.equal(C.isPlanFile('PLAN.md'), false);
  });

  it('rejects partial match plan.md.bak', () => {
    assert.equal(C.isPlanFile('plan.md.bak'), false);
  });
});

// ─── isSummaryFile ──────────────────────────────────────────────────────────

describe('isSummaryFile', () => {
  it('matches summary.md', () => {
    assert.equal(C.isSummaryFile('summary.md'), true);
  });

  it('matches 01-summary.md', () => {
    assert.equal(C.isSummaryFile('01-summary.md'), true);
  });

  it('rejects plan.md', () => {
    assert.equal(C.isSummaryFile('plan.md'), false);
  });

  it('rejects SUMMARY.md (wrong case)', () => {
    assert.equal(C.isSummaryFile('SUMMARY.md'), false);
  });
});

// ─── isResearchFile ─────────────────────────────────────────────────────────

describe('isResearchFile', () => {
  it('matches research.md', () => {
    assert.equal(C.isResearchFile('research.md'), true);
  });

  it('matches 01-research.md', () => {
    assert.equal(C.isResearchFile('01-research.md'), true);
  });

  it('rejects plan.md', () => {
    assert.equal(C.isResearchFile('plan.md'), false);
  });
});

// ─── isContextFile ──────────────────────────────────────────────────────────

describe('isContextFile', () => {
  it('matches context.md', () => {
    assert.equal(C.isContextFile('context.md'), true);
  });

  it('matches 01-context.md', () => {
    assert.equal(C.isContextFile('01-context.md'), true);
  });

  it('rejects summary.md', () => {
    assert.equal(C.isContextFile('summary.md'), false);
  });
});

// ─── isVerificationFile ─────────────────────────────────────────────────────

describe('isVerificationFile', () => {
  it('matches verification.md', () => {
    assert.equal(C.isVerificationFile('verification.md'), true);
  });

  it('matches 01-verification.md', () => {
    assert.equal(C.isVerificationFile('01-verification.md'), true);
  });

  it('rejects plan.md', () => {
    assert.equal(C.isVerificationFile('plan.md'), false);
  });
});

// ─── getPlanId ──────────────────────────────────────────────────────────────

describe('getPlanId', () => {
  it('extracts id from 01-plan.md', () => {
    assert.equal(C.getPlanId('01-plan.md'), '01');
  });

  it('extracts id from 03-02-plan.md', () => {
    assert.equal(C.getPlanId('03-02-plan.md'), '03-02');
  });

  it('returns empty string from plan.md', () => {
    assert.equal(C.getPlanId('plan.md'), '');
  });

  it('returns string type', () => {
    assert.equal(typeof C.getPlanId('01-plan.md'), 'string');
    assert.equal(typeof C.getPlanId('plan.md'), 'string');
  });

  it('handles multi-segment id 01-02-03-plan.md', () => {
    assert.equal(C.getPlanId('01-02-03-plan.md'), '01-02-03');
  });
});

// ─── getSummaryId ───────────────────────────────────────────────────────────

describe('getSummaryId', () => {
  it('extracts id from 01-summary.md', () => {
    assert.equal(C.getSummaryId('01-summary.md'), '01');
  });

  it('extracts id from 03-02-summary.md', () => {
    assert.equal(C.getSummaryId('03-02-summary.md'), '03-02');
  });

  it('returns empty string from summary.md', () => {
    assert.equal(C.getSummaryId('summary.md'), '');
  });

  it('returns string type', () => {
    assert.equal(typeof C.getSummaryId('01-summary.md'), 'string');
    assert.equal(typeof C.getSummaryId('summary.md'), 'string');
  });

  it('handles multi-segment id 01-02-03-summary.md', () => {
    assert.equal(C.getSummaryId('01-02-03-summary.md'), '01-02-03');
  });
});

// ─── PHASE_DIR_RE ───────────────────────────────────────────────────────────

describe('PHASE_DIR_RE', () => {
  it('matches 01-setup-auth', () => {
    const m = '01-setup-auth'.match(C.PHASE_DIR_RE);
    assert.ok(m, 'PHASE_DIR_RE should match "01-setup-auth"');
    assert.equal(m[1], '01');
    assert.equal(m[2], 'setup-auth');
  });

  it('matches 03.1-hotfix', () => {
    const m = '03.1-hotfix'.match(C.PHASE_DIR_RE);
    assert.ok(m, 'PHASE_DIR_RE should match "03.1-hotfix"');
    assert.equal(m[1], '03.1');
    assert.equal(m[2], 'hotfix');
  });

  it('matches 10A-feature', () => {
    const m = '10A-feature'.match(C.PHASE_DIR_RE);
    assert.ok(m, 'PHASE_DIR_RE should match "10A-feature"');
    assert.equal(m[1], '10A');
    assert.equal(m[2], 'feature');
  });

  it('matches bare number 01', () => {
    const m = '01'.match(C.PHASE_DIR_RE);
    assert.ok(m, 'PHASE_DIR_RE should match bare "01"');
    assert.equal(m[1], '01');
  });

  it('does not match non-numeric start', () => {
    const m = 'abc-setup'.match(C.PHASE_DIR_RE);
    assert.equal(m, null);
  });
});

// ─── PHASE_NUM_RE ───────────────────────────────────────────────────────────

describe('PHASE_NUM_RE', () => {
  it('matches simple number 03', () => {
    const m = '03'.match(C.PHASE_NUM_RE);
    assert.ok(m, 'PHASE_NUM_RE should match "03"');
    assert.equal(m[1], '03');
  });

  it('matches decimal 03.1', () => {
    const m = '03.1'.match(C.PHASE_NUM_RE);
    assert.ok(m, 'PHASE_NUM_RE should match "03.1"');
    assert.equal(m[1], '03');
    assert.equal(m[3], '.1');
  });

  it('matches letter variant 03A', () => {
    const m = '03A'.match(C.PHASE_NUM_RE);
    assert.ok(m, 'PHASE_NUM_RE should match "03A"');
    assert.equal(m[1], '03');
    assert.equal(m[2], 'A');
  });

  it('matches complex 03A.1.2', () => {
    const m = '03A.1.2'.match(C.PHASE_NUM_RE);
    assert.ok(m, 'PHASE_NUM_RE should match "03A.1.2"');
    assert.equal(m[1], '03');
    assert.equal(m[2], 'A');
    assert.equal(m[3], '.1.2');
  });
});

// ─── ARCHIVE_DIR_RE ─────────────────────────────────────────────────────────

describe('ARCHIVE_DIR_RE', () => {
  it('matches v0.1.0-phases', () => {
    assert.ok(C.ARCHIVE_DIR_RE.test('v0.1.0-phases'));
  });

  it('matches v1.0-phases', () => {
    assert.ok(C.ARCHIVE_DIR_RE.test('v1.0-phases'));
  });

  it('matches v12.34.56-phases', () => {
    assert.ok(C.ARCHIVE_DIR_RE.test('v12.34.56-phases'));
  });

  it('rejects v0.1.0 (no -phases)', () => {
    assert.equal(C.ARCHIVE_DIR_RE.test('v0.1.0'), false);
  });

  it('rejects random-dir', () => {
    assert.equal(C.ARCHIVE_DIR_RE.test('random-dir'), false);
  });
});

// ─── FIELD_VALUE_RE ─────────────────────────────────────────────────────────

describe('FIELD_VALUE_RE', () => {
  it('matches **Current Phase:** 3', () => {
    const m = '**Current Phase:** 3'.match(C.FIELD_VALUE_RE);
    assert.ok(m, 'FIELD_VALUE_RE should match "**Current Phase:** 3"');
    assert.equal(m[1], 'Current Phase');
    assert.equal(m[2], '3');
  });

  it('matches **Status:** In Progress', () => {
    const m = '**Status:** In Progress'.match(C.FIELD_VALUE_RE);
    assert.ok(m, 'FIELD_VALUE_RE should match "**Status:** In Progress"');
    assert.equal(m[1], 'Status');
    assert.equal(m[2], 'In Progress');
  });
});

// ─── Magic number constants ─────────────────────────────────────────────────

describe('magic number constants', () => {
  it('MAX_JSON_SIZE is a positive number', () => {
    assert.equal(typeof C.MAX_JSON_SIZE, 'number');
    assert.ok(C.MAX_JSON_SIZE > 0);
  });

  it('PROGRESS_BAR_WIDTH is a positive number', () => {
    assert.equal(typeof C.PROGRESS_BAR_WIDTH, 'number');
    assert.ok(C.PROGRESS_BAR_WIDTH > 0);
  });

  it('MAX_SLUG_LENGTH is a positive number', () => {
    assert.equal(typeof C.MAX_SLUG_LENGTH, 'number');
    assert.ok(C.MAX_SLUG_LENGTH > 0);
  });

  it('FILLED_BLOCK is a string', () => {
    assert.equal(typeof C.FILLED_BLOCK, 'string');
    assert.ok(C.FILLED_BLOCK.length > 0);
  });

  it('EMPTY_BLOCK is a string', () => {
    assert.equal(typeof C.EMPTY_BLOCK, 'string');
    assert.ok(C.EMPTY_BLOCK.length > 0);
  });
});

// ─── PHASE_HEADER_RE ────────────────────────────────────────────────────────

describe('PHASE_HEADER_RE', () => {
  it('matches ## Phase 01: Setup Authentication', () => {
    C.PHASE_HEADER_RE.lastIndex = 0;
    const m = C.PHASE_HEADER_RE.exec('## Phase 01: Setup Authentication');
    assert.ok(m, 'PHASE_HEADER_RE should match "## Phase 01: Setup Authentication"');
    assert.equal(m[1], '01');
    assert.equal(m[2].trim(), 'Setup Authentication');
  });

  it('matches ### Phase 3.1: Hotfix', () => {
    C.PHASE_HEADER_RE.lastIndex = 0;
    const m = C.PHASE_HEADER_RE.exec('### Phase 3.1: Hotfix');
    assert.ok(m, 'PHASE_HEADER_RE should match "### Phase 3.1: Hotfix"');
    assert.equal(m[1], '3.1');
    assert.equal(m[2].trim(), 'Hotfix');
  });

  it('does not match # Phase 01: (h1 too shallow)', () => {
    C.PHASE_HEADER_RE.lastIndex = 0;
    const m = C.PHASE_HEADER_RE.exec('# Phase 01: Setup');
    assert.equal(m, null);
  });
});

// ─── MILESTONE_VERSION_RE ───────────────────────────────────────────────────

describe('MILESTONE_VERSION_RE', () => {
  it('matches v1.0 in text', () => {
    const m = 'Milestone v1.0 complete'.match(C.MILESTONE_VERSION_RE);
    assert.ok(m, 'MILESTONE_VERSION_RE should match v1.0 in "Milestone v1.0 complete"');
    assert.equal(m[1], '1.0');
  });

  it('matches v12.34', () => {
    const m = 'v12.34'.match(C.MILESTONE_VERSION_RE);
    assert.ok(m, 'MILESTONE_VERSION_RE should match "v12.34"');
    assert.equal(m[1], '12.34');
  });
});
