// Draws the mirrored/cover-fitted camera frame, then the garment layers, on a single canvas.
// Layer order (back to front): bottom wear, full-body, top wear. Each layer is rendered off-screen first so the whole
// layer can be lit to match the room, given a soft contact shadow, and (top wear) trimmed to the person silhouette.
const ORDER = ['bottom', 'full', 'top'];
const mk = () => document.createElement('canvas');

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.mirror = true; this.alpha = 0;
    this.cw = canvas.width; this.ch = canvas.height;
    this.ox = 0; this.oy = 0; this.dw = 1; this.dh = 1;
    this.layers = {}; this.lum = 0.5; this.frame = 0;
    this.sampler = mk(); this.sampler.width = 16; this.sampler.height = 12; this.sctx = this.sampler.getContext('2d', { willReadFrequently: true });
    this.maskCanvas = null; this.dilated = null; this.maskStamp = null; this.filterOk = null;
    this.stats = { layerMs: 0 };
  }
  setMirror(m) { this.mirror = !!m; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; }
    this.cw = w; this.ch = h;
  }

  layout(video) {
    this.resize();
    const s = Math.max(this.cw / video.videoWidth, this.ch / video.videoHeight);   // "cover"
    this.dw = video.videoWidth * s; this.dh = video.videoHeight * s;
    this.ox = (this.cw - this.dw) / 2; this.oy = (this.ch - this.dh) / 2;
  }

  /** normalized video coords -> canvas pixels (accounts for mirroring) */
  toCanvas(nx, ny) { return { x: this.ox + (this.mirror ? 1 - nx : nx) * this.dw, y: this.oy + ny * this.dh }; }

  _layer(name) {
    const l = this.layers[name] || (this.layers[name] = mk());
    if (l.width !== this.cw || l.height !== this.ch) { l.width = this.cw; l.height = this.ch; }
    const c = l.getContext('2d'); c.clearRect(0, 0, this.cw, this.ch); return { l, c };
  }

  _lighting(video) {                                   // average brightness of the camera frame, cheap (16x12 sample, every 8th frame)
    if (this.frame % 8) return;
    try { this.sctx.drawImage(video, 0, 0, 16, 12); const d = this.sctx.getImageData(0, 0, 16, 12).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; this.lum += (s / (d.length / 4) / 255 - this.lum) * 0.5; } catch { /* ignore */ }
  }

  _dilatedMask(mask, radius) {                          // person silhouette grown by `radius` px so loose garments are not cut off
    if (!mask) return null;
    if (this.maskStamp !== mask) {
      this.maskStamp = mask;
      if (!this.maskCanvas) this.maskCanvas = mk();
      this.maskCanvas.width = mask.w; this.maskCanvas.height = mask.h;
      const id = new ImageData(mask.w, mask.h); for (let i = 0; i < mask.data.length; i++) { id.data[i * 4 + 3] = mask.data[i]; }
      this.maskCanvas.getContext('2d').putImageData(id, 0, 0);
      this.dilated = null;
    }
    const key = `${this.cw}x${this.ch}x${Math.round(radius)}`;
    if (!this.dilated || this.dilated.key !== key) {
      const c = mk(); c.width = this.cw; c.height = this.ch; const x = c.getContext('2d'), r = Math.max(2, radius);
      x.save(); if (this.mirror) { x.translate(this.cw, 0); x.scale(-1, 1); }     // same transform the video gets
      for (let a = 0; a < 8; a++) x.drawImage(this.maskCanvas, this.ox + Math.cos((a * Math.PI) / 4) * r, this.oy + Math.sin((a * Math.PI) / 4) * r, this.dw, this.dh);
      x.drawImage(this.maskCanvas, this.ox, this.oy, this.dw, this.dh);
      x.restore();
      this.dilated = { key, canvas: c };
    }
    return this.dilated.canvas;
  }

  /**
   * @param adapters  array of adapters currently worn (any order)
   * @param opts { mask, arms }  mask: person mask from the tracker; arms: [{from,to,w}] capsules in canvas px to re-draw from the camera
   */
  draw(video, adapters, show, opts = {}) {
    const { ctx } = this; this.frame++;
    ctx.save();
    if (this.mirror) { ctx.translate(this.cw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, this.ox, this.oy, this.dw, this.dh);
    ctx.restore();
    this.alpha += ((show ? 1 : 0) - this.alpha) * 0.2;
    if (!adapters || !adapters.length || this.alpha < 0.02) return;
    const t0 = performance.now();
    this._lighting(video);
    const dark = this.lum < 0.45 ? (0.45 - this.lum) * 0.7 : 0, bright = this.lum > 0.7 ? (this.lum - 0.7) * 0.4 : 0;
    const sorted = [...adapters].sort((a, b) => ORDER.indexOf(a.family || 'top') - ORDER.indexOf(b.family || 'top'));
    for (const a of sorted) {
      const { l, c } = this._layer('cur');
      if (a.render) a.render(c); else a.draw(c, 1);              // legacy adapters draw with their own transform
      if (dark || bright) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = dark ? `rgba(0,0,0,${dark})` : `rgba(255,255,255,${bright})`; c.fillRect(0, 0, this.cw, this.ch); }
      if (a.family === 'top' && opts.mask && a.sw) {
        const m = this._dilatedMask(opts.mask, a.sw * 0.14);
        if (m) { c.globalCompositeOperation = 'destination-in'; c.drawImage(m, 0, 0); }
      }
      c.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.globalAlpha = this.alpha; ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = Math.max(6, this.cw * 0.012); ctx.shadowOffsetY = Math.max(2, this.cw * 0.004);
      ctx.drawImage(l, 0, 0); ctx.restore();
    }
    // Arms that are in front of the torso: show the real camera pixels through the garment (foreground/background order).
    if (opts.arms && opts.arms.length) {
      ctx.save();
      for (const arm of opts.arms) {
        ctx.save();   // clip to a capsule around the segment, then draw the camera frame through it
        const dx = arm.to.x - arm.from.x, dy = arm.to.y - arm.from.y, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * arm.w / 2, ny = (dx / l) * arm.w / 2;
        ctx.beginPath(); ctx.moveTo(arm.from.x + nx, arm.from.y + ny); ctx.lineTo(arm.to.x + nx, arm.to.y + ny); ctx.arc(arm.to.x, arm.to.y, arm.w / 2, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
        ctx.lineTo(arm.from.x - nx, arm.from.y - ny); ctx.arc(arm.from.x, arm.from.y, arm.w / 2, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false); ctx.closePath(); ctx.clip();
        if (this.mirror) { ctx.translate(this.cw, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, this.ox, this.oy, this.dw, this.dh);
        ctx.restore();
      }
      ctx.restore();
    }
    this.stats.layerMs = this.stats.layerMs * 0.9 + (performance.now() - t0) * 0.1;
  }
}
