import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyText } from '../src/detect/category.js';
import { canonicalCategory } from '../src/fit/profiles.js';

const c = (name, extra = {}) => classifyText({ name, ...extra });
test('names -> categories', () => {
  const cases = { 'Classic Cotton T-Shirt': 'tshirt', 'Slim Fit Oxford Shirt': 'shirt', 'Polo Shirt - Navy': 'polo', 'Zip Hoodie': 'hoodie', 'Crew Sweatshirt': 'sweatshirt', 'Wool Cardigan': 'sweater',
    'Denim Jacket': 'jacket', 'Tailored Blazer': 'blazer', 'Printed Cotton Kurti': 'kurti', 'Skinny Fit Jeans': 'jeans', 'Formal Trousers': 'trousers', 'Jogger Pants': 'joggers', 'Cargo Shorts': 'shorts',
    'Pleated Midi Skirt': 'skirt', 'High-rise Leggings': 'leggings', 'Palazzo Pants': 'palazzo', 'Floral Maxi Dress': 'maxi', 'Evening Gown': 'gown', 'Summer Dress': 'dress', 'Crop Top': 'croptop', 'Lace Top': 'top' };
  for (const [n, want] of Object.entries(cases)) assert.equal(c(n), want, n);
});
test('known-but-unsupported garments are recognised (and then refused), never mapped to a wrong fit', () => {
  assert.equal(c('Denim Jumpsuit'), 'jumpsuit'); assert.equal(c('Cotton Dhoti'), 'dhoti'); assert.equal(c('Silk Saree'), 'saree');
  for (const k of ['jumpsuit', 'dhoti', 'saree']) assert.equal(canonicalCategory(k), null);
});
test('breadcrumb / url evidence helps when the name is vague', () => assert.equal(c('Urban Classic', { breadcrumb: 'Women Dresses', url: '/dresses/urban-classic' }), 'dress'));
test('no clue -> null', () => assert.equal(c('Mystery Item 42'), null));
