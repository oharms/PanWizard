#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

// Extracted pure functions (testable independently)
const lib = require('./install-lib.cjs');
const {
  colorNameToHex, claudeToOpencodeTools, claudeToGeminiTools, claudeToCopilotTools,
  getDirName, getConfigDirFromHome, expandTilde, toSingleLine, yamlQuote, buildHookCommand,
  extractFrontmatterAndBody, extractFrontmatterField,
  convertToolName, convertGeminiToolName, convertCopilotToolName,
  convertSlashCommandsToCodexSkillMentions, convertSlashCommandsToCopilotSkillMentions,
  convertClaudeToCodexMarkdown, convertClaudeToCopilotMarkdown,
  convertClaudeToOpencodeFrontmatter, convertClaudeToGeminiToml, convertClaudeToGeminiAgent,
  rewriteAskUserQuestionForCopilot, stripSubTags,
  getCodexSkillAdapterHeader, convertClaudeCommandToCodexSkill,
  convertClaudeCommandToUnifiedSkill,
  getCopilotSkillAdapterHeader, convertClaudeCommandToCopilotSkill, convertClaudeToCopilotAgent,
  processAttribution, parseJsonc,
  detectModelCapabilities, buildClaudeSkillShim, stripThinkingFrontmatter,
  geminiTransitionNotice,
  convertClaudeAgentToCodexToml, codexTrustNotice,
  buildCopilotHooksConfig,
} = lib;

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// Get version from package.json
const pkg = require('../package.json');

// Source repo root — prevent installing PAN into its own source directory
const PAN_SOURCE_ROOT = path.resolve(__dirname, '..');
// Windows paths are case-insensitive; normalize for comparison
const normPath = p => process.platform === 'win32' ? p.toLowerCase() : p;

// IMPROVEMENT-TODO P0 (v3.7.10): warning collector for non-fatal install
// failures. Replaces silent `catch {}` blocks in copy paths. Surfaced at end
// of install if non-empty. Required failures still throw / exit non-zero.
const INSTALL_WARNINGS = [];
function pushInstallWarning(stage, file, err) {
  INSTALL_WARNINGS.push({ stage, file, error: err && (err.message || String(err)) });
}

// Parse args
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal = args.includes('--local') || args.includes('-l');
const hasOpencode = args.includes('--opencode');
const hasClaude = args.includes('--claude');
const hasGemini = args.includes('--gemini');
const hasCodex = args.includes('--codex');
const hasCopilot = args.includes('--copilot');
const hasBoth = args.includes('--both'); // Legacy flag, keeps working
const hasAll = args.includes('--all');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');

// Runtime selection - can be set by flags or interactive prompt
let selectedRuntimes = [];
if (hasAll) {
  selectedRuntimes = ['claude', 'opencode', 'gemini', 'codex', 'copilot'];
} else if (hasBoth) {
  selectedRuntimes = ['claude', 'opencode'];
} else {
  if (hasOpencode) selectedRuntimes.push('opencode');
  if (hasClaude) selectedRuntimes.push('claude');
  if (hasGemini) selectedRuntimes.push('gemini');
  if (hasCodex) selectedRuntimes.push('codex');
  if (hasCopilot) selectedRuntimes.push('copilot');
}

/**
 * Get the global config directory for OpenCode
 * OpenCode follows XDG Base Directory spec and uses ~/.config/opencode/
 * Priority: OPENCODE_CONFIG_DIR > dirname(OPENCODE_CONFIG) > XDG_CONFIG_HOME/opencode > ~/.config/opencode
 */
function getOpencodeGlobalDir() {
  // 1. Explicit OPENCODE_CONFIG_DIR env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return expandTilde(process.env.OPENCODE_CONFIG_DIR);
  }
  
  // 2. OPENCODE_CONFIG env var (use its directory)
  if (process.env.OPENCODE_CONFIG) {
    return path.dirname(expandTilde(process.env.OPENCODE_CONFIG));
  }
  
  // 3. XDG_CONFIG_HOME/opencode
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(expandTilde(process.env.XDG_CONFIG_HOME), 'opencode');
  }
  
  // 4. Default: ~/.config/opencode (XDG default)
  return path.join(os.homedir(), '.config', 'opencode');
}

/**
 * Get the global config directory for a runtime
 * @param {string} runtime - 'claude', 'opencode', 'gemini', or 'codex'
 * @param {string|null} explicitDir - Explicit directory from --config-dir flag
 */
/**
 * Codex skills root. Codex reads skills from the shared `.agents/skills/`
 * tree — repo scope `$REPO_ROOT/.agents/skills`, user scope `~/.agents/skills`.
 * `$CODEX_HOME/skills` is NOT a documented read location (verified against
 * developers.openai.com/codex/skills, 2026-06).
 */
function getCodexSkillsRoot(isGlobal) {
  return isGlobal
    ? path.join(os.homedir(), '.agents', 'skills')
    : path.join(process.cwd(), '.agents', 'skills');
}

function getGlobalDir(runtime, explicitDir = null) {
  if (runtime === 'opencode') {
    // For OpenCode, --config-dir overrides env vars
    if (explicitDir) {
      return expandTilde(explicitDir);
    }
    return getOpencodeGlobalDir();
  }
  
  if (runtime === 'gemini') {
    // Gemini: --config-dir > GEMINI_CONFIG_DIR > ~/.gemini
    if (explicitDir) {
      return expandTilde(explicitDir);
    }
    if (process.env.GEMINI_CONFIG_DIR) {
      return expandTilde(process.env.GEMINI_CONFIG_DIR);
    }
    return path.join(os.homedir(), '.gemini');
  }

  if (runtime === 'codex') {
    // Codex: --config-dir > CODEX_HOME > ~/.codex
    if (explicitDir) {
      return expandTilde(explicitDir);
    }
    if (process.env.CODEX_HOME) {
      return expandTilde(process.env.CODEX_HOME);
    }
    return path.join(os.homedir(), '.codex');
  }

  if (runtime === 'copilot') {
    // Copilot CLI: --config-dir > COPILOT_CONFIG_DIR > ~/.copilot
    if (explicitDir) {
      return expandTilde(explicitDir);
    }
    if (process.env.COPILOT_CONFIG_DIR) {
      return expandTilde(process.env.COPILOT_CONFIG_DIR);
    }
    return path.join(os.homedir(), '.copilot');
  }

  // Claude Code: --config-dir > CLAUDE_CONFIG_DIR > ~/.claude
  if (explicitDir) {
    return expandTilde(explicitDir);
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    return expandTilde(process.env.CLAUDE_CONFIG_DIR);
  }
  return path.join(os.homedir(), '.claude');
}

const banner = '\n' +
  cyan + '  ██████╗  █████╗ ███╗   ██╗\n' +
  '  ██╔══██╗██╔══██╗████╗  ██║\n' +
  '  ██████╔╝███████║██╔██╗ ██║\n' +
  '  ██╔═══╝ ██╔══██║██║╚██╗██║\n' +
  '  ██║     ██║  ██║██║ ╚████║\n' +
  '  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝' + reset + '\n' +
  '\n' +
  '  PAN Wizard ' + dim + 'v' + pkg.version + reset + '\n' +
  '  A lightweight workflow automation and context engineering\n' +
  '  system for Claude Code, OpenCode, Gemini, Codex, and Copilot CLI.\n';

// Parse --config-dir argument
function parseConfigDirArg() {
  const configDirIndex = args.findIndex(arg => arg === '--config-dir' || arg === '-c');
  if (configDirIndex !== -1) {
    const nextArg = args[configDirIndex + 1];
    // Error if --config-dir is provided without a value or next arg is another flag
    if (!nextArg || nextArg.startsWith('-')) {
      console.error(`  ${yellow}--config-dir requires a path argument${reset}`);
      process.exit(1);
    }
    return nextArg;
  }
  // Also handle --config-dir=value format
  const configDirArg = args.find(arg => arg.startsWith('--config-dir=') || arg.startsWith('-c='));
  if (configDirArg) {
    const value = configDirArg.split('=')[1];
    if (!value) {
      console.error(`  ${yellow}--config-dir requires a non-empty path${reset}`);
      process.exit(1);
    }
    return value;
  }
  return null;
}
const explicitConfigDir = parseConfigDirArg();
const hasHelp = args.includes('--help') || args.includes('-h');
const forceStatusline = args.includes('--force-statusline');
// ADR-0028 Phase 1 (opt-in): compile commands once into the shared
// .agents/skills/ tree for every runtime instead of per-runtime command trees.
const unifiedSkills = args.includes('--unified-skills');

console.log(banner);

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx pan-wizard [options]\n\n  ${yellow}Options:${reset}\n    ${cyan}-l, --local${reset}               Install locally to current directory (default)\n    ${cyan}-g, --global${reset}              Install globally to config directory\n    ${cyan}--claude${reset}                  Install for Claude Code only\n    ${cyan}--opencode${reset}                Install for OpenCode only\n    ${cyan}--gemini${reset}                  Install for Gemini only\n    ${cyan}--codex${reset}                   Install for Codex only\n    ${cyan}--all${reset}                     Install for all runtimes\n    ${cyan}-u, --uninstall${reset}           Uninstall PAN (remove all PAN files)\n    ${cyan}-c, --config-dir <path>${reset}   Specify custom config directory\n    ${cyan}-h, --help${reset}                Show this help message\n    ${cyan}--force-statusline${reset}        Replace existing statusline config\n    ${cyan}--unified-skills${reset}          Install commands as one shared .agents/skills/ tree (ADR-0028 alpha)\n\n  ${yellow}Examples:${reset}\n    ${dim}# Interactive install (prompts for runtime; installs project-level)${reset}\n    npx pan-wizard\n\n    ${dim}# Install for Claude Code in current project (default, --local implied)${reset}\n    npx pan-wizard --claude\n\n    ${dim}# Install for all runtimes in current project${reset}\n    npx pan-wizard --all --local\n\n    ${dim}# Install globally (available in all projects)${reset}\n    npx pan-wizard --claude --global\n\n    ${dim}# Install for Gemini globally${reset}\n    npx pan-wizard --gemini --global\n\n    ${dim}# Install to custom config directory${reset}\n    npx pan-wizard --codex --global --config-dir ~/.codex-work\n\n    ${dim}# Uninstall PAN from Codex globally${reset}\n    npx pan-wizard --codex --global --uninstall\n\n  ${yellow}Notes:${reset}\n    By default, PAN installs into the current project directory only.\n    Use --global to install system-wide (writes to ~/.claude, ~/.gemini, etc.).\n    The --config-dir option takes priority over CLAUDE_CONFIG_DIR / GEMINI_CONFIG_DIR / CODEX_HOME.\n`);
  process.exit(0);
}

/**
 * Read and parse settings.json, returning empty object if it doesn't exist
 */
function readSettings(settingsPath) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write settings.json with proper formatting
 */
function writeSettings(settingsPath, settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch (e) {
    console.error(`  ${yellow}⚠${reset} Failed to write settings: ${e.message}`);
  }
}

// Cache for attribution settings (populated once per runtime during install)
const attributionCache = new Map();

/**
 * Get commit attribution setting for a runtime
 * @param {string} runtime - 'claude', 'opencode', 'gemini', or 'codex'
 * @returns {null|undefined|string} null = remove, undefined = keep default, string = custom
 */
function getCommitAttribution(runtime) {
  // Return cached value if available
  if (attributionCache.has(runtime)) {
    return attributionCache.get(runtime);
  }

  let result;

  if (runtime === 'opencode') {
    const config = readSettings(path.join(getGlobalDir('opencode', null), 'opencode.json'));
    result = config.disable_ai_attribution === true ? null : undefined;
  } else if (runtime === 'gemini') {
    // Gemini: check gemini settings.json for attribution config
    const settings = readSettings(path.join(getGlobalDir('gemini', explicitConfigDir), 'settings.json'));
    if (!settings.attribution || settings.attribution.commit === undefined) {
      result = undefined;
    } else if (settings.attribution.commit === '') {
      result = null;
    } else {
      result = settings.attribution.commit;
    }
  } else if (runtime === 'claude') {
    // Claude Code
    const settings = readSettings(path.join(getGlobalDir('claude', explicitConfigDir), 'settings.json'));
    if (!settings.attribution || settings.attribution.commit === undefined) {
      result = undefined;
    } else if (settings.attribution.commit === '') {
      result = null;
    } else {
      result = settings.attribution.commit;
    }
  } else if (runtime === 'copilot') {
    // Copilot CLI: user-editable settings live in settings.json; config.json is
    // legacy (auto-migrated by the CLI, now internal state) — fall back for old installs
    const copilotDir = getGlobalDir('copilot', explicitConfigDir);
    let config = readSettings(path.join(copilotDir, 'settings.json'));
    if (!config.attribution) {
      config = readSettings(path.join(copilotDir, 'config.json'));
    }
    if (!config.attribution || config.attribution.commit === undefined) {
      result = undefined;
    } else if (config.attribution.commit === '') {
      result = null;
    } else {
      result = config.attribution.commit;
    }
  } else {
    // Codex currently has no attribution setting equivalent
    result = undefined;
  }

  // Cache and return
  attributionCache.set(runtime, result);
  return result;
}

