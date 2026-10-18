'use strict';

/** "1m 5s" -> 65000. */
function parseDuration(text) {
  const m = /^(\d+)m (\d+)s$/.exec(String(text).trim());
  if (!m) throw new Error(`not a duration: ${text}`);
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

module.exports = { parseDuration };
