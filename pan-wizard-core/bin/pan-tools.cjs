#!/usr/bin/env node

/**
 * PAN Tools — CLI utility for PAN workflow operations
 *
 * Replaces repetitive inline bash patterns across ~50 PAN command/workflow/agent files.
 * Centralizes: config parsing, model resolution, phase lookup, git commits, summary verification.
 *
 * Usage: node pan-tools.cjs <command> [args] [--raw] [--verbose]
 *
 * Atomic Commands:
 *   state load                         Load project config + state
 *   state json                         Output state.md frontmatter as JSON
 *   state update <field> <value>       Update a state.md field
 *   state get [section]                Get state.md content or section
 *   state patch --field val ...        Batch update state.md fields
 *   resolve-model <agent-type>         Get model for agent based on profile
 *   find-phase <phase>                 Find phase directory by number
 *   commit <message> [--files f1 f2]   Commit planning docs
 *   verify-summary <path>              Verify a summary.md file
 *   generate-slug <text>               Convert text to URL-safe slug
 *   current-timestamp [format]         Get timestamp (full|date|filename)
 *   list-todos [area]                  Count and enumerate pending todos
 *   verify-path-exists <path>          Check file/directory existence
 *   config-ensure-section              Initialize .planning/config.json
 *   config-set <key> <value>           Set a config.json key
 *   config-get <key>                   Get a config.json value
 *   history-digest                     Aggregate all summary.md data
 *   summary-extract <path> [--fields]  Extract structured data from summary.md
 *   state-snapshot                     Structured parse of state.md
 *   phase-plan-index <phase>           Index plans with waves and status
 *   websearch <query>                  Search web via Brave API (if configured)
 *     [--limit N] [--freshness day|week|month]
 *
 * Phase Listing:
 *   phases list [--type plan|summary]  List phases with optional type filter
 *     [--phase N] [--include-archived]
 *
 * Phase Operations:
 *   phase next-decimal <phase>         Calculate next decimal phase number
 *   phase add <description>            Append new phase to roadmap + create dir
 *   phase insert <after> <description> Insert decimal phase after existing
 *   phase remove <phase> [--force]     Remove phase, renumber all subsequent
 *   phase complete <phase>             Mark phase done, update state + roadmap
 *
 * Roadmap Operations:
 *   roadmap get-phase <phase>          Extract phase section from roadmap.md
 *   roadmap analyze                    Full roadmap parse with disk status
 *   roadmap update-plan-progress <N>   Update progress table row from disk (PLAN vs SUMMARY counts)
 *
 * Requirements Operations:
 *   requirements mark-complete <ids>   Mark requirement IDs as complete in requirements.md
 *                                      Accepts: REQ-01,REQ-02 or REQ-01 REQ-02 or [REQ-01, REQ-02]
 *
 * Milestone Operations:
 *   milestone complete <version>       Archive milestone, create milestones.md
 *     [--name <name>]
 *     [--archive-phases]               Move phase dirs to milestones/vX.Y-phases/
 *
 * Validation:
 *   validate consistency               Check phase numbering, disk/roadmap sync
 *   validate health [--repair] [--full] Check .planning/ integrity, optionally repair or run tests+build
 *
 * Progress:
 *   progress [json|table|bar|health]   Render progress in various formats
 *   context-budget                     Estimate context utilization for current phase
 *
 * Todos:
 *   todo complete <filename>           Move todo from pending to completed
 *
 * Scaffolding:
 *   scaffold context --phase <N>       Create context.md template
 *   scaffold uat --phase <N>           Create uat.md template
 *   scaffold verification --phase <N>  Create verification.md template
 *   scaffold phase-dir --phase <N>     Create phase directory
 *     --name <name>
 *
 * Frontmatter CRUD:
 *   frontmatter get <file> [--field k] Extract frontmatter as JSON
 *   frontmatter set <file> --field k   Update single frontmatter field
 *     --value jsonVal
 *   frontmatter merge <file>           Merge JSON into frontmatter
 *     --data '{json}'
 *   frontmatter validate <file>        Validate required fields
 *     --schema plan|summary|verification
 *
 * Verification Suite:
 *   verify plan-structure <file>       Check plan.md structure + tasks
 *   verify phase-completeness <phase>  Check all plans have summaries
 *   verify references <file>           Check @-refs + paths resolve
 *   verify commits <h1> [h2] ...      Batch verify commit hashes
 *   verify artifacts <plan-file>       Check must_haves.artifacts
 *   verify key-links <plan-file>       Check must_haves.key_links
 *
 * Template Fill:
 *   template fill summary --phase N    Create pre-filled summary.md
 *     [--plan M] [--name "..."]
 *     [--fields '{json}']
 *   template fill plan --phase N       Create pre-filled plan.md
 *     [--plan M] [--type execute|tdd]
 *     [--wave N] [--fields '{json}']
 *   template fill verification         Create pre-filled verification.md
 *     --phase N [--fields '{json}']
 *
 * State Progression:
 *   state advance-plan                 Increment plan counter
 *   state record-metric --phase N      Record execution metrics
 *     --plan M --duration Xmin
 *     [--tasks N] [--files N]
 *   state update-progress              Recalculate progress bar
 *   state add-decision --summary "..."  Add decision to state.md
 *     [--phase N] [--rationale "..."]
 *     [--summary-file path] [--rationale-file path]
 *   state add-blocker --text "..."     Add blocker
 *     [--text-file path]
 *   state resolve-blocker --text "..." Remove blocker
 *   state record-session               Update session continuity
 *     --stopped-at "..."
 *     [--resume-file path]
 *
 * Compound Commands (workflow-specific initialization):
 *   init execute-phase <phase>         All context for execute-phase workflow
 *   init plan-phase <phase>            All context for plan-phase workflow
 *   init new-project                   All context for new-project workflow
 *   init new-milestone                 All context for new-milestone workflow
 *   init quick <description>           All context for quick workflow
 *   init resume                        All context for resume-project workflow
 *   init verify-work <phase>           All context for verify-work workflow
 *   init phase-op <phase>              Generic phase operation context
 *   init todos [area]                  All context for todo workflows
 *   init milestone-op                  All context for milestone operations
 *   init map-codebase                  All context for map-codebase workflow
 *   init progress                      All context for progress workflow
 *
 * Focus (Strategic Project Management):
 *   focus scan [--lean]                Collect, classify, and prioritize work items
 *   focus plan [--budget N]            Create capacity-budgeted execution batch
 *     [--mode bugfix|balanced|features|full]
 *     [--priority P0-P6] [--lean]
 *   focus sync [--check-only]          Check documentation staleness
 *   focus exec [--dry-run]             Load and classify batch for execution
 *   focus auto [--category CAT]        Auto-runner: init, status, update, stop
 *     [--mode MODE] [--budget N] [--max-cycles N] [--total-budget N]
 *     [--status] [--stop] [--update] [--continue] [--dry-run]
 *   focus design                       Route to 10-phase investigation workflow
 *
 * Pre-Flight & Dashboard:
 *   preflight [phase|batch]            Validate execution prerequisites
 *   dashboard                          Aggregated project status overview
 *   hud [--out f] [--open] [--stdout]  Single-page HTML army + project dashboard
 *
 * Session Learnings:
 *   learnings extract                  Extract patterns from session data
 *   learnings list                     List accumulated learnings
 *   learnings prune [--days N] [--id]  Remove stale learnings
 *
 * Dependency Validation:
 *   deps validate                      Cross-reference roadmap vs reality
 *
 * Standards (Industry Standards Integration):
 *   standards list [--category <cat>]  List available standards catalog
 *   standards select <id>              Add a standard to the project
 *   standards remove <id>              Remove a standard from the project
 *   standards status                   Report compliance status
 *   standards recommend                Recommend standards based on project.md
 *   standards phase-track <phase>      Show standards relevant to a phase
 *   standards tools [id]               List external scanning tools for standards
 *
 * Circular Optimization Loop:
 *   optimize trace init                Start a new trace session
 *     [--description "..."]
 *   optimize trace end                 Finalize trace session + write summary
 *   optimize trace current             Show active session ID
 *   optimize trace list                List all sessions
 *   optimize trace log                 Log a trace event to the active session
 *     --type <type> --description "..." [--agent a] [--category c] [--impact i]
 *   optimize learn [--session <id>]   Analyze session, write analysis JSON
 *   optimize apply [--report <path>]  Apply safe recommendations from report
 *   optimize list                     List optimization reports
 *   optimize stats                    Cumulative optimization statistics
 *
 * Self-Learn:
 *   learn [--session <id>]            Alias for optimize learn + invoke pan-optimizer
 */

