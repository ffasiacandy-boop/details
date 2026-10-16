// Garment image analysis on raw RGBA pixels (no DOM, so it is unit-testable in Node).
// Pipeline: size check -> alpha or plain-background removal -> skin/model-photo rejection -> connected components
// (multiple garments) -> crop + soft edge -> silhouette measurements (row widths, leg gap) -> category guess.
//
// This is classical image processing, NOT a neural segmenter. It is reliable for garments on plain/uniform backgrounds
// and transparent PNGs; it deliberately REFUSES photos of people and busy backgrounds instead of guessing.
export const REASONS = {
  LOW_RESOLUTION: 'The product image is too small to fit reliably.',
  MODEL_PHOTO: 'The product image shows a person wearing the garment. Garment extraction from model photos is not supported; a flat-lay or ghost-mannequin image is needed.',
  BUSY_BACKGROUND: 'The product image has a busy background that cannot be removed reliably.',
  MULTIPLE_GARMENTS: 'The product image contains several garments and the intended one could not be identified.',
  NO_GARMENT: 'No garment could be found in the product image.',
};

const TOL = 54;                      // summed-RGB distance from the background colour that still counts as background
const ROWS = 64;

function borderIndices(w, h) {
  const b = [];
  for (let x = 0; x < w; x++) b.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) b.push(y * w, y * w + w - 1);
  return b;
}

function floodBackground(px, w, h) {
  const border = borderIndices(w, h);
  let r = 0, g = 0, b = 0;
  for (const i of border) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
  r /= border.length; g /= border.length; b /= border.length;
  const dev = (i) => Math.abs(px[i * 4] - r) + Math.abs(px[i * 4 + 1] - g) + Math.abs(px[i * 4 + 2] - b);
  let maxDev = 0; for (const i of border) maxDev = Math.max(maxDev, dev(i));
  const bg = new Uint8Array(w * h), stack = [];
  for (const i of border) if (!bg[i] && dev(i) < TOL) { bg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0 && !bg[i - 1] && dev(i - 1) < TOL) { bg[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && !bg[i + 1] && dev(i + 1) < TOL) { bg[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !bg[i - w] && dev(i - w) < TOL) { bg[i - w] = 1; stack.push(i - w); }
    if (y < h - 1 && !bg[i + w] && dev(i + w) < TOL) { bg[i + w] = 1; stack.push(i + w); }
  }
  return { bg, bgColor: [r, g, b], uniformBorder: maxDev < 120 };
}

// Classic YCbCr skin range. Imperfect (tan/beige fabric, dark skin tones); used only as one signal.
const isSkin = (r, g, b) => {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 137 && cr <= 173 && r > 60 && r > b;
};

function components(mask, w, h) {
  const label = new Int32Array(w * h), comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    const id = comps.length + 1, stack = [s]; label[s] = id;
    let area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
    }
    comps.push({ id, area, x0, y0, x1, y1 });
  }
  return { label, comps };
}

function runs(mask, w, y, x0, x1) {
  const out = []; let s = -1;
  for (let x = x0; x <= x1; x++) {
    const on = mask[y * w + x] === 1;
    if (on && s < 0) s = x;
    if ((!on || x === x1) && s >= 0) { out.push([s, on ? x : x - 1]); s = -1; }
  }
  const gap = Math.max(2, Math.round((x1 - x0) * 0.03)), merged = [];
  for (const r of out) { const l = merged[merged.length - 1]; if (l && r[0] - l[1] <= gap) l[1] = r[1]; else merged.push([...r]); }
  return merged;
}

