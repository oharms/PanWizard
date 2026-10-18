'use strict';

/** True when lo <= n <= hi (both ends included). */
function inRange(n, lo, hi) {
  return n >= lo && n <= hi;
}

/** n limited to [lo, hi]. */
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** True for a list with no items. */
function isEmpty(xs) {
  if (xs.length === 0) return true;
  return false;
}

module.exports = { inRange, clamp, isEmpty };
