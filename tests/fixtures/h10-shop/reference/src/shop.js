'use strict';
// Reference implementation of seed brief-shop's BRIEF.md (H10 project-definition pair).
const fs = require('fs');

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isQty = (n) => Number.isInteger(n) && n > 0;
const money = (cents) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

function createShop(file) {
  let db = { nextOrderId: 1, products: {}, orders: [], shipments: [] };
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  const product = (sku) => {
    const p = db.products[sku];
    if (!p) throw new Error(`unknown SKU ${sku}`);
    return p;
  };
  const order = (id) => {
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new Error(`unknown order ${id}`);
    return o;
  };
  const view = (p) => ({ sku: p.sku, name: p.name, priceCents: p.priceCents, stock: p.stock, reserved: p.reserved, available: p.stock - p.reserved });
  const orderView = (o) => ({ id: o.id, status: o.status, totalCents: o.totalCents });
  const isLow = (p) => p.stock - p.reserved <= p.threshold;
  const skus = () => Object.keys(db.products).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    addProduct({ sku, name, priceCents, stock, lowStockThreshold = 0 }) {
      if (typeof sku !== 'string' || !sku) throw new Error('sku is required');
      if (db.products[sku]) throw new Error(`duplicate SKU ${sku}`);
      if (!isCount(priceCents)) throw new Error('priceCents must be integer cents');
      if (!isCount(stock)) throw new Error('stock must be a whole number');
      if (!isCount(lowStockThreshold)) throw new Error('lowStockThreshold must be a whole number');
      db.products[sku] = { sku, name, priceCents, stock, reserved: 0, threshold: lowStockThreshold };
      save();
      return view(db.products[sku]);
    },
    restock(sku, qty) {
      const p = product(sku);
      if (!isQty(qty)) throw new Error('qty must be a positive whole number');
      p.stock += qty;
      save();
      return view(p);
    },
    getProduct(sku) { return view(product(sku)); },
    placeOrder(lines, date) {
      if (!Array.isArray(lines) || !lines.length) throw new Error('an order needs lines');
      const want = {};
      for (const { sku, qty } of lines) {
        product(sku);
        if (!isQty(qty)) throw new Error('qty must be a positive whole number');
        want[sku] = (want[sku] || 0) + qty;
      }
      for (const [sku, qty] of Object.entries(want)) {
        const p = db.products[sku];
        if (qty > p.stock - p.reserved) throw new Error(`not enough ${sku}: ${p.stock - p.reserved} available`);
      }
      for (const [sku, qty] of Object.entries(want)) db.products[sku].reserved += qty;
      const o = {
        id: db.nextOrderId++, status: 'open', date,
        lines: lines.map(({ sku, qty }) => ({ sku, qty, shipped: 0, priceCents: db.products[sku].priceCents })),
      };
      o.totalCents = o.lines.reduce((s, l) => s + l.qty * l.priceCents, 0);
      db.orders.push(o);
      save();
      return orderView(o);
    },
    fulfil(id, sku, qty, date) {
      const o = order(id);
      if (o.status === 'cancelled' || o.status === 'fulfilled') throw new Error(`order ${id} is ${o.status}`);
      if (!isQty(qty)) throw new Error('qty must be a positive whole number');
      const need = o.lines.filter((l) => l.sku === sku).reduce((s, l) => s + l.qty - l.shipped, 0);
      if (qty > need) throw new Error(`order ${id} needs ${need} of ${sku}`);
      let left = qty;
      for (const l of o.lines) {
        if (l.sku !== sku || !left) continue;
        const n = Math.min(left, l.qty - l.shipped);
        l.shipped += n; left -= n;
      }
      const p = product(sku);
      p.stock -= qty; p.reserved -= qty;
      db.shipments.push({ orderId: id, sku, qty, date, priceCents: p.priceCents });
      o.status = o.lines.every((l) => l.shipped === l.qty) ? 'fulfilled' : 'partial';
      save();
      return orderView(o);
    },
    cancel(id) {
      const o = order(id);
      if (o.status === 'cancelled' || o.status === 'fulfilled') throw new Error(`order ${id} is ${o.status}`);
      for (const l of o.lines) db.products[l.sku].reserved -= l.qty - l.shipped;
      o.status = 'cancelled';
      save();
      return orderView(o);
    },
    getOrder(id) { return orderView(order(id)); },
    lowStock() {
      return skus().map((s) => db.products[s]).filter(isLow).map((p) => ({ sku: p.sku, available: p.stock - p.reserved }));
    },
    dailyReport(date) {
      const out = [`Report ${date}`];
      let total = 0;
      for (const s of skus()) {
        const p = db.products[s];
        const day = db.shipments.filter((x) => x.sku === s && x.date === date);
        const units = day.reduce((n, x) => n + x.qty, 0);
        const revenue = day.reduce((n, x) => n + x.qty * x.priceCents, 0);
        total += revenue;
        out.push(`${s}: shipped ${units}, revenue ${money(revenue)}, available ${p.stock - p.reserved}${isLow(p) ? ' LOW' : ''}`);
      }
      out.push(`Total revenue ${money(total)}`);
      return out.join('\n');
    },
  };
}

module.exports = { createShop };
