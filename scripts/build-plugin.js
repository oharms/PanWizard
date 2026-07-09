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
 * publishing is gated on one live verification — whether ${CLAUDE_PLUGIN_ROOT}
 * expands inside command markdown content (documented for hook/MCP configs
 * only). Until then, content references core paths relative to the plugin
 * root, which matches the documented plugin working layout.
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
