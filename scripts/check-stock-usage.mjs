// Cek cepat aturan pemakaian stok Kasir (resep + cup). Jalankan: node scripts/check-stock-usage.mjs
import assert from 'assert';
import { stockUsageOf, sumStockUsage } from '../src/utils/stockUtils.js';

const inv = ['Cup (Flat) Ori', 'Cup (Flat) Premi', 'Paper Cup', 'Gula Milk Tea Ori', 'Gula Milk Tea Premi',
  'Black Tea Ori', 'Black Tea Premi', 'Diamond Besar', 'Ultra Milk Besar', 'Milo Ori', 'Strawberry Ori', 'Coffee Cream'];
const u = (p) => Object.fromEntries(stockUsageOf(p, inv).map(x => [x.item, x.qty]));

assert.deepEqual(u({ name: 'Es Teh', variant: 'Ori', category: 'Tea Series' }), { 'Cup (Flat) Ori': 1 });
assert.deepEqual(u({ name: 'Es Teh', variant: 'Premi', category: 'Tea Series' }), { 'Cup (Flat) Premi': 1 });
assert.deepEqual(u({ name: 'Milo', variant: 'Ori', category: 'Sachet Series' }), { 'Milo Ori': 1, 'Cup (Flat) Ori': 1 });
assert.deepEqual(u({ name: 'Milk Tea', variant: 'Premi', is_unlimited: true }), { 'Cup (Flat) Premi': 1, 'Gula Milk Tea Premi': 1, 'Black Tea Premi': 1 });
assert.deepEqual(u({ name: 'Teh Tarik', variant: 'Ori' }), { 'Cup (Flat) Ori': 1, 'Black Tea Ori': 1 });
assert.deepEqual(u({ name: 'Full Cream', variant: 'Ori', is_unlimited: true }), { 'Cup (Flat) Ori': 1, 'Diamond Besar': 0.2 });
assert.deepEqual(u({ name: 'Full Cream', variant: 'Premi', is_unlimited: true }), { 'Cup (Flat) Premi': 1, 'Ultra Milk Besar': 0.25 });
assert.deepEqual(u({ name: 'Coffee Cream', variant: 'Standar' }), { 'Coffee Cream': 1, 'Cup (Flat) Ori': 1, 'Diamond Besar': 0.2 });
assert.deepEqual(u({ name: 'Strawberry', variant: 'Ori', category: 'Milky Series' }), { 'Strawberry Ori': 1 }); // rasa: tanpa cup
assert.deepEqual(u({ name: 'Kopi Bali', variant: 'Standar', category: 'Hot Series' }), { 'Kopi Bali': 1, 'Paper Cup': 1 });
assert.deepEqual(u({ name: 'Cao Jelly', variant: 'Standar', category: 'Topping', is_non_base: true }), { 'Cao Jelly': 1 });
assert.deepEqual(u({ name: 'Green Thai Tea Premi', variant: 'Standar' }), { 'Green Thai Tea Premi': 1, 'Cup (Flat) Premi': 1 });

// Strawberry Ori x2 lewat Kasir = Strawberry + Full Cream: 2 sachet, 2 cup, 0.4 Diamond.
const used = sumStockUsage([
  { product: { name: 'Strawberry', variant: 'Ori', category: 'Milky Series' }, qty: 2 },
  { product: { name: 'Full Cream', variant: 'Ori', is_unlimited: true }, qty: 2 },
], inv);
assert.deepEqual(used, { 'Strawberry Ori': 2, 'Cup (Flat) Ori': 2, 'Diamond Besar': 0.4 });
console.log('stock usage ok');
