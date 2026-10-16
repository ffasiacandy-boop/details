// Finds the image of the product/variant the shopper is CURRENTLY looking at, trying sources in this order:
//   1 selected main image element   2 selected variant's image   3 gallery images   4 page JS state   5 JSON-LD / og:image
// Returns an ordered, de-duplicated candidate list; the SDK tries them in turn until one loads and passes analysis.
// The pure helpers (srcset parsing, ranking, upsizing, variant matching) take plain data so they can be tested in Node.

export const parseSrcset = (s) => String(s || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
  const [url, d] = p.split(/\s+/); const m = /^(\d+(?:\.\d+)?)(w|x)$/.exec(d || '');
  return { url, score: m ? Number(m[1]) * (m[2] === 'x' ? 1000 : 1) : 0 };
}).filter((x) => x.url);
export const bestFromSrcset = (s) => { const l = parseSrcset(s).sort((a, b) => b.score - a.score); return l[0] ? l[0].url : ''; };

/** Larger-size variants of well-known CDN thumbnail URLs. Always tried BEFORE the original; the original is the fallback. */
export function upsizeCandidates(url) {
  const out = [];
  try {
    const u = new URL(url, 'http://x.invalid');
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) {
      const big = url.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.[a-z]+(\?|$))/i, '');
      if (big !== url) out.push(big);
      const w = new URL(url, 'https://x.invalid'); if (w.searchParams.has('width')) { w.searchParams.set('width', '1600'); w.searchParams.delete('height'); out.push(w.href.replace('https://x.invalid', '')); }
    }
    if (/-\d{2,4}x\d{2,4}\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname)) out.push(url.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))/i, '$1'));   // WooCommerce/WordPress thumbnails
  } catch { /* keep original only */ }
  return out;
}

