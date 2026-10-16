// Pure geometry helpers (no DOM) so the fitting maths can be unit-tested in Node.
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const unit = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const along = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Piecewise-linear interpolation through sorted knots [[t, value], ...]. */
export function profile(knots, t) {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (t <= knots[i][0]) { const [t0, v0] = knots[i - 1], [t1, v1] = knots[i]; return lerp(v0, v1, (t - t0) / ((t1 - t0) || 1)); }
  }
  return knots[knots.length - 1][1];
}

/** Point at fraction f (0..1) of the total length of a polyline, plus the unit direction of the segment there. */
export function pointOnPath(path, f) {
  const lens = []; let total = 0;
  for (let i = 1; i < path.length; i++) { const l = dist(path[i - 1], path[i]); lens.push(l); total += l; }
  let d = clamp(f, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? clamp(d / lens[i], 0, 1) : 0;
      return { p: along(path[i], path[i + 1], t), dir: unit(sub(path[i + 1], path[i])), total };
    }
    d -= lens[i];
  }
  return { p: path[0], dir: { x: 0, y: 1 }, total };
}
export const pathLength = (path) => path.reduce((s, p, i) => (i ? s + dist(path[i - 1], p) : 0), 0);

/** Extend a path past its last point along its last direction by `extra` pixels. */
export function extendPath(path, extra) {
  if (extra <= 0 || path.length < 2) return path;
  const a = path[path.length - 2], b = path[path.length - 1], d = unit(sub(b, a));
  return [...path, { x: b.x + d.x * extra, y: b.y + d.y * extra }];
}

/** Row widths (0..1 of image width) -> smooth function. rows[i] = fraction of the garment image width covered at row i. */
export function rowWidthAt(rows, t) {
  const f = clamp(t, 0, 1) * (rows.length - 1), i = Math.floor(f), j = Math.min(rows.length - 1, i + 1);
  return lerp(rows[i], rows[j], f - i);
}
