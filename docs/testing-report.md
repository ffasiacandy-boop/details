# Testing report (what was actually run)

Environment: Node 22, headless Chromium (Playwright), **no network, no GPU, no webcam**, `express` / `better-sqlite3` /
project `esbuild` could not be installed, so the server was **not started**.

## Executed
| Suite | Command | Result |
|---|---|---|
| SDK unit tests (segmentation, resolver helpers, category text rules, fitting geometry, adapter tracking/smoothing/switching) | `npm --prefix sdk test` | 48 / 48 pass |
| Server unit tests (SSRF-hardened image fetcher incl. redirects to metadata IP, loopback, size, MIME, timeout, scheme, credentials) | `npm --prefix server test` | 14 / 14 pass |
| SDK bundle compiles | esbuild (bundled with `tsx` in this sandbox), same options as `sdk/build.js` | OK (107 KB unminified) |
| Resolver in real browser DOMs (Shopify-like, WooCommerce-like, custom selector, variant change) | `node sdk/test/browser/build.js && python3 sdk/test/browser/dom.py` | pass |
| Rendering in real Chromium: real SDK code + the repo's demo product images on a **synthetic mannequin** with a fake pose | `python3 sdk/test/browser/run.py` (serve project root on :8765) | 14 scenes rendered, no console errors; PNGs in `sdk/test/browser/out/` |
| Syntax check of all server files | `node --check` | OK |

The browser run found and I fixed three real defects: SVG product images rejected as "too small", semi-transparent
garments banding where strips overlap, and dress/gown hems defined on the wrong scale.

## Image types (synthetic fixtures in unit tests; demo SVG art in browser)
| Image type | Result | Confidence |
|---|---|---|
| Garment on plain white/grey background | cut out, cropped, category guessed | reliable on synthetic + demo art; **real photos with shadows/gradients untested** |
| Flat-lay | same as above | same |
| Transparent PNG/SVG | alpha used directly | reliable |
| Colour variants | colours preserved, correct variant image resolved from Shopify/Woo-style data | resolver tested on fixtures only |
| Jeans, kurti, dress, shorts, skirt silhouettes | correct family guessed from shape (synthetic) | moderate; text in the product name is preferred |
| Model wearing garment | **rejected** (`MODEL_PHOTO`) by skin-tone blob heuristic | heuristic: can miss models with dark skin tones / full-body covering, can false-positive on skin-toned fabric (a mostly-skin-coloured garment is allowed through) |
| Complex background | **rejected** (`BUSY_BACKGROUND`) | reliable for noisy backgrounds; a softly blurred/studio gradient background may be accepted wrongly or rejected |
| Multiple garments | rejected unless the product name implies exactly one family (then that garment is chosen) | synthetic only |
| Low resolution | < 120 px rejected, < 400 px accepted with warning | - |
| Hanger/accessories/shadows | **not handled** (can merge into the cutout) | unsupported |

There is no neural garment segmenter; extraction from model photos is **unsupported by design** (returns a clear message).

## Garment categories
**Implemented and exercised in Chromium with demo flat art on a synthetic mannequin (geometry + rendering verified; NOT with a real person/camera):**
T-shirt, shirt, hoodie (T-shirt art: no hood shape), kurti, jeans, trousers, shorts, dress, gown, T-shirt + jeans outfit layering, legs-out-of-frame hint, arm-in-front redraw.

**Implemented (profile + maths) but only covered by unit tests, no rendering check with a matching image:**
polo, sweatshirt, sweater, jacket, blazer, crop top, top, joggers, leggings, palazzo, skirt (a real skirt image was not available; rendered once with the dress art), maxi dress.

**Not implemented (recognised and refused with "not available for this product yet"):**
jumpsuit, salwar suit as a two-piece (kurti part only), dhoti/veshti, lehenga. `saree` keeps the **legacy** overlay, unchanged and unverified.

## NOT verified (needs real devices before you claim anything)
Real camera + MediaPipe model loading (needs internet to jsDelivr/Google Storage), pose z-depth thresholds for arm occlusion,
the segmentation-mask path (`getAsFloat32Array`), different body proportions/camera distances/lighting on real people,
frame rate and latency on phones, Safari behaviour (`CanvasRenderingContext2D` shadows/clip), end-to-end `POST /api/image/fetch`
through Express + SQLite, and a regression run of the Admin dashboard / API-key flow (those files were not modified, but the
server was not started here).
