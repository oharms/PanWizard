'use strict';

const path = require('path');

/** root + rel, refusing any rel that resolves outside root. */
function safeJoin(root, rel) {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('path escapes root');
  return full;
}

module.exports = { safeJoin };