/** Silhouette measurements on a cropped mask (w x h, 1 = garment). */
export function measureSilhouette(mask, w, h) {
  const rowExtent = new Array(ROWS).fill(0), rowCover = new Array(ROWS).fill(0), rowLeft = new Array(ROWS).fill(0);
  for (let k = 0; k < ROWS; k++) {
    const y = Math.min(h - 1, Math.floor(((k + 0.5) / ROWS) * h));
    let lo = -1, hi = -1, cover = 0;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (lo < 0) lo = x; hi = x; cover++; }
    rowExtent[k] = lo < 0 ? 0 : (hi - lo + 1) / w; rowCover[k] = cover / w; rowLeft[k] = lo < 0 ? 0 : lo / w;
  }
  const band = (f0, f1) => {
    let span = 0, runsMax = 0, widest = 0, gapMax = 0, gapAt = 0, n = 0;
    const ya = Math.floor(h * f0), yb = Math.max(ya + 1, Math.floor(h * f1));
    for (let y = ya; y < yb; y += Math.max(1, Math.floor((yb - ya) / 12))) {
      const rs = runs(mask, w, y, 0, w - 1); n++;
      if (!rs.length) continue;
      const lo = rs[0][0], hi = rs[rs.length - 1][1];
      widest = Math.max(widest, (hi - lo + 1) / w); runsMax = Math.max(runsMax, rs.length); span += (hi - lo + 1) / w;
      for (let k = 1; k < rs.length; k++) { const g = (rs[k][0] - rs[k - 1][1]) / w; if (g > gapMax) { gapMax = g; gapAt = (rs[k][0] + rs[k - 1][1]) / 2 / w; } }
    }
    return { avg: span / Math.max(1, n), runs: runsMax, widest, gap: gapMax, gapAt };
  };
  const top = band(0.06, 0.25), midB = band(0.45, 0.6), low = band(0.8, 0.97);
  return { aspect: h / w, rowExtent, rowCover, rowLeft, top, mid: midB, low, legsSplit: low.runs >= 2 && low.gap > 0.06, legGapX: low.gap > 0.06 ? low.gapAt : 0.5 };
}

/** Category guess from the silhouette alone (used only when the page text gives no clue). */
export function guessFromSilhouette(m) {
  const { aspect, top, mid, low, legsSplit } = m;
  if (legsSplit && aspect >= 1.25) return { category: 'pant', family: 'bottom', confidence: 0.75 };
  if (legsSplit && aspect < 1.25 && aspect > 0.45) return { category: 'shorts', family: 'bottom', confidence: 0.55 };
  if (aspect <= 1.15 && top.avg > 0 && low.avg / top.avg >= 1.25 && top.widest < 0.7) return { category: 'skirt', family: 'bottom', confidence: 0.4 };
  if (aspect >= 1.45 && !legsSplit) return { category: 'dress', family: 'full', confidence: 0.4 };
  const sleeves = top.widest > 0.9 && mid.avg > 0 && top.widest / Math.max(mid.avg, 0.05) > 1.22;
  if (aspect <= 1.45 && sleeves) return { category: 'tshirt', family: 'top', confidence: 0.55 };
  if (aspect <= 1.45) return { category: 'tshirt', family: 'top', confidence: 0.35 };
  return { category: null, family: null, confidence: 0 };
}

const fail = (reason, extra = {}) => ({ ok: false, reason, message: REASONS[reason], ...extra });

/**
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} img  RGBA pixels
 * @param {{expectedFamily?:'top'|'bottom'|'full'}} opts  family implied by product text, used to pick one garment out of several
 */
