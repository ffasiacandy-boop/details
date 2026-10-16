import test from 'node:test';
import assert from 'node:assert/strict';
import { FamilyAdapter } from '../src/adapters/family.js';
import { createAdapter, supportedCategories, isKnownUnsupported } from '../src/adapters/index.js';
import { analyzePixels } from '../src/detect/segment.js';
import { shapeImage } from './helpers.js';

function loaded(category, shape, o) {
  const a = new FamilyAdapter({ id: 'x', garmentImage: 'x' }, category), r = analyzePixels(shapeImage(shape, o)); assert.ok(r.ok);
  a.g = { ok: true, image: { width: r.cutout.width, height: r.cutout.height }, width: r.cutout.width, height: r.cutout.height, silhouette: r.silhouette };
  return a;
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
function bodyAt(cx, noise = 0, drop = []) {
  const P = { 11: [-70, 0], 12: [70, 0], 13: [-85, 110], 14: [85, 110], 23: [-45, 260], 24: [45, 260], 25: [-48, 420], 26: [48, 420], 27: [-50, 570], 28: [50, 570] };
  return { width: 640, get: (i) => (P[i] && !drop.includes(i) ? { x: cx + P[i][0] + rnd() * noise, y: 120 + P[i][1] + rnd() * noise, z: 0 } : null) };
}
const run = (a, frames) => frames.map((p, i) => { a.update(p, i / 30); return a.plan.parts[0].sample(0.5).p; });
const std = (v) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };

test('garment tracks the body as it moves (no drift away)', () => {
  const a = loaded('tshirt', 'tshirt'); const frames = []; for (let i = 0; i < 60; i++) frames.push(bodyAt(320 + i * 2));
  const pts = run(a, frames); assert.ok(Math.abs(pts[59].x - (320 + 118)) < 10, `final x ${pts[59].x}`);
});
test('temporal smoothing: output jitter is much lower than landmark jitter', () => {
  const a = loaded('tshirt', 'tshirt'); const frames = []; for (let i = 0; i < 90; i++) frames.push(bodyAt(320, 4));
  const out = run(a, frames).slice(20); assert.ok(std(out.map((p) => p.x)) < 1.6, `std ${std(out.map((p) => p.x))}`);
});
test('switching categories on the same pose stream keeps tracking (top -> bottom -> full)', () => {
  const frames = []; for (let i = 0; i < 20; i++) frames.push(bodyAt(320 + i));
  for (const [cat, shape, o] of [['tshirt', 'tshirt'], ['jeans', 'pants'], ['skirt', 'skirt', { h: 560 }], ['dress', 'dress', { h: 820 }], ['shorts', 'shorts'], ['kurti', 'kurti', { h: 760 }]]) {
    const a = loaded(cat, shape, o); const pts = run(a, frames); assert.ok(pts.every((p) => Number.isFinite(p.x + p.y)), cat);
  }
});
test('bottom wear with legs out of frame: still fitted, but the shopper is told (hint legs)', () => {
  const a = loaded('jeans', 'pants'); assert.equal(a.update(bodyAt(320, 0, [25, 26, 27, 28]), 0), true); assert.equal(a.hint, 'legs');
  assert.equal(a.update(bodyAt(320), 1), true); assert.equal(a.hint, null);
});
test('no body -> not tracked, no garment plan produced, and shoulders-hidden hint for tops', () => {
  const a = loaded('tshirt', 'tshirt'); assert.equal(a.update(null, 0), false);
  assert.equal(a.update(bodyAt(320, 0, [11, 12]), 0.1), false); assert.equal(a.hint, 'shoulders');
});
test('top and bottom layers fit the same body independently (outfit): bottom waist is under the top hem', () => {
  const t = loaded('tshirt', 'tshirt'), b = loaded('jeans', 'pants'), p = bodyAt(320);
  t.update(p, 0); b.update(p, 0);
  const hemY = t.plan.parts[0].sample(1).p.y, waistY = b.plan.parts[0].sample(0).p.y;
  assert.ok(hemY > waistY, `top hem (${hemY}) overlaps the waistband (${waistY}) so no gap shows`);
});
test('registry: new categories supported; jumpsuit/dhoti/salwar-suit refused, saree only via legacy', () => {
  for (const c of ['tshirt', 'shirt', 'polo', 'hoodie', 'jacket', 'kurti', 'jeans', 'trousers', 'shorts', 'skirt', 'dress', 'gown']) assert.ok(createAdapter(c, { garmentImage: 'x' }), c);
  assert.equal(createAdapter('jumpsuit', {}), null); assert.equal(createAdapter('dhoti', {}), null);
  assert.ok(isKnownUnsupported('jumpsuit')); assert.ok(supportedCategories().includes('saree'));
});
