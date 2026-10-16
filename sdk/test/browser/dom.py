"""Resolver checks against realistic product-page DOMs in headless Chromium (static HTML, no network).
Run from project root after: node sdk/test/browser/build.js"""
import json, os
from playwright.sync_api import sync_playwright
bundle = open(os.path.join(os.path.dirname(__file__), 'vto-test.js')).read()
PAGES = {
 'shopify-like': ('https://shop.example/products/tee?variant=222', """
  <h1>Classic Tee</h1><div class="product__media-wrapper"><div class="product__media-item is-active"><img style="width:400px;height:500px" src="https://cdn.shopify.com/s/files/1/p/red_600x.jpg?v=1" srcset="https://cdn.shopify.com/s/files/1/p/red_600x.jpg 600w, https://cdn.shopify.com/s/files/1/p/red_1200x.jpg 1200w"></div>
  <img style="width:90px;height:90px" src="https://cdn.shopify.com/s/files/1/p/blue_100x.jpg"></div>
  <form action="/cart/add"><input name="id" value="222"></form>
  <script type="application/json" data-product-json>{"product":{"variants":[{"id":111,"option1":"Blue","featured_image":{"src":"https://cdn.shopify.com/s/files/1/p/blue.jpg"}},{"id":222,"option1":"Red","featured_image":{"src":"https://cdn.shopify.com/s/files/1/p/red.jpg"}}]}}</script>""", 'https://cdn.shopify.com/s/files/1/p/red_1200x.jpg'),
 'woocommerce-like': ('https://shop.example/product/jeans/', """
  <h1>Skinny Jeans</h1><div class="woocommerce-product-gallery"><div class="woocommerce-product-gallery__image flex-active-slide" data-thumb="x"><a href="https://shop.example/wp-content/uploads/jeans-full.jpg"><img style="width:500px;height:600px" src="https://shop.example/wp-content/uploads/jeans-300x300.jpg" data-large_image="https://shop.example/wp-content/uploads/jeans-full.jpg"></a></div></div>""", 'https://shop.example/wp-content/uploads/jeans-full.jpg'),
 'custom-selector': ('https://shop.example/p/1', """<h1>Dress</h1><div id="hero"><img style="width:300px;height:400px" src="https://shop.example/img/dress-small.jpg"></div><div class="gallery"><img style="width:300px;height:400px" src="https://shop.example/img/other.jpg"></div>""", 'https://shop.example/img/dress-small.jpg'),
}
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body='<!doctype html><body></body>') if r.request.resource_type == 'document' else r.abort())
    for name, (url, body, want) in PAGES.items():
        pg.goto(url); pg.set_content('<!doctype html><body>' + body + '</body>'); pg.add_script_tag(content=bundle)
        opts = '{imageSelector:"#hero"}' if name == 'custom-selector' else '{}'
        r = pg.evaluate('async () => { const c = await window.VTO_TEST.resolveImageCandidates(%s); return { urls: c.map(x => x.url + " <" + x.source + ">").slice(0,6), sig: window.VTO_TEST.selectionSignature(%s) }; }' % (opts, opts))
        top = r['urls'][0].split(' <')[0]
        res[name] = {'first': r['urls'][0], 'expected_in_top3': any(want == u.split(' <')[0] for u in r['urls'][:3]), 'candidates': r['urls']}
    # variant change must change the signature (so the SDK swaps the garment)
    pg.goto(PAGES['shopify-like'][0]); pg.set_content('<!doctype html><body>' + PAGES['shopify-like'][1] + '</body>'); pg.add_script_tag(content=bundle)
    s1 = pg.evaluate('() => window.VTO_TEST.selectionSignature({})'); pg.evaluate('() => { document.querySelector("form input").value = "111"; document.querySelector(".product__media-item img").src = "https://cdn.shopify.com/s/files/1/p/blue_600x.jpg"; }')
    s2 = pg.evaluate('() => window.VTO_TEST.selectionSignature({})'); res['variant_change_changes_signature'] = s1 != s2
    b.close()
for k, v in res.items(): print(k, json.dumps(v, indent=1) if isinstance(v, dict) else v)
