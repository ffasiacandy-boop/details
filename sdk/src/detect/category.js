// Garment category detection from text (product name, breadcrumbs, schema.org category, URL, image alt/filename).
// Returns a key of fit/profiles.js PROFILES, a KNOWN-BUT-UNSUPPORTED key (jumpsuit, saree, dhoti ...), or null.
// Rule ORDER is the tie-break: more specific garments come first.
const RULES = [
  ['jumpsuit', /\b(jumpsuit|jumpsuits|playsuit|romper|dungaree|dungarees|boiler\s*suit)\b/],
  ['dhoti', /\b(dhoti|dhotis|veshti|veshtis|mundu|lungi)\b/],
  ['lehenga', /\b(lehenga|lehengas|ghagra)\b/],
  ['saree', /\b(saree|sarees|sari|saris|sarong|pattu|kanjeevaram|kanchipuram|banarasi)\b/],
  ['kurti', /\b(kurti|kurtis|kurta|kurtas|anarkali|salwar|salwar\s*kameez|churidar|chudidar|chudithar|patiala|sharara)\b/],
  ['gown', /\b(gown|gowns|ballgown|evening\s*dress)\b/],
  ['maxi', /\b(maxi|maxis|maxi\s*dress)\b/],
  ['dress', /\b(dress|dresses|frock|frocks|bodycon)\b/],
  ['skirt', /\b(skirt|skirts|skort|skorts)\b/],
  ['shorts', /\b(shorts|short\s*pants|bermuda|bermudas)\b/],
  ['leggings', /\b(legging|leggings|jeggings|jegging|tights)\b/],
  ['joggers', /\b(jogger|joggers|track\s*pants?|trackpants?|sweatpants)\b/],
  ['palazzo', /\b(palazzo|palazzos|culottes?)\b/],
  ['jeans', /\b(jeans|jean|denim\s*pants?)\b/],
  ['trousers', /\b(trouser|trousers|formal\s*pants?|slacks|chino|chinos)\b/],
  ['pant', /\b(pant|pants|cargo|cargos|bottom\s*wear|bottoms)\b/],
  ['hoodie', /\b(hoodie|hoodies|hooded)\b/],
  ['sweatshirt', /\b(sweatshirt|sweatshirts|pullover\s*sweat)\b/],
  ['sweater', /\b(sweater|sweaters|pullover|cardigan|jumper|knitwear)\b/],
  ['blazer', /\b(blazer|blazers|sport\s*coat|waistcoat)\b/],
  ['jacket', /\b(jacket|jackets|coat|coats|bomber|windcheater|parka|puffer|gilet)\b/],
  ['polo', /\b(polo|polos)\b/],
  ['croptop', /\b(crop\s*top|crop\s*tops|cropped\s*top|bralette)\b/],
  ['tshirt', /\b(t[\s-]?shirt|t[\s-]?shirts|tshirt|tshirts|tee|tees|tank\s*top|tank|henley|jersey|singlet)\b/],
  ['shirt', /\b(shirt|shirts|blouse|blouses|flannel|oxford)\b/],
  ['top', /\b(top|tops|tunic|camisole|cami)\b/],
];
const ORDER = Object.fromEntries(RULES.map(([c], i) => [c, i]));
const WEIGHTS = { name: 4, category: 3, breadcrumb: 3, url: 1.5, alt: 1 };

export function classifyText(parts) {
  const scores = {};
  for (const [source, raw] of Object.entries(parts)) {
    const text = String(raw || '').toLowerCase().replace(/[_/+]+/g, ' ');
    if (!text.trim()) continue;
    for (const [cat, re] of RULES) if (re.test(text)) scores[cat] = (scores[cat] || 0) + (WEIGHTS[source] || 1);
  }
  // "t-shirt"/"polo shirt"/"hoodie sweatshirt" also contain the plain word "shirt": the more specific rule must win.
  if (scores.shirt && (scores.tshirt || scores.polo)) delete scores.shirt;
  if (scores.top && Object.keys(scores).length > 1) delete scores.top;      // "top" is a weak, generic word
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1] || ORDER[a[0]] - ORDER[b[0]])[0];
  return best ? best[0] : null;
}