// processAttribution, parseJsonc, and all pure converter functions
// are provided by install-lib.cjs (see require at top of file).

/**
 * Copy commands to a flat structure for OpenCode
 * OpenCode expects: commands/pan-help.md (invoked as /pan-help)
 * Source structure: commands/pan/help.md
 *
 * @param {string} srcDir - Source directory (e.g., commands/pan/)
 * @param {string} destDir - Destination directory (e.g., commands/)
 * @param {string} prefix - Prefix for filenames (e.g., 'pan')
 * @param {string} pathPrefix - Path prefix for file references
 * @param {string} runtime - Target runtime ('claude' or 'opencode')
 */
function copyFlattenedCommands(srcDir, destDir, prefix, pathPrefix, runtime) {
  if (!fs.existsSync(srcDir)) {
    return;
  }
  
  // Remove old pan-*.md files before copying new ones
  if (fs.existsSync(destDir)) {
    for (const file of fs.readdirSync(destDir)) {
      if (file.startsWith(`${prefix}-`) && file.endsWith('.md')) {
        try { fs.unlinkSync(path.join(destDir, file)); } catch (err) { pushInstallWarning('staleCleanup', file, err); }
      }
    }
  } else {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (err) { pushInstallWarning('mkdir', destDir, err); }
  }
  
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    
    if (entry.isDirectory()) {
      // Recurse into subdirectories, adding to prefix
      // e.g., commands/pan/debug/start.md -> command/pan-debug-start.md
      copyFlattenedCommands(srcPath, destDir, `${prefix}-${entry.name}`, pathPrefix, runtime);
    } else if (entry.name.endsWith('.md')) {
      // Flatten: help.md -> pan-help.md
      const baseName = entry.name.replace('.md', '');
      const destName = `${prefix}-${baseName}.md`;
      const destPath = path.join(destDir, destName);

      let content = fs.readFileSync(srcPath, 'utf8');
      const globalClaudeRegex = /~\/\.claude\//g;
      const localClaudeRegex = /\.\/\.claude\//g;
      const opencodeDirRegex = /~\/\.opencode\//g;
      content = content.replace(globalClaudeRegex, pathPrefix);
      content = content.replace(localClaudeRegex, `./${getDirName(runtime)}/`);
      content = content.replace(opencodeDirRegex, pathPrefix);
      content = processAttribution(content, getCommitAttribution(runtime));
      content = convertClaudeToOpencodeFrontmatter(content);

      fs.writeFileSync(destPath, content);
    }
  }
}

function listCodexSkillNames(skillsDir, prefix = 'pan-') {
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .filter(entry => fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

function copyCommandsAsCodexSkills(srcDir, skillsDir, prefix, pathPrefix, runtime) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  try { fs.mkdirSync(skillsDir, { recursive: true }); } catch (err) { pushInstallWarning('mkdir', skillsDir, err); }

  // Remove previous PAN Codex skills to avoid stale command skills.
  const existing = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`)) {
      try { fs.rmSync(path.join(skillsDir, entry.name), { recursive: true }); } catch (err) { pushInstallWarning('staleCleanup', entry.name, err); }
    }
  }

  function recurse(currentSrcDir, currentPrefix) {
    const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrcDir, entry.name);
      if (entry.isDirectory()) {
        recurse(srcPath, `${currentPrefix}-${entry.name}`);
        continue;
      }

      if (!entry.name.endsWith('.md')) {
        continue;
      }

      const baseName = entry.name.replace('.md', '');
      const skillName = `${currentPrefix}-${baseName}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });

      let content = fs.readFileSync(srcPath, 'utf8');
      const globalClaudeRegex = /~\/\.claude\//g;
      const localClaudeRegex = /\.\/\.claude\//g;
      const codexDirRegex = /~\/\.codex\//g;
      content = content.replace(globalClaudeRegex, pathPrefix);
      content = content.replace(localClaudeRegex, `./${getDirName(runtime)}/`);
      content = content.replace(codexDirRegex, pathPrefix);
      // Codex executes commands literally; no `pan-tools` bin on PATH.
      const panToolsPath = `${pathPrefix}pan-wizard-core/bin/pan-tools.cjs`;
      content = content.replace(/\bpan-tools\b(?=\s+[a-z])/g, `node ${panToolsPath}`);
      content = processAttribution(content, getCommitAttribution(runtime));
      content = convertClaudeCommandToCodexSkill(content, skillName);

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    }
  }

  recurse(srcDir, prefix);
}

/**
 * Copy PAN commands as runtime-neutral unified skills (ADR-0028 Phase 1).
 * Same tree layout as the Codex path (.agents/skills/pan-{name}/SKILL.md) but
 * the content carries the runtime-neutral adapter so every runtime can consume it.
 * Core references resolve against the shared .agents/pan-wizard-core/ copy
 * (Phase 2), so the compiled skills are identical regardless of which runtime
 * installed them — only the rare agent-file references stay runtime-local.
 */
function copyCommandsAsUnifiedSkills(srcDir, skillsDir, prefix, pathPrefix, corePrefix, runtime) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  try { fs.mkdirSync(skillsDir, { recursive: true }); } catch (err) { pushInstallWarning('mkdir', skillsDir, err); }

  // Remove previous PAN skills to avoid stale command skills.
  const existing = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`)) {
      try { fs.rmSync(path.join(skillsDir, entry.name), { recursive: true }); } catch (err) { pushInstallWarning('staleCleanup', entry.name, err); }
    }
  }

  function recurse(currentSrcDir, currentPrefix) {
    const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrcDir, entry.name);
      if (entry.isDirectory()) {
        recurse(srcPath, `${currentPrefix}-${entry.name}`);
        continue;
      }

      if (!entry.name.endsWith('.md')) {
        continue;
      }

      const baseName = entry.name.replace('.md', '');
      const skillName = `${currentPrefix}-${baseName}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });

      let content = fs.readFileSync(srcPath, 'utf8');
      // Core + agent-definition references → shared .agents/ copies (specific,
      // before the generic rewrites); everything else .claude-scoped → the
      // installing runtime. Agent refs point at the canonical reference copies
      // shipped with the shared core — the runtime's own agents dir may carry
      // a different format (Codex TOML, Copilot .agent.md).
      content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
      content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
      content = content.replace(/~\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
      content = content.replace(/\.\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
      content = content.replace(/~\/\.claude\//g, pathPrefix);
      content = content.replace(/\.\/\.claude\//g, `./${getDirName(runtime)}/`);
      // Not every runtime puts a `pan-tools` bin on PATH — invoke via node.
      const panToolsPath = `${corePrefix}pan-wizard-core/bin/pan-tools.cjs`;
      content = content.replace(/\bpan-tools\b(?=\s+[a-z])/g, `node ${panToolsPath}`);
      content = processAttribution(content, getCommitAttribution(runtime));
      content = convertClaudeCommandToUnifiedSkill(content, skillName);

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    }
  }

  recurse(srcDir, prefix);
}

/**
 * Remove a runtime's proprietary command surface after a --unified-skills
 * install so commands don't resolve twice (ADR-0028 Phase 1 sweep).
 */
function sweepProprietaryCommandSurfaces(targetDir, runtime) {
  if (runtime === 'opencode') {
    for (const dirName of ['commands', 'command']) {
      const commandDir = path.join(targetDir, dirName);
      try {
        for (const file of fs.readdirSync(commandDir)) {
          if (file.startsWith('pan-') && file.endsWith('.md')) {
            try { fs.unlinkSync(path.join(commandDir, file)); } catch {}
          }
        }
      } catch { /* dir absent — nothing to sweep */ }
    }
  } else if (runtime === 'copilot') {
    const skillsDir = path.join(targetDir, 'skills');
    try {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('pan-')) {
          try { fs.rmSync(path.join(skillsDir, entry.name), { recursive: true }); } catch {}
        }
      }
    } catch { /* dir absent — nothing to sweep */ }
  } else if (runtime === 'codex') {
    // Legacy .codex/skills location (dead read path; swept on upgrade anyway)
    const legacySkillsDir = path.join(targetDir, 'skills');
    try {
      for (const entry of fs.readdirSync(legacySkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('pan-')) {
          try { fs.rmSync(path.join(legacySkillsDir, entry.name), { recursive: true }); } catch {}
        }
      }
    } catch { /* dir absent — nothing to sweep */ }
  } else {
    // Claude Code & Gemini: nested commands/pan tree (+ Claude skill shims)
    try { fs.rmSync(path.join(targetDir, 'commands', 'pan'), { recursive: true }); } catch {}
    if (runtime === 'claude') {
      const skillsDir = path.join(targetDir, 'skills');
      try {
        for (const file of fs.readdirSync(skillsDir)) {
          if (file.startsWith('pan-') && file.endsWith('.md')) {
            try { fs.unlinkSync(path.join(skillsDir, file)); } catch {}
          }
        }
      } catch { /* dir absent — nothing to sweep */ }
    }
  }
}

/**
 * Copy pan-wizard-core into the shared .agents/ root for unified installs
 * (ADR-0028 Phase 2). Core-internal references resolve against the shared
 * prefix, so the copy is runtime-neutral and rewrites across runtimes are
 * idempotent; the few non-core references (agent files, cache paths) resolve
 * against the installing runtime. Skill mentions are normalized to the
 * neutral /pan-{name} form to match the unified SKILL.md content.
 */
function copySharedCore(srcDir, destDir, corePrefix, runtimePathPrefix, runtime) {
  try {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    fs.mkdirSync(destDir, { recursive: true });
  } catch (err) {
    throw new Error(`copySharedCore: cannot prepare ${destDir}: ${err.message}`);
  }

  const dirName = getDirName(runtime);

  (function recurse(currentSrc, currentDest) {
    for (const entry of fs.readdirSync(currentSrc, { withFileTypes: true })) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);

      if (entry.isDirectory()) {
        try { fs.mkdirSync(destPath, { recursive: true }); } catch (err) { pushInstallWarning('copySharedCore(mkdir)', destPath, err); }
        recurse(srcPath, destPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          let content = fs.readFileSync(srcPath, 'utf8');
          content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
          content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
          // Agent-definition refs → the canonical reference copies in the
          // shared core (runtime agents dirs carry runtime-specific formats).
          content = content.replace(/~\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
          content = content.replace(/\.\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
          content = content.replace(/~\/\.claude\//g, runtimePathPrefix);
          content = content.replace(/\.\/\.claude\//g, `./${dirName}/`);
          content = processAttribution(content, getCommitAttribution(runtime));
          content = convertSlashCommandsToCopilotSkillMentions(content);
          fs.writeFileSync(destPath, content);
        } catch (err) {
          pushInstallWarning('copySharedCore(md)', destPath, err);
        }
      } else {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch (err) {
          pushInstallWarning('copySharedCore(copy)', destPath, err);
        }
      }
    }
  })(srcDir, destDir);

  // learnings/internal is source-only — strip it like the per-runtime copy does
  try {
    fs.rmSync(path.join(destDir, 'learnings', 'internal'), { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') pushInstallWarning('stripInternalLearnings', 'learnings/internal', err);
  }
}

/**
 * Copy PAN commands as Copilot CLI skills.
 * Creates skills/pan-{name}/SKILL.md directory structure.
 * Similar to copyCommandsAsCodexSkills but uses Copilot CLI converters.
 */
function copyCommandsAsCopilotSkills(srcDir, skillsDir, prefix, pathPrefix, runtime) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  try { fs.mkdirSync(skillsDir, { recursive: true }); } catch (err) { pushInstallWarning('mkdir', skillsDir, err); }

  // Remove previous PAN Copilot skills to avoid stale command skills
  const existing = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`)) {
      try { fs.rmSync(path.join(skillsDir, entry.name), { recursive: true }); } catch (err) { pushInstallWarning('staleCleanup', entry.name, err); }
    }
  }

  function recurse(currentSrcDir, currentPrefix) {
    const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrcDir, entry.name);
      if (entry.isDirectory()) {
        recurse(srcPath, `${currentPrefix}-${entry.name}`);
        continue;
      }

      if (!entry.name.endsWith('.md')) {
        continue;
      }

      const baseName = entry.name.replace('.md', '');
      const skillName = `${currentPrefix}-${baseName}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });

      let content = fs.readFileSync(srcPath, 'utf8');
      const globalClaudeRegex = /~\/\.claude\//g;
      const localClaudeRegex = /\.\/\.claude\//g;
      content = content.replace(globalClaudeRegex, pathPrefix);
      content = content.replace(localClaudeRegex, `./${getDirName(runtime)}/`);
      // Copilot CLI executes commands literally; there's no `pan-tools` bin on PATH.
      // Replace bare `pan-tools` invocations with the explicit node + .cjs path.
      const panToolsPath = `${pathPrefix}pan-wizard-core/bin/pan-tools.cjs`;
      content = content.replace(/\bpan-tools\b(?=\s+[a-z])/g, `node ${panToolsPath}`);
      content = processAttribution(content, getCommitAttribution(runtime));
      content = convertClaudeCommandToCopilotSkill(content, skillName);

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    }
  }

  recurse(srcDir, prefix);
}

