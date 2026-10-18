'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call fn until it resolves, at most `attempts` times, waiting delayMs * i between tries. */
async function retry(fn, attempts = 3, delayMs = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts) await sleep(delayMs * i);
    }
  }
  throw last;
}

module.exports = { retry };
