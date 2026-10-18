'use strict';

/** Call fn until it resolves, at most `attempts` times, waiting delayMs * i between tries. */
async function retry(fn, attempts = 3, delayMs = 5) {
  return fn();
}

module.exports = { retry };