/**
 * Recursively copy directory, replacing paths in .md files
 * Deletes existing destDir first to remove orphaned files from previous versions
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @param {string} pathPrefix - Path prefix for file references
 * @param {string} runtime - Target runtime ('claude', 'opencode', 'gemini', 'codex', 'copilot')
 */
function copyWithPathReplacement(srcDir, destDir, pathPrefix, runtime, isCommand = false) {
  const isOpencode = runtime === 'opencode';
  const isCodex = runtime === 'codex';
  const dirName = getDirName(runtime);

  // Clean install: remove existing destination to prevent orphaned files.
  // mkdirSync failure is FATAL — without destDir, every subsequent file write
  // would fail too. We throw instead of silent-swallowing.
  try {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    fs.mkdirSync(destDir, { recursive: true });
  } catch (err) {
    throw new Error(`copyWithPathReplacement: cannot prepare ${destDir}: ${err.message}`);
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyWithPathReplacement(srcPath, destPath, pathPrefix, runtime, isCommand);
    } else if (entry.name.endsWith('.md')) {
      try {
        // Replace ~/.claude/ and ./.claude/ with runtime-appropriate paths
        let content = fs.readFileSync(srcPath, 'utf8');
        const globalClaudeRegex = /~\/\.claude\//g;
        const localClaudeRegex = /\.\/\.claude\//g;
        content = content.replace(globalClaudeRegex, pathPrefix);
        content = content.replace(localClaudeRegex, `./${dirName}/`);
        content = processAttribution(content, getCommitAttribution(runtime));

        // Convert frontmatter for opencode compatibility
        if (isOpencode) {
          content = convertClaudeToOpencodeFrontmatter(content);
          fs.writeFileSync(destPath, content);
        } else if (runtime === 'gemini') {
          if (isCommand) {
            // Convert to TOML for Gemini (strip <sub> tags — terminals can't render subscript)
            content = stripSubTags(content);
            const tomlContent = convertClaudeToGeminiToml(content);
            // Replace extension with .toml
            const tomlPath = destPath.replace(/\.md$/, '.toml');
            fs.writeFileSync(tomlPath, tomlContent);
          } else {
            fs.writeFileSync(destPath, content);
          }
        } else if (isCodex) {
          content = convertClaudeToCodexMarkdown(content);
          fs.writeFileSync(destPath, content);
        } else if (runtime === 'copilot') {
          content = convertClaudeToCopilotMarkdown(content);
          fs.writeFileSync(destPath, content);
        } else {
          fs.writeFileSync(destPath, content);
        }
      } catch (err) {
        // Per-file write failure: collect warning. verifyInstall() at end of
        // install will catch the missing file and fail the install if it was
        // required. This stops the silent-failure surface that bit whoocache.
        pushInstallWarning('copyWithPathReplacement(md)', destPath, err);
      }
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        pushInstallWarning('copyWithPathReplacement(copy)', destPath, err);
      }
    }
  }
}

/**
 * Clean up orphaned files from previous PAN versions
 */
function cleanupOrphanedFiles(configDir) {
  const orphanedFiles = [
    'hooks/pan-notify.sh',  // Removed in v1.6.x
    'hooks/statusline.js',  // Renamed to pan-statusline.js in v1.9.0
  ];

  for (const relPath of orphanedFiles) {
    const fullPath = path.join(configDir, relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`  ${green}✓${reset} Removed orphaned ${relPath}`);
    }
  }
}

/**
 * Clean up orphaned hook registrations from settings.json
 */
function cleanupOrphanedHooks(settings) {
  const orphanedHookPatterns = [
    'pan-notify.sh',  // Removed in v1.6.x
    'hooks/statusline.js',  // Renamed to pan-statusline.js in v1.9.0
    'pan-intel-index.js',  // Removed in v1.9.2
    'pan-intel-session.js',  // Removed in v1.9.2
    'pan-intel-prune.js',  // Removed in v1.9.2
  ];

  let cleanedHooks = false;

  // Check all hook event types (Stop, SessionStart, etc.)
  if (settings.hooks) {
    for (const eventType of Object.keys(settings.hooks)) {
      const hookEntries = settings.hooks[eventType];
      if (Array.isArray(hookEntries)) {
        // Filter out entries that contain orphaned hooks
        const filtered = hookEntries.filter(entry => {
          if (entry.hooks && Array.isArray(entry.hooks)) {
            // Check if any hook in this entry matches orphaned patterns
            const hasOrphaned = entry.hooks.some(h =>
              h.command && orphanedHookPatterns.some(pattern => h.command.includes(pattern))
            );
            if (hasOrphaned) {
              cleanedHooks = true;
              return false;  // Remove this entry
            }
          }
          return true;  // Keep this entry
        });
        settings.hooks[eventType] = filtered;
      }
    }
  }

  if (cleanedHooks) {
    console.log(`  ${green}✓${reset} Removed orphaned hook registrations`);
  }

  // Fix #330: Update statusLine if it points to old statusline.js path
  if (settings.statusLine && settings.statusLine.command &&
      settings.statusLine.command.includes('statusline.js') &&
      !settings.statusLine.command.includes('pan-statusline.js')) {
    // Replace old path with new path
    settings.statusLine.command = settings.statusLine.command.replace(
      /statusline\.js/,
      'pan-statusline.js'
    );
    console.log(`  ${green}✓${reset} Updated statusline path (statusline.js → pan-statusline.js)`);
  }

  return settings;
}

/**
 * Uninstall PAN from the specified directory for a specific runtime
 * Removes only PAN-specific files/directories, preserves user content
 * @param {boolean} isGlobal - Whether to uninstall from global or local
 * @param {string} runtime - Target runtime ('claude', 'opencode', 'gemini', 'codex')
 */
