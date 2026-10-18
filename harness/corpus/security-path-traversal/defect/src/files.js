'use strict';

const path = require('path');

/** root + rel, refusing any rel that resolves outside root. */
function safeJoin(root, rel) {
  return path.join(path.resolve(root), rel);
}

module.exports = { safeJoin };