const fs = require('fs');
const path = require('path');
const { error, output, buildCachedContext } = require('./lib/core.cjs');
const state = require('./lib/state.cjs');
const phase = require('./lib/phase.cjs');
const roadmap = require('./lib/roadmap.cjs');
const verify = require('./lib/verify.cjs');
const config = require('./lib/config.cjs');
const template = require('./lib/template.cjs');
const milestone = require('./lib/milestone.cjs');
const commands = require('./lib/commands.cjs');
const init = require('./lib/init.cjs');
const frontmatter = require('./lib/frontmatter.cjs');
const contextBudget = require('./lib/context-budget.cjs');
const focus = require('./lib/focus.cjs');
const codebase = require('./lib/codebase.cjs');
const memory = require('./lib/memory.cjs');
const bus = require('./lib/bus.cjs');
const cost = require('./lib/cost.cjs');
const preview = require('./lib/preview.cjs');
const reviewDeep = require('./lib/review-deep.cjs');
const knowledge = require('./lib/knowledge.cjs');
const skillAlign = require('./lib/skill-align.cjs');
const hygiene = require('./lib/hygiene.cjs');
const whatif = require('./lib/whatif.cjs');
const bridge = require('./lib/bridge.cjs');
const optimize = require('./lib/optimize.cjs');
const git = require('./lib/git.cjs');
const distill = require('./lib/distill.cjs');
const experiment = require('./lib/experiment.cjs');
const runner = require('./lib/runner.cjs');
const docLint = require('./lib/doc-lint.cjs');
const learnLint = require('./lib/learn-lint.cjs');
const learnIndex = require('./lib/learn-index.cjs');
const links = require('./lib/links.cjs');

/**
 * Get the value following a flag in the args array.
 * @param {string[]} args - CLI arguments
 * @param {string} flag - Flag name (e.g., '--phase')
 * @param {*} [defaultVal=null] - Default if flag missing or no value follows
 * @returns {string|null} The value after the flag, or defaultVal
 */