function uninstall(isGlobal, runtime = 'claude') {
  const isOpencode = runtime === 'opencode';
  const isCodex = runtime === 'codex';
  const isCopilot = runtime === 'copilot';
  const dirName = getDirName(runtime);

  // Get the target directory based on runtime and install type
  const targetDir = isGlobal
    ? getGlobalDir(runtime, explicitConfigDir)
    : path.join(process.cwd(), dirName);

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  let runtimeLabel = 'Claude Code';
  if (runtime === 'opencode') runtimeLabel = 'OpenCode';
  if (runtime === 'gemini') runtimeLabel = 'Gemini';
  if (runtime === 'codex') runtimeLabel = 'Codex';
  if (runtime === 'copilot') runtimeLabel = 'GitHub Copilot CLI';

  // Guard: never uninstall from the PAN source repository itself
  if (normPath(path.resolve(process.cwd())) === normPath(PAN_SOURCE_ROOT)) {
    console.error(`\n  ${red}✗${reset} Refusing to uninstall from PAN's own source repository.`);
    console.error(`  Run from your target project directory instead.\n`);
    process.exit(1);
  }

  console.log(`  Uninstalling PAN from ${cyan}${runtimeLabel}${reset} at ${cyan}${locationLabel}${reset}\n`);

  // Check if target directory exists
  if (!fs.existsSync(targetDir)) {
    console.log(`  ${yellow}⚠${reset} Directory does not exist: ${locationLabel}`);
    console.log(`  Nothing to uninstall.\n`);
    return;
  }

  let removedCount = 0;

  // ADR-0028 Phase 2 ref-counting: another runtime still tracking the shared
  // .agents tree (manifest keys reaching outside its config dir) keeps the
  // tree alive when this runtime uninstalls.
  function otherRuntimeTrackingShared(currentRuntime) {
    const others = ['claude', 'codex', 'gemini', 'opencode', 'copilot']
      .filter(r => r !== currentRuntime);
    for (const rt of others) {
      const dir = isGlobal
        ? getGlobalDir(rt, null)
        : path.join(process.cwd(), getDirName(rt));
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
        if (Object.keys(m.files || {}).some(k => k.startsWith('../'))) return rt;
      } catch { /* no manifest for that runtime */ }
    }
    return null;
  }

  // 1. Remove PAN commands/skills
  if (isOpencode) {
    // OpenCode: remove commands/pan-*.md files (plus legacy singular command/
    // left by pre-plural installs).
    for (const dirName of ['commands', 'command']) {
      const commandDir = path.join(targetDir, dirName);
      if (fs.existsSync(commandDir)) {
        const files = fs.readdirSync(commandDir);
        let removedHere = 0;
        for (const file of files) {
          if (file.startsWith('pan-') && file.endsWith('.md')) {
            try { fs.unlinkSync(path.join(commandDir, file)); } catch {}
            removedCount++;
            removedHere++;
          }
        }
        if (removedHere > 0) {
          console.log(`  ${green}✓${reset} Removed PAN commands from ${dirName}/`);
        }
      }
    }
  } else if (isCodex || isCopilot) {
    // Codex & Copilot CLI: remove skills/pan-*/SKILL.md skill directories from
    // the runtime-local locations. The shared .agents/skills tree (Codex's
    // primary surface, plus any --unified-skills install) is handled by the
    // ref-counted sweep below.
    const skillDirs = [path.join(targetDir, 'skills')];
    let skillCount = 0;
    for (const skillsDir of skillDirs) {
      if (!fs.existsSync(skillsDir)) continue;
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('pan-')) {
          try { fs.rmSync(path.join(skillsDir, entry.name), { recursive: true }); } catch {}
          skillCount++;
        }
      }
    }
    if (skillCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${skillCount} ${isCopilot ? 'Copilot CLI' : 'Codex'} skills`);
    }
  } else {
    // Claude Code & Gemini: remove commands/pan/ directory
    const panCommandsDir = path.join(targetDir, 'commands', 'pan');
    if (fs.existsSync(panCommandsDir)) {
      try { fs.rmSync(panCommandsDir, { recursive: true }); } catch {}
      removedCount++;
      console.log(`  ${green}✓${reset} Removed commands/pan/`);
    }

    // Claude-only: remove skills/pan-*.md shim files (registered at install time)
    if (runtime === 'claude') {
      const skillsDir = path.join(targetDir, 'skills');
      if (fs.existsSync(skillsDir)) {
        let skillCount = 0;
        for (const file of fs.readdirSync(skillsDir)) {
          if (file.startsWith('pan-') && file.endsWith('.md')) {
            try { fs.unlinkSync(path.join(skillsDir, file)); } catch {}
            skillCount++;
          }
        }
        if (skillCount > 0) {
          removedCount++;
          console.log(`  ${green}✓${reset} Removed ${skillCount} PAN skill shims`);
        }
        // Remove the skills/ dir only if it's now empty (user may have non-PAN skills)
        try {
          if (fs.readdirSync(skillsDir).length === 0) fs.rmdirSync(skillsDir);
        } catch {}
      }
    }
  }

  // ADR-0028 unified tree: sweep the shared .agents tree when this runtime
  // tracks it (manifest ../ keys; Codex always uses it) AND no other runtime
  // still does (Phase 2 ref-counting). The last tracker also removes the
  // shared core and prunes empty .agents directories.
  {
    let manifestHasShared = false;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(targetDir, MANIFEST_NAME), 'utf8'));
      manifestHasShared = Object.keys(m.files || {}).some(k => k.startsWith('../'));
    } catch { /* no manifest — nothing tracked out-of-tree */ }

    if (isCodex || manifestHasShared) {
      const stillTracking = otherRuntimeTrackingShared(runtime);
      if (stillTracking) {
        console.log(`  ${dim}ℹ Shared .agents/skills left in place — still tracked by ${stillTracking}${reset}`);
      } else {
        const sharedDir = getCodexSkillsRoot(isGlobal);
        let sharedCount = 0;
        try {
          for (const entry of fs.readdirSync(sharedDir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith('pan-')) {
              try { fs.rmSync(path.join(sharedDir, entry.name), { recursive: true }); } catch {}
              sharedCount++;
            }
          }
        } catch { /* shared tree absent */ }
        if (sharedCount > 0) {
          removedCount++;
          console.log(`  ${green}✓${reset} Removed ${sharedCount} unified skills from .agents/skills/`);
        }
        // Shared core ships only with --unified-skills installs; remove it
        // alongside the last tracked skills sweep.
        const agentsRoot = path.dirname(sharedDir);
        const sharedCore = path.join(agentsRoot, 'pan-wizard-core');
        if (fs.existsSync(sharedCore)) {
          try {
            fs.rmSync(sharedCore, { recursive: true });
            removedCount++;
            console.log(`  ${green}✓${reset} Removed shared pan-wizard-core from .agents/`);
          } catch { /* best-effort */ }
        }
        // Prune now-empty shared directories (never directories with foreign content)
        for (const dir of [sharedDir, agentsRoot]) {
          try {
            if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
          } catch { /* non-empty or absent — keep */ }
        }
      }
    }
  }

  // 2. Remove pan-wizard-core directory
  const panDir = path.join(targetDir, 'pan-wizard-core');
  if (fs.existsSync(panDir)) {
    try { fs.rmSync(panDir, { recursive: true }); } catch {}
    removedCount++;
    console.log(`  ${green}✓${reset} Removed pan-wizard-core/`);
  }

  // 3. Remove PAN agents (pan-*.md / pan-*.agent.md / pan-*.toml files only)
  const agentsDir = path.join(targetDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    let agentCount = 0;
    for (const file of files) {
      if (file.startsWith('pan-') && (file.endsWith('.md') || file.endsWith('.toml'))) {
        try { fs.unlinkSync(path.join(agentsDir, file)); } catch {}
        agentCount++;
      }
    }
    if (agentCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${agentCount} PAN agents`);
    }
  }

  // 4. Remove PAN hooks (scripts + Copilot CLI hooks config file)
  const hooksDir = path.join(targetDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const panHooks = ['pan-statusline.js', 'pan-check-update.js', 'pan-check-update.sh', 'pan-context-monitor.js', 'pan-cost-logger.js', 'pan-trace-logger.js', 'pan.json'];
    let hookCount = 0;
    for (const hook of panHooks) {
      const hookPath = path.join(hooksDir, hook);
      if (fs.existsSync(hookPath)) {
        try { fs.unlinkSync(hookPath); } catch {}
        hookCount++;
      }
    }
    if (hookCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${hookCount} PAN hooks`);
    }
  }

  // 4a. Remove native workflow scripts (Claude-only surface)
  const workflowsDir = path.join(targetDir, 'workflows');
  if (fs.existsSync(workflowsDir)) {
    let wfCount = 0;
    for (const file of fs.readdirSync(workflowsDir)) {
      if (file.startsWith('pan-') && file.endsWith('.js')) {
        try { fs.unlinkSync(path.join(workflowsDir, file)); } catch {}
        wfCount++;
      }
    }
    if (wfCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${wfCount} native workflows`);
    }
  }

  // 4b. Codex: strip PAN entries from the shared .codex/hooks.json (foreign
  // hook registrations are preserved; the file is deleted only when nothing
  // but PAN content remained).
  if (isCodex) {
    const hooksJsonPath = path.join(targetDir, 'hooks.json');
    try {
      const rawText = fs.readFileSync(hooksJsonPath, 'utf8');
      const before = JSON.stringify(JSON.parse(rawText));
      // removeCodexPanHooks mutates its argument — parse a fresh copy for it.
      const stripped = lib.removeCodexPanHooks(JSON.parse(rawText));
      if (stripped === null) {
        fs.unlinkSync(hooksJsonPath);
        removedCount++;
        console.log(`  ${green}✓${reset} Removed hooks.json (only PAN hooks remained)`);
      } else if (JSON.stringify(stripped) !== before) {
        fs.writeFileSync(hooksJsonPath, JSON.stringify(stripped, null, 2) + '\n');
        removedCount++;
        console.log(`  ${green}✓${reset} Removed PAN hooks from hooks.json`);
      }
    } catch { /* absent or unparseable — nothing to strip */ }
  }

  // 5. Remove PAN package.json (CommonJS mode marker)
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const content = fs.readFileSync(pkgJsonPath, 'utf8').trim();
      // Only remove if it's our minimal CommonJS marker (handle formatting variations)
      const normalized = content.replace(/\s+/g, '');
      if (normalized === '{"type":"commonjs"}') {
        fs.unlinkSync(pkgJsonPath);
        removedCount++;
        console.log(`  ${green}✓${reset} Removed PAN package.json`);
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  // 6a. Clean up Copilot CLI config.json
  if (isCopilot) {
    const configPath = path.join(targetDir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        let configModified = false;

        // Remove PAN statusline
        if (config.statusLine && config.statusLine.command &&
            config.statusLine.command.includes('pan-statusline')) {
          delete config.statusLine;
          configModified = true;
          console.log(`  ${green}✓${reset} Removed PAN statusline from config`);
        }

        // Remove PAN hooks from sessionStart
        if (config.hooks && config.hooks.sessionStart) {
          const before = config.hooks.sessionStart.length;
          config.hooks.sessionStart = config.hooks.sessionStart.filter(h =>
            !(h.command && h.command.includes('pan-check-update'))
          );
          if (config.hooks.sessionStart.length < before) {
            configModified = true;
            console.log(`  ${green}✓${reset} Removed PAN hooks from config`);
          }
          if (config.hooks.sessionStart.length === 0) {
            delete config.hooks.sessionStart;
          }
        }

        // Remove PAN hooks from postToolUse
        if (config.hooks && config.hooks.postToolUse) {
          const before = config.hooks.postToolUse.length;
          config.hooks.postToolUse = config.hooks.postToolUse.filter(h =>
            !(h.command && h.command.includes('pan-context-monitor'))
          );
          if (config.hooks.postToolUse.length < before) {
            configModified = true;
            console.log(`  ${green}✓${reset} Removed context monitor from config`);
          }
          if (config.hooks.postToolUse.length === 0) {
            delete config.hooks.postToolUse;
          }
        }

        if (config.hooks && Object.keys(config.hooks).length === 0) {
          delete config.hooks;
        }

        if (configModified) {
          if (Object.keys(config).length === 0) {
            fs.unlinkSync(configPath);
            console.log(`  ${green}✓${reset} Removed empty config.json`);
          } else {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
          }
          removedCount++;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    // Clean PAN statusline from the documented settings read paths:
    // settings.json (global ~/.copilot/) and copilot/settings.json (.github/).
    for (const { settingsPath, removableDir } of [
      { settingsPath: path.join(targetDir, 'settings.json'), removableDir: false },
      { settingsPath: path.join(targetDir, 'copilot', 'settings.json'), removableDir: true },
    ]) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.statusLine && settings.statusLine.command &&
            settings.statusLine.command.includes('pan-statusline')) {
          delete settings.statusLine;
          if (Object.keys(settings).length === 0) {
            fs.unlinkSync(settingsPath);
            if (removableDir) {
              // Only the nested .github/copilot/ dir PAN may have created —
              // never the user's ~/.copilot home.
              try { fs.rmdirSync(path.dirname(settingsPath)); } catch { /* non-empty — keep */ }
            }
          } else {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          }
          console.log(`  ${green}✓${reset} Removed PAN statusline from settings`);
          removedCount++;
        }
      } catch {
        // Missing file or parse error — nothing to clean
      }
    }
  }

  // 6b. Clean up settings.json (remove PAN hooks and statusline)
  const settingsPath = path.join(targetDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    let settings = readSettings(settingsPath);
    let settingsModified = false;

    // Remove PAN statusline if it references our hook
    if (settings.statusLine && settings.statusLine.command &&
        settings.statusLine.command.includes('pan-statusline')) {
      delete settings.statusLine;
      settingsModified = true;
      console.log(`  ${green}✓${reset} Removed PAN statusline from settings`);
    }

    // Remove PAN hooks from SessionStart
    if (settings.hooks && settings.hooks.SessionStart) {
      const before = settings.hooks.SessionStart.length;
      settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          // Filter out PAN hooks
          const hasPanHook = entry.hooks.some(h =>
            h.command && (h.command.includes('pan-check-update') || h.command.includes('pan-statusline'))
          );
          return !hasPanHook;
        }
        return true;
      });
      if (settings.hooks.SessionStart.length < before) {
        settingsModified = true;
        console.log(`  ${green}✓${reset} Removed PAN hooks from settings`);
      }
      // Clean up empty array
      if (settings.hooks.SessionStart.length === 0) {
        delete settings.hooks.SessionStart;
      }
    }

    // Remove PAN hooks from PostToolUse
    if (settings.hooks && settings.hooks.PostToolUse) {
      const before = settings.hooks.PostToolUse.length;
      settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          const hasPanHook = entry.hooks.some(h =>
            h.command && h.command.includes('pan-context-monitor')
          );
          return !hasPanHook;
        }
        return true;
      });
      if (settings.hooks.PostToolUse.length < before) {
        settingsModified = true;
        console.log(`  ${green}✓${reset} Removed context monitor hook from settings`);
      }
      if (settings.hooks.PostToolUse.length === 0) {
        delete settings.hooks.PostToolUse;
      }
    }

    // Remove PAN hooks from SubagentStop (cost logger v3.4+, trace logger v3.5+)
    if (settings.hooks && settings.hooks.SubagentStop) {
      const before = settings.hooks.SubagentStop.length;
      settings.hooks.SubagentStop = settings.hooks.SubagentStop.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          const hasPanHook = entry.hooks.some(h =>
            h.command && (h.command.includes('pan-cost-logger') || h.command.includes('pan-trace-logger'))
          );
          return !hasPanHook;
        }
        return true;
      });
      if (settings.hooks.SubagentStop.length < before) {
        settingsModified = true;
        console.log(`  ${green}✓${reset} Removed cost/trace logger hooks from settings`);
      }
      if (settings.hooks.SubagentStop.length === 0) {
        delete settings.hooks.SubagentStop;
      }
    }

    // Clean up empty hooks object
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    // Remove Gemini experimental.enableAgents if PAN set it
    if (settings.experimental && settings.experimental.enableAgents === true) {
      delete settings.experimental.enableAgents;
      if (Object.keys(settings.experimental).length === 0) {
        delete settings.experimental;
      }
      settingsModified = true;
      console.log(`  ${green}✓${reset} Removed experimental agents flag from settings`);
    }

    if (settingsModified) {
      // If settings is now empty (only PAN entries existed), remove the file
      if (Object.keys(settings).length === 0) {
        fs.unlinkSync(settingsPath);
        console.log(`  ${green}✓${reset} Removed empty settings.json`);
      } else {
        writeSettings(settingsPath, settings);
      }
      removedCount++;
    }
  }

  // 6. For OpenCode, clean up permissions from opencode.json
  if (isOpencode) {
    // For local uninstalls, clean up ./.opencode/opencode.json
    // For global uninstalls, clean up ~/.config/opencode/opencode.json
    const opencodeConfigDir = isGlobal
      ? getOpencodeGlobalDir()
      : path.join(process.cwd(), '.opencode');
    const configPath = path.join(opencodeConfigDir, 'opencode.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        let modified = false;

        // Remove PAN permission entries
        if (config.permission) {
          for (const permType of ['read', 'external_directory']) {
            if (config.permission[permType]) {
              const keys = Object.keys(config.permission[permType]);
              for (const key of keys) {
                if (key.includes('pan-wizard-core')) {
                  delete config.permission[permType][key];
                  modified = true;
                }
              }
              // Clean up empty objects
              if (Object.keys(config.permission[permType]).length === 0) {
                delete config.permission[permType];
              }
            }
          }
          if (Object.keys(config.permission).length === 0) {
            delete config.permission;
          }
        }

        if (modified) {
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
          removedCount++;
          console.log(`  ${green}✓${reset} Removed PAN permissions from opencode.json`);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
  }

  // 7. Remove pan-file-manifest.json
  const manifestPath = path.join(targetDir, MANIFEST_NAME);
  if (fs.existsSync(manifestPath)) {
    try { fs.unlinkSync(manifestPath); } catch {}
    removedCount++;
    console.log(`  ${green}✓${reset} Removed ${MANIFEST_NAME}`);
  }

  // 7b. AGENTS.md / CLAUDE.md rules layer (ADR-0028 Phase 3): strip the PAN
  // marker block when this was the last PAN runtime in the project (the
  // manifest scan runs AFTER this runtime's manifest was removed above, so
  // any hit means another runtime still needs the section). Local only.
  if (!isGlobal) {
    const anotherRuntimeInstalled = ['.claude', '.codex', '.gemini', '.opencode', '.github']
      .some(d => fs.existsSync(path.join(process.cwd(), d, MANIFEST_NAME)));
    if (!anotherRuntimeInstalled) {
      for (const fileName of ['AGENTS.md', 'CLAUDE.md']) {
        const filePath = path.join(process.cwd(), fileName);
        try {
          const existing = fs.readFileSync(filePath, 'utf8');
          const stripped = lib.removeAgentsMdSection(existing);
          if (stripped === existing) continue; // no PAN block — leave untouched
          if (stripped === null) {
            fs.unlinkSync(filePath);
            console.log(`  ${green}✓${reset} Removed ${fileName} (only the PAN section remained)`);
          } else {
            fs.writeFileSync(filePath, stripped);
            console.log(`  ${green}✓${reset} Removed PAN section from ${fileName}`);
          }
          removedCount++;
        } catch { /* file absent — nothing to strip */ }
      }
    }
  }

  // 8. Clean up empty PAN directories
  const dirsToClean = [
    path.join(targetDir, 'agents'),
    path.join(targetDir, 'hooks'),
    path.join(targetDir, 'skills'),
    path.join(targetDir, 'workflows'),
    path.join(targetDir, 'commands', 'pan'),
    path.join(targetDir, 'commands'),
    path.join(targetDir, 'command'), // legacy OpenCode singular dir
  ];
  for (const dir of dirsToClean) {
    try {
      if (fs.existsSync(dir)) {
        const remaining = fs.readdirSync(dir);
        if (remaining.length === 0) {
          fs.rmdirSync(dir);
        }
      }
    } catch {}
  }

  if (removedCount === 0) {
    console.log(`  ${yellow}⚠${reset} No PAN files found to remove.`);
  }

  console.log(`
  ${green}Done!${reset} PAN has been uninstalled from ${runtimeLabel}.
  Your other files and settings have been preserved.
`);
}


/**
 * Configure OpenCode permissions to allow reading PAN reference docs
 * This prevents permission prompts when PAN accesses the pan-wizard-core directory
 * @param {boolean} isGlobal - Whether this is a global or local install
 */
function configureOpencodePermissions(isGlobal = true) {
  // For local installs, use ./.opencode/opencode.json
  // For global installs, use ~/.config/opencode/opencode.json
  const opencodeConfigDir = isGlobal
    ? getOpencodeGlobalDir()
    : path.join(process.cwd(), '.opencode');
  const configPath = path.join(opencodeConfigDir, 'opencode.json');

  // Ensure config directory exists
  fs.mkdirSync(opencodeConfigDir, { recursive: true });

  // Read existing config or create empty object
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      config = parseJsonc(content);
    } catch (e) {
      // Cannot parse - DO NOT overwrite user's config
      console.log(`  ${yellow}⚠${reset} Could not parse opencode.json - skipping permission config`);
      console.log(`    ${dim}Reason: ${e.message}${reset}`);
      console.log(`    ${dim}Your config was NOT modified. Fix the syntax manually if needed.${reset}`);
      return;
    }
  }

  // Ensure permission structure exists
  if (!config.permission) {
    config.permission = {};
  }

  // Build the PAN path using the actual config directory
  // Use ~ shorthand if it's in the default location, otherwise use full path
  const defaultConfigDir = path.join(os.homedir(), '.config', 'opencode');
  const panPath = opencodeConfigDir === defaultConfigDir
    ? '~/.config/opencode/pan-wizard/*'
    : `${opencodeConfigDir.replace(/\\/g, '/')}/pan-wizard-core/*`;
  
  let modified = false;

  // Configure read permission
  if (!config.permission.read || typeof config.permission.read !== 'object') {
    config.permission.read = {};
  }
  if (config.permission.read[panPath] !== 'allow') {
    config.permission.read[panPath] = 'allow';
    modified = true;
  }

  // Configure external_directory permission (the safety guard for paths outside project)
  if (!config.permission.external_directory || typeof config.permission.external_directory !== 'object') {
    config.permission.external_directory = {};
  }
  if (config.permission.external_directory[panPath] !== 'allow') {
    config.permission.external_directory[panPath] = 'allow';
    modified = true;
  }

  if (!modified) {
    return; // Already configured
  }

  // Write config back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`  ${green}✓${reset} Configured read permission for PAN docs`);
  } catch (e) {
    console.error(`  ${yellow}⚠${reset} Failed to write config: ${e.message}`);
  }
}

