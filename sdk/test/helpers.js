// Synthetic garment images (flat colour polygons) for deterministic unit tests. These are NOT real product photos.
export function makeImage(w, h, bg = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h };
}
function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function fillPoly(img, poly, color) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(img.height - 1, Math.ceil(Math.max(...ys))); y++)
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(img.width - 1, Math.ceil(Math.max(...xs))); x++)
      if (inPoly(x + 0.5, y + 0.5, poly)) { const i = (y * img.width + x) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; img.data[i + 3] = 255; }
}
export function fillCircle(img, cx, cy, r, color) {
  for (let y = Math.max(0, cy - r | 0); y < Math.min(img.height, cy + r + 1); y++)
    for (let x = Math.max(0, cx - r | 0); x < Math.min(img.width, cx + r + 1); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { const i = (y * img.width + x) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; }
}
// shapes, in a 600x700-ish frame; ox/oy shift, s scales
const sh = (pts, ox = 0, oy = 0, s = 1) => pts.map(([x, y]) => [ox + x * s, oy + y * s]);
export const SHAPES = {
  tshirt: (o, y, s) => sh([[150, 60], [230, 40], [370, 40], [450, 60], [560, 170], [490, 230], [440, 190], [440, 520], [160, 520], [160, 190], [110, 230], [40, 170]], o, y, s),
  pants: (o, y, s) => sh([[150, 40], [450, 40], [480, 640], [330, 640], [300, 250], [270, 640], [120, 640]], o, y, s),
  shorts: (o, y, s) => sh([[150, 40], [450, 40], [490, 330], [330, 330], [300, 190], [270, 330], [110, 330]], o, y, s),
  skirt: (o, y, s) => sh([[220, 40], [380, 40], [540, 420], [60, 420]], o, y, s),
  dress: (o, y, s) => sh([[230, 40], [370, 40], [380, 220], [520, 760], [80, 760], [220, 220]], o, y, s),
  kurti: (o, y, s) => sh([[220, 40], [380, 40], [450, 90], [540, 300], [470, 320], [430, 190], [450, 700], [150, 700], [170, 190], [130, 320], [60, 300], [150, 90]], o, y, s),
};
export function shapeImage(name, { color = [30, 60, 160], bg = [255, 255, 255], w = 640, h = 800 } = {}) {
  const img = makeImage(w, h, bg); fillPoly(img, SHAPES[name](20, 20, 1), color); return img;
}