function getArgValue(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

/**
 * Parse JSON string or call error() with a descriptive message.
 * @param {string} raw - Raw JSON string
 * @param {string} flagName - Flag name for error reporting
 * @returns {*} Parsed JSON value
 */
function parseJsonOrError(raw, flagName) {
  try { return JSON.parse(raw); } catch (e) { error(`Invalid JSON for ${flagName}: ${e.message}`); }
}

// ─── CLI Router ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Optional cwd override for sandboxed subagents running outside project root.
  let cwd = process.cwd();
  const cwdEqArg = args.find(arg => arg.startsWith('--cwd='));
  const cwdIdx = args.indexOf('--cwd');
  if (cwdEqArg) {
    const value = cwdEqArg.slice('--cwd='.length).trim();
    if (!value) error('Missing value for --cwd');
    args.splice(args.indexOf(cwdEqArg), 1);
    cwd = path.resolve(value);
  } else if (cwdIdx !== -1) {
    const value = args[cwdIdx + 1];
    if (!value || value.startsWith('--')) error('Missing value for --cwd');
    args.splice(cwdIdx, 2);
    cwd = path.resolve(value);
  }

  try {
    if (!fs.statSync(cwd).isDirectory()) error(`Invalid --cwd: ${cwd} is not a directory`);
  } catch {
    error(`Invalid --cwd: ${cwd}`);
  }

  const rawIndex = args.indexOf('--raw');
  const raw = rawIndex !== -1;
  if (rawIndex !== -1) args.splice(rawIndex, 1);

  const verboseIndex = args.indexOf('--verbose');
  if (verboseIndex !== -1) {
    args.splice(verboseIndex, 1);
    process.env.PAN_VERBOSE = '1';
  }

  const command = args[0];

  if (!command) {
    error('Usage: pan-tools <command> [args] [--raw] [--cwd <path>]\nCommands: state, state-snapshot, resolve-model, find-phase, commit, verify-summary, verify, frontmatter, template, generate-slug, current-timestamp, list-todos, verify-path-exists, config-ensure-section, config-set, config-get, history-digest, phases, roadmap, requirements, phase, milestone, validate, progress, context-budget, todo, scaffold, init, phase-plan-index, summary-extract, rollback-snapshot, websearch, focus, preflight, dashboard, learnings, deps, standards');
  }

  switch (command) {
    case 'state': {
      const subcommand = args[1];
      if (subcommand === 'json') {
        state.cmdStateJson(cwd, raw);
      } else if (subcommand === 'update') {
        state.cmdStateUpdate(cwd, args[2], args[3]);
      } else if (subcommand === 'get') {
        state.cmdStateGet(cwd, args[2], raw);
      } else if (subcommand === 'patch') {
        const patches = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = args[i].replace(/^--/, '');
          const value = args[i + 1];
          if (key && value !== undefined) {
            patches[key] = value;
          }
        }
        state.cmdStatePatch(cwd, patches, raw);
      } else if (subcommand === 'advance-plan') {
        state.cmdStateAdvancePlan(cwd, raw);
      } else if (subcommand === 'record-metric') {
        state.cmdStateRecordMetric(cwd, {
          phase: getArgValue(args, '--phase'),
          plan: getArgValue(args, '--plan'),
          duration: getArgValue(args, '--duration'),
          tasks: getArgValue(args, '--tasks'),
          files: getArgValue(args, '--files'),
        }, raw);
      } else if (subcommand === 'update-progress') {
        state.cmdStateUpdateProgress(cwd, raw);
      } else if (subcommand === 'add-decision') {
        state.cmdStateAddDecision(cwd, {
          phase: getArgValue(args, '--phase'),
          summary: getArgValue(args, '--summary'),
          summary_file: getArgValue(args, '--summary-file'),
          rationale: getArgValue(args, '--rationale', ''),
          rationale_file: getArgValue(args, '--rationale-file'),
        }, raw);
      } else if (subcommand === 'add-blocker') {
        state.cmdStateAddBlocker(cwd, {
          text: getArgValue(args, '--text'),
          text_file: getArgValue(args, '--text-file'),
        }, raw);
      } else if (subcommand === 'resolve-blocker') {
        state.cmdStateResolveBlocker(cwd, getArgValue(args, '--text'), raw);
      } else if (subcommand === 'record-session') {
        state.cmdStateRecordSession(cwd, {
          stopped_at: getArgValue(args, '--stopped-at'),
          resume_file: getArgValue(args, '--resume-file', 'None'),
        }, raw);
      } else if (subcommand === 'load' || !subcommand) {
        state.cmdStateLoad(cwd, raw);
      } else {
        error(`Unknown state subcommand: ${subcommand}. Available: json, update, get, patch, advance-plan, record-metric, update-progress, add-decision, add-blocker, resolve-blocker, record-session, load`);
      }
      break;
    }

    case 'resolve-model': {
      const metadataIdx = args.indexOf('--metadata');
      const metadataJson = metadataIdx !== -1 ? args[metadataIdx + 1] : undefined;
      commands.cmdResolveModel(cwd, args[1], raw, metadataJson);
      break;
    }

    case 'estimate-cost': {
      commands.cmdEstimateCost(cwd, raw);
      break;
    }

    case 'find-phase': {
      if (!args[1]) error('find-phase requires a phase number');
      phase.cmdFindPhase(cwd, args[1], raw);
      break;
    }

    case 'git': {
      const subcommand = args[1];
      if (!subcommand) { error('git subcommand required. Available: commit, branch, push, status, log, stash, diff, rollback, tag, sync'); }
      git.cmdGit(cwd, subcommand, args.slice(1), raw);
      break;
    }

    case 'distill': {
      const subcommand = args[1];
      if (!subcommand) { error('distill subcommand required. Available: scan, analyze, report'); }
      distill.cmdDistill(cwd, subcommand, args.slice(1), raw);
      break;
    }

    case 'experiment': {
      const subcommand = args[1];
      if (!subcommand) { error('experiment subcommand required. Available: new, list, manifest, run, status, stop, harvest, prune'); }
      const root = getArgValue(args, '--root');

      if (subcommand === 'new') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment new <slug> required'); }
        const ideaPath = getArgValue(args, '--idea');
        if (!ideaPath) { error('experiment new requires --idea <path>'); }
        const runtime = getArgValue(args, '--runtime', 'claude');
        const budgetStr = getArgValue(args, '--budget');
        const budget = budgetStr != null ? parseInt(budgetStr, 10) : null;
        const skipInstaller = args.includes('--skip-installer');
        const result = experiment.newExperiment(slug, { ideaPath, runtime, root, budget, skipInstaller });
        output(result, raw);
      } else if (subcommand === 'list') {
        const includeArchived = args.includes('--include-archived');
        const result = experiment.listExperiments({ root, includeArchived });
        output(result, raw);
      } else if (subcommand === 'manifest') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment manifest <slug> required'); }
        const result = experiment.getExperimentManifest(slug, { root });
        output(result, raw);
      } else if (subcommand === 'run') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment run <slug> required'); }
        const prompt = getArgValue(args, '--prompt');
        const timeoutStr = getArgValue(args, '--timeout');
        const timeoutMs = timeoutStr ? parseInt(timeoutStr, 10) * 1000 : undefined;
        const runtimeOverride = getArgValue(args, '--runtime-override');
        const runOpts = { root };
        if (prompt) runOpts.prompt = prompt;
        if (timeoutMs) runOpts.timeoutMs = timeoutMs;
        if (runtimeOverride) {
          // For tests/dev: override="bin:arg1,arg2" — split on first colon, args by comma
          const [bin, argsCsv] = runtimeOverride.split(':', 2);
          runOpts.runtimeOverride = {
            bin,
            buildArgs: () => (argsCsv ? argsCsv.split(',') : []),
          };
        }
        const result = runner.runExperiment(slug, runOpts);
        output(result, raw);
      } else if (subcommand === 'status') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment status <slug> required'); }
        const result = runner.tailExperimentState(slug, { root });
        output(result, raw);
      } else if (subcommand === 'stop') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment stop <slug> required'); }
        const result = runner.stopExperiment(slug, { root });
        output(result, raw);
      } else if (subcommand === 'harvest') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment harvest <slug> required'); }
        const sourceRoot = getArgValue(args, '--source-root');
        const force = args.includes('--force');
        const harvestOpts = { root, force };
        if (sourceRoot) harvestOpts.sourceRoot = sourceRoot;
        const result = experiment.harvestExperiment(slug, harvestOpts);
        output(result, raw);
      } else if (subcommand === 'prune') {
        const slug = args[2];
        if (!slug || slug.startsWith('--')) { error('experiment prune <slug> required'); }
        const hard = args.includes('--hard');
        const result = experiment.pruneExperiment(slug, { root, hard });
        output(result, raw);
      } else {
        error(`unknown experiment subcommand: ${subcommand}. Available: new, list, manifest, run, status, stop, harvest, prune`);
      }
      break;
    }

    case 'commit': {
      const amend = args.includes('--amend');
      const force = args.includes('--force');
      const failOnError = args.includes('--fail-on-error');
      const message = args[1] && !args[1].startsWith('--') ? args[1] : null;
      // Parse --files flag (collect args after --files, stopping at other flags)
      const filesIndex = args.indexOf('--files');
      const files = filesIndex !== -1 ? args.slice(filesIndex + 1).filter(a => !a.startsWith('--')) : [];
      const commitType = getArgValue(args, '--type');
      commands.cmdCommit(cwd, message, files, raw, amend, { type: commitType, force, failOnError });
      break;
    }

    case 'verify-summary': {
      const summaryPath = args[1];
      const checkCount = Math.max(1, Math.min(parseInt(getArgValue(args, '--check-count', '2'), 10) || 2, 20));
      verify.cmdVerifySummary(cwd, summaryPath, checkCount, raw);
      break;
    }

    case 'template': {
      const subcommand = args[1];
      if (subcommand === 'select') {
        template.cmdTemplateSelect(cwd, args[2], raw);
      } else if (subcommand === 'fill') {
        const templateType = args[2];
        const fieldsRaw = getArgValue(args, '--fields');
        template.cmdTemplateFill(cwd, templateType, {
          phase: getArgValue(args, '--phase'),
          plan: getArgValue(args, '--plan'),
          name: getArgValue(args, '--name'),
          type: getArgValue(args, '--type', 'execute'),
          wave: getArgValue(args, '--wave', '1'),
          fields: fieldsRaw ? parseJsonOrError(fieldsRaw, '--fields') : {},
        }, raw);
      } else {
        error('Unknown template subcommand. Available: select, fill');
      }
      break;
    }

    case 'frontmatter': {
      const subcommand = args[1];
      const file = args[2];
      if (subcommand === 'get') {
        frontmatter.cmdFrontmatterGet(cwd, file, getArgValue(args, '--field'), raw);
      } else if (subcommand === 'set') {
        frontmatter.cmdFrontmatterSet(cwd, file, getArgValue(args, '--field'), getArgValue(args, '--value') ?? undefined, raw);
      } else if (subcommand === 'merge') {
        frontmatter.cmdFrontmatterMerge(cwd, file, getArgValue(args, '--data'), raw);
      } else if (subcommand === 'validate') {
        frontmatter.cmdFrontmatterValidate(cwd, file, getArgValue(args, '--schema'), raw);
      } else {
        error('Unknown frontmatter subcommand. Available: get, set, merge, validate');
      }
      break;
    }

    case 'verify': {
      const subcommand = args[1];
      if (subcommand === 'plan-structure') {
        verify.cmdVerifyPlanStructure(cwd, args[2], raw);
      } else if (subcommand === 'phase-completeness') {
        verify.cmdVerifyPhaseCompleteness(cwd, args[2], raw);
      } else if (subcommand === 'references') {
        verify.cmdVerifyReferences(cwd, args[2], raw);
      } else if (subcommand === 'commits') {
        verify.cmdVerifyCommits(cwd, args.slice(2), raw);
      } else if (subcommand === 'artifacts') {
        verify.cmdVerifyArtifacts(cwd, args[2], raw);
      } else if (subcommand === 'key-links') {
        verify.cmdVerifyKeyLinks(cwd, args[2], raw);
      } else if (subcommand === 'reconcile') {
        verify.cmdVerifyReconcile(cwd, args[2], raw);
      } else if (subcommand === 'stubs') {
        verify.cmdVerifyStubs(cwd, { gate: args.includes('--gate') }, raw);
      } else {
        error('Unknown verify subcommand. Available: plan-structure, phase-completeness, references, commits, artifacts, key-links');
      }
      break;
    }

    case 'generate-slug': {
      commands.cmdGenerateSlug(args[1], raw);
      break;
    }

    case 'current-timestamp': {
      commands.cmdCurrentTimestamp(args[1] || 'full', raw);
      break;
    }

    case 'list-todos': {
      commands.cmdListTodos(cwd, args[1], raw);
      break;
    }

    case 'verify-path-exists': {
      commands.cmdVerifyPathExists(cwd, args[1], raw);
      break;
    }

    case 'config-ensure-section': {
      config.cmdConfigEnsureSection(cwd, raw);
      break;
    }

    case 'config-set': {
      config.cmdConfigSet(cwd, args[1], args[2], raw);
      break;
    }

    case 'config-get': {
      config.cmdConfigGet(cwd, args[1], raw);
      break;
    }

    case 'history-digest': {
      commands.cmdHistoryDigest(cwd, raw);
      break;
    }

    case 'phases': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        const options = {
          type: getArgValue(args, '--type'),
          phase: getArgValue(args, '--phase'),
          includeArchived: args.includes('--include-archived'),
        };
        phase.cmdPhasesList(cwd, options, raw);
      } else {
        error('Unknown phases subcommand. Available: list');
      }
      break;
    }

    case 'roadmap': {
      const subcommand = args[1];
      if (subcommand === 'get-phase') {
        if (!args[2]) error('roadmap get-phase requires a phase number');
        roadmap.cmdRoadmapGetPhase(cwd, args[2], raw);
      } else if (subcommand === 'analyze') {
        roadmap.cmdRoadmapAnalyze(cwd, raw);
      } else if (subcommand === 'update-plan-progress') {
        if (!args[2]) error('roadmap update-plan-progress requires a phase number');
        roadmap.cmdRoadmapUpdatePlanProgress(cwd, args[2], raw);
      } else {
        error('Unknown roadmap subcommand. Available: get-phase, analyze, update-plan-progress');
      }
      break;
    }

    case 'requirements': {
      const subcommand = args[1];
      if (subcommand === 'mark-complete') {
        milestone.cmdRequirementsMarkComplete(cwd, args.slice(2), raw);
      } else {
        error('Unknown requirements subcommand. Available: mark-complete');
      }
      break;
    }

    case 'phase': {
      const subcommand = args[1];
      if (subcommand === 'next-decimal') {
        if (!args[2]) error('phase next-decimal requires a base phase number');
        phase.cmdPhaseNextDecimal(cwd, args[2], raw);
      } else if (subcommand === 'add') {
        phase.cmdPhaseAdd(cwd, args.slice(2).join(' '), raw);
      } else if (subcommand === 'insert') {
        if (!args[2]) error('phase insert requires a phase number');
        phase.cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
      } else if (subcommand === 'remove') {
        if (!args[2]) error('phase remove requires a phase number');
        const forceFlag = args.includes('--force');
        phase.cmdPhaseRemove(cwd, args[2], { force: forceFlag }, raw);
      } else if (subcommand === 'complete') {
        if (!args[2]) error('phase complete requires a phase number');
        const noCommit = args.includes('--no-commit');
        phase.cmdPhaseComplete(cwd, args[2], raw, { noCommit });
      } else {
        error('Unknown phase subcommand. Available: next-decimal, add, insert, remove, complete');
      }
      break;
    }

    case 'milestone': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        const nameIndex = args.indexOf('--name');
        const archivePhases = args.includes('--archive-phases');
        // Collect --name value (everything after --name until next flag or end)
        let milestoneName = null;
        if (nameIndex !== -1) {
          const nameArgs = [];
          for (let i = nameIndex + 1; i < args.length; i++) {
            if (args[i].startsWith('--')) break;
            nameArgs.push(args[i]);
          }
          milestoneName = nameArgs.join(' ') || null;
        }
        const noCommitMilestone = args.includes('--no-commit');
        milestone.cmdMilestoneComplete(cwd, args[2], { name: milestoneName, archivePhases, noCommit: noCommitMilestone }, raw);
      } else {
        error('Unknown milestone subcommand. Available: complete');
      }
      break;
    }

    case 'validate': {
      const subcommand = args[1];
      if (subcommand === 'consistency') {
        verify.cmdValidateConsistency(cwd, raw);
      } else if (subcommand === 'health') {
        const repairFlag = args.includes('--repair');
        const standardsFlag = args.includes('--standards');
        const fullFlag = args.includes('--full');
        const driftFlag = args.includes('--drift');
        const linksFlag = args.includes('--links');
        verify.cmdValidateHealth(cwd, { repair: repairFlag, standards: standardsFlag, full: fullFlag, drift: driftFlag, links: linksFlag }, raw);
      } else if (subcommand === 'deployment') {
        verify.cmdValidateDeployment(cwd, raw);
      } else {
        error('Unknown validate subcommand. Available: consistency, health, deployment');
      }
      break;
    }

    case 'progress': {
      const subcommand = args[1] || 'json';
      commands.cmdProgressRender(cwd, subcommand, raw);
      break;
    }

    case 'context-budget': {
      contextBudget.cmdContextBudget(cwd, raw);
      break;
    }

    case 'todo': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        commands.cmdTodoComplete(cwd, args[2], raw);
      } else {
        error('Unknown todo subcommand. Available: complete');
      }
      break;
    }

    case 'scaffold': {
      const scaffoldType = args[1];
      const nameIndex = args.indexOf('--name');
      const scaffoldOptions = {
        phase: getArgValue(args, '--phase'),
        name: nameIndex !== -1 ? args.slice(nameIndex + 1).filter(a => !a.startsWith('--')).join(' ') : null,
      };
      commands.cmdScaffold(cwd, scaffoldType, scaffoldOptions, raw);
      break;
    }

    case 'init': {
      const workflow = args[1];
      switch (workflow) {
        case 'execute-phase': {
          const dryRun = args.includes('--dry-run');
          init.cmdInitExecutePhase(cwd, args[2], raw, { dry_run: dryRun, budget: getArgValue(args, '--budget') ?? undefined });
          break;
        }
        case 'plan-phase':
          init.cmdInitPlanPhase(cwd, args[2], raw);
          break;
        case 'new-project':
          init.cmdInitNewProject(cwd, raw);
          break;
        case 'new-milestone':
          init.cmdInitNewMilestone(cwd, raw);
          break;
        case 'quick':
          init.cmdInitQuick(cwd, args.slice(2).join(' '), raw);
          break;
        case 'resume':
          init.cmdInitResume(cwd, raw);
          break;
        case 'verify-work':
          init.cmdInitVerifyWork(cwd, args[2], raw);
          break;
        case 'phase-op':
          init.cmdInitPhaseOp(cwd, args[2], raw);
          break;
        case 'todos':
          init.cmdInitTodos(cwd, args[2], raw);
          break;
        case 'milestone-op':
          init.cmdInitMilestoneOp(cwd, raw);
          break;
        case 'map-codebase':
          init.cmdInitMapCodebase(cwd, raw);
          break;
        case 'progress':
          init.cmdInitProgress(cwd, raw);
          break;
        default:
          error(`Unknown init workflow: ${workflow}\nAvailable: execute-phase, plan-phase, new-project, new-milestone, quick, resume, verify-work, phase-op, todos, milestone-op, map-codebase, progress`);
      }
      break;
    }

    case 'phase-plan-index': {
      phase.cmdPhasePlanIndex(cwd, args[1], raw);
      break;
    }

    case 'state-snapshot': {
      state.cmdStateSnapshot(cwd, raw);
      break;
    }

    case 'summary-extract': {
      const summaryPath = args[1];
      const fieldsIndex = args.indexOf('--fields');
      const fields = fieldsIndex !== -1 ? args.slice(fieldsIndex + 1).filter(a => !a.startsWith('--')).flatMap(a => a.split(',')) : null;
      commands.cmdSummaryExtract(cwd, summaryPath, fields, raw);
      break;
    }

    case 'rollback-snapshot': {
      commands.cmdRollbackSnapshot(cwd, args[1], raw);
      break;
    }

    case 'batch-commit': {
      const itemsJson = args[1];
      let items = [];
      try { items = JSON.parse(itemsJson); } catch { /* empty */ }
      commands.cmdBatchCommit(cwd, items, raw);
      break;
    }

    case 'websearch': {
      const query = args[1];
      await commands.cmdWebsearch(query, {
        limit: parseInt(getArgValue(args, '--limit', '10'), 10),
        freshness: getArgValue(args, '--freshness'),
      }, raw);
      break;
    }

    case 'focus': {
      const subcommand = args[1];
      if (subcommand === 'scan') {
        focus.cmdFocusScan(cwd, raw, ...args.slice(2));
      } else if (subcommand === 'plan') {
        focus.cmdFocusPlan(cwd, raw, ...args.slice(2));
      } else if (subcommand === 'sync') {
        focus.cmdFocusSync(cwd, raw, ...args.slice(2));
      } else if (subcommand === 'exec') {
        focus.cmdFocusExec(cwd, raw, ...args.slice(2));
      } else if (subcommand === 'auto') {
        focus.cmdFocusAuto(cwd, raw, ...args.slice(2));
      } else if (subcommand === 'design') {
        // design is a workflow-only command (no core function)
        // The AI reads commands/pan/focus-design.md directly
        output({ command: 'focus-design', type: 'workflow', message: 'Use /pan:focus-design to invoke the 10-phase investigation pipeline' }, raw);
      } else if (subcommand === 'classify-stages') {
        const useStdin = args.includes('--stdin');
        let items;
        if (useStdin) {
          try {
            items = JSON.parse(fs.readFileSync(0, 'utf-8'));
          } catch (e) {
            error(`Failed to parse stdin JSON: ${e.message}`);
          }
        } else {
          const batch = focus.readLatestBatch(cwd);
          if (!batch) {
            output({ error: 'No batch file found. Run focus plan first.' }, raw);
            break;
          }
          items = batch.batch || [];
        }
        output(focus.classifyStageDependencies(items), raw);
      } else if (subcommand === 'reflection') {
        let payload;
        try {
          payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
        } catch (e) {
          error(`Failed to parse stdin JSON for focus reflection: ${e.message}`);
        }
        output(focus.determineContinuation(
          payload.run || {},
          payload.cycle || {},
          payload.batch || [],
          { tier: payload.tier }
        ), raw);
      } else {
        error('Unknown focus subcommand. Available: scan, plan, sync, exec, auto, design, classify-stages, reflection');
      }
      break;
    }

    case 'preflight': {
      verify.cmdPreflight(cwd, args[1] || null, raw);
      break;
    }

    case 'dashboard': {
      state.cmdDashboard(cwd, raw);
      break;
    }

    case 'hud': {
      const hud = require('./lib/hud.cjs');
      hud.cmdHud(cwd, {
        out: getArgValue(args, '--out'),
        open: args.includes('--open'),
        stdout: args.includes('--stdout'),
      }, raw);
      break;
    }

    case 'learnings': {
      const subcommand = args[1];
      if (subcommand === 'extract') {
        commands.cmdLearningsExtract(cwd, raw);
      } else if (subcommand === 'list') {
        commands.cmdLearningsList(cwd, raw);
      } else if (subcommand === 'prune') {
        const daysRaw = getArgValue(args, '--days');
        commands.cmdLearningsPrune(cwd, {
          days: daysRaw !== null ? parseInt(daysRaw, 10) : null,
          id: getArgValue(args, '--id'),
        }, raw);
      } else {
        error('Unknown learnings subcommand. Available: extract, list, prune');
      }
      break;
    }

    case 'deps': {
      const subcommand = args[1];
      if (subcommand === 'validate') {
        verify.cmdDepsValidate(cwd, raw);
      } else {
        error('Unknown deps subcommand. Available: validate');
      }
      break;
    }

    case 'drift-check': {
      verify.cmdDriftCheck(cwd, raw, args);
      break;
    }

    case 'memory': {
      const subcommand = args[1];
      if (subcommand === 'read') {
        memory.cmdMemoryRead(cwd, args[2], raw);
      } else if (subcommand === 'append') {
        memory.cmdMemoryAppend(cwd, args[2], args.slice(3).join(' '), raw);
      } else if (subcommand === 'list') {
        memory.cmdMemoryList(cwd, raw);
      } else if (subcommand === 'compact') {
        memory.cmdMemoryCompact(cwd, args[2], args[3], raw);
      } else if (subcommand === 'select') {
        memory.cmdMemorySelect(cwd, args[2], {
          cue: getArgValue(args, '--cue'),
          tokenBudget: getArgValue(args, '--token-budget'),
          recencyFloor: getArgValue(args, '--recency-floor'),
        }, raw);
      } else if (subcommand === 'budget') {
        memory.cmdMemoryBudget(cwd, raw);
      } else {
        error('Unknown memory subcommand. Available: read, append, list, compact, select, budget');
      }
      break;
    }

    case 'bridge': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        bridge.cmdBridgeList(cwd, raw);
      } else if (subcommand === 'recommend') {
        bridge.cmdBridgeRecommend(cwd, args[2], {
          max_recommendations: Number(getArgValue(args, '--max') || 10),
          min_score: Number(getArgValue(args, '--min-score') || 1),
        }, raw);
      } else if (subcommand === 'cache') {
        bridge.cmdBridgeCache(cwd, getArgValue(args, '--servers'), getArgValue(args, '--runtime'), raw);
      } else {
        error('Unknown bridge subcommand. Available: list, recommend, cache');
      }
      break;
    }

    case 'whatif': {
      const subcommand = args[1];
      if (subcommand === 'prepare') {
        const phaseNum = args[2];
        const scenario = args.slice(3).filter(a => !a.startsWith('--')).join(' ');
        whatif.cmdWhatifPrepare(cwd, phaseNum, scenario, raw);
      } else if (subcommand === 'report') {
        const phaseNum = args[2];
        const scenarioParts = [];
        for (let i = 3; i < args.length; i++) {
          if (args[i] === '--comparison') break;
          scenarioParts.push(args[i]);
        }
        const scenario = scenarioParts.join(' ');
        const comparisonJson = getArgValue(args, '--comparison');
        whatif.cmdWhatifReport(cwd, phaseNum, scenario, comparisonJson, raw);
      } else if (subcommand === 'cleanup') {
        whatif.cmdWhatifCleanup(
          cwd,
          getArgValue(args, '--worktree'),
          getArgValue(args, '--branch'),
          args.includes('--force'),
          raw
        );
      } else {
        error('Unknown whatif subcommand. Available: prepare, report, cleanup');
      }
      break;
    }

    case 'knowledge': {
      const subcommand = args[1];
      if (subcommand === 'ask') {
        const question = args.slice(2).filter(a => !a.startsWith('--')).join(' ');
        const maxSources = getArgValue(args, '--max-sources');
        knowledge.cmdKnowledgeAsk(cwd, question, {
          max_sources: maxSources ? Number(maxSources) : undefined,
          recall_cue: getArgValue(args, '--recall-cue'),
        }, raw);
      } else if (subcommand === 'discuss') {
        const phaseNum = args[2];
        knowledge.cmdKnowledgeDiscuss(cwd, phaseNum, {
          subcmd: getArgValue(args, '--subcmd'),
          role: getArgValue(args, '--role'),
          content: getArgValue(args, '--content'),
          cites: getArgValue(args, '--cites'),
        }, raw);
      } else if (subcommand === 'playbook') {
        knowledge.cmdKnowledgePlaybook(cwd, {
          preview: args.includes('--preview'),
        }, raw);
      } else {
        error('Unknown knowledge subcommand. Available: ask, discuss, playbook');
      }
      break;
    }

    case 'skills': {
      const subcommand = args[1];
      const skillRoot = getArgValue(args, '--source-root') || skillAlign.resolveSkillRoot();
      if (subcommand === 'index') {
        skillAlign.cmdSkillsIndex(skillRoot, raw);
      } else if (subcommand === 'align') {
        skillAlign.cmdSkillsAlign(skillRoot, {
          draft: getArgValue(args, '--draft'),
          draftFile: getArgValue(args, '--draft-file'),
          topK: getArgValue(args, '--top'),
          minScore: getArgValue(args, '--min-score'),
          tokenBudget: getArgValue(args, '--token-budget'),
        }, raw);
      } else {
        error('Unknown skills subcommand. Available: index, align');
      }
      break;
    }

    case 'hygiene': {
      const subcommand = args[1];
      const hygieneOpts = {
        traceAgeDays: getArgValue(args, '--trace-age-days'),
        apply: args.includes('--apply'),
      };
      if (subcommand === 'scan') {
        hygiene.cmdHygieneScan(cwd, hygieneOpts, raw);
      } else if (subcommand === 'clean') {
        hygiene.cmdHygieneClean(cwd, hygieneOpts, raw);
      } else {
        error('Unknown hygiene subcommand. Available: scan, clean [--apply] [--trace-age-days N]');
      }
      break;
    }

    case 'review-deep': {
      const subcommand = args[1];
      const phaseNum = args[2];
      const opts = {
        reviewerFile: getArgValue(args, '--reviewer-file'),
        hardenerFile: getArgValue(args, '--hardener-file'),
        metaFile: getArgValue(args, '--meta-file'),
      };
      if (subcommand === 'merge') {
        reviewDeep.cmdReviewDeepMerge(cwd, phaseNum, opts, raw);
      } else if (subcommand === 'analyze') {
        reviewDeep.cmdReviewDeepAnalyze(cwd, phaseNum, opts, raw);
      } else {
        error('Unknown review-deep subcommand. Available: merge, analyze');
      }
      break;
    }

    case 'preview': {
      const subcommand = args[1];
      if (subcommand === 'phase') {
        preview.cmdPreviewPhase(cwd, args[2], raw);
      } else if (subcommand === 'phases') {
        preview.cmdPreviewPhases(cwd, raw);
      } else if (subcommand === 'milestone') {
        preview.cmdPreviewMilestone(cwd, raw);
      } else {
        error('Unknown preview subcommand. Available: phase <N>, phases, milestone');
      }
      break;
    }

    case 'cost': {
      const subcommand = args[1];
      if (subcommand === 'report' || !subcommand) {
        const format = getArgValue(args, '--format', 'json');
        const since = getArgValue(args, '--since');
        const until = getArgValue(args, '--until');
        cost.cmdCostReport(cwd, { format, since, until }, raw);
      } else if (subcommand === 'append') {
        const rec = {
          agent: getArgValue(args, '--agent'),
          command: getArgValue(args, '--command'),
          model: getArgValue(args, '--model'),
          tier: getArgValue(args, '--tier'),
          input_tokens: Number(getArgValue(args, '--input-tokens', 0)),
          output_tokens: Number(getArgValue(args, '--output-tokens', 0)),
          cache_read_tokens: Number(getArgValue(args, '--cache-read-tokens', 0)),
          cache_write_tokens: Number(getArgValue(args, '--cache-write-tokens', 0)),
          phase: getArgValue(args, '--phase'),
          session: getArgValue(args, '--session'),
        };
        cost.cmdCostAppend(cwd, rec, raw);
      } else if (subcommand === 'clear') {
        cost.cmdCostClear(cwd, raw);
      } else {
        error('Unknown cost subcommand. Available: report, append, clear');
      }
      break;
    }

    case 'models': {
      const subcommand = args[1];
      if (subcommand === 'check' || !subcommand) {
        cost.cmdModelsCheck(raw);
      } else {
        error('Unknown models subcommand. Available: check');
      }
      break;
    }

    case 'squad': {
      const squads = require('./lib/squads.cjs');
      const subcommand = args[1];
      if (subcommand === 'list' || !subcommand) {
        squads.cmdSquadList(raw);
      } else if (subcommand === 'show') {
        squads.cmdSquadShow(args[2], raw);
      } else {
        error('Unknown squad subcommand. Available: list, show');
      }
      break;
    }

    case 'worktree': {
      const worktree = require('./lib/worktree.cjs');
      const subcommand = args[1];
      if (subcommand === 'list' || !subcommand) {
        worktree.cmdWorktreeList(cwd, raw);
      } else if (subcommand === 'create') {
        worktree.cmdWorktreeCreate(cwd, args[2], raw, { base: getArgValue(args, '--base') });
      } else if (subcommand === 'remove') {
        worktree.cmdWorktreeRemove(cwd, args[2], getArgValue(args, '--branch'), raw, { force: args.includes('--force') });
      } else {
        error('Unknown worktree subcommand. Available: list, create, remove');
      }
      break;
    }

    case 'campaign': {
      const campaign = require('./lib/campaign.cjs');
      const subcommand = args[1];
      if (subcommand === 'schedule') {
        const budget = getArgValue(args, '--daily-budget');
        campaign.cmdCampaignSchedule(cwd, {
          goal: getArgValue(args, '--goal'),
          source: getArgValue(args, '--source'),
          cadence: getArgValue(args, '--cadence', 'daily'),
          daily_budget: budget != null ? Number(budget) : undefined,
          enabled: args.includes('--disable') ? false : undefined,
          paused: args.includes('--pause') ? true : (args.includes('--resume') ? false : undefined),
        }, raw);
      } else if (subcommand === 'status' || !subcommand) {
        campaign.cmdCampaignStatus(cwd, raw);
      } else if (subcommand === 'due') {
        campaign.cmdCampaignDue(cwd, raw);
      } else if (subcommand === 'record-run') {
        const r = campaign.recordRun(cwd, {
          items_landed: Number(getArgValue(args, '--items', 0)),
          points_used: Number(getArgValue(args, '--points', 0)),
        });
        if (r.error) { error(r.error); } else { output(r, raw, `recorded · next ${r.next_due}`); }
      } else {
        error('Unknown campaign subcommand. Available: schedule, status, due, record-run');
      }
      break;
    }

    case 'bus': {
      const subcommand = args[1];
      if (subcommand === 'publish') {
        bus.cmdBusPublish(cwd, args[2], args[3], { source: getArgValue(args, '--source') }, raw);
      } else if (subcommand === 'drain') {
        const mode = getArgValue(args, '--mode', 'peek');
        const limit = getArgValue(args, '--limit');
        const offset = getArgValue(args, '--offset');
        bus.cmdBusDrain(cwd, args[2], {
          mode,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        }, raw);
      } else if (subcommand === 'list') {
        bus.cmdBusList(cwd, raw);
      } else {
        error('Unknown bus subcommand. Available: publish, drain, list');
      }
      break;
    }

    case 'cache': {
      const subcommand = args[1];
      if (subcommand === 'prime') {
        const result = buildCachedContext(cwd);
        if (args.includes('--summary')) {
          // Metadata-only form: hide full block content so agents can decide
          // whether to request the full payload.
          const summary = {
            blocks: result.blocks.map(b => ({ path: b.path, bytes: Buffer.byteLength(b.content, 'utf-8'), cache: b.cache })),
            total_bytes: result.total_bytes,
            sha: result.sha,
          };
          output(summary, raw);
        } else {
          output(result, raw);
        }
      } else {
        error('Unknown cache subcommand. Available: prime [--summary]');
      }
      break;
    }


    case 'retro': {
      verify.cmdRetro(cwd, raw, args);
      break;
    }

    case 'codebase': {
      const subcommand = args[1];
      if (subcommand === 'analyze-imports') {
        codebase.cmdAnalyzeImports(cwd, raw, args);
      } else if (subcommand === 'detect-languages') {
        codebase.cmdDetectLanguages(cwd, raw);
      } else if (subcommand === 'best-practices') {
        codebase.cmdBestPractices(cwd, raw);
      } else if (subcommand === 'estimate-size') {
        codebase.cmdEstimateRepoSize(cwd, raw, args);
      } else {
        error('Unknown codebase subcommand. Available: analyze-imports, detect-languages, best-practices, estimate-size');
      }
      break;
    }

    case 'standards': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        config.cmdStandardsList(cwd, getArgValue(args, '--category'), raw);
      } else if (subcommand === 'select') {
        config.cmdStandardsSelect(cwd, args[2], raw);
      } else if (subcommand === 'remove') {
        config.cmdStandardsRemove(cwd, args[2], raw);
      } else if (subcommand === 'status') {
        config.cmdStandardsStatus(cwd, raw);
      } else if (subcommand === 'recommend') {
        config.cmdStandardsRecommend(cwd, raw);
      } else if (subcommand === 'phase-track') {
        config.cmdStandardsPhaseTrack(cwd, args[2], raw);
      } else if (subcommand === 'tools') {
        config.cmdStandardsTools(cwd, args[2], raw);
      } else {
        error('Unknown standards subcommand. Available: list, select, remove, status, recommend, phase-track, tools');
      }
      break;
    }

    case 'optimize': {
      const subcommand = args[1];
      if (subcommand === 'trace') {
        const traceSub = args[2];
        optimize.cmdOptimizeTrace(cwd, traceSub, {
          sessionId: getArgValue(args, '--session'),
          description: getArgValue(args, '--description'),
          command: getArgValue(args, '--command'),
          phase: getArgValue(args, '--phase'),
          // trace log opts
          agent: getArgValue(args, '--agent'),
          type: getArgValue(args, '--type'),
          category: getArgValue(args, '--category'),
          impact: getArgValue(args, '--impact'),
          description: getArgValue(args, '--description'),
          correction: getArgValue(args, '--correction'),
          tokens_wasted: getArgValue(args, '--tokens-wasted') ? Number(getArgValue(args, '--tokens-wasted')) : null,
          context: (() => { const v = getArgValue(args, '--context'); if (!v) return null; try { return JSON.parse(v); } catch { return null; } })(),
        }, raw);
      } else if (subcommand === 'learn') {
        optimize.cmdOptimizeLearn(cwd, {
          sessionId: getArgValue(args, '--session'),
        }, raw);
      } else if (subcommand === 'apply') {
        optimize.cmdOptimizeApply(cwd, {
          reportPath: getArgValue(args, '--report'),
        }, raw);
      } else if (subcommand === 'list') {
        optimize.cmdOptimizeList(cwd, raw);
      } else if (subcommand === 'stats') {
        optimize.cmdOptimizeStats(cwd, raw);
      } else {
        error('Unknown optimize subcommand. Available: trace, learn, apply, list, stats');
      }
      break;
    }

    case 'doc-lint': {
      const subcommand = args[1];
      if (subcommand === 'schema-check') {
        const schemaPath = args[2];
        if (!schemaPath || schemaPath.startsWith('--')) { error('doc-lint schema-check <path> required'); }
        docLint.cmdDocLintSchemaCheck(cwd, schemaPath, { raw });
        break;
      }
      if (subcommand === 'counts') {
        const dir = args[2];
        if (!dir || dir.startsWith('--')) { error('doc-lint counts <dir> required'); }
        const exclude = [];
        for (let k = 0; k < args.length; k++) if (args[k] === '--exclude') exclude.push(args[k + 1]);
        docLint.cmdDocLintCounts(cwd, dir, { raw, exclude });
        break;
      }
      if (subcommand === 'flags') {
        const docDirs = [];
        for (let k = 0; k < args.length; k++) if (args[k] === '--doc-dir') docDirs.push(args[k + 1]);
        docLint.cmdDocLintFlags(cwd, { docDirs: docDirs.length ? docDirs : undefined }, raw);
        break;
      }
      // Default: lint a directory
      const dir = args[1];
      if (!dir || dir.startsWith('--')) { error('doc-lint <dir> required (or doc-lint schema-check <path>, doc-lint counts <dir>)'); }
      const schema = getArgValue(args, '--schema');
      const format = getArgValue(args, '--format', 'human');
      const strict = args.includes('--strict');
      const exclude = [];
      for (let k = 0; k < args.length; k++) if (args[k] === '--exclude') exclude.push(args[k + 1]);
      docLint.cmdDocLint(cwd, dir, { schema, format, strict, exclude: exclude.filter(Boolean), raw });
      break;
    }

    case 'learn': {
      const subcommand = args[1];

      // W4: pan-tools learn promote/unpromote/list-promoted (self-improvement loop)
      if (subcommand === 'promote') {
        const patternId = getArgValue(args, '--pattern');
        if (!patternId) { error('learn promote requires --pattern <id>'); }
        const scope = getArgValue(args, '--scope');
        const topic = getArgValue(args, '--topic');
        if (!scope) { error('learn promote requires --scope universal|internal'); }
        if (!topic) { error('learn promote requires --topic <name>'); }
        const summary = getArgValue(args, '--summary') || '';
        const evidence = getArgValue(args, '--evidence') || '';
        const rule = getArgValue(args, '--rule') || '';
        const appliesIn = getArgValue(args, '--applies-in') || '';
        const sourceExpsCsv = getArgValue(args, '--source-experiments') || '';
        const sourceExperiments = sourceExpsCsv
          ? sourceExpsCsv.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        const sourceRoot = getArgValue(args, '--source-root') || cwd;

        const result = optimize.promotePattern(
          { id: patternId, summary, evidence, rule, applies_in: appliesIn, source_experiments: sourceExperiments },
          { scope, topic, sourceRoot }
        );
        output(result, raw);
        break;
      }

      if (subcommand === 'unpromote') {
        const patternId = getArgValue(args, '--pattern');
        const scope = getArgValue(args, '--scope');
        const topic = getArgValue(args, '--topic');
        const sourceRoot = getArgValue(args, '--source-root') || cwd;
        if (!patternId || !scope || !topic) {
          error('learn unpromote requires --pattern <id> --scope <s> --topic <t>');
        }
        const result = optimize.unpromotePattern(patternId, { scope, topic, sourceRoot });
        output(result, raw);
        break;
      }

      if (subcommand === 'list-promoted') {
        const sourceRoot = getArgValue(args, '--source-root') || cwd;
        const result = optimize.listPromotedPatterns({ sourceRoot });
        output(result, raw);
        break;
      }

      if (subcommand === 'build-index') {
        const sourceRoot = getArgValue(args, '--source-root') || cwd;
        const result = learnIndex.cmdBuildIndex(sourceRoot);
        if (raw) {
          output(result, true,
            `Index written: ${result.written_to}\n` +
            `Topics: ${result.topics}\nPatterns: ${result.patterns}\n` +
            `Total tokens (est): ${result.total_tokens_est.toLocaleString()}\n` +
            `Schema version: ${result.schema_version}`);
        } else {
          output(result, false);
        }
        break;
      }

      if (subcommand === 'topics-for') {
        const sourceRoot = getArgValue(args, '--source-root') || cwd;
        const agent = getArgValue(args, '--agent');
        if (!agent) { error('learn topics-for requires --agent <name>'); }
        const minRelevance = getArgValue(args, '--min-relevance', 'medium');
        const tokenBudget = parseInt(getArgValue(args, '--token-budget', '5000'), 10);
        const result = learnIndex.cmdTopicsFor(sourceRoot, { agent, minRelevance, tokenBudget });
        if (raw) {
          const lines = [`Topics for "${agent}" (min ${minRelevance}, budget ${tokenBudget}):`, ``];
          for (const t of result.selected) {
            lines.push(`  [${t.relevance.padEnd(6)}] ${t.scope}/${t.name.padEnd(22)} ${t.tokens.toString().padStart(5)}t   ${t.patterns.join(', ')}`);
          }
          lines.push(``, `Selected: ${result.selected.length} topics, ${result.total_tokens} tokens`);
          if (result.dropped.length > 0) {
            lines.push(`Dropped (over budget): ${result.dropped.length} — ${result.dropped.map(d => d.name).join(', ')}`);
          }
          output(result, true, lines.join('\n'));
        } else {
          output(result, false);
        }
        break;
      }

      if (subcommand === 'lint') {
        const sourceRoot = getArgValue(args, '--source-root') || cwd;
        const scope = getArgValue(args, '--scope');
        const strict = args.includes('--strict');
        const result = learnLint.cmdLearnLint(sourceRoot, { scope, strict });
        if (raw) {
          const lines = [`Learn-Lint: ${result.summary.status.toUpperCase()}`,
            ``,
            `Patterns scanned: ${result.pattern_count} across ${result.file_count} files`,
            `Errors:   ${result.summary.errors}`,
            `Warnings: ${result.summary.warnings}`,
            ``,
          ];
          for (const v of result.violations) {
            lines.push(`[${v.severity.toUpperCase()}] ${v.code} ${v.pattern_id}: ${v.message}`);
          }
          output(result, true, lines.join('\n'));
        } else {
          output(result, false);
        }
        if (result.summary.status === 'fail') process.exit(1);
        break;
      }

      // Default: convenience alias for optimize learn (existing behavior)
      optimize.cmdOptimizeLearn(cwd, {
        sessionId: getArgValue(args, '--session'),
      }, raw);
      break;
    }

    case 'links': {
      const subcommand = args[1];
      if (subcommand === 'validate' || !subcommand) {
        const collectMulti = (flag) => {
          const vals = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i] === flag && i + 1 < args.length) vals.push(args[i + 1]);
          }
          return vals.length ? vals : null;
        };
        const opts = {
          docRoots: collectMulti('--doc-root'),
          sourceRoots: collectMulti('--source-root'),
          strict: args.includes('--strict'),
          raw,
        };
        links.cmdLinksValidate(cwd, opts);
        break;
      }
      error(`Unknown links subcommand: ${subcommand}. Available: validate`);
    }

    default:
      error(`Unknown command: ${command}. Run pan-tools without arguments to see available commands.`);
  }
}

main();
