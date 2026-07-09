'use strict';

/**
 * Command output contract schemas for E2E validation.
 * Each schema defines the expected JSON output shape for a pan-tools command.
 * Verified against actual command output in contract tests.
 */

const SCHEMAS = {
  // === State commands ===
  'state json': {
    success_fields: ['Status'],
    types: { Status: 'string' },
  },
  'state update': {
    success_fields: ['updated'],
    types: { updated: 'boolean' },
  },
  'state add-decision': {
    success_fields: ['added'],
    types: { added: 'boolean' },
  },
  'state add-blocker': {
    success_fields: ['added'],
    types: { added: 'boolean' },
  },
  'state resolve-blocker': {
    success_fields: ['resolved'],
    types: { resolved: 'boolean' },
  },
  'state-snapshot': {
    success_fields: ['decisions', 'blockers'],
    types: { decisions: 'array', blockers: 'array' },
  },
  'state record-session': {
    success_fields: ['recorded'],
    types: { recorded: 'boolean' },
  },

  // === Phase commands ===
  'phase add': {
    success_fields: ['phase_number', 'name', 'slug', 'directory'],
    types: { name: 'string', slug: 'string', directory: 'string' },
  },
  'phase insert': {
    success_fields: ['phase_number', 'name', 'directory'],
    types: { name: 'string', directory: 'string' },
  },
  'phase remove': {
    success_fields: ['removed', 'roadmap_updated'],
    types: { roadmap_updated: 'boolean' },
  },
  'phase complete': {
    success_fields: ['completed_phase', 'roadmap_updated', 'state_updated'],
    types: { completed_phase: 'string', roadmap_updated: 'boolean', state_updated: 'boolean' },
  },
  'phases list': {
    success_fields: ['directories', 'count'],
    types: { directories: 'array', count: 'number' },
  },
  'phase next-decimal': {
    success_fields: ['found', 'next'],
    types: { found: 'boolean', next: 'string' },
  },

  // === Roadmap + config commands ===
  'roadmap analyze': {
    success_fields: ['phases', 'phase_count', 'completed_phases', 'progress_percent'],
    types: { phases: 'array', phase_count: 'number', completed_phases: 'number', progress_percent: 'number' },
  },
  'roadmap get-phase': {
    success_fields: ['found', 'phase_number'],
    types: { found: 'boolean', phase_number: 'string' },
  },
  'config-set': {
    success_fields: ['updated', 'key', 'value'],
    types: { updated: 'boolean', key: 'string' },
  },
  'template select': {
    success_fields: ['template'],
    types: { template: 'string' },
  },
  'generate-slug': {
    success_fields: ['slug'],
    types: { slug: 'string' },
  },

  // === Validation + verify commands ===
  'validate health': {
    success_fields: ['status', 'errors', 'warnings'],
    types: { status: 'string', errors: 'array', warnings: 'array' },
    enum_values: { status: ['healthy', 'degraded', 'broken'] },
  },
  'validate consistency': {
    success_fields: ['passed', 'errors', 'warnings'],
    types: { passed: 'boolean', errors: 'array', warnings: 'array' },
  },
  'verify phase-completeness': {
    success_fields: ['complete', 'phase'],
    types: { complete: 'boolean', phase: 'string' },
  },

  // === Focus commands ===
  'focus scan': {
    success_fields: ['items', 'total'],
    types: { items: 'array', total: 'number' },
  },
  'focus sync': {
    success_fields: ['needs_sync', 'stale_count', 'actuals'],
    types: { needs_sync: 'boolean', stale_count: 'number', actuals: 'object' },
  },
  'focus auto': {
    success_fields: ['status'],
    types: { status: 'string' },
  },

  // === Init commands ===
  'init new-project': {
    success_fields: ['project_exists', 'planning_exists', 'has_git', 'commit_docs'],
    types: { project_exists: 'boolean', planning_exists: 'boolean', commit_docs: 'boolean' },
  },
  'init execute-phase': {
    success_fields: ['executor_model', 'commit_docs'],
    types: { executor_model: 'string', commit_docs: 'boolean' },
  },
  'init plan-phase': {
    success_fields: ['researcher_model', 'phase_found', 'commit_docs'],
    types: { researcher_model: 'string', phase_found: 'boolean', commit_docs: 'boolean' },
  },
  'init quick': {
    success_fields: ['executor_model', 'commit_docs'],
    types: { executor_model: 'string', commit_docs: 'boolean' },
  },
  'init resume': {
    success_fields: ['state_exists', 'roadmap_exists', 'planning_exists'],
    types: { state_exists: 'boolean', roadmap_exists: 'boolean', planning_exists: 'boolean' },
  },
  // === Drift commands ===
  'drift-check': {
    success_fields: ['drift_score', 'verdict', 'passed', 'threshold', 'violations', 'violation_count', 'files_checked', 'conventions_loaded', 'summary'],
    types: { drift_score: 'number', verdict: 'string', passed: 'boolean', threshold: 'number', violation_count: 'number', files_checked: 'number', conventions_loaded: 'number', summary: 'string' },
    enum_values: { verdict: ['clean', 'low', 'medium', 'high'] },
  },
  // === Codebase commands ===
  'codebase detect-languages': {
    success_fields: ['primary', 'secondary', 'files_by_language', 'file_count'],
    types: { file_count: 'number' },
  },
  'codebase analyze-imports': {
    success_fields: ['language', 'modules', 'imports', 'circular_deps', 'entry_points', 'orphan_modules', 'dependency_graph'],
    types: { modules: 'number', imports: 'number', dependency_graph: 'string' },
  },
  'codebase best-practices': {
    success_fields: ['categories', 'score', 'recommendations'],
    types: { score: 'number' },
  },
  // === Retro command ===
  'retro': {
    success_fields: ['phases_planned', 'phases_completed', 'phases_decimal', 'estimation_accuracy_pct', 'verifications_total', 'verifications_passed_first_try', 'verifications_gaps_found', 'verifications_human_needed', 'common_gap_patterns'],
    types: { phases_planned: 'number', phases_completed: 'number', phases_decimal: 'number', estimation_accuracy_pct: 'number', verifications_total: 'number' },
  },
};

module.exports = { SCHEMAS };
