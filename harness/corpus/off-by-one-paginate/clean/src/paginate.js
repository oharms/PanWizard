'use strict';

/** The items on a 1-based page of the given size. */
function paginate(items, page, size) {
  return items.slice((page - 1) * size, page * size);
}

module.exports = { paginate };