export function analyzePixels(img, opts = {}) {
  const { data: px, width: w, height: h } = img, N = w * h, warnings = [];
  if (Math.max(w, h) < 120 || Math.min(w, h) < 80) return fail('LOW_RESOLUTION');
  if (Math.max(w, h) < 400) warnings.push('LOW_RESOLUTION');

  let transparent = 0, sampled = 0;
  for (let i = 0; i < N; i += 7) { sampled++; if (px[i * 4 + 3] < 200) transparent++; }
  const hasAlpha = transparent / sampled > 0.03;

  let fg = new Uint8Array(N), mode, bgColor = null;
  if (hasAlpha) { for (let i = 0; i < N; i++) fg[i] = px[i * 4 + 3] > 40 ? 1 : 0; mode = 'alpha'; }
  else {
    const f = floodBackground(px, w, h); bgColor = f.bgColor;
    let n = 0; for (let i = 0; i < N; i++) { fg[i] = f.bg[i] ? 0 : 1; n += fg[i]; }
    const ratio = n / N;
    if (!f.uniformBorder) {
      // Busy background. If skin tones are present it is almost certainly a photo of a person.
      let skin = 0; for (let i = 0; i < N; i += 3) if (isSkin(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) skin++;
      return skin / (N / 3) > 0.03 ? fail('MODEL_PHOTO', { mode: 'none' }) : fail('BUSY_BACKGROUND', { mode: 'none' });
    }
    if (ratio < 0.04 || ratio > 0.97) return fail('NO_GARMENT', { mode: 'none' });
    mode = 'background-removed';
  }

  // --- person / model photo rejection (skin-coloured blob inside the foreground)
  let fgCount = 0, skinCount = 0; const skin = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (fg[i]) { fgCount++; if (isSkin(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) { skin[i] = 1; skinCount++; } }
  if (!fgCount) return fail('NO_GARMENT', { mode });
  const skinFrac = skinCount / fgCount;
  const sk = components(skin, w, h);
  const biggestSkin = sk.comps.reduce((m, c) => Math.max(m, c.area), 0);
  // a person: a sizeable skin blob that is only PART of the foreground. Mostly-skin-coloured foreground = beige/tan fabric.
  if (biggestSkin / N >= 0.012 && skinFrac > 0.03 && skinFrac < 0.6) return fail('MODEL_PHOTO', { mode, skinFrac });
  if (skinFrac >= 0.6) warnings.push('SKIN_TONED_GARMENT');

  // --- several garments?
  const cc = components(fg, w, h);
  const minArea = fgCount * 0.03;
  let sig = cc.comps.filter((c) => c.area >= minArea);
  if (!sig.length) return fail('NO_GARMENT', { mode });
  const biggest = Math.max(...sig.map((c) => c.area));
  sig = sig.filter((c) => c.area >= biggest * 0.12);
  let chosen = sig[0];
  if (sig.length > 1) {
    const cands = sig.map((c) => {
      const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1, m = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) m[y * cw + x] = cc.label[(y + c.y0) * w + x + c.x0] === c.id ? 1 : 0;
      return { c, guess: guessFromSilhouette(measureSilhouette(m, cw, ch)) };
    });
    const match = opts.expectedFamily ? cands.filter((k) => k.guess.family === opts.expectedFamily) : [];
    if (match.length !== 1) return fail('MULTIPLE_GARMENTS', { mode, count: sig.length });
    chosen = match[0].c; warnings.push('MULTIPLE_GARMENTS_RESOLVED');
  }

  // --- crop to the chosen component, soft edge
  const bw = chosen.x1 - chosen.x0 + 1, bh = chosen.y1 - chosen.y0 + 1;
  if (bw < 60 || bh < 60) return fail('LOW_RESOLUTION', { mode });
  const out = new Uint8ClampedArray(bw * bh * 4), mask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const si = (y + chosen.y0) * w + (x + chosen.x0), di = y * bw + x, inside = cc.label[si] === chosen.id;
    out[di * 4] = px[si * 4]; out[di * 4 + 1] = px[si * 4 + 1]; out[di * 4 + 2] = px[si * 4 + 2];
    mask[di] = inside ? 1 : 0;
    let a = inside ? 255 : 0;
    if (inside && hasAlpha) {   // keep anti-aliased edge alpha, but make the interior opaque: overlapping render strips must not double-blend semi-transparent pixels
      const X = x + chosen.x0, Y = y + chosen.y0, nIn = (X > 0 && cc.label[si - 1] === chosen.id) && (X < w - 1 && cc.label[si + 1] === chosen.id) && (Y > 0 && cc.label[si - w] === chosen.id) && (Y < h - 1 && cc.label[si + w] === chosen.id);
      if (!nIn) a = px[si * 4 + 3];
    }
    if (inside && !hasAlpha && bgColor) {   // soften the 1px fringe next to the removed background
      const edge = (x > 0 && !mask[di - 1] && x + chosen.x0 > 0 && cc.label[si - 1] !== chosen.id) || (y > 0 && cc.label[si - w] !== chosen.id);
      if (edge) { const d = Math.abs(px[si * 4] - bgColor[0]) + Math.abs(px[si * 4 + 1] - bgColor[1]) + Math.abs(px[si * 4 + 2] - bgColor[2]); a = Math.min(255, Math.round((d / (TOL * 2.5)) * 255)); }
    }
    out[di * 4 + 3] = a;
  }
  const sil = measureSilhouette(mask, bw, bh), guess = guessFromSilhouette(sil);
  return { ok: true, mode, warnings, cutout: { data: out, width: bw, height: bh }, silhouette: sil, guess, skinFrac };
}
