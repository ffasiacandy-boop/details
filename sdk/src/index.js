import { MSG, messageForCode, messageForImageReason } from './messages.js';
import { createLicenseClient } from './license.js';
import { Camera } from './camera.js';
import { PoseTracker } from './pose.js';
import { Renderer } from './renderer.js';
import { createAdapter, supportedCategories, isKnownUnsupported } from './adapters/index.js';
import { familyOf, canonicalCategory } from './fit/profiles.js';
import { resolveImageCandidates, selectionSignature } from './detect/resolver.js';
import { TryOnModal } from './ui/modal.js';
import { extractProduct, looksLikeProductPage } from './detect/product.js';
import { resolveGarment } from './detect/image.js';
import { createLauncher } from './detect/launcher.js';

/* global __VTO_API_URL__ */
const BUILD_API_URL = typeof __VTO_API_URL__ === 'string' ? __VTO_API_URL__ : '';
const SCRIPT = document.currentScript;
const SCRIPT_ORIGIN = (() => { try { return new URL(SCRIPT.src).origin; } catch { return ''; } })();
const API_KEY_RE = /^vto_[a-z0-9_]{8,64}$/i;
const log = (...a) => console.error('[VirtualTryOn]', ...a);

function checkConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'init() needs a configuration object.';
  if (typeof cfg.apiKey !== 'string' || !API_KEY_RE.test(cfg.apiKey.trim())) return 'Invalid or missing "apiKey" (expected vto_...).';
  return null;
}

function cameraErrorMessage(e) {
  switch (e && e.name) {
    case 'NotAllowedError': case 'SecurityError': case 'PermissionDeniedError': return MSG.permission;
    case 'NotReadableError': case 'AbortError': return MSG.cameraBusy;
    default: return MSG.noCamera;
  }
}

