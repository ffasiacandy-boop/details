// Category-specific fitting maths. Input: a pose (pose.get(i) -> {x,y,z?} in canvas pixels, or null when the landmark is
// missing / low confidence) and the garment's silhouette measurements. Output: a "plan" the strip renderer draws.
// All sizes derive from the wearer's own measurements (shoulder width, torso length, hip width, leg length): no fixed pixels.
import { clamp, lerp, mid, dist, sub, add, scale, unit, along, profile, pointOnPath, pathLength, extendPath } from './geometry.js';

const IDX = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
const PAIRS = [['ls', 'rs'], ['le', 're'], ['lw', 'rw'], ['lh', 'rh'], ['lk', 'rk'], ['la', 'ra']];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Raw landmarks by name, with "l"/"r" meaning LEFT/RIGHT ON SCREEN (so mirroring never matters). */
export function collectPoints(pose) {
  const p = {}; for (const [k, i] of Object.entries(IDX)) p[k] = pose.get(i);
  const swap = p.ls && p.rs ? p.ls.x > p.rs.x : (p.lh && p.rh ? p.lh.x > p.rh.x : false);
  if (swap) for (const [a, b] of PAIRS) [p[a], p[b]] = [p[b], p[a]];
  return p;
}

/**
 * Fills in landmarks that are not visible (from body proportions) so the garment keeps a plausible fit, and reports which
 * were really measured. Returns { pts, q } or { hint } when the body is not usable for this family.
 */
export function completePoints(p, family, pw) {
  const q = { shoulders: !!(p.ls && p.rs), hips: !!(p.lh && p.rh), knees: !!(p.lk && p.rk), ankles: !!(p.la && p.ra) };
  const out = { ...p };
  if (family !== 'bottom' && !q.shoulders) return { hint: 'shoulders' };
  if (family !== 'top' && !q.hips && !q.shoulders) return { hint: 'hips' };
  if (family === 'bottom' && !q.hips) return { hint: 'hips' };
  if (q.shoulders && dist(p.ls, p.rs) < pw * 0.07) return { hint: 'closer' };
  if (!q.shoulders && q.hips && dist(p.lh, p.rh) < pw * 0.035) return { hint: 'closer' };

  let down;
  if (q.shoulders) { const u = unit(sub(p.rs, p.ls)); down = { x: -u.y, y: u.x }; }
  else { const u = unit(sub(p.rh, p.lh)); down = { x: -u.y, y: u.x }; }
  const sw = q.shoulders ? dist(p.ls, p.rs) : dist(p.lh, p.rh) * 1.9;
  if (!q.hips) {
    const m = mid(p.ls, p.rs), hm = add(m, scale(down, sw * 1.35)), half = scale(unit(sub(p.rs, p.ls)), sw * 0.21);
    out.lh = sub(hm, half); out.rh = add(hm, half);
  }
  const hm = mid(out.lh, out.rh);
  if (q.shoulders && q.hips) { const v = sub(hm, mid(p.ls, p.rs)); if (Math.hypot(v.x, v.y) > sw * 0.6) down = unit(v); }   // true torso axis (leans, bends)
  const torso = q.shoulders ? Math.max(sw * 0.8, dist(mid(p.ls, p.rs), hm)) : sw * 1.35;
  const thigh = torso * 0.85, shank = torso * 0.85;
  if (!q.knees) { out.lk = add(out.lh, scale(down, thigh)); out.rk = add(out.rh, scale(down, thigh)); }
  if (!q.ankles) { out.la = add(out.lk, scale(down, shank)); out.ra = add(out.rk, scale(down, shank)); }
  return { pts: out, q, down, sw, torso };
}