/**
 * Verify a directory exists and contains files
 */
function verifyInstalled(dirPath, description) {
  if (!fs.existsSync(dirPath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory not created`);
    return false;
  }
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory is empty`);
      return false;
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: ${e.message}`);
    return false;
  }
  return true;
}

/**
 * Verify a file exists
 */
function verifyFileInstalled(filePath, description) {
  if (!fs.existsSync(filePath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: file not created`);
    return false;
  }
  return true;
}

/**
 * Install to the specified directory for a specific runtime
 * @param {boolean} isGlobal - Whether to install globally or locally
 * @param {string} runtime - Target runtime ('claude', 'opencode', 'gemini', 'codex')
 */

// ──────────────────────────────────────────────────────
// Local Patch Persistence
// ──────────────────────────────────────────────────────

const PATCHES_DIR_NAME = 'pan-local-patches';
const MANIFEST_NAME = 'pan-file-manifest.json';

/**
 * Compute SHA256 hash of file contents
 */
function fileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

/**
 * Recursively collect all files in dir with their hashes
 */
function generateManifest(dir, baseDir) {
  if (!baseDir) baseDir = dir;
  const manifest = {};
  if (!fs.existsSync(dir)) return manifest;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(manifest, generateManifest(fullPath, baseDir));
    } else {
      manifest[relPath] = fileHash(fullPath);
    }
  }
  return manifest;
}

/**
 * Write file manifest after installation for future modification detection
 */
function writeManifest(configDir, runtime = 'claude', isGlobal = false) {
  const isOpencode = runtime === 'opencode';
  const isCodex = runtime === 'codex';
  const isCopilot = runtime === 'copilot';
  const panDir = path.join(configDir, 'pan-wizard-core');
  const commandsDir = path.join(configDir, 'commands', 'pan');
  const opencodeCommandDir = path.join(configDir, 'commands');
  // Codex skills (and every runtime under --unified-skills, ADR-0028) live in
  // the shared .agents/skills tree (outside configDir); Copilot otherwise uses
  // configDir/skills. Out-of-tree manifest keys are stored relative to
  // configDir (e.g. "../.agents/skills/...") so existing
  // path.join(configDir, key) consumers resolve them.
  const skillsShared = isCodex || unifiedSkills;
  const codexSkillsDir = skillsShared ? getCodexSkillsRoot(isGlobal) : path.join(configDir, 'skills');
  const codexSkillsPrefix = skillsShared
    ? path.relative(configDir, codexSkillsDir).replace(/\\/g, '/')
    : 'skills';
  const agentsDir = path.join(configDir, 'agents');
  const manifest = { version: pkg.version, timestamp: new Date().toISOString(), files: {} };

  const panHashes = generateManifest(panDir);
  for (const [rel, hash] of Object.entries(panHashes)) {
    manifest.files['pan-wizard-core/' + rel] = hash;
  }
  if (!isOpencode && !isCodex && !unifiedSkills && fs.existsSync(commandsDir)) {
    const cmdHashes = generateManifest(commandsDir);
    for (const [rel, hash] of Object.entries(cmdHashes)) {
      manifest.files['commands/pan/' + rel] = hash;
    }
  }
  if (isOpencode && !unifiedSkills && fs.existsSync(opencodeCommandDir)) {
    for (const file of fs.readdirSync(opencodeCommandDir)) {
      if (file.startsWith('pan-') && file.endsWith('.md')) {
        manifest.files['commands/' + file] = fileHash(path.join(opencodeCommandDir, file));
      }
    }
  }
  if ((isCodex || isCopilot || unifiedSkills) && fs.existsSync(codexSkillsDir)) {
    for (const skillName of listCodexSkillNames(codexSkillsDir)) {
      const skillRoot = path.join(codexSkillsDir, skillName);
      const skillHashes = generateManifest(skillRoot);
      for (const [rel, hash] of Object.entries(skillHashes)) {
        manifest.files[`${codexSkillsPrefix}/${skillName}/${rel}`] = hash;
      }
    }
  }
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.startsWith('pan-') && (file.endsWith('.md') || file.endsWith('.toml'))) {
        manifest.files['agents/' + file] = fileHash(path.join(agentsDir, file));
      }
    }
  }
  // Track hook scripts in manifest for modification detection during upgrades
  const hooksDir = path.join(configDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    for (const file of fs.readdirSync(hooksDir)) {
      if (file.startsWith('pan-') && file.endsWith('.js')) {
        manifest.files['hooks/' + file] = fileHash(path.join(hooksDir, file));
      }
    }
  }
  // Track native workflow scripts (Claude-only surface)
  const workflowsDir = path.join(configDir, 'workflows');
  if (fs.existsSync(workflowsDir)) {
    for (const file of fs.readdirSync(workflowsDir)) {
      if (file.startsWith('pan-') && file.endsWith('.js')) {
        manifest.files['workflows/' + file] = fileHash(path.join(workflowsDir, file));
      }
    }
  }

  try {
    fs.writeFileSync(path.join(configDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
  } catch (e) {
    console.error(`  ${yellow}⚠${reset} Failed to write manifest: ${e.message}`);
  }
  return manifest;
}

/**
 * Detect user-modified PAN files by comparing against install manifest.
 * Backs up modified files to pan-local-patches/ for reapply after update.
 */
function saveLocalPatches(configDir) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return []; }

  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const modified = [];

  for (const [relPath, originalHash] of Object.entries(manifest.files || {})) {
    // Keys reaching outside configDir (Codex skills in ../.agents/skills/)
    // can't be backed up under patchesDir — path.join would collapse the
    // `..` and write outside the patches tree. Skip them; they're still
    // overwritten cleanly on reinstall.
    if (relPath.split('/').includes('..')) continue;
    const fullPath = path.join(configDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const currentHash = fileHash(fullPath);
    if (currentHash !== originalHash) {
      const backupPath = path.join(patchesDir, relPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
      modified.push(relPath);
    }
  }

  if (modified.length > 0) {
    const meta = {
      backed_up_at: new Date().toISOString(),
      from_version: manifest.version,
      files: modified
    };
    fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify(meta, null, 2));
    console.log('  ' + yellow + 'i' + reset + '  Found ' + modified.length + ' locally modified PAN file(s) — backed up to ' + PATCHES_DIR_NAME + '/');
    for (const f of modified) {
      console.log('     ' + dim + f + reset);
    }
  }
  return modified;
}

/**
 * After install, report backed-up patches for user to reapply.
 */
function reportLocalPatches(configDir, runtime = 'claude') {
  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const metaPath = path.join(patchesDir, 'backup-meta.json');
  if (!fs.existsSync(metaPath)) return [];

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return []; }

  if (meta.files && meta.files.length > 0) {
    const reapplyCommand = runtime === 'opencode'
      ? '/pan-patches'
      : runtime === 'codex'
        ? '$pan-patches'
        : '/pan:patches';
    console.log('');
    console.log('  ' + yellow + 'Local patches detected' + reset + ' (from v' + meta.from_version + '):');
    for (const f of meta.files) {
      console.log('     ' + cyan + f + reset);
    }
    console.log('');
    console.log('  Your modifications are saved in ' + cyan + PATCHES_DIR_NAME + '/' + reset);
    console.log('  Run ' + cyan + reapplyCommand + reset + ' to merge them into the new version.');
    console.log('  Or manually compare and merge the files.');
    console.log('');
  }
  return meta.files || [];
}

