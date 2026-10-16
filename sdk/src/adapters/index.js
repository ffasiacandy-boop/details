import { TShirtAdapter } from './tshirt.js';
import { ShirtAdapter, PantAdapter, SareeAdapter, DressAdapter, KurtiAdapter } from './categories.js';
import { FamilyAdapter } from './family.js';
import { PROFILES, canonicalCategory, UNSUPPORTED_KNOWN } from '../fit/profiles.js';

// New engine: every key in fit/profiles.js (top / bottom / full-body families). See docs/ai-rendering.md for what is verified.
// LEGACY (v2 single-anchor overlays) is kept only for 'saree', which has no new pipeline, and as a manual fallback:
//   VirtualTryOn.init({ ..., fitting: 'legacy' })
const LEGACY = { tshirt: TShirtAdapter, shirt: ShirtAdapter, pant: PantAdapter, pants: PantAdapter, saree: SareeAdapter, dress: DressAdapter, kurti: KurtiAdapter, chudidar: KurtiAdapter };
const LEGACY_ONLY = ['saree'];

export function createAdapter(category, product, { legacy = false } = {}) {
  const key = String(category || '').toLowerCase();
  if (legacy || LEGACY_ONLY.includes(key)) {
    const fam = PROFILES[canonicalCategory(key)] ? PROFILES[canonicalCategory(key)].family : null;
    const C = LEGACY[key] || (fam === 'top' ? TShirtAdapter : fam === 'bottom' ? PantAdapter : fam === 'full' ? DressAdapter : null);
    return C ? new C(product) : null;
  }
  const canon = canonicalCategory(key);
  return canon ? new FamilyAdapter(product, canon) : null;
}
export const isKnownUnsupported = (c) => UNSUPPORTED_KNOWN.includes(String(c || '').toLowerCase());
export const supportedCategories = () => [...Object.keys(PROFILES), ...LEGACY_ONLY];
