'use strict';

/** Parse a JSON config; throws on invalid JSON or a non-numeric port. */
function readConfig(text) {
  const cfg = JSON.parse(text);
  if (typeof cfg.port !== 'number') throw new Error('config: port must be a number');
  return cfg;
}

module.exports = { readConfig };