function install(isGlobal, runtime = 'claude') {
  const isOpencode = runtime === 'opencode';
  const isGemini = runtime === 'gemini';
  const isCodex = runtime === 'codex';
  const isCopilot = runtime === 'copilot';
  const dirName = getDirName(runtime);
  const src = path.join(__dirname, '..');

  // Get the target directory based on runtime and install type
  const targetDir = isGlobal
    ? getGlobalDir(runtime, explicitConfigDir)
    : path.join(process.cwd(), dirName);

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  // Path prefix for file references in markdown content
  // For global installs: use full path
  // For local installs: use relative
  const pathPrefix = isGlobal
    ? `${targetDir.replace(/\\/g, '/')}/`
    : `./${dirName}/`;

  let runtimeLabel = 'Claude Code';
  if (isOpencode) runtimeLabel = 'OpenCode';
  if (isGemini) runtimeLabel = 'Gemini';
  if (isCodex) runtimeLabel = 'Codex';
  if (isCopilot) runtimeLabel = 'GitHub Copilot CLI';

  // Guard: never install into the PAN source repository itself
  if (normPath(path.resolve(process.cwd())) === normPath(PAN_SOURCE_ROOT)) {
    console.error(`\n  ${red}✗${reset} Refusing to install PAN into its own source repository.`);
    console.error(`  Run the installer from your target project directory instead.\n`);
    console.error(`  Example: cd /path/to/my-project && node ${path.resolve(__dirname, 'install.js')} --claude --local\n`);
    process.exit(1);
  }

  console.log(`  Installing for ${cyan}${runtimeLabel}${reset} to ${cyan}${locationLabel}${reset}\n`);

  // Early writability check — fail fast before any file operations
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const probe = path.join(targetDir, '.pan-write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (e) {
    console.error(`  ${red}✗${reset} Cannot write to ${locationLabel}: ${e.message}`);
    console.error(`  Check directory permissions and try again.`);
    process.exit(1);
  }

  // Track installation failures
  const failures = [];

  // Save any locally modified PAN files before they get wiped
  saveLocalPatches(targetDir);

  // Clean up orphaned files from previous versions
  cleanupOrphanedFiles(targetDir);

  // OpenCode uses commands/ (flat), Codex uses skills/, Claude/Gemini use commands/pan/
  try {
    if (unifiedSkills) {
      // ADR-0028 Phase 1: every runtime consumes one runtime-neutral
      // .agents/skills/ tree; the proprietary command surface is swept so
      // commands don't resolve twice.
      const skillsDir = getCodexSkillsRoot(isGlobal);
      const agentsRoot = path.dirname(skillsDir);
      const corePrefix = isGlobal
        ? `${agentsRoot.replace(/\\/g, '/')}/`
        : './.agents/';

      // ADR-0028 Phase 2: shared runtime-neutral core. Skills resolve
      // pan-tools against this copy regardless of which runtime installed
      // last; the per-runtime core remains for agents/hooks.
      const sharedCoreDest = path.join(agentsRoot, 'pan-wizard-core');
      copySharedCore(path.join(src, 'pan-wizard-core'), sharedCoreDest, corePrefix, pathPrefix, runtime);
      try { fs.writeFileSync(path.join(sharedCoreDest, 'VERSION'), pkg.version); } catch { /* non-fatal */ }

      // Canonical agent-definition reference copies (ADR-0028 agent-ref
      // canonicalization): shared content references these instead of the
      // runtime's agents dir, whose files carry runtime-specific formats.
      // These are reading material for agents, not runtime registrations —
      // the per-runtime installed agents still drive subagent spawning.
      try {
        const agentsRefDir = path.join(sharedCoreDest, 'agents');
        fs.mkdirSync(agentsRefDir, { recursive: true });
        const agentsSrc = path.join(src, 'agents');
        for (const f of fs.readdirSync(agentsSrc).filter(n => n.endsWith('.md'))) {
          let content = fs.readFileSync(path.join(agentsSrc, f), 'utf8');
          content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
          content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
          content = convertSlashCommandsToCopilotSkillMentions(content);
          fs.writeFileSync(path.join(agentsRefDir, f), content);
        }
      } catch (e) {
        pushInstallWarning('unifiedAgentRefs', 'pan-wizard-core/agents', e);
      }
      console.log(`  ${green}✓${reset} Installed shared pan-wizard-core to ${isGlobal ? '~/.agents/' : '.agents/'}`);

      const panSrc = path.join(src, 'commands', 'pan');
      copyCommandsAsUnifiedSkills(panSrc, skillsDir, 'pan', pathPrefix, corePrefix, runtime);
      sweepProprietaryCommandSurfaces(targetDir, runtime);

      const installedSkillNames = listCodexSkillNames(skillsDir);
      if (installedSkillNames.length > 0) {
        const label = isGlobal ? '~/.agents/skills/' : '.agents/skills/';
        console.log(`  ${green}✓${reset} Installed ${installedSkillNames.length} unified skills to ${label} (ADR-0028)`);
      } else {
        failures.push('.agents/skills/pan-* (unified)');
      }
    } else if (isOpencode) {
      // OpenCode: flat structure in commands/ directory. Plural since
      // OpenCode 2026 releases — singular command/ is back-compat only.
      const commandDir = path.join(targetDir, 'commands');
      fs.mkdirSync(commandDir, { recursive: true });

      // Copy commands/pan/*.md as commands/pan-*.md (flatten structure)
      const panSrc = path.join(src, 'commands', 'pan');
      copyFlattenedCommands(panSrc, commandDir, 'pan', pathPrefix, runtime);

      // Upgrade path: remove PAN files left in the legacy singular command/
      // directory by older installs so commands don't resolve twice.
      const legacyCommandDir = path.join(targetDir, 'command');
      if (fs.existsSync(legacyCommandDir)) {
        for (const file of fs.readdirSync(legacyCommandDir)) {
          if (file.startsWith('pan-') && file.endsWith('.md')) {
            try { fs.unlinkSync(path.join(legacyCommandDir, file)); } catch {}
          }
        }
      }

      if (verifyInstalled(commandDir, 'commands/pan-*')) {
        const count = fs.readdirSync(commandDir).filter(f => f.startsWith('pan-')).length;
        console.log(`  ${green}✓${reset} Installed ${count} commands to commands/`);
      } else {
        failures.push('commands/pan-*');
      }
    } else if (isCodex) {
      // Codex reads skills from the shared .agents/skills tree (repo or user
      // scope) — $CODEX_HOME/skills is no longer a read location (2026-06).
      const skillsDir = getCodexSkillsRoot(isGlobal);
      const panSrc = path.join(src, 'commands', 'pan');
      copyCommandsAsCodexSkills(panSrc, skillsDir, 'pan', pathPrefix, runtime);

      // Upgrade path: remove pan-* skills left in the legacy .codex/skills/
      // location by older installs (dead directory for current Codex).
      const legacySkillsDir = path.join(targetDir, 'skills');
      if (fs.existsSync(legacySkillsDir)) {
        for (const entry of fs.readdirSync(legacySkillsDir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith('pan-')) {
            try { fs.rmSync(path.join(legacySkillsDir, entry.name), { recursive: true }); } catch {}
          }
        }
      }

      const installedSkillNames = listCodexSkillNames(skillsDir);
      if (installedSkillNames.length > 0) {
        const label = isGlobal ? '~/.agents/skills/' : '.agents/skills/';
        console.log(`  ${green}✓${reset} Installed ${installedSkillNames.length} skills to ${label}`);
      } else {
        failures.push('.agents/skills/pan-*');
      }
    } else if (isCopilot) {
      const skillsDir = path.join(targetDir, 'skills');
      const panSrc = path.join(src, 'commands', 'pan');
      copyCommandsAsCopilotSkills(panSrc, skillsDir, 'pan', pathPrefix, runtime);
      const installedSkills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('pan-'));
      if (installedSkills.length > 0) {
        console.log(`  ${green}✓${reset} Installed ${installedSkills.length} skills to skills/`);
      } else {
        failures.push('skills/pan-*');
      }
    } else {
      // Claude Code & Gemini: nested structure in commands/ directory
      const commandsDir = path.join(targetDir, 'commands');
      fs.mkdirSync(commandsDir, { recursive: true });

      const panSrc = path.join(src, 'commands', 'pan');
      const panDest = path.join(commandsDir, 'pan');
      copyWithPathReplacement(panSrc, panDest, pathPrefix, runtime, true);
      if (verifyInstalled(panDest, 'commands/pan')) {
        console.log(`  ${green}✓${reset} Installed commands/pan`);
      } else {
        failures.push('commands/pan');
      }

      // E-5: Claude native skill shims — register each PAN command as a skill
      // so Claude Code's native skill discovery surfaces them. Gemini doesn't
      // use the skills/ directory, so only generate for Claude.
      if (runtime === 'claude') {
        try {
          const skillsDir = path.join(targetDir, 'skills');
          fs.mkdirSync(skillsDir, { recursive: true });
          let shimCount = 0;
          for (const file of fs.readdirSync(panDest)) {
            if (!file.endsWith('.md')) continue;
            const commandName = file.slice(0, -3);
            const commandBody = fs.readFileSync(path.join(panDest, file), 'utf-8');
            const description = lib.extractFrontmatterField(commandBody, 'description')
              || `PAN command: ${commandName}`;
            const shim = buildClaudeSkillShim({ commandName, description });
            fs.writeFileSync(path.join(skillsDir, `pan-${commandName}.md`), shim, 'utf-8');
            shimCount += 1;
          }
          if (shimCount > 0) {
            console.log(`  ${green}✓${reset} Registered ${shimCount} commands as skills/pan-*.md`);
          }
        } catch (e) {
          console.error(`  ${yellow}⚠${reset} Skill shim registration skipped: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} Commands install failed: ${e.message}`);
    failures.push('commands');
  }

  // Copy pan-wizard-core skill with path replacement
  try {
    const skillSrc = path.join(src, 'pan-wizard-core');
    const skillDest = path.join(targetDir, 'pan-wizard-core');
    copyWithPathReplacement(skillSrc, skillDest, pathPrefix, runtime);

    // v3.7.0+ self-improvement loop two-tier delivery:
    // learnings/universal/ ships to all 5 runtimes (consumed by user-project workflows).
    // learnings/internal/ stays source-only — strip it from the installed copy.
    // Spec: docs/specs/self_improvement_loop_featureai.md §3.6
    const internalLearningsDir = path.join(skillDest, 'learnings', 'internal');
    if (fs.existsSync(internalLearningsDir)) {
      try {
        fs.rmSync(internalLearningsDir, { recursive: true, force: true });
      } catch (err) {
        // Surface it: a failed strip would ship source-only internal learnings.
        if (err.code !== 'ENOENT') pushInstallWarning('stripInternalLearnings', 'learnings/internal', err);
      }
    }

    if (verifyInstalled(skillDest, 'pan-wizard-core')) {
      console.log(`  ${green}✓${reset} Installed pan-wizard-core`);
    } else {
      failures.push('pan-wizard-core');
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} pan-wizard-core install failed: ${e.message}`);
    failures.push('pan-wizard-core');
  }

  // Copy agents to agents directory
  try {
    const agentsSrc = path.join(src, 'agents');
    if (fs.existsSync(agentsSrc)) {
      const agentsDest = path.join(targetDir, 'agents');
      fs.mkdirSync(agentsDest, { recursive: true });

      // Remove old PAN agents (pan-*.md, pan-*.agent.md, pan-*.toml) before copying new ones
      if (fs.existsSync(agentsDest)) {
        for (const file of fs.readdirSync(agentsDest)) {
          if (file.startsWith('pan-') && (file.endsWith('.md') || file.endsWith('.toml'))) {
            fs.unlinkSync(path.join(agentsDest, file));
          }
        }
      }

      // Copy new agents
      const agentEntries = fs.readdirSync(agentsSrc, { withFileTypes: true });
      for (const entry of agentEntries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          let content = fs.readFileSync(path.join(agentsSrc, entry.name), 'utf8');
          // Always replace ~/.claude/ as it is the source of truth in the repo
          const dirRegex = /~\/\.claude\//g;
          content = content.replace(dirRegex, pathPrefix);
          content = processAttribution(content, getCommitAttribution(runtime));
          // Codex custom agents are standalone TOML files (2026-06 format);
          // markdown in .codex/agents/ is not recognized. Handle before
          // stripThinkingFrontmatter so `effort:` survives to be mapped to
          // Codex's native model_reasoning_effort field.
          if (isCodex) {
            const toml = convertClaudeAgentToCodexToml(stripSubTags(content));
            if (toml) {
              const tomlName = entry.name.replace(/\.md$/, '.toml');
              fs.writeFileSync(path.join(agentsDest, tomlName), toml);
            }
            continue;
          }
          // E-3 (per-runtime): strip unsupported thinking frontmatter and inject
          // prose preamble for runtimes without native extended thinking.
          content = stripThinkingFrontmatter(content, runtime);
          // Convert frontmatter for runtime compatibility
          if (isOpencode) {
            content = convertClaudeToOpencodeFrontmatter(content);
          } else if (isGemini) {
            content = convertClaudeToGeminiAgent(content);
          } else if (isCopilot) {
            content = convertClaudeToCopilotAgent(content);
          }
          // Copilot CLI uses .agent.md extension; others use .md
          const destName = isCopilot
            ? entry.name.replace(/\.md$/, '.agent.md')
            : entry.name;
          fs.writeFileSync(path.join(agentsDest, destName), content);
        }
      }
      if (verifyInstalled(agentsDest, 'agents')) {
        console.log(`  ${green}✓${reset} Installed agents`);
      } else {
        failures.push('agents');
      }
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} Agents install failed: ${e.message}`);
    failures.push('agents');
  }

  // Copy CHANGELOG.md
  try {
    const changelogSrc = path.join(src, 'CHANGELOG.md');
    const changelogDest = path.join(targetDir, 'pan-wizard-core', 'CHANGELOG.md');
    if (fs.existsSync(changelogSrc)) {
      fs.copyFileSync(changelogSrc, changelogDest);
      if (verifyFileInstalled(changelogDest, 'CHANGELOG.md')) {
        console.log(`  ${green}✓${reset} Installed CHANGELOG.md`);
      } else {
        failures.push('CHANGELOG.md');
      }
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} CHANGELOG install failed: ${e.message}`);
    failures.push('CHANGELOG.md');
  }

  // Write VERSION file (with upgrade/same/downgrade detection)
  try {
    const versionDest = path.join(targetDir, 'pan-wizard-core', 'VERSION');
    let versionMsg = `${pkg.version}`;
    try {
      const prev = fs.readFileSync(versionDest, 'utf8').trim();
      if (prev && prev !== pkg.version) {
        versionMsg = `${prev} → ${pkg.version}`;
      } else if (prev === pkg.version) {
        versionMsg = `${pkg.version} (reinstall)`;
      }
    } catch (_) { /* first install */ }
    fs.writeFileSync(versionDest, pkg.version + '\n');
    if (verifyFileInstalled(versionDest, 'VERSION')) {
      console.log(`  ${green}✓${reset} Wrote VERSION (${versionMsg})`);
    } else {
      failures.push('VERSION');
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} VERSION write failed: ${e.message}`);
    failures.push('VERSION');
  }

  if (!isCodex) {
    // Write package.json to force CommonJS mode for PAN scripts
    // Prevents "require is not defined" errors when project has "type": "module"
    // Node.js walks up looking for package.json - this stops inheritance from project
    try {
      const pkgJsonDest = path.join(targetDir, 'package.json');
      fs.writeFileSync(pkgJsonDest, '{"type":"commonjs"}\n');
      console.log(`  ${green}✓${reset} Wrote package.json (CommonJS mode)`);
    } catch (e) {
      console.error(`  ${yellow}✗${reset} package.json write failed: ${e.message}`);
      failures.push('package.json');
    }
  }

  if (!isOpencode) {
    // Copy hooks from dist/ (bundled with dependencies)
    // Hooks are supported by Claude Code, Gemini, Copilot CLI, and (since
    // 2026-06) Codex via .codex/hooks.json. OpenCode has no hook support.
    // Template paths for the target runtime (replaces '.claude' with correct config dir)
    try {
      const hooksSrc = path.join(src, 'hooks', 'dist');
      if (fs.existsSync(hooksSrc)) {
        const hooksDest = path.join(targetDir, 'hooks');
        fs.mkdirSync(hooksDest, { recursive: true });
        const hookEntries = fs.readdirSync(hooksSrc);
        const configDirReplacement = getConfigDirFromHome(runtime, isGlobal);
        for (const entry of hookEntries) {
          const srcFile = path.join(hooksSrc, entry);
          if (fs.statSync(srcFile).isFile()) {
            const destFile = path.join(hooksDest, entry);
            // Template .js files to replace '.claude' with runtime-specific config dir
            if (entry.endsWith('.js')) {
              let content = fs.readFileSync(srcFile, 'utf8');
              content = content.replace(/'\.claude'/g, configDirReplacement);
              fs.writeFileSync(destFile, content);
            } else {
              fs.copyFileSync(srcFile, destFile);
            }
          }
        }
        if (verifyInstalled(hooksDest, 'hooks')) {
          console.log(`  ${green}✓${reset} Installed hooks (bundled)`);
        } else {
          failures.push('hooks');
        }
      }
    } catch (e) {
      console.error(`  ${yellow}✗${reset} Hooks install failed: ${e.message}`);
      failures.push('hooks');
    }
  }

  // Native Claude Code workflows (2026-06): deterministic orchestration
  // scripts for PAN's fan-out-shaped protocols. Claude-only — no other
  // runtime has an equivalent discovery surface.
  if (runtime === 'claude') {
    try {
      const workflowsDir = path.join(targetDir, 'workflows');
      fs.mkdirSync(workflowsDir, { recursive: true });
      const scripts = lib.buildNativeWorkflowScripts();
      for (const { name, content } of scripts) {
        fs.writeFileSync(path.join(workflowsDir, name), content);
      }
      console.log(`  ${green}✓${reset} Installed ${scripts.length} native workflows to workflows/`);
    } catch (e) {
      pushInstallWarning('nativeWorkflows', 'workflows/pan-*', e);
    }
  }

  if (failures.length > 0) {
    console.error(`\n  ${yellow}Installation incomplete!${reset} Failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  // Write file manifest for future modification detection
  const manifest = writeManifest(targetDir, runtime, isGlobal);
  console.log(`  ${green}✓${reset} Wrote file manifest (${MANIFEST_NAME})`);

  // AGENTS.md universal rules layer (ADR-0028 Phase 3): contribute one
  // marker-fenced PAN section to the project's AGENTS.md (read natively by
  // every PAN runtime), and bridge CLAUDE.md to it via @AGENTS.md for the
  // Claude runtime. Project-scoped — local installs only; user content
  // outside the markers is never touched.
  if (!isGlobal) {
    try {
      const agentsMdPath = path.join(process.cwd(), 'AGENTS.md');
      let agentsExisting = null;
      try { agentsExisting = fs.readFileSync(agentsMdPath, 'utf8'); } catch { /* absent */ }
      fs.writeFileSync(agentsMdPath, lib.upsertAgentsMdSection(agentsExisting, lib.buildAgentsMdSection()));
      console.log(`  ${green}✓${reset} ${agentsExisting === null ? 'Created' : 'Updated'} AGENTS.md (PAN section)`);

      if (runtime === 'claude') {
        const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
        let claudeExisting = null;
        try { claudeExisting = fs.readFileSync(claudeMdPath, 'utf8'); } catch { /* absent */ }
        const bridged = lib.ensureClaudeMdImport(claudeExisting);
        if (bridged !== claudeExisting) {
          fs.writeFileSync(claudeMdPath, bridged);
          console.log(`  ${green}✓${reset} Bridged CLAUDE.md to AGENTS.md (@AGENTS.md import)`);
        }
      }
    } catch (e) {
      pushInstallWarning('agentsMd', 'AGENTS.md', e);
    }
  }

  // Report any backed-up local patches
  reportLocalPatches(targetDir, runtime);

  // Post-install verification: walk every manifest entry, assert file present.
  // Catches silent copy/write failures from earlier stages (IMPROVEMENT-TODO P0).
  // Missing files = exit 1; warnings = log but continue.
  const verifyResult = lib.verifyInstall(targetDir, manifest);
  if (verifyResult.warnings.length > 0) {
    console.error(`\n  ${yellow}⚠ Install verification warnings:${reset}`);
    for (const w of verifyResult.warnings) console.error(`    - ${w}`);
  }
  if (!verifyResult.ok) {
    const emptyFiles = verifyResult.empty || [];
    const problems = [
      ...verifyResult.missing.map(m => `${m} (missing)`),
      ...emptyFiles.map(e => `${e} (empty — copy failed)`),
    ];
    console.error(`\n  ${red}✖ Install verification FAILED — ${verifyResult.missing.length} missing, ${emptyFiles.length} empty:${reset}`);
    // Limit output to first 20 to avoid screen-flooding
    const sample = problems.slice(0, 20);
    for (const m of sample) console.error(`    - ${m}`);
    if (problems.length > sample.length) {
      console.error(`    ... and ${problems.length - sample.length} more`);
    }
    console.error(`\n  Run ${cyan}pan-tools validate deployment${reset} for full diagnostics, then re-run the installer.\n`);
    process.exit(1);
  }
  console.log(`  ${green}✓${reset} Verified ${Object.keys(manifest.files || {}).length} installed files`);

  // Surface non-fatal install warnings collected during copy/write phases.
  // verifyInstall above already exited 1 on missing required files; warnings
  // here are for partial failures that didn't ultimately leave gaps.
  if (INSTALL_WARNINGS.length > 0) {
    console.error(`\n  ${yellow}⚠ ${INSTALL_WARNINGS.length} non-fatal install warning(s):${reset}`);
    for (const w of INSTALL_WARNINGS.slice(0, 10)) {
      console.error(`    [${w.stage}] ${w.file}: ${w.error}`);
    }
    if (INSTALL_WARNINGS.length > 10) {
      console.error(`    ... and ${INSTALL_WARNINGS.length - 10} more`);
    }
  }

  const updateCheckCommand = isGlobal
    ? buildHookCommand(targetDir, 'pan-check-update.js')
    : 'node ' + dirName + '/hooks/pan-check-update.js';
  const contextMonitorCommand = isGlobal
    ? buildHookCommand(targetDir, 'pan-context-monitor.js')
    : 'node ' + dirName + '/hooks/pan-context-monitor.js';
  const statuslineCommand = isGlobal
    ? buildHookCommand(targetDir, 'pan-statusline.js')
    : 'node ' + dirName + '/hooks/pan-statusline.js';
  const costLoggerCommand = isGlobal
    ? buildHookCommand(targetDir, 'pan-cost-logger.js')
    : 'node ' + dirName + '/hooks/pan-cost-logger.js';
  const traceLoggerCommand = isGlobal
    ? buildHookCommand(targetDir, 'pan-trace-logger.js')
    : 'node ' + dirName + '/hooks/pan-trace-logger.js';

  if (isCodex) {
    // Codex hooks (2026-06): Claude-compatible PascalCase events in the shared
    // .codex/hooks.json — merge PAN entries non-destructively (foreign hooks
    // preserved, reinstall idempotent). Project-scoped hooks load once the
    // project is trusted; codexTrustNotice() already covers that.
    try {
      const hooksJsonPath = path.join(targetDir, 'hooks.json');
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')); } catch { /* absent or invalid — start fresh */ }
      const merged = lib.mergeCodexHooksConfig(existing, {
        updateCheckCommand, contextMonitorCommand, costLoggerCommand, traceLoggerCommand,
      });
      fs.writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + '\n');
      console.log(`  ${green}✓${reset} Configured hooks (.codex/hooks.json: update check, context monitor, cost + trace loggers)`);
    } catch (e) {
      pushInstallWarning('codexHooks', 'hooks.json', e);
    }
    return { settingsPath: null, settings: null, statuslineCommand: null, runtime };
  }

  // Copilot CLI reads hook config from .github/hooks/*.json (version:1 schema),
  // NOT from config.json. Write a dedicated PAN hooks file and migrate away
  // from any legacy config.json registration.
  if (isCopilot) {
    const hooksConfigPath = path.join(targetDir, 'hooks', 'pan.json');
    const hooksConfig = buildCopilotHooksConfig({ updateCheckCommand, contextMonitorCommand, costLoggerCommand, traceLoggerCommand });
    try {
      fs.mkdirSync(path.dirname(hooksConfigPath), { recursive: true });
      fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2) + '\n');
      console.log(`  ${green}✓${reset} Configured hooks (.github/hooks/pan.json: update check, context monitor, cost + trace loggers)`);
    } catch (e) {
      console.error(`  ${yellow}✗${reset} Failed to write Copilot hooks config: ${e.message}`);
    }

    // Upgrade cleanup: strip PAN hook + statusline registrations left in
    // config.json by pre-2026-06 installs. Copilot CLI never read them there —
    // user-editable settings live in settings.json (~/.copilot/ global,
    // .github/copilot/ repo-level); config.json is internal CLI state.
    const configPath = path.join(targetDir, 'config.json');
    const config = readSettings(configPath);
    let legacyModified = false;
    if (config.hooks) {
      for (const evt of ['sessionStart', 'postToolUse']) {
        if (Array.isArray(config.hooks[evt])) {
          config.hooks[evt] = config.hooks[evt].filter(h =>
            !(h.command && (h.command.includes('pan-check-update') || h.command.includes('pan-context-monitor')))
          );
          if (config.hooks[evt].length === 0) delete config.hooks[evt];
        }
      }
      if (Object.keys(config.hooks).length === 0) delete config.hooks;
      legacyModified = true;
    }
    if (config.statusLine && config.statusLine.command &&
        config.statusLine.command.includes('pan-statusline')) {
      delete config.statusLine;
      legacyModified = true;
    }
    if (legacyModified) {
      writeSettings(configPath, config);
    }

    // Documented Copilot CLI settings read paths: ~/.copilot/settings.json
    // (global) or .github/copilot/settings.json (repo-level, committed).
    const copilotSettingsPath = isGlobal
      ? path.join(targetDir, 'settings.json')
      : path.join(targetDir, 'copilot', 'settings.json');
    const copilotSettings = readSettings(copilotSettingsPath);

    return { settingsPath: copilotSettingsPath, settings: copilotSettings, statuslineCommand, runtime };
  }

  // Configure statusline and hooks in settings.json
  // Claude Code, Gemini, OpenCode use settings.json
  const settingsPath = path.join(targetDir, 'settings.json');
  const settings = cleanupOrphanedHooks(readSettings(settingsPath));

  // Enable experimental agents for Gemini CLI (required for custom sub-agents)
  if (isGemini) {
    if (!settings.experimental) {
      settings.experimental = {};
    }
    if (!settings.experimental.enableAgents) {
      settings.experimental.enableAgents = true;
      console.log(`  ${green}✓${reset} Enabled experimental agents`);
    }
  }

  // Configure SessionStart hook for update checking (skip for opencode)
  if (!isOpencode) {
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = [];
    }

    const hasPanUpdateHook = settings.hooks.SessionStart.some(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('pan-check-update'))
    );

    if (!hasPanUpdateHook) {
      settings.hooks.SessionStart.push({
        hooks: [
          {
            type: 'command',
            command: updateCheckCommand
          }
        ]
      });
      console.log(`  ${green}✓${reset} Configured update check hook`);
    }

    // Configure PostToolUse hook for context window monitoring
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }

    const hasContextMonitorHook = settings.hooks.PostToolUse.some(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('pan-context-monitor'))
    );

    if (!hasContextMonitorHook) {
      settings.hooks.PostToolUse.push({
        hooks: [
          {
            type: 'command',
            command: contextMonitorCommand
          }
        ]
      });
      console.log(`  ${green}✓${reset} Configured context window monitor hook`);
    }

    // v3.4+: SubagentStop hook for automatic cost logging.
    // Gemini + OpenCode may not implement SubagentStop; we still register
    // the entry — hosts that don't fire the event simply never trigger it.
    if (!settings.hooks.SubagentStop) {
      settings.hooks.SubagentStop = [];
    }
    const hasCostLoggerHook = settings.hooks.SubagentStop.some(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('pan-cost-logger'))
    );
    if (!hasCostLoggerHook) {
      settings.hooks.SubagentStop.push({
        hooks: [
          {
            type: 'command',
            command: costLoggerCommand
          }
        ]
      });
      console.log(`  ${green}✓${reset} Configured cost logger hook`);
    }

    // v3.5+: SubagentStop hook for circular optimization tracing.
    // Logs agent completion events to the active trace session (if one is running).
    const hasTraceLoggerHook = settings.hooks.SubagentStop.some(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('pan-trace-logger'))
    );
    if (!hasTraceLoggerHook) {
      settings.hooks.SubagentStop.push({
        hooks: [
          {
            type: 'command',
            command: traceLoggerCommand
          }
        ]
      });
      console.log(`  ${green}✓${reset} Configured trace logger hook`);
    }
  }

  return { settingsPath, settings, statuslineCommand, runtime };
}

/**
 * Apply statusline config, then print completion message
 */
function finishInstall(settingsPath, settings, statuslineCommand, shouldInstallStatusline, runtime = 'claude', isGlobal = true) {
  const isOpencode = runtime === 'opencode';
  const isCodex = runtime === 'codex';
  const isCopilot = runtime === 'copilot';

  if (shouldInstallStatusline && !isOpencode && !isCodex) {
    // Same schema everywhere — Copilot CLI also uses {type: "command", command}
    // in settings.json (statusline is experimental there as of 2026-05).
    settings.statusLine = {
      type: 'command',
      command: statuslineCommand
    };
    console.log(`  ${green}✓${reset} Configured statusline`);
    if (isCopilot) {
      console.log(`  ${dim}ℹ Copilot CLI statusline is experimental — if it doesn't render, start with 'copilot --experimental'${reset}`);
    }
  }

  // Write settings/config when runtime supports it. For Copilot, skip the
  // write when there is nothing to persist (avoids creating an empty
  // .github/copilot/settings.json).
  if (!isCodex && !(isCopilot && Object.keys(settings).length === 0)) {
    if (isCopilot) {
      try { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); } catch { /* surfaced by writeSettings */ }
    }
    writeSettings(settingsPath, settings);
  }

  // Configure OpenCode permissions
  if (isOpencode) {
    configureOpencodePermissions(isGlobal);
  }

  // E-9: Opus 4.7 capability detection — warn if user's default model lacks
  // features Spec A relies on (1M ctx, extended thinking, prompt caching).
  if (!args.includes('--skip-warnings')) {
    try {
      const settingsPath = path.join(targetDir, 'settings.json');
      const settingsRaw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsRaw);
      const modelField = settings && settings.model;
      if (typeof modelField === 'string' && modelField.trim()) {
        const caps = detectModelCapabilities(modelField);
        if (!caps.has_1m_ctx || !caps.has_thinking) {
          const missing = [
            !caps.has_1m_ctx ? '1M context (E-2 map-codebase single-shot)' : null,
            !caps.has_thinking ? 'extended thinking (E-3, E-10, E-11)' : null,
          ].filter(Boolean).join(', ');
          console.log(`
  ${yellow}ℹ${reset} PAN's multi-agent workflows are tuned for frontier reasoning models. Default model "${modelField}" lacks: ${missing}.
     Features degrade gracefully, but for best results select claude-fable-5 (PAN's recommended flagship — deepest
     long-horizon reasoning for the bot army) or claude-opus-4-8 (same 1M context at half the cost).`);
        }
      }
    } catch {
      // No settings.json, no model field, or JSON parse error — skip silently.
    }
  }

  // Gemini CLI → Antigravity transition (2026-06): informational, non-blocking.
  if (runtime === 'gemini' && !args.includes('--skip-warnings')) {
    console.log(`\n  ${yellow}ℹ${reset} ${geminiTransitionNotice().split('\n').join('\n     ')}`);
  }

  // Codex project-trust gate (2026-06): project-scoped .codex/ config only
  // loads once the project is trusted. Local installs only — personal
  // ~/.codex/ config is not gated.
  if (runtime === 'codex' && !isGlobal && !args.includes('--skip-warnings')) {
    console.log(`\n  ${yellow}ℹ${reset} ${codexTrustNotice().split('\n').join('\n     ')}`);
  }

  let program = 'Claude Code';
  if (runtime === 'opencode') program = 'OpenCode';
  if (runtime === 'gemini') program = 'Gemini';
  if (runtime === 'codex') program = 'Codex';
  if (runtime === 'copilot') program = 'GitHub Copilot CLI';

  let command = '/pan:new-project';
  if (runtime === 'opencode') command = '/pan-new-project';
  if (runtime === 'codex') command = '$pan-new-project';
  if (runtime === 'copilot') command = '/pan-new-project';
  console.log(`
  ${green}Done!${reset} Open a blank directory in ${program} and run ${cyan}${command}${reset}.

  ${cyan}Join the community:${reset} https://discord.gg/pan-wizard
`);
}

