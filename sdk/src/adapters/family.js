import { OneEuro } from '../smoothing.js';
import { PROFILES, canonicalCategory } from '../fit/profiles.js';
import { collectPoints, completePoints, BUILDERS } from '../fit/rig.js';
import { drawPlan } from '../fit/strips.js';
import { prepareGarment } from '../detect/image.js';
import { DEFAULT_CALIBRATION } from './base.js';

/**
 * One adapter class for the three families; behaviour comes from the category profile (fit/profiles.js) and the family
 * builder (fit/rig.js). Landmarks are smoothed with a One-Euro filter, missing ones are estimated from body proportions,
 * and the garment is drawn as strips along the wearer's spine / leg chains.
 */
export class FamilyAdapter {
  constructor(product, category) {
    this.product = product;
    this.category = canonicalCategory(category);
    this.profile = PROFILES[this.category];
    this.family = this.profile.family;
    this.longSleeve = !!this.profile.longSleeve;
    const src = { ...product, ...(product.config || {}) };
    this.cal = { ...DEFAULT_CALIBRATION };
    for (const k of ['widthRatio', 'heightRatio', 'offsetX', 'offsetY']) { const n = Number(src[k]); if (src[k] !== undefined && src[k] !== '' && Number.isFinite(n)) this.cal[k] = n; }
    this.g = null; this.reset();
  }

  async load() {
    const r = await prepareGarment(this.product.garmentImage, { family: this.family, proxy: this.product._proxy });
    if (!r.ok) throw Object.assign(new Error(r.reason), { code: 'IMAGE', reason: r.reason });
    this.g = r;
  }

  reset() { this.f = {}; this.plan = null; this.pts = null; this.hint = null; this.quality = null; }

  _filter(name, p, t, pw) {
    const f = this.f[name] || (this.f[name] = { x: new OneEuro({ minCutoff: 1.3, beta: 7 }), y: new OneEuro({ minCutoff: 1.3, beta: 7 }) });
    return { ...p, x: f.x.filter(p.x / pw, t) * pw, y: f.y.filter(p.y / pw, t) * pw };
  }

  /** @returns {boolean} true when the body is usable and a plan was produced */
  update(pose, t) {
    if (!pose || !this.g) return false;
    const c0 = completePoints(collectPoints(pose), this.family, pose.width);
    if (c0.hint) { this.hint = c0.hint; return false; }
    const pts = {};
    for (const [k, p] of Object.entries(c0.pts)) if (p) pts[k] = this._filter(k, p, t, pose.width);
    const c = completePoints(pts, this.family, pose.width);
    if (c.hint) { this.hint = c.hint; return false; }
    const img = { cw: this.g.width, ch: this.g.height };
    this.plan = BUILDERS[this.family](c, this.profile, this.cal, this.g.silhouette, img);
    this.pts = pts; this.sw = c.sw; this.quality = c0.q;
    this.hint = this.family !== 'top' && !c0.q.knees ? 'legs' : null;     // garment still shown (legs estimated) but the shopper is told
    return true;
  }

  /** Draws the garment (no global alpha / shading: the renderer owns compositing). */
  render(ctx) { if (this.plan && this.g) drawPlan(ctx, this.g.image, this.plan); }
}
