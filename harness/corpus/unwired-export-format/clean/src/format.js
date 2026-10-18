'use strict';

/** 65000 -> "1m 5s". */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

module.exports = { formatDuration };