function createInstance(cfg) {
  const configError = checkConfig(cfg);
  if (configError) log(configError);
  const apiUrl = (cfg && cfg.apiUrl) || BUILD_API_URL || SCRIPT_ORIGIN;
  const licenseKey = configError ? '' : cfg.apiKey.trim().toLowerCase();
  const licenseClient = configError ? null : createLicenseClient({ apiUrl, license: licenseKey });
  const legacy = !!(cfg && cfg.fitting === 'legacy');
  const imgOpts = () => ({ imageSelector: cfg.imageSelector, imageResolver: cfg.imageResolver });
  let product = null;

  // Resolves WHAT the shopper is looking at right now: product text + the best usable garment image on the page
  // (main image -> selected variant -> gallery -> page JS state -> JSON-LD/og:image). Nothing is uploaded by the shopper.
  async function resolveProduct(extra) {
    const found = { ...extractProduct(), ...(cfg.product || {}), ...(extra || {}) };
    const category = found.category;
    if (category && isKnownUnsupported(category)) return { error: MSG.unsupportedCategory, product: found };
    if (category && !canonicalCategory(category) && !createAdapter(category, found, { legacy })) return { error: MSG.unsupportedCategory, product: found };
    const family = category ? familyOf(category) : null;
    let cands;
    if (found.garmentImage && (cfg.product && cfg.product.garmentImage || extra && extra.garmentImage)) cands = [{ url: new URL(found.garmentImage, location.href).href, source: 'config' }];
    else cands = await resolveImageCandidates({ ...imgOpts(), jsonLdImage: found.garmentImage });
    if (!cands.length) return { error: MSG.noProduct, product: found };
    const proxy = { apiUrl, license: licenseKey };
    const res = await resolveGarment(cands, { family, proxy });
    if (!res.ok) return { error: res.reason === 'LOAD' ? MSG.imageFail : res.reason === 'NONE' ? MSG.noProduct : messageForImageReason(res.reason), reason: res.reason, product: found };
    found.garmentImage = res.url; found.imageSource = res.source; found._proxy = proxy;
    if (!found.category && res.prepared.guess.category && res.prepared.guess.confidence >= 0.3) { found.category = res.prepared.guess.category; found.categorySource = 'image'; }
    if (!found.category || (!createAdapter(found.category, found, { legacy }))) return { error: MSG.unsupportedCategory, product: found };
    return { product: found, warnings: res.prepared.warnings || [] };
  }

  let modal = null, camera = null, tracker = null, renderer = null;
  let opened = false, running = false, destroyed = false, raf = 0, facing = 'user', lastBlob = null;
  let lastVideoTime = -1, lastDetect = 0, infMs = 0, interval = 0, seen = 0, lastSeen = 0, state = 'info', frame = 0, slowFrames = 0, hintShown = '';
  const layers = {};                                  // family -> adapter currently worn ('top' | 'bottom' | 'full')
  const worn = () => Object.values(layers);
  const triggers = [];
  let watcher = null, lastSig = '', switching = false;

  function ensureModal() {
    if (modal) return;
    modal = new TryOnModal({
      onClose: close, onStart: startCamera, onStop: stopCamera, onSwitch: switchCamera, onCapture: capture,
      onRetry: () => { camera && camera.stop(); modal.screen('intro'); },
      onRetake: resume, onDownload: download,
    });
    camera = new Camera(modal.video);
    renderer = new Renderer(modal.canvas);
  }

  async function open() {
    if (destroyed || opened) return;
    opened = true;
    ensureModal();
    modal.show('');
    modal.screen('loading', MSG.loading);
    if (configError) return modal.error(MSG.unavailable, { retry: false });
    const res = await licenseClient.validate();       // authoritative backend check on every open
    if (!opened) return;
    if (!res.ok) return modal.error(res.message || messageForCode(res.code), { retry: false });
    const r = await resolveProduct();
    if (!opened) return;
    if (r.product) { product = r.product; modal.setProduct([product.name, product.price].filter(Boolean).join(' \u00b7 ')); }
    if (r.error) { log(`Not supported: ${r.error} (category: ${r.product && r.product.category}). Supported: ${supportedCategories().join(', ')}`); return modal.error(r.error, { retry: false }); }
    if (!Camera.supported()) return modal.error(MSG.unsupportedBrowser, { retry: false });
    for (const k of Object.keys(layers)) if (layers[k].isPage) delete layers[k];
    lastSig = selectionSignature(imgOpts());
    startWatch();
    modal.screen('intro');
  }

  async function ensureTracker() {
    if (!tracker) tracker = new PoseTracker(cfg.assets, { segmentation: cfg.segmentation !== false });
    await tracker.load();
  }

  // Put a product on as a layer. top/bottom coexist (outfit); full-body replaces both; a new item replaces the same family.
  async function wear(p, { page = false } = {}) {
    const a = createAdapter(p.category, p, { legacy });
    if (!a) throw Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED' });
    a.isPage = page; await a.load();
    const fam = a.family || 'top';
    if (fam === 'full') { delete layers.top; delete layers.bottom; } else delete layers.full;
    layers[fam] = a;
    return a;
  }

  async function startCamera() {
    if (running) return;
    modal.screen('loading', MSG.loading);
    const trackerReady = ensureTracker(); trackerReady.catch(() => {});   // load AI while the permission prompt is open
    try { await camera.start(facing); } catch (e) { return modal.error(cameraErrorMessage(e)); }
    if (!opened) { camera.stop(); return; }
    try {
      await Promise.all([layers && Object.values(layers).some((a) => a.isPage) ? null : wear(product, { page: true }), trackerReady]);
      for (const extra of (cfg.outfit || [])) { try { const r = await resolveProduct(extra); if (r.product && !r.error) await wear(r.product); } catch { /* optional extra item */ } }
    } catch (e) {
      camera.stop();
      return modal.error(e && e.code === 'IMAGE' ? MSG.imageFail : e && e.code === 'UNSUPPORTED' ? MSG.unsupportedCategory : MSG.modelFail);
    }
    if (!opened) { camera.stop(); return; }
    begin();
    modal.showSwitch(await camera.hasMultiple());
  }

  function begin() {
    renderer.setMirror(camera.mirrored);
    worn().forEach((a) => a.reset && a.reset());
    modal.screen('live');
    modal.status('info', MSG.stand);
    state = 'info'; seen = 0; lastSeen = performance.now(); lastVideoTime = -1; lastDetect = 0; infMs = 0; interval = 0; frame = 0; slowFrames = 0; hintShown = '';
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function makePose(lm) {
    return {
      width: renderer.cw, height: renderer.ch,
      get(i) {
        const p = lm[i];
        if (!p || (p.visibility !== undefined && p.visibility < 0.5)) return null;
        if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) return null;
        const c = renderer.toCanvas(p.x, p.y);
        return { x: c.x, y: c.y, z: p.z || 0 };
      },
    };
  }

  // Arms in front of the torso: reveal the camera's own arm/hand over the garment (depth order from MediaPipe z).
  // Thresholds are heuristics that must be tuned on real footage. Long-sleeved tops only reveal the hands.
  function armCapsules(pose) {
    const top = layers.top || layers.full;
    if (!top) return [];
    const ls = pose.get(11), rs = pose.get(12);
    if (!ls || !rs) return [];
    const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y), cx = (ls.x + rs.x) / 2, out = [];
    for (const [s, e, w, hand] of [[ls, pose.get(13), pose.get(15), pose.get(19)], [rs, pose.get(14), pose.get(16), pose.get(20)]]) {
      if (!e || !w) continue;
      const inFront = w.z < s.z - 0.2 && Math.abs(w.x - cx) < sw * 0.65 && w.y > Math.min(ls.y, rs.y);
      if (!inFront) continue;
      if (top.longSleeve) out.push({ from: w, to: hand || w, w: sw * 0.2 });
      else out.push({ from: e, to: hand || w, w: sw * 0.22 });
    }
    return out;
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const v = camera.video;
    if (v.readyState < 2 || !v.videoWidth || v.currentTime === lastVideoTime) return;   // draw only on new camera frames
    lastVideoTime = v.currentTime;
    renderer.layout(v);
    let arms = [];

    if (now - lastDetect >= interval) {                 // adaptive frame skipping: slower devices detect less often
      lastDetect = now; frame++;
      const t0 = performance.now();
      let lm = null;
      try { lm = tracker.detect(v, frame % 3 === 0 && !!layers.top); } catch { /* skip this frame */ }
      const dt = performance.now() - t0;
      infMs = infMs ? infMs * 0.8 + dt * 0.2 : dt;
      interval = infMs < 22 ? 0 : infMs < 40 ? 33 : infMs < 70 ? 66 : 100;     // ~30 / 20 / 12 / 8 detections per second
      if (tracker.segmentation && infMs > 55 && ++slowFrames > 40) { slowFrames = -1e9; tracker.disableSegmentation().catch(() => {}); }   // device too slow: drop the body mask first
      const pose = lm ? makePose(lm) : null;
      let tracked = false, hint = null;
      for (const a of worn()) {
        if (a.update(pose, now / 1000)) tracked = true;
        if (a.hint && (a.hint !== 'legs' || !hint)) hint = a.hint;      // body-position hints win over the softer "legs" hint
      }
      if (pose && tracked) arms = armCapsules(pose);
      if (tracked) {
        lastSeen = now; seen += 1;
        if (hint === 'legs') { if (hintShown !== 'legs') { hintShown = 'legs'; state = 'warn'; modal.status('warn', MSG.hintLegs); } }
        else if (seen >= 3 && state !== 'ok') { state = 'ok'; hintShown = ''; modal.status('ok', MSG.ready); }
      } else {
        seen = 0;
        if (now - lastSeen > 600) {
          const text = !pose ? MSG.move : hint === 'shoulders' ? MSG.hintShoulders : hint === 'hips' ? MSG.hintHips : hint === 'closer' ? MSG.hintCloser : MSG.move;
          if (hintShown !== text) { hintShown = text; state = 'warn'; modal.status('warn', text); }
        }
      }
      renderer._arms = arms;
    }
    renderer.draw(v, worn(), now - lastSeen < 600 && !switching, { mask: tracker && tracker.segmentation ? tracker.mask : null, arms: renderer._arms });
  }

  function pause() { running = false; cancelAnimationFrame(raf); }
  function resume() { if (!camera.stream) return; modal.screen('live'); running = true; lastVideoTime = -1; raf = requestAnimationFrame(loop); }

  function stopCamera() { pause(); camera.stop(); modal.screen('intro'); }

  async function switchCamera() {
    const next = facing === 'user' ? 'environment' : 'user';
    pause();
    try { await camera.start(next); facing = next; } catch { try { await camera.start(facing); } catch (e) { return modal.error(cameraErrorMessage(e)); } modal.toast('Could not switch camera.'); }
    begin();
  }

  function capture() {
    try {
      renderer.canvas.toBlob((blob) => {
        if (!blob) return modal.toast(MSG.captureFail);
        if (lastBlob) URL.revokeObjectURL(lastBlob.url);
        lastBlob = { blob, url: URL.createObjectURL(blob) };
        pause();
        modal.preview(lastBlob.url);
      }, 'image/png');
    } catch { modal.toast(MSG.captureFail); }     // canvas tainted by a cross-origin image without CORS headers
  }

  function download() {      // stays on the device: a local file download, nothing is uploaded
    if (!lastBlob) return;
    const a = document.createElement('a');
    a.href = lastBlob.url; a.download = `try-on-${product.id}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /**
   * Garment switch without a page reload: the camera stream, pose model and other layers stay as they are. The previous
   * page garment is removed FIRST (so it never lingers while the new one loads), then the new one is prepared and worn.
   */
  async function refresh(extra) {
    if (!opened || switching) return false;
    switching = true;
    try {
      for (const k of Object.keys(layers)) if (layers[k].isPage) delete layers[k];
      if (running) modal.status('info', MSG.switching);
      const r = await resolveProduct(extra);
      if (!opened) return false;
      if (r.product) { product = r.product; modal.setProduct([product.name, product.price].filter(Boolean).join(' \u00b7 ')); }
      if (r.error) { modal.toast(r.error); return false; }
      await wear(r.product, { page: true });
      worn().forEach((a) => a.reset && a.reset());
      state = 'info'; seen = 0; hintShown = '';
      return true;
    } catch (e) { modal.toast(e && e.code === 'UNSUPPORTED' ? MSG.unsupportedCategory : MSG.imageFail); return false; }
    finally { switching = false; }
  }

  // Add an extra garment (e.g. jeans with the page's T-shirt) as another layer: { garmentImage, category, name }.
  async function addGarment(item) {
    if (!opened || !item || !item.garmentImage) return false;
    const r = await resolveProduct({ ...item, garmentImage: item.garmentImage });
    if (r.error) { modal.toast(r.error); return false; }
    await wear(r.product); worn().forEach((a) => a.reset && a.reset()); return true;
  }
  function removeGarment(family) { delete layers[family]; }

  // Watches the page for colour/variant/gallery changes while the try-on is open and swaps the garment in place.
  function startWatch() {
    if (watcher) return;
    let timer = 0;
    const check = () => { clearTimeout(timer); timer = setTimeout(() => { if (!opened) return; const sig = selectionSignature(imgOpts()); if (sig !== lastSig) { lastSig = sig; refresh(); } }, 450); };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'aria-checked', 'aria-pressed', 'aria-current', 'checked'] });
    document.addEventListener('change', check, true); document.addEventListener('click', check, true);
    watcher = () => { clearTimeout(timer); obs.disconnect(); document.removeEventListener('change', check, true); document.removeEventListener('click', check, true); };
  }
  function stopWatch() { if (watcher) { watcher(); watcher = null; } }

  function close() {
    if (!opened) return;
    opened = false; pause(); stopWatch();
    if (camera) camera.stop();
    if (lastBlob) { URL.revokeObjectURL(lastBlob.url); lastBlob = null; }
    for (const k of Object.keys(layers)) delete layers[k];
    if (modal) modal.hide();
  }

  function destroy() {
    close(); destroyed = true;
    triggers.forEach(([el, fn]) => el.removeEventListener('click', fn));
    if (tracker) tracker.close();
    if (modal) modal.destroy();
  }

  function bindTrigger(t) {
    const els = typeof t === 'string' ? document.querySelectorAll(t) : t instanceof Element ? [t] : [];
    els.forEach((el) => { const fn = (e) => { e.preventDefault(); open(); }; el.addEventListener('click', fn); triggers.push([el, fn]); });
  }
  if (cfg && cfg.trigger) bindTrigger(cfg.trigger);

  // Early, silent validation so integrators can see problems; open() always re-validates.
  const ready = licenseClient ? licenseClient.validate().then((r) => { if (!r.ok) log(`API key check failed (${r.code || 'invalid'}).`); return r.ok; }) : Promise.resolve(false);

  return { open, close, destroy, ready, refresh, addGarment, removeGarment, resolve: resolveProduct };
}

/**
 * Zero-config mode: <script src=".../vto.js" data-api-key="vto_..." defer></script>
 * Finds the product on the page, and shows a "Virtual Try-On" button on every product page.
 * The button only appears while the API key is valid (disabling the key in the admin panel removes it).
 */
function autoMount(opts) {
  let instance = null, launcher = null, mountedFor = '', timer = 0, busy = false;

  async function sync() {
    if (busy) return;
    busy = true;
    try {
      const isProduct = looksLikeProductPage();
      const sig = isProduct ? location.href : '';
      if (!isProduct) { teardown(); mountedFor = ''; return; }
      if (launcher && launcher.host.isConnected && mountedFor === sig) return;
      if (launcher && mountedFor === sig) { launcher.ensureAttached(); return; }
      teardown();
      mountedFor = sig;
      const inst = createInstance({ apiKey: opts.apiKey, apiUrl: opts.apiUrl, assets: opts.assets, imageSelector: opts.imageSelector, imageResolver: opts.imageResolver, segmentation: opts.segmentation, fitting: opts.fitting });
      const ok = await inst.ready;                      // key must be valid for this domain, else no button at all
      if (mountedFor !== sig) { inst.destroy(); return; }
      if (!ok) { inst.destroy(); mountedFor = ''; return; }
      instance = inst;
      launcher = createLauncher({ text: opts.buttonText, color: opts.buttonColor, selector: opts.selector, position: opts.position, onClick: () => inst.open() });
    } finally { busy = false; }
  }
  function teardown() { if (launcher) launcher.destroy(); if (instance) instance.destroy(); launcher = null; instance = null; }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(sync, 700); };

  sync();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });   // SPA navigation / late rendering
  for (const m of ['pushState', 'replaceState']) { const o = history[m]; history[m] = function (...a) { const r = o.apply(this, a); schedule(); return r; }; }
  window.addEventListener('popstate', schedule);
  return { destroy() { clearTimeout(timer); teardown(); } };
}

const VirtualTryOn = {
  version: '3.0.0',
  /** Manual mode. `product` is optional: anything omitted is detected from the page. */
  async init(config) { return createInstance(config); },
  autoMount,
  /** Debug helper: what the SDK detects on the current page (name, price, image, category and how it was found). */
  async detect() {
    const p = extractProduct();
    if (p.garmentImage) {
      p.candidates = (await resolveImageCandidates({ jsonLdImage: p.garmentImage })).slice(0, 8);
      try {
        const g = await resolveGarment(p.candidates, { family: p.category ? familyOf(p.category) : null });
        p.image = g.ok ? { url: g.url, source: g.source, mode: g.prepared.mode, guess: g.prepared.guess, warnings: g.prepared.warnings } : { unsupported: g.reason };
        if (g.ok && !p.category && g.prepared.guess.category) { p.category = g.prepared.guess.category; p.categorySource = 'image'; }
      } catch { p.image = { error: true }; }
    }
    return p;
  },
};
window.VirtualTryOn = VirtualTryOn;

if (SCRIPT && SCRIPT.dataset && SCRIPT.dataset.apiKey && SCRIPT.dataset.auto !== 'false') {
  const d = SCRIPT.dataset;
  const start = () => autoMount({ apiKey: d.apiKey, apiUrl: d.apiUrl, buttonText: d.buttonText, buttonColor: d.buttonColor, selector: d.selector, position: d.position, imageSelector: d.imageSelector, segmentation: d.segmentation !== 'false', fitting: d.fitting });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