// Moving average over the 64 silhouette rows: the per-row width corrections must vary smoothly or the garment edge turns jagged.
const smoothRows = (a, r = 3) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; n++; } return s / n; });
const sleeveSpread = (pts, sw) => (pts.le && pts.re ? clamp((dist(pts.le, pts.re) - sw) / sw, 0, 0.8) : 0);
const rowsAvg = (a, f0, f1) => { const i0 = Math.floor(f0 * a.length), i1 = Math.max(i0 + 1, Math.floor(f1 * a.length)); const s = a.slice(i0, i1).filter((v) => v > 0.02); return s.length ? med(s) : 0.6; };

/** TOP WEAR: shoulders, neckline lift, torso axis, hem, arm spread. Plan is a single spine following shoulder->hip(->knee). */
export function buildTop(c, prof, cal, sil, img) {
  const { pts, sw, torso, down } = c, m = mid(pts.ls, pts.rs), h = mid(pts.lh, pts.rh), hipW = dist(pts.lh, pts.rh);
  const lift = prof.topLift * torso, top = sub(m, scale(down, lift));
  const km = mid(pts.lk, pts.rk);
  const path = extendPath([top, m, h, km], torso * 1.5);
  const refW = sw * 1.08 * prof.ease * cal.widthRatio, ext0 = rowsAvg(sil.rowExtent, 0.55, 0.8);
  const W0 = refW / ext0, spread = 1 + 0.14 * sleeveSpread(pts, sw);
  const bodyKnots = [[0, sw * 1.1], [0.5, sw * 0.95], [1, Math.max(hipW * 1.5, sw * 0.95)]];
  const natural = img.ch * (W0 / img.cw), expected = lift + torso * prof.hem;
  const L = clamp(lerp(natural, expected, 0.5), expected * 0.8, expected * 1.25) * cal.heightRatio;
  const total = pathLength(path), sm = smoothRows(sil.rowExtent);
  const sample = (t) => {
    const s = t * L, { p, dir } = pointOnPath(path, s / total);
    const ext = Math.max(0.05, sm[Math.min(63, Math.floor(t * 64))]);
    let cover = ext * W0 * (t < 0.45 ? spread : 1);
    if (t > 0.5) cover = lerp(cover, profile(bodyKnots, (s - lift) / torso) * prof.ease, clamp((t - 0.5) / 0.5, 0, 1) * 0.55);
    return { p, dir, w: clamp(cover / ext, W0 * 0.75, W0 * 1.25) };
  };
  return { parts: [{ sx0: 0, sx1: 1, len: L, sample, cx: (t) => { const k = Math.min(63, Math.floor(t * 64)); return sil.rowExtent[k] > 0 ? sil.rowLeft[k] + sil.rowExtent[k] / 2 : 0.5; } }], meta: { family: 'top', L, torso, sw } };
}

