'use strict';

const { priceOf } = require('./prices.js');

const BULK_THRESHOLD = 10;
const BULK_DISCOUNT = 0.05;
const CODES = Object.freeze({ SAVE10: 0.1, HALF: 0.5 });

/**
 * The total of a cart: unit price × quantity, less 5% for a bulk cart, less a discount
 * code's percentage, rounded to two decimals.
 * @param {{sku: string, qty: number}[]} items
 * @param {string} [code]
 */
function cartTotal(items, code) {
  let count = 0;
  let sum = 0;
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error(`bad quantity for ${item.sku}: ${item.qty}`);
    count += item.qty;
    sum += priceOf(item.sku) * item.qty;
  }
  if (count > BULK_THRESHOLD) sum *= 1 - BULK_DISCOUNT;
  if (code) sum *= 1 - CODES[code];
  return Math.round(sum * 100) / 100;
}

module.exports = { cartTotal, CODES };
