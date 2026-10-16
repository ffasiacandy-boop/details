# Universal Virtual Try-On SaaS

Admin-only control panel + hosted SDK. **There is no client portal.** You (the admin) create a client, generate an API key,
and send them one line of code. Everything else (product name, price, image, garment type) is read automatically from the
client's own product pages. Try-on runs entirely in the shopper's browser (MediaPipe Pose + canvas).

```
server/   Express API, SQLite, API-key validation, serves everything below
sdk/      Browser SDK source -> dist/vto.js, dist/vto.min.js (esbuild)
admin/    Admin dashboard   (/admin/)
demo/     Demo store        (/demo/)  - product pages with just the one script line
docs/     integration.md
```

## Run it
Requires Node 18+.
```bash
cp .env.example .env          # edit ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET / SDK_CDN_URL
npm run setup                 # installs server + sdk deps, builds the SDK
npm start
```
* Admin: http://localhost:4000/admin/  (credentials from `.env`)
* Demo store: http://localhost:4000/demo/  (seeded API key `vto_demo_localkey_0001`, domain `localhost`; dev only)

## Admin workflow
1. **Clients -> + New client**: enter company, contact, the client's website domain, plan, expiry. An API key (`vto_...`) is generated and the embed code is shown.
2. Send the client the one line:
   ```html
   <script src="https://YOUR-CDN/vto.js" data-api-key="vto_xxxxxxxx" defer></script>
   ```
3. On every product page of their site a **Virtual Try-On** button appears automatically.
4. Client page controls: **Disable / Enable** (button vanishes / returns on the client's site), **Regenerate key** (old key stops immediately), **+30/+90/+365 days**, add/remove allowed domains, **Delete client**.

## What the SDK detects automatically (the client enters nothing)
| Item | Source (in order) |
|---|---|
| Is this a product page? | schema.org JSON-LD `Product`, Open Graph `og:type=product` / `product:price`, microdata, or "Add to cart" + `<h1>` + price |
| Name | JSON-LD, `og:title`, `itemprop=name`, `<h1>`, `<title>` |
| Price + currency | JSON-LD offers, `product:price:amount`, `itemprop=price`, visible price element |
| Image | JSON-LD image, `og:image`, `itemprop=image`, largest visible product image |
| Garment type (t-shirt / shirt / pant / saree / dress / kurti / chudidar) | 1) product name, breadcrumbs, schema category, URL, image alt; 2) if there is no text clue: the image silhouette (leg gap -> pant, sleeves -> t-shirt, long drape -> dress/saree) |
| Background | A plain studio background is removed and the garment is cropped automatically. Photos with busy backgrounds can't be cut out; cross-origin images without CORS fall back to a multiply blend. |

`await VirtualTryOn.detect()` in the browser console prints what was detected on the current page. Single-page apps are handled (the page is re-scanned on navigation).

Optional script attributes: `data-button-text`, `data-button-color`, `data-selector` (insert the button after this element), `data-position="floating"`, `data-auto="false"` (manual `VirtualTryOn.init({apiKey, product?})`).

## How API-key validation works
1. The SDK calls `POST /api/license/validate {license: <api key>, domain: location.hostname}` on load (the button only shows if valid) and again every time the try-on opens.
2. Backend: key exists -> domain is in the client's allowed domains -> status (disabled keys are rejected) -> expiry.
3. The browser `Origin` header must match the claimed domain.
4. If the backend is unreachable, a previous success is honoured for 24h.

The API key is visible in the page source (like any frontend key); domain binding is what stops other sites from using it. JavaScript in a browser can never be fully protected from a determined user.

## Security notes
* Admin password: bcrypt. Session: HTTP-only SameSite=Strict cookie + server-side session. Mutating calls need `X-Requested-With`.
* Only the ADMIN account can sign in. Client records exist for licensing only (random, unknown password).
* Rate limits on login and key validation. Strict CSP on the admin dashboard. All SQL parameterised.
* Production: `NODE_ENV=production`, 32+ char `JWT_SECRET`, strong admin password, HTTPS, `TRUST_PROXY` behind a proxy, back up `data/`.

## Adding a garment category
1. `sdk/src/adapters/<name>.js` extending `GarmentAdapter` (implement `fit(pose)`), register it in `sdk/src/adapters/index.js`.
2. Add keywords in `sdk/src/detect/category.js` (and optionally a silhouette rule in `sdk/src/detect/image.js`).
3. `npm run build:sdk`.

## v3 engine: multi-category, live-camera, automatic product image
* **Image resolver** (`sdk/src/detect/resolver.js`): selected main image -> selected variant (Shopify/WooCommerce JSON) -> gallery -> page JS state -> JSON-LD/`og:image`; largest `srcset`/zoom URL first, CDN thumbnail up-sizing, automatic fallback to the next candidate. Override with `data-image-selector="#hero img"` or `VirtualTryOn.init({ imageResolver: ({document}) => url })`.
* **Garment preparation** (`detect/segment.js`, `detect/image.js`): background removal, tight crop, silhouette measurement, category guess; **refuses** model photos, busy backgrounds, multiple ambiguous garments, tiny images.
* **Categories**: top (t-shirt, shirt, polo, hoodie, sweatshirt, sweater, jacket, blazer, top, crop top, kurti), bottom (jeans, trousers/pants, joggers, leggings, palazzo, shorts, skirt), full-body (dress, maxi, gown). Jumpsuit / dhoti / veshti / salwar suit are refused. See `docs/testing-report.md` for what is verified.
* **Server image fetch** `POST /api/image/fetch` (licence + domain checked, SSRF-hardened) is used only when an image has no CORS headers. Add CDN hosts with `IMAGE_PROXY_EXTRA_HOSTS`.
* Switching garments / variants while open reuses the camera and pose model; extra layers via `instance.addGarment({garmentImage, category})`.
* Docs: `docs/ai-rendering.md` (architecture, AI-model evaluation, latency), `docs/testing-report.md`. Tests: `npm test`.

## Notes
* Garments are 2D strip-warped overlays driven by pose landmarks (not cloth simulation, no neural rendering). Fit depends on a clean, front-facing flat/ghost-mannequin garment image.
* MediaPipe files load from jsDelivr / Google Storage at runtime (override with the `assets` option to self-host).
