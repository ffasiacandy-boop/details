import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPoints, completePoints, buildTop, buildBottom, buildFull } from '../src/fit/rig.js';
import { drawPlan } from '../src/fit/strips.js';
import { PROFILES, canonicalCategory, familyOf } from '../src/fit/profiles.js';
import { analyzePixels } from '../src/detect/segment.js';
import { shapeImage } from './helpers.js';

const CAL = { widthRatio: 1, heightRatio: 1 };
// Synthetic standing body in canvas pixels. s = body scale, mirror flips left/right landmarks like a selfie camera.
function body({ s = 1, cx = 320, top = 120, lean = 0, drop = [], mirror = false, w = 640 } = {}) {
  const P = { 11: [-70, 0], 12: [70, 0], 13: [-85, 110], 14: [85, 110], 15: [-90, 210], 16: [90, 210], 23: [-45 + lean, 260], 24: [45 + lean, 260], 25: [-48 + lean, 420], 26: [48 + lean, 420], 27: [-50 + lean, 570], 28: [50 + lean, 570], 0: [0, -70] };
  return { width: w, get: (i) => { if (drop.includes(i) || !P[i]) return null; const [x, y] = P[i]; return { x: cx + (mirror ? -x : x) * s, y: top + y * s, z: 0 }; } };
}
const prep = (name, o) => { const r = analyzePixels(shapeImage(name, o)); assert.ok(r.ok); return { sil: r.silhouette, img: { cw: r.cutout.width, ch: r.cutout.height } }; };
const fit = (pose, family) => { const p = collectPoints(pose); return completePoints(p, family, pose.width); };
const ext = (plan) => { const pts = []; for (const part of plan.parts) for (let k = 0; k <= 10; k++) pts.push(part.sample(k / 10)); return pts; };

