// Browser side of garment preparation: loads the product image (direct, CORS, or through the licence-checked server fetch),
// runs the pixel analysis in segment.js and returns a cropped, background-free garment canvas plus its silhouette.
// Refuses (ok:false + reason) photos of people, busy backgrounds, multiple garments, unreadable or tiny images.
import { analyzePixels } from './segment.js';

const MAX_SIDE = 1100;
const cache = new Map();

function loadImg(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(Object.assign(new Error('image'), { code: 'IMAGE' }));
    img.src = src;
  });
}

/** Load for pixel reading: same-origin/CORS first, then the server fetch (when allowed), else a tainted (unreadable) image. */
export async function loadReadable(url, proxy) {
  try { return { img: await loadImg(url, true), tainted: false, via: 'cors' }; } catch { /* no CORS headers or broken URL */ }
  if (proxy && proxy.apiUrl && proxy.license) {
    try {
      const res = await fetch(`${proxy.apiUrl}/api/image/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license: proxy.license, domain: location.hostname, url }) });
      if (res.ok) {
        const objUrl = URL.createObjectURL(await res.blob());
        try { return { img: await loadImg(objUrl, false), tainted: false, via: 'server' }; } finally { setTimeout(() => URL.revokeObjectURL(objUrl), 5000); }
      }
    } catch { /* fall through */ }
  }
  return { img: await loadImg(url, false), tainted: true, via: 'plain' };        // displayable but pixel data is blocked
}

export function prepareGarment(url, { family = null, proxy = null } = {}) {
  const key = `${url}|${family || ''}`;
  if (cache.has(key)) return cache.get(key);
  const p = loadReadable(url, proxy).then(({ img, tainted, via }) => {
    if (tainted) return { ok: false, reason: 'CORS', tainted: true };
    // Raster images are never upscaled; vector images (SVG) have an arbitrary natural size and are rasterised at full analysis size.
    const vector = /\.svg(\?|#|$)|^data:image\/svg/i.test(url);
    const sc = vector ? MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1) : Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(2, Math.round(img.naturalWidth * sc)), h = Math.max(2, Math.round(img.naturalHeight * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    let data;
    try { data = ctx.getImageData(0, 0, w, h); } catch { return { ok: false, reason: 'CORS', tainted: true }; }
    const r = analyzePixels({ data: data.data, width: w, height: h }, { expectedFamily: family });
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, mode: r.mode };
    const cut = document.createElement('canvas'); cut.width = r.cutout.width; cut.height = r.cutout.height;
    cut.getContext('2d').putImageData(new ImageData(r.cutout.data, r.cutout.width, r.cutout.height), 0, 0);
    return { ok: true, image: cut, width: cut.width, height: cut.height, silhouette: r.silhouette, guess: r.guess, mode: r.mode, warnings: r.warnings, via, source: { width: img.naturalWidth, height: img.naturalHeight } };
  });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}

/**
 * Tries image candidates (best first) until one loads AND passes analysis (a gallery may contain a flat-lay when the main
 * image is a model photo). Returns { ok:true, url, source, prepared } or { ok:false, reason }.
 */
export async function resolveGarment(candidates, opts = {}) {
  let firstFailure = null, loadFailures = 0;
  for (const c of candidates.slice(0, 8)) {
    let prepared;
    try { prepared = await prepareGarment(c.url, opts); } catch { loadFailures++; continue; }     // 404 / blocked / not an image: next candidate
    if (prepared.ok) return { ok: true, url: c.url, source: c.source, prepared };
    if (!firstFailure) firstFailure = { reason: prepared.reason, source: c.source };
  }
  return firstFailure ? { ok: false, ...firstFailure } : { ok: false, reason: loadFailures ? 'LOAD' : 'NONE' };
}
