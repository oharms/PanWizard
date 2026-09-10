'use strict';

/** Is `name` runnable from PATH? Windows shims end in .cmd/.exe/.bat. Pure over the env passed in. */
const fs = require('fs');
const path = require('path');

function findCli(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}

module.exports = { findCli };
