'use strict';

/** True when n is an even integer, negative numbers included. */
function isEven(n) {
  return Math.abs(n) % 2 === 0;
}

module.exports = { isEven };
