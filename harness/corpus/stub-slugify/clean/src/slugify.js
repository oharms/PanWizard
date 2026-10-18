'use strict';

/** "Hello, World!" -> "hello-world": lowercase, each run of non-alphanumerics one hyphen, none at either end. */
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