const clean = (u) => String(u || '').trim();
export function dedupe(list) {
  const seen = new Set(), out = [];
  for (const c of list) { const k = c.url.replace(/^https?:/, '').replace(/[?#].*$/, ''); if (!c.url || /^data:image\/gif|spacer|pixel|blank\./i.test(c.url) || seen.has(k + (c.keepQuery ? c.url : ''))) continue; seen.add(k + (c.keepQuery ? c.url : '')); out.push(c); }
  return out;
}

/** Variant lookup in product JSON as exposed by Shopify (variants[].featured_image.src), WooCommerce (variations[].image) and generic shapes. */
export function variantImageFromProduct(product, { variantId, options } = {}) {
  if (!product || typeof product !== 'object') return '';
  const variants = product.variants || product.variations || product.hasVariant || [];
  if (!Array.isArray(variants)) return '';
  const img = (v) => { const i = (v.featured_image && (v.featured_image.src || v.featured_image.url)) || (v.image && (typeof v.image === 'string' ? v.image : v.image.full_src || v.image.src || v.image.url)) || v.image_url || ''; return typeof i === 'string' ? i : ''; };
  let hit = null;
  if (variantId) hit = variants.find((v) => String(v.id || v.variation_id || v.sku) === String(variantId));
  if (!hit && options && options.length) {
    const want = options.map((o) => String(o).toLowerCase());
    hit = variants.find((v) => { const o = [v.option1, v.option2, v.option3, ...(v.attributes ? Object.values(v.attributes) : [])].filter(Boolean).map((x) => String(x).toLowerCase()); return want.every((w) => o.includes(w)); });
  }
  return hit ? clean(img(hit)) : '';
}

// ------------------------------------------------------------------------------------------------ DOM part
const GALLERY_ACTIVE = '[data-vto-image],.woocommerce-product-gallery__image.flex-active-slide img,.woocommerce-product-gallery__image:first-child img,.swiper-slide-active img,.slick-current img,.product__media-item.is-active img,.product-gallery__image.is-selected img,[aria-current="true"] img,.is-selected img,.selected img,.active img';
const GALLERY_ROOT = '[class*="gallery" i],[class*="product-media" i],[class*="product__media" i],[class*="product-image" i],[class*="product-photo" i],[id*="gallery" i],[id*="product-image" i],[data-gallery],[class*="images" i]';
const SKIP = 'header,footer,nav,[class*="related" i],[class*="recommend" i],[class*="upsell" i],[class*="cross-sell" i],[class*="recent" i],[class*="carousel-item" i]:not([class*="active" i])';
const LAZY_ATTRS = ['data-zoom-image', 'data-large_image', 'data-large-image', 'data-zoom', 'data-full', 'data-original', 'data-image', 'data-src', 'data-lazy-src', 'data-lazy'];

const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
const abs = (u) => { try { return u ? new URL(u, location.href).href : ''; } catch { return ''; } };

/** Highest-resolution URL an <img> (or its zoom wrapper) offers. */
export function imgUrls(img) {
  const out = [];
  const wrap = img.closest('a[href],[data-zoom-image],[data-large_image]');
  if (wrap) for (const a of ['data-zoom-image', 'data-large_image', 'data-large-image']) if (wrap.getAttribute(a)) out.push(wrap.getAttribute(a));
  if (wrap && wrap.tagName === 'A' && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(wrap.getAttribute('href') || '')) out.push(wrap.getAttribute('href'));
  for (const a of LAZY_ATTRS) if (img.getAttribute(a) && /[./]/.test(img.getAttribute(a)) && !/\s\d+[wx]/.test(img.getAttribute(a))) out.push(img.getAttribute(a));
  const pic = img.closest('picture'); if (pic) for (const s of pic.querySelectorAll('source[srcset]')) out.push(bestFromSrcset(s.getAttribute('srcset')));
  out.push(bestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset')), img.currentSrc, img.src);
  return out.filter(Boolean);
}

function mainImageEl(opts) {
  if (opts.imageSelector) { const el = document.querySelector(opts.imageSelector); if (el) return el.tagName === 'IMG' ? el : el.querySelector('img'); }
  const active = [...document.querySelectorAll(GALLERY_ACTIVE)].filter((i) => i.tagName === 'IMG' && visible(i) && !i.closest(SKIP));
  const pick = (list) => list.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
  const roots = [...document.querySelectorAll(GALLERY_ROOT)].filter((r) => !r.closest(SKIP));
  const inRoots = []; for (const r of roots) for (const i of r.querySelectorAll('img')) if (visible(i) && !i.closest(SKIP) && i.getBoundingClientRect().width >= 150) inRoots.push(i);
  return (active.length && pick(active)) || (inRoots.length && pick(inRoots)) || null;
}

function selectedVariant() {
  const q = new URLSearchParams(location.search), variantId = q.get('variant') || (document.querySelector('form[action*="/cart/add"] [name="id"]') || {}).value || (document.querySelector('input.variation_id') || {}).value || '';
  const options = [...document.querySelectorAll('input[type="radio"]:checked,select option:checked,[aria-checked="true"],[aria-pressed="true"],.swatch.is-selected,.swatch.selected,[class*="swatch" i][class*="active" i]')]
    .map((e) => e.value || e.getAttribute('data-value') || e.getAttribute('title') || e.getAttribute('aria-label') || '').filter((v) => v && v.length < 40);
  return { variantId, options };
}

function pageProducts() {
  const out = [];
  const w = window;
  for (const p of [w.meta && w.meta.product, w.ShopifyAnalytics && w.ShopifyAnalytics.meta && w.ShopifyAnalytics.meta.product, w.product, w.productData, w.__PRODUCT__]) if (p && typeof p === 'object') out.push(p);
  const nd = w.__NEXT_DATA__ && w.__NEXT_DATA__.props && w.__NEXT_DATA__.props.pageProps; if (nd && (nd.product || nd.initialProduct)) out.push(nd.product || nd.initialProduct);
  for (const s of document.querySelectorAll('script[type="application/json"][data-product-json],script[type="application/json"][id*="ProductJson" i],script[type="application/json"][data-product]')) { try { const j = JSON.parse(s.textContent); out.push(j.product || j); } catch { /* ignore */ } }
  const wc = document.querySelector('form.variations_form[data-product_variations]'); if (wc) { try { out.push({ variations: JSON.parse(wc.getAttribute('data-product_variations')) }); } catch { /* ignore */ } }
  return out;
}
const productImages = (p) => { const l = []; const push = (i) => { const u = typeof i === 'string' ? i : i && (i.src || i.url || i.full_src); if (u) l.push(u); }; (Array.isArray(p.images) ? p.images : []).forEach(push); push(p.featured_image); push(p.image); return l; };

/**
 * @param {{imageSelector?:string, imageResolver?:Function, jsonLdImage?:string, ogImage?:string}} opts
 * @returns {Promise<{url:string, source:string}[]>} best first
 */
export async function resolveImageCandidates(opts = {}) {
  const cands = [];
  const add = (url, source, extra) => { const a = abs(clean(url)); if (!a) return; for (const big of upsizeCandidates(a)) cands.push({ url: abs(big), source: `${source}+hires`, ...extra }); cands.push({ url: a, source, ...extra }); };

  if (typeof opts.imageResolver === 'function') {                            // integrator override has absolute priority
    try { const r = await opts.imageResolver({ document, location }); for (const u of [].concat(r || [])) add(u, 'custom-resolver'); } catch { /* fall through to automatic sources */ }
  }
  const main = mainImageEl(opts);                                            // 1. selected main image
  if (main) for (const u of imgUrls(main)) add(u, 'main-image');
  const { variantId, options } = selectedVariant();                          // 2. selected variant
  const products = pageProducts();
  for (const p of products) { const v = variantImageFromProduct(p, { variantId, options }); if (v) add(v, 'variant'); }
  const root = main && main.closest(GALLERY_ROOT);                           // 3. gallery
  const gallery = root ? [...root.querySelectorAll('img')].filter((i) => !i.closest(SKIP)) : [];
  for (const i of gallery) if (i.getBoundingClientRect().width >= 80) for (const u of imgUrls(i).slice(0, 2)) add(u, 'gallery');
  for (const p of products) for (const u of productImages(p)) add(u, 'page-state');   // 4. JS state
  if (opts.jsonLdImage) add(opts.jsonLdImage, 'json-ld');                    // 5. structured data
  if (opts.ogImage) add(opts.ogImage, 'og-image');
  return dedupe(cands);
}

/** Stable signature of "what is selected right now": changes when the shopper picks another colour/variant. */
export function selectionSignature(opts = {}) {
  const main = mainImageEl(opts), v = selectedVariant();
  return [location.pathname, v.variantId, v.options.join(','), main ? (main.currentSrc || main.src) : ''].join('|');
}
