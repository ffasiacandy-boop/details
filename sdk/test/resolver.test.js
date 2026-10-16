import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrcset, bestFromSrcset, upsizeCandidates, variantImageFromProduct, dedupe } from '../src/detect/resolver.js';

test('srcset: highest width wins; x-descriptors handled', () => {
  assert.equal(bestFromSrcset('a.jpg 400w, b.jpg 1200w, c.jpg 800w'), 'b.jpg');
  assert.equal(bestFromSrcset('a.jpg 1x, b.jpg 2x'), 'b.jpg');
  assert.equal(parseSrcset('').length, 0);
});
test('Shopify thumbnail upsizing produces the full-size URL first', () => {
  const u = 'https://cdn.shopify.com/s/files/1/0001/products/shirt_600x.jpg?v=12';
  assert.equal(upsizeCandidates(u)[0], 'https://cdn.shopify.com/s/files/1/0001/products/shirt.jpg?v=12');
});
test('WooCommerce -300x300 thumbnails upsized', () => {
  assert.deepEqual(upsizeCandidates('https://shop.example/wp-content/uploads/tee-300x300.jpg'), ['https://shop.example/wp-content/uploads/tee.jpg']);
});
test('non-CDN URLs get no invented variants', () => assert.deepEqual(upsizeCandidates('https://shop.example/img/tee.jpg'), []));
test('variant image by id (Shopify shape) and by selected options (WooCommerce shape)', () => {
  const shopify = { variants: [{ id: 1, option1: 'Red', featured_image: { src: '//cdn/red.jpg' } }, { id: 2, option1: 'Blue', featured_image: { src: '//cdn/blue.jpg' } }] };
  assert.equal(variantImageFromProduct(shopify, { variantId: '2' }), '//cdn/blue.jpg');
  assert.equal(variantImageFromProduct(shopify, { options: ['red'] }), '//cdn/red.jpg');
  const woo = { variations: [{ variation_id: 9, attributes: { attribute_pa_color: 'Green' }, image: { full_src: 'https://s/green-full.jpg' } }] };
  assert.equal(variantImageFromProduct(woo, { options: ['green'] }), 'https://s/green-full.jpg');
  assert.equal(variantImageFromProduct(woo, { options: ['purple'] }), '');
});
test('dedupe ignores query strings/protocol and drops tracking pixels', () => {
  const l = dedupe([{ url: 'https://a/x.jpg?v=1' }, { url: 'http://a/x.jpg?v=2' }, { url: 'https://a/spacer.gif' }, { url: 'https://a/y.jpg' }]);
  assert.deepEqual(l.map((c) => c.url), ['https://a/x.jpg?v=1', 'https://a/y.jpg']);
});
