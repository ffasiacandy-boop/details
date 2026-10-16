# Integration guide (for your clients)

Add this one line before `</body>` on every page of the site (or in the theme footer):

```html
<script src="https://YOUR-CDN/vto.js" data-api-key="vto_xxxxxxxxxxxxxxxx" defer></script>
```

That is all. On every product page a **Virtual Try-On** button appears next to "Add to Cart". The product name, price,
image and garment type (t-shirt / pant / saree ...) are read from the page automatically.

## Requirements
* The site's domain must be added to the client by the administrator.
* HTTPS (camera access requires it).
* Best results: product pages with schema.org `Product` JSON-LD (most Shopify / WooCommerce / Magento themes have it) and a clean, front-facing garment image on a plain background.
* If you use a Content-Security-Policy: allow `script-src` + `connect-src` for the SDK/API host, `https://cdn.jsdelivr.net`, `https://storage.googleapis.com`; `worker-src blob:`, `'wasm-unsafe-eval'`.

## Optional attributes on the script tag
| Attribute | Meaning |
|---|---|
| `data-button-text` | Button label (default "Virtual Try-On") |
| `data-button-color` | Hex colour, e.g. `#e11d48` |
| `data-selector` | CSS selector; the button is inserted right after this element |
| `data-position="floating"` | Floating button at the bottom-right instead of next to Add to Cart |
| `data-image-selector` | CSS selector of the main product image (for unusual themes) |
| `data-segmentation="false"` | Turn off the body mask (faster on weak devices) |
| `data-fitting="legacy"` | Use the previous single-anchor overlay engine |
| `data-auto="false"` | Disable auto mode and call `VirtualTryOn.init({ apiKey })` yourself |

## Manual override (rarely needed)
```js
VirtualTryOn.init({ apiKey: "vto_...", product: { category: "saree", garmentImage: "https://.../saree.png" }, trigger: "#my-button" });
```
Anything you leave out of `product` is still detected from the page.

## Debugging
Run `await VirtualTryOn.detect()` in the browser console to see what was detected (name, price, image, category, and whether the category came from text or from the image).

## What shoppers see
| Situation | Result |
|---|---|
| API key disabled / invalid | No button is shown |
| Expired | Virtual Try-On access has expired. Please contact the store. |
| Domain not allowed | Virtual Try-On is not configured for this website. |
| Camera permission denied | Camera access is required for Virtual Try-On. Please allow camera permission and try again. |

## Product images and CORS
The SDK reads the selected product/variant image from the page itself. If the image host sends no CORS headers the browser cannot read its
pixels; the SDK then asks `POST /api/image/fetch` (needs a valid key and the image host to be one of the client's domains or listed in
`IMAGE_PROXY_EXTRA_HOSTS`, e.g. `cdn.shopify.com`). Otherwise the shopper sees: "The product image cannot be read by the browser...".
Model photos are not supported: use a flat-lay / ghost-mannequin image as the first gallery image, or set `data-image-selector`.

## Outfits and switching (API)
```js
const t = await VirtualTryOn.init({ apiKey, outfit: [{ garmentImage: "https://.../jeans.png", category: "jeans" }] });
t.open();                       // page product + jeans, rendered as layers (top over bottom)
t.addGarment({ garmentImage, category: "tshirt" }); t.removeGarment("top"); t.refresh();
```