/**
 * Handle statusline configuration with optional prompt
 */
function handleStatusline(settings, isInteractive, callback) {
  const hasExisting = settings.statusLine != null;

  if (!hasExisting) {
    callback(true);
    return;
  }

  if (forceStatusline) {
    callback(true);
    return;
  }

  if (!isInteractive) {
    console.log(`  ${yellow}⚠${reset} Skipping statusline (already configured)`);
    console.log(`    Use ${cyan}--force-statusline${reset} to replace\n`);
    callback(false);
    return;
  }

  const existingCmd = settings.statusLine.command || settings.statusLine.url || '(custom)';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`
  ${yellow}⚠${reset} Existing statusline detected\n
  Your current statusline:
    ${dim}command: ${existingCmd}${reset}

  PAN includes a statusline showing:
    • Model name
    • Current task (from todo list)
    • Context window usage (color-coded)

  ${cyan}1${reset}) Keep existing
  ${cyan}2${reset}) Replace with PAN statusline
`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    rl.close();
    const choice = answer.trim() || '1';
    callback(choice === '2');
  });
}

/**
 * Prompt for runtime selection
 */
function promptRuntime(callback) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      console.log(`\n  ${yellow}Installation cancelled${reset}\n`);
      process.exit(0);
    }
  });

  console.log(`  ${yellow}Which runtime(s) would you like to install for?${reset}\n\n  ${cyan}1${reset}) Claude Code  ${dim}(~/.claude)${reset}
  ${cyan}2${reset}) OpenCode     ${dim}(~/.config/opencode)${reset} - open source, free models
  ${cyan}3${reset}) Gemini       ${dim}(~/.gemini)${reset}
  ${cyan}4${reset}) Codex        ${dim}(~/.codex)${reset}
  ${cyan}5${reset}) Copilot CLI  ${dim}(~/.copilot)${reset} - GitHub's terminal agent
  ${cyan}6${reset}) All
`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    answered = true;
    rl.close();
    const choice = answer.trim() || '1';
    if (choice === '6') {
      callback(['claude', 'opencode', 'gemini', 'codex', 'copilot']);
    } else if (choice === '5') {
      callback(['copilot']);
    } else if (choice === '4') {
      callback(['codex']);
    } else if (choice === '3') {
      callback(['gemini']);
    } else if (choice === '2') {
      callback(['opencode']);
    } else {
      callback(['claude']);
    }
  });
}

