import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels } from '../src/detect/segment.js';
import { makeImage, fillPoly, fillCircle, shapeImage, SHAPES } from './helpers.js';

const ok = (r) => { assert.equal(r.ok, true, `expected ok, got ${r.reason}`); return r; };

test('shirt on plain white background: cut out and guessed as top', () => {
  const r = ok(analyzePixels(shapeImage('tshirt')));
  assert.equal(r.mode, 'background-removed');
  assert.equal(r.guess.family, 'top');
  assert.ok(r.cutout.width < 640 && r.cutout.height < 800, 'cropped tight');
});
test('flat-lay shirt on light-grey backdrop', () => {
  const r = ok(analyzePixels(shapeImage('tshirt', { bg: [226, 226, 230], color: [190, 40, 40] })));
  assert.equal(r.guess.family, 'top');
});
test('jeans: two legs detected, leg gap measured', () => {
  const r = ok(analyzePixels(shapeImage('pants', { color: [40, 70, 130] })));
  assert.equal(r.guess.category, 'pant'); assert.equal(r.silhouette.legsSplit, true);
  assert.ok(Math.abs(r.silhouette.legGapX - 0.5) < 0.12);
});
test('shorts guessed as shorts, not pants', () => assert.equal(ok(analyzePixels(shapeImage('shorts'))).guess.category, 'shorts'));
test('skirt guessed as bottom', () => assert.equal(ok(analyzePixels(shapeImage('skirt', { w: 640, h: 560 }))).guess.family, 'bottom'));
test('dress guessed as full-body', () => assert.equal(ok(analyzePixels(shapeImage('dress', { h: 820 }))).guess.family, 'full'));
test('kurti (long, sleeved) is not mistaken for pants', () => assert.notEqual(ok(analyzePixels(shapeImage('kurti', { h: 760 }))).guess.family, 'bottom'));
test('colour variants keep their own colours', () => {
  const a = ok(analyzePixels(shapeImage('tshirt', { color: [200, 30, 30] }))), b = ok(analyzePixels(shapeImage('tshirt', { color: [30, 160, 60] })));
  const px = (r) => { const i = ((r.cutout.height >> 1) * r.cutout.width + (r.cutout.width >> 1)) * 4; return [...r.cutout.data.slice(i, i + 3)]; };
  assert.deepEqual(px(a), [200, 30, 30]); assert.deepEqual(px(b), [30, 160, 60]);
});
test('transparent PNG uses the alpha channel', () => {
  const img = shapeImage('tshirt'); for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4] === 255 && img.data[i * 4 + 1] === 255) img.data[i * 4 + 3] = 0;
  assert.equal(ok(analyzePixels(img)).mode, 'alpha');
});
test('complex (busy) background is rejected, not guessed', () => {
  const img = makeImage(640, 800); for (let y = 0; y < 800; y++) for (let x = 0; x < 640; x++) { const i = (y * 640 + x) * 4; img.data[i] = (x * 7) % 256; img.data[i + 1] = (y * 5) % 256; img.data[i + 2] = ((x + y) * 3) % 256; }
  fillPoly(img, SHAPES.tshirt(20, 20, 1), [30, 60, 160]);
  const r = analyzePixels(img); assert.equal(r.ok, false); assert.ok(['BUSY_BACKGROUND', 'MODEL_PHOTO'].includes(r.reason));
});
test('model wearing the shirt (skin-toned head/arms) is rejected as MODEL_PHOTO', () => {
  const img = makeImage(640, 800), skin = [224, 172, 140];
  fillCircle(img, 320, 90, 55, skin);                          // head
  fillPoly(img, [[200, 160], [440, 160], [440, 520], [200, 520]], [30, 60, 160]);   // shirt on torso
  fillPoly(img, [[130, 170], [200, 160], [200, 440], [140, 440]], skin); fillPoly(img, [[440, 160], [510, 170], [500, 440], [440, 440]], skin);   // arms
  assert.equal(analyzePixels(img).reason, 'MODEL_PHOTO');
});
test('multiple garments: ambiguous -> rejected; resolved when product family is known', () => {
  const img = makeImage(1200, 800);
  fillPoly(img, SHAPES.tshirt(20, 20, 1), [30, 60, 160]); fillPoly(img, SHAPES.pants(640, 20, 0.95), [40, 40, 40]);
  assert.equal(analyzePixels(img).reason, 'MULTIPLE_GARMENTS');
  const r = analyzePixels(img, { expectedFamily: 'bottom' }); assert.equal(r.ok, true); assert.equal(r.guess.family, 'bottom');
  assert.ok(r.warnings.includes('MULTIPLE_GARMENTS_RESOLVED'));
});
test('low-resolution image: tiny rejected, small accepted with warning', () => {
  assert.equal(analyzePixels(shapeImage('tshirt', { w: 100, h: 90 })).reason, 'LOW_RESOLUTION');
  const img = makeImage(320, 320); fillPoly(img, SHAPES.tshirt(10, 10, 0.5), [30, 60, 160]);
  const r = analyzePixels(img); assert.equal(r.ok, true); assert.ok(r.warnings.includes('LOW_RESOLUTION'));
});
test('tan/beige garment is not mistaken for a person', () => {
  const r = analyzePixels(shapeImage('pants', { color: [205, 160, 125] })); assert.equal(r.ok, true);
});

test('semi-transparent interior (gradient with alpha) becomes opaque; edges keep anti-aliasing', () => {
  const img = shapeImage('tshirt'); for (let i = 0; i < img.width * img.height; i++) { if (img.data[i * 4] === 255 && img.data[i * 4 + 1] === 255) img.data[i * 4 + 3] = 0; else img.data[i * 4 + 3] = 180; }
  const r = ok(analyzePixels(img)); const c = r.cutout, mid = ((c.height >> 1) * c.width + (c.width >> 1)) * 4;
  assert.equal(c.data[mid + 3], 255);
});