test('profiles: every category maps to a family; unknown words are not invented', () => {
  assert.equal(familyOf('Hoodie'), 'top'); assert.equal(familyOf('jeans'), 'bottom'); assert.equal(familyOf('gown'), 'full'); assert.equal(familyOf('chudidar'), 'top');
  assert.equal(canonicalCategory('jumpsuit'), null); assert.equal(canonicalCategory('saree'), null); assert.equal(canonicalCategory('dhoti'), null);
  assert.ok(Object.values(PROFILES).every((p) => ['top', 'bottom', 'full'].includes(p.family)));
});
test('TOP: neckline above shoulders, hem below hips, width tracks shoulder width (not fixed pixels)', () => {
  const { sil, img } = prep('tshirt');
  const mk = (s) => { const c = fit(body({ s }), 'top'); return buildTop(c, PROFILES.tshirt, CAL, sil, img); };
  const a = mk(1), b = mk(1.6);
  const first = a.parts[0].sample(0.0), last = a.parts[0].sample(1.0);
  assert.ok(first.p.y < 120, 'starts above shoulder line (y=120)'); assert.ok(last.p.y > 120 + 260, 'hem below the hips');
  const wA = a.parts[0].sample(0.7).w, wB = b.parts[0].sample(0.7).w;
  assert.ok(Math.abs(wB / wA - 1.6) < 0.1, `scales with body: ${wB / wA}`);
});
test('TOP: garment length is category-specific (crop < tshirt < kurti)', () => {
  const { sil, img } = prep('tshirt'); const c = fit(body(), 'top');
  const L = (k) => buildTop(c, PROFILES[k], CAL, sil, img).meta.L;
  assert.ok(L('croptop') < L('tshirt') && L('tshirt') < L('kurti'));
});
test('TOP: follows a leaning torso (spine tilts with the body)', () => {
  const { sil, img } = prep('tshirt'); const c = fit(body({ lean: 60 }), 'top'), plan = buildTop(c, PROFILES.tshirt, CAL, sil, img);
  assert.ok(plan.parts[0].sample(0.9).p.x > plan.parts[0].sample(0.1).p.x + 20);
});
test('mirrored (selfie) landmarks give the same plan as unmirrored', () => {
  const { sil, img } = prep('tshirt');
  const a = buildTop(fit(body(), 'top'), PROFILES.tshirt, CAL, sil, img), b = buildTop(fit(body({ mirror: true }), 'top'), PROFILES.tshirt, CAL, sil, img);
  assert.ok(Math.abs(a.parts[0].sample(0.5).p.x - b.parts[0].sample(0.5).p.x) < 1); assert.ok(Math.abs(a.parts[0].sample(0.5).w - b.parts[0].sample(0.5).w) < 1);
});
test('TOP with hips hidden: hips estimated from shoulders; no shoulders -> hint, not a bad fit', () => {
  const c = fit(body({ drop: [23, 24, 25, 26, 27, 28] }), 'top'); assert.ok(c.pts && c.q.hips === false);
  assert.equal(fit(body({ drop: [11, 12] }), 'top').hint, 'shoulders');
});
test('BOTTOM jeans: two leg parts, each follows its own hip->knee->ankle chain; hem reaches the ankles', () => {
  const { sil, img } = prep('pants'); const c = fit(body(), 'bottom'), plan = buildBottom(c, PROFILES.jeans, CAL, sil, img);
  assert.equal(plan.parts.length, 2);
  const [l, r] = plan.parts, lEnd = l.sample(1), rEnd = r.sample(1);
  assert.ok(lEnd.p.x < rEnd.p.x, 'left leg is left of right leg'); assert.ok(lEnd.p.y > 120 + 480, `hem near ankles, y=${lEnd.p.y}`);
  assert.ok(l.sample(0.1).p.y > 120 + 220, 'waist at the hips, not the chest');
});
test('BOTTOM: shorts end near mid-thigh/knee, shorter than jeans', () => {
  const j = prep('pants'), s = prep('shorts'); const c = fit(body(), 'bottom');
  const jy = buildBottom(c, PROFILES.jeans, CAL, j.sil, j.img).parts[0].sample(1).p.y, sy = buildBottom(c, PROFILES.shorts, CAL, s.sil, s.img).parts[0].sample(1).p.y;
  assert.ok(sy < jy - 150 && sy < 120 + 440, `shorts hem y=${sy}`);
});
test('BOTTOM: legs bend with the knees (bent leg changes strip direction)', () => {
  const { sil, img } = prep('pants'); const straight = buildBottom(fit(body(), 'bottom'), PROFILES.jeans, CAL, sil, img);
  const p = body(); const bent = { width: 640, get: (i) => (i === 25 ? { x: 220, y: 380, z: 0 } : p.get(i)) };
  const b = buildBottom(fit(bent, 'bottom'), PROFILES.jeans, CAL, sil, img);
  assert.ok(Math.abs(b.parts[0].sample(0.8).dir.x - straight.parts[0].sample(0.8).dir.x) > 0.05);
});
test('BOTTOM with knees/ankles hidden: estimated; with hips hidden: hint', () => {
  assert.equal(fit(body({ drop: [25, 26, 27, 28] }), 'bottom').q.knees, false); assert.equal(fit(body({ drop: [23, 24] }), 'bottom').hint, 'hips');
});
test('BOTTOM skirt: single spine part starting at the waist', () => {
  const { sil, img } = prep('skirt', { w: 640, h: 560 }); const plan = buildBottom(fit(body(), 'bottom'), PROFILES.skirt, CAL, sil, img);
  assert.equal(plan.parts.length, 1); assert.ok(plan.parts[0].sample(0.05).p.y > 120 + 200);
});
test('FULL dress: starts at the neckline, ends near the knee; gown ends lower than dress', () => {
  const { sil, img } = prep('dress', { h: 820 }); const c = fit(body(), 'full');
  const d = buildFull(c, PROFILES.dress, CAL, sil, img), g = buildFull(c, PROFILES.gown, CAL, sil, img);
  assert.ok(d.parts[0].sample(0).p.y < 150); assert.ok(g.meta.L > d.meta.L * 1.1);
  assert.ok(d.parts[0].sample(1).p.y > 120 + 420);
});
test('FULL requires shoulders and hips (hints otherwise)', () => assert.equal(fit(body({ drop: [11, 12, 23, 24] }), 'full').hint, 'shoulders'));
test('too far away: hint "closer"', () => assert.equal(fit(body({ s: 0.2 }), 'top').hint, 'closer'));
test('plans are finite everywhere (no NaN from degenerate silhouettes)', () => {
  const { sil, img } = prep('tshirt');
  for (const fam of ['top', 'bottom', 'full']) { const c = fit(body(), fam); const B = { top: buildTop, bottom: buildBottom, full: buildFull }[fam]; const prof = { top: PROFILES.tshirt, bottom: PROFILES.jeans, full: PROFILES.dress }[fam];
    for (const p of ext(B(c, prof, CAL, sil, img))) assert.ok(Number.isFinite(p.p.x + p.p.y + p.w)); }
});
test('drawPlan issues one drawImage per strip per part with finite arguments', () => {
  const { sil, img } = prep('pants'); const plan = buildBottom(fit(body(), 'bottom'), PROFILES.jeans, CAL, sil, img); const calls = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, drawImage: (...a) => calls.push(a) };
  drawPlan(ctx, { width: img.cw, height: img.ch }, plan, 20);
  assert.equal(calls.length, 40); assert.ok(calls.every((a) => a.slice(1).every(Number.isFinite)));
});