/**
 * Install PAN for all selected runtimes
 */
function installAllRuntimes(runtimes, isGlobal, isInteractive) {
  const results = [];

  for (const runtime of runtimes) {
    const result = install(isGlobal, runtime);
    results.push(result);
  }

  const statuslineRuntimes = ['claude', 'gemini', 'copilot'];
  const primaryStatuslineResult = results.find(r => statuslineRuntimes.includes(r.runtime));

  const finalize = (shouldInstallStatusline) => {
    for (const result of results) {
      const useStatusline = statuslineRuntimes.includes(result.runtime) && shouldInstallStatusline;
      finishInstall(
        result.settingsPath,
        result.settings,
        result.statuslineCommand,
        useStatusline,
        result.runtime,
        isGlobal
      );
    }
  };

  if (primaryStatuslineResult) {
    handleStatusline(primaryStatuslineResult.settings, isInteractive, finalize);
  } else {
    finalize(false);
  }
}

// Main logic
if (hasGlobal && hasLocal) {
  console.error(`  ${yellow}Cannot specify both --global and --local${reset}`);
  process.exit(1);
} else if (explicitConfigDir && hasLocal) {
  console.error(`  ${yellow}Cannot use --config-dir with --local${reset}`);
  process.exit(1);
} else if (hasUninstall) {
  if (!hasGlobal && !hasLocal) {
    console.error(`  ${yellow}--uninstall requires --global or --local${reset}`);
    process.exit(1);
  }
  const runtimes = selectedRuntimes.length > 0 ? selectedRuntimes : ['claude'];
  for (const runtime of runtimes) {
    uninstall(hasGlobal, runtime);
  }
} else if (selectedRuntimes.length > 0) {
  if (!hasGlobal && !hasLocal) {
    // Default: project-level install. Use --global to install for all projects.
    console.log(`  ${dim}Defaulting to project-level install (use --global for user-level).${reset}\n`);
    installAllRuntimes(selectedRuntimes, false, false);
  } else {
    installAllRuntimes(selectedRuntimes, hasGlobal, false);
  }
} else if (hasGlobal || hasLocal) {
  // Default to Claude if no runtime specified but location is
  installAllRuntimes(['claude'], hasGlobal, false);
} else {
  // Interactive
  if (!process.stdin.isTTY) {
    console.log(`  ${yellow}Non-interactive terminal detected, defaulting to Claude Code project-level install${reset}\n`);
    installAllRuntimes(['claude'], false, false);
  } else {
    promptRuntime((runtimes) => {
      // Default: project-level install. Pass --global on CLI for user-level.
      console.log(`  ${dim}Defaulting to project-level install (use --global for user-level).${reset}\n`);
      installAllRuntimes(runtimes, false, true);
    });
  }
}
