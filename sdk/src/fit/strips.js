// Draws a fitting plan: the garment image is cut into horizontal strips, and each strip is placed, rotated and scaled
// along the body (spine or leg chain). This follows leans, bends and body proportions instead of pasting a rigid sticker.
export function drawPlan(ctx, img, plan, strips = 30) {
  const cw = img.width, ch = img.height;
  for (const part of plan.parts) {
    const sx = part.sx0 * cw, sw = Math.max(1, (part.sx1 - part.sx0) * cw), stripLen = part.len / strips;
    for (let k = 0; k < strips; k++) {
      const t = (k + 0.5) / strips, s = part.sample(t);
      if (!s || !(s.w > 0)) continue;
      const sy = Math.floor((k / strips) * ch), sh = Math.min(ch - sy, Math.ceil(ch / strips) + 1);
      ctx.save();
      ctx.translate(s.p.x, s.p.y); ctx.rotate(Math.atan2(s.dir.y, s.dir.x) - Math.PI / 2);
      ctx.drawImage(img, sx, sy, sw, sh, -part.cx(t) * s.w, -stripLen * 0.6, s.w, stripLen * 1.22);
      ctx.restore();
    }
  }
}
