'use strict';

/** The items on a 1-based page of the given size. */
function paginate(items, page, size) {
  return items.slice(page * size, (page + 1) * size);
}

module.exports = { paginate };