/** BOTTOM WEAR, two-leg garments: each half of the image follows its own hip->knee->ankle chain. Skirts use one spine. */
export function buildBottom(c, prof, cal, sil, img) {
  const { pts, torso, down } = c, hipW = dist(pts.lh, pts.rh), hm = mid(pts.lh, pts.rh);
  const rise = prof.rise * torso, up = scale(down, -rise);
  const legLen = (k, a) => dist(pts.lh, pts[k]) + dist(pts[k], pts[a]);
  const hipToAnkle = (legLen('lk', 'la') + legLen('rk', 'ra')) / 2;
  const expected = rise + prof.hem * hipToAnkle + (prof.hem >= 0.95 ? hipToAnkle * 0.04 : 0);
  if (prof.legs === false) {                                         // skirt: one spine waist -> knees
    const path = extendPath([add(hm, up), hm, mid(pts.lk, pts.rk), mid(pts.la, pts.ra)], torso);
    const ext0 = rowsAvg(sil.rowExtent, 0, 0.1), W0 = (hipW * 1.5 * prof.ease * cal.widthRatio) / ext0;
    const natural = img.ch * (W0 / img.cw), L = clamp(lerp(natural, expected, 0.5), expected * 0.75, expected * 1.3) * cal.heightRatio, total = pathLength(path);
    const sample = (t) => { const { p, dir } = pointOnPath(path, (t * L) / total); return { p, dir, w: W0 }; };
    return { parts: [{ sx0: 0, sx1: 1, len: L, sample, cx: (t) => { const k = Math.min(63, Math.floor(t * 64)); return sil.rowExtent[k] > 0 ? sil.rowLeft[k] + sil.rowExtent[k] / 2 : 0.5; } }], meta: { family: 'bottom', L, torso, hipW } };
  }
  const gap = clamp(sil.legGapX, 0.3, 0.7), halves = [{ side: 'l', sx0: 0, sx1: gap }, { side: 'r', sx0: gap, sx1: 1 }];
  const topCover = Math.max(0.2, rowsAvg(sil.rowCover, 0, 0.12)), k = (hipW * 0.85 * prof.ease * cal.widthRatio) / ((topCover * img.cw) / 2);   // dest px per source px
  const natural = img.ch * k, L = clamp(lerp(natural, expected, 0.5), expected * 0.75, expected * 1.3) * cal.heightRatio;
  const parts = halves.map((hv) => {
    const hip = pts[`${hv.side}h`], knee = pts[`${hv.side}k`], ank = pts[`${hv.side}a`];
    const path = extendPath([add(hip, up), hip, knee, ank], hipToAnkle * 0.3), total = pathLength(path);
    const srcW = (hv.sx1 - hv.sx0) * img.cw;
    return { sx0: hv.sx0, sx1: hv.sx1, len: L, cx: () => 0.5, sample: (t) => { const { p, dir } = pointOnPath(path, (t * L) / total); return { p, dir, w: srcW * k }; } };
  });
  return { parts, meta: { family: 'bottom', L, torso, hipW } };
}

/** FULL-BODY one-piece (dress/gown/maxi): neckline + torso fit above the waist, the garment's own flare below it. */
export function buildFull(c, prof, cal, sil, img) {
  const { pts, sw, torso, down } = c, m = mid(pts.ls, pts.rs), h = mid(pts.lh, pts.rh), hipW = dist(pts.lh, pts.rh);
  const lift = prof.topLift * torso, top = sub(m, scale(down, lift));
  const path = extendPath([top, m, h, mid(pts.lk, pts.rk), mid(pts.la, pts.ra)], torso * 0.8), total = pathLength(path);
  const legLen = (dist(pts.lh, pts.lk) + dist(pts.lk, pts.la) + dist(pts.rh, pts.rk) + dist(pts.rk, pts.ra)) / 2;
  const ext0 = rowsAvg(sil.rowExtent, 0.12, 0.25), W0 = (sw * 1.1 * prof.ease * cal.widthRatio) / ext0;
  const bodyKnots = [[0, sw * 1.1], [0.5, sw * 0.9], [1, Math.max(hipW * 1.5, sw * 0.95)]];
  const natural = img.ch * (W0 / img.cw), expected = lift + torso + prof.hem * legLen;
  const L = clamp(lerp(natural, expected, 0.5), expected * 0.8, expected * 1.2) * cal.heightRatio;
  const sm = smoothRows(sil.rowExtent, 4);
  const sample = (t) => {
    const s = t * L, { p, dir } = pointOnPath(path, s / total), k = Math.min(63, Math.floor(t * 64)), ext = Math.max(0.05, sm[k]);
    let cover = ext * W0; const st = (s - lift) / torso;
    if (st > 0.15 && st < 1.0) cover = lerp(cover, profile(bodyKnots, st) * prof.ease, 0.35);       // fitted bodice/waist, flare kept below the hips
    return { p, dir, w: clamp(cover / ext, W0 * 0.8, W0 * 1.2) };
  };
  return { parts: [{ sx0: 0, sx1: 1, len: L, sample, cx: (t) => { const k = Math.min(63, Math.floor(t * 64)); return sil.rowExtent[k] > 0 ? sil.rowLeft[k] + sil.rowExtent[k] / 2 : 0.5; } }], meta: { family: 'full', L, torso, sw } };
}

export const BUILDERS = { top: buildTop, bottom: buildBottom, full: buildFull };
