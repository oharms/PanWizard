/**
 * Build the PAN Wizard Claude Code plugin (ecosystem review item: plugin
 * distribution, first slice). Emits a self-contained plugin directory at
 * dist/pan-wizard-plugin/ following the verified plugin layout:
 *
 *   .claude-plugin/plugin.json    manifest (metadata; components auto-discover)
 *   commands/pan/*.md             command markdown (Claude flavor)
 *   agents/pan-*.md               agent definitions
 *   hooks/hooks.json              PAN hooks with ${CLAUDE_PLUGIN_ROOT} paths
 *   hooks/pan-*.js                hook scripts
 *   pan-wizard-core/              dispatcher + modules + workflows + templates
 *
 * Distribution status: built ALONGSIDE the loose-file installer. Marketplace
 * publishing WAS gated on one live verification — whether ${CLAUDE_PLUGIN_ROOT}
 * expands inside command markdown content (documented for hook/MCP configs
 * only).
 *
 * ANSWERED 2026-08-14, Claude Code 2.1.233 on Windows, by installing this plugin
 * from the `command`-source marketplace in `marketplace/` and running
 * `/pan-plugin-selftest`: **it does expand.** The command body reached the model
 * with a real absolute path — no placeholder text survived — and invoking
 * pan-tools through that path worked. So the CONTENT_PREFIX rewrite below is
 * correct as it stands, and the gate is lifted.
 *
 * One measurement from the same run that constrains how far to take this: the
 * `CLAUDE_PLUGIN_ROOT` environment variable is NOT exported into the Bash tool's
 * environment (it read as empty). Textual substitution and shell expansion are
 * therefore NOT interchangeable — generated content must keep using the
 * substituted form, because `$CLAUDE_PLUGIN_ROOT` evaluated by a shell at runtime
 * expands to nothing. Re-measure before relying on the shell form anywhere.
 *
 * Usage: node scripts/build-plugin.js  (or npm run build:plugin)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'pan-wizard-plugin');
const pkg = require(path.join(ROOT, 'package.json'));
const lib = require(path.join(ROOT, 'bin', 'install-lib.cjs'));

// Plugin-relative prefix used inside markdown content. Hook/MCP configs get
// the documented ${CLAUDE_PLUGIN_ROOT} form via buildPluginHooksConfig().
const CONTENT_PREFIX = '${CLAUDE_PLUGIN_ROOT}/';

function rewriteContent(content) {
  return content
    .replace(/~\/\.claude\/pan-wizard-core\//g, `${CONTENT_PREFIX}pan-wizard-core/`)
    .replace(/\.\/\.claude\/pan-wizard-core\//g, `${CONTENT_PREFIX}pan-wizard-core/`)
    .replace(/~\/\.claude\/agents\//g, `${CONTENT_PREFIX}agents/`)
    .replace(/\.\/\.claude\/agents\//g, `${CONTENT_PREFIX}agents/`)
    .replace(/~\/\.claude\//g, CONTENT_PREFIX)
    .replace(/\.\/\.claude\//g, CONTENT_PREFIX);
}

function copyTree(srcDir, destDir, transformMd) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, transformMd);
    } else if (transformMd && entry.name.endsWith('.md')) {
      fs.writeFileSync(destPath, transformMd(fs.readFileSync(srcPath, 'utf8')));
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  // Clean output
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, '.claude-plugin'), { recursive: true });

  // 1. Manifest
  fs.writeFileSync(
    path.join(OUT, '.claude-plugin', 'plugin.json'),
    JSON.stringify(lib.buildPluginManifest(pkg), null, 2) + '\n'
  );

  // 2. Commands (Claude flavor, plugin-root-relative paths)
  copyTree(path.join(ROOT, 'commands', 'pan'), path.join(OUT, 'commands', 'pan'), rewriteContent);

  // 3. Agents
  copyTree(path.join(ROOT, 'agents'), path.join(OUT, 'agents'), rewriteContent);

  // 4. Hooks: config + scripts
  fs.mkdirSync(path.join(OUT, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'hooks', 'hooks.json'),
    JSON.stringify(lib.buildPluginHooksConfig(), null, 2) + '\n'
  );
  const hooksDist = path.join(ROOT, 'hooks', 'dist');
  if (fs.existsSync(hooksDist)) {
    for (const f of fs.readdirSync(hooksDist).filter(n => n.endsWith('.js'))) {
      fs.copyFileSync(path.join(hooksDist, f), path.join(OUT, 'hooks', f));
    }
  }

  // 2b. Plugin-only self-test command. NOT copied from commands/pan/ — it is
  // generated here so the shipped command set stays unchanged and no ordinary
  // install gains a diagnostic. It answers the one question gating publication:
  // whether CONTENT_PREFIX expands inside command markdown. The placeholder must
  // reach the plugin UNEXPANDED or the probe measures nothing, so this write
  // deliberately bypasses rewriteContent().
  fs.writeFileSync(
    path.join(OUT, 'commands', 'pan-plugin-selftest.md'),
    lib.buildPluginSelfTestCommand(CONTENT_PREFIX.replace(/\/$/, ''))
  );

  // 4b. MCP registration. The server itself rides along inside pan-wizard-core
  // (step 5 copies it wholesale), but shipping it is not the same as declaring
  // it — without this file the plugin carried the bridge and never registered it.
  fs.writeFileSync(
    path.join(OUT, '.mcp.json'),
    JSON.stringify(lib.buildPluginMcpConfig(), null, 2) + '\n'
  );

  // 5. Core (strip source-only internal learnings, same policy as the installer)
  copyTree(path.join(ROOT, 'pan-wizard-core'), path.join(OUT, 'pan-wizard-core'), rewriteContent);
  fs.rmSync(path.join(OUT, 'pan-wizard-core', 'learnings', 'internal'), { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, 'pan-wizard-core', 'VERSION'), pkg.version);

  // Sanity report
  const count = (p) => { try { return fs.readdirSync(p).length; } catch { return 0; } };
  console.log('PAN plugin built at', path.relative(ROOT, OUT));
  console.log('  commands/pan:', count(path.join(OUT, 'commands', 'pan')));
  console.log('  agents:', count(path.join(OUT, 'agents')));
  console.log('  hooks:', count(path.join(OUT, 'hooks')));
  console.log('  version:', pkg.version);
}

main();
