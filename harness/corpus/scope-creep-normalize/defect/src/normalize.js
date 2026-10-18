'use strict';

/** Collapse runs of whitespace to one space; with { trim: true } also trim the ends. */
function normalize(s, opts = {}) {
  let out = String(s).replace(/\s+/g, ' ').toLowerCase();
  if (opts.trim) out = out.trim();
  return out;
}

module.exports = { normalize };
