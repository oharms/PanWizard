'use strict';

/** The arithmetic mean of a non-empty list of numbers. */
function mean(xs) {
  if (xs.length === 0) throw new Error('mean of an empty list');
  return xs.reduce((a, b) => a + b, 0);
}

module.exports = { mean };
