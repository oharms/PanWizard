'use strict';

// Unit prices by SKU, in rand.
const PRICES = Object.freeze({
  APPLE: 4.5,
  BREAD: 18,
  MILK: 22.99,
});

function priceOf(sku) {
  if (!Object.prototype.hasOwnProperty.call(PRICES, sku)) throw new Error(`unknown SKU: ${sku}`);
  return PRICES[sku];
}

module.exports = { priceOf, PRICES };
