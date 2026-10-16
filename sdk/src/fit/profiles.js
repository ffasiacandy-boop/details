// Category table: every supported garment maps to a fitting FAMILY (top / bottom / full) plus per-category geometry.
// Only categories listed here AND implemented by a family adapter are advertised as supported.
// Numbers are ratios of the wearer's own measured body (shoulder width, torso length, leg length), never pixels.
//
// top:    hem = hem position as a fraction of the shoulder->hip distance below the shoulder line (1 = hip joints)
//         ease = how much wider than the body the garment is cut
// bottom: legs = true -> two-leg pipeline; hem = fraction of the hip->ankle path at which the hem ends
//         taper = hem width relative to thigh width; rise = waistband height above the hip joints (torso fractions)
// full:   hem = fraction of the hip->ankle distance, measured down from the hip joint, where the hem ends (0.55 ~ knee, 1.0 ~ floor)
export const FAMILIES = { TOP: 'top', BOTTOM: 'bottom', FULL: 'full' };

export const PROFILES = {
  // ---- TOP WEAR
  tshirt:   { family: 'top', hem: 1.12, ease: 1.04, topLift: 0.06 },
  shirt:    { family: 'top', longSleeve: true, hem: 1.22, ease: 1.06, topLift: 0.07 },
  polo:     { family: 'top', hem: 1.14, ease: 1.04, topLift: 0.06 },
  hoodie:   { family: 'top', longSleeve: true, hem: 1.22, ease: 1.22, topLift: 0.08 },
  sweatshirt:{ family: 'top', longSleeve: true, hem: 1.18, ease: 1.16, topLift: 0.07 },
  sweater:  { family: 'top', longSleeve: true, hem: 1.18, ease: 1.12, topLift: 0.07 },
  jacket:   { family: 'top', longSleeve: true, hem: 1.22, ease: 1.14, topLift: 0.07 },
  blazer:   { family: 'top', longSleeve: true, hem: 1.28, ease: 1.08, topLift: 0.07 },
  top:      { family: 'top', hem: 1.05, ease: 1.02, topLift: 0.06 },
  croptop:  { family: 'top', hem: 0.68, ease: 1.0,  topLift: 0.05 },
  kurti:    { family: 'top', longSleeve: true, hem: 1.75, ease: 1.08, topLift: 0.07, longTop: true },
  // ---- BOTTOM WEAR
  jeans:    { family: 'bottom', legs: true,  hem: 1.0,  taper: 0.72, ease: 1.0,  rise: 0.10 },
  pant:     { family: 'bottom', legs: true,  hem: 1.0,  taper: 0.78, ease: 1.04, rise: 0.10 },
  trousers: { family: 'bottom', legs: true,  hem: 1.0,  taper: 0.80, ease: 1.04, rise: 0.12 },
  joggers:  { family: 'bottom', legs: true,  hem: 0.98, taper: 0.58, ease: 1.08, rise: 0.10 },
  leggings: { family: 'bottom', legs: true,  hem: 1.0,  taper: 0.55, ease: 0.94, rise: 0.10 },
  palazzo:  { family: 'bottom', legs: true,  hem: 1.0,  taper: 1.35, ease: 1.12, rise: 0.12 },
  shorts:   { family: 'bottom', legs: true,  hem: 0.46, taper: 0.95, ease: 1.04, rise: 0.10 },
  skirt:    { family: 'bottom', legs: false, hem: 0.60, flare: 1.0, ease: 1.0, rise: 0.10 },
  // ---- FULL BODY (one-piece with a skirt-like lower half)
  dress:    { family: 'full', hem: 0.55, ease: 1.04, topLift: 0.06 },
  gown:     { family: 'full', hem: 1.02, ease: 1.04, topLift: 0.06 },
  maxi:     { family: 'full', hem: 0.95, ease: 1.04, topLift: 0.06 },
};

// Words the page may use -> canonical key in PROFILES (or null when we know the word but cannot fit it yet).
export const ALIASES = {
  't-shirt': 'tshirt', tee: 'tshirt', pants: 'pant', trouser: 'trousers', jean: 'jeans', jogger: 'joggers',
  legging: 'leggings', palazzos: 'palazzo', skirts: 'skirt', dresses: 'dress', gowns: 'gown', maxi_dress: 'maxi',
  chudidar: 'kurti', hoodies: 'hoodie', polos: 'polo', blouse: 'shirt', crop_top: 'croptop',
};
// Recognised, but there is no fitting pipeline for them yet: reported as unsupported instead of faking a fit.
export const UNSUPPORTED_KNOWN = ['jumpsuit', 'saree', 'salwar_suit', 'dhoti', 'veshti', 'lehenga'];

export function canonicalCategory(c) {
  const k = String(c || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (PROFILES[k]) return k;
  if (ALIASES[k] && PROFILES[ALIASES[k]]) return ALIASES[k];
  return null;
}
export const familyOf = (c) => { const k = canonicalCategory(c); return k ? PROFILES[k].family : null; };
