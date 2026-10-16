"""Headless-Chromium visual/functional harness. Serves the project over http (python3 -m http.server 8765 from the project
root), draws real demo product images on a synthetic mannequin with the real SDK code, saves PNGs to test/browser/out/.
Usage (from project root): node sdk/test/browser/build.js && python3 sdk/test/browser/run.py"""
import json, os
from playwright.sync_api import sync_playwright
out = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(out, exist_ok=True)
base = 'http://localhost:8765/sdk/test/browser/harness.html'; prod = 'http://localhost:8765/demo/products/%s.svg'
cases = [
  ('tshirt', [('black-tshirt', 'tshirt')], {}), ('shirt', [('shirt', 'shirt')], {}), ('hoodie_from_tshirt_img', [('black-tshirt', 'hoodie')], {}),
  ('kurti', [('kurti', 'kurti')], {}), ('jeans', [('pants', 'jeans')], {}), ('trousers', [('pants', 'trousers')], {}), ('shorts', [('pants', 'shorts')], {}),
  ('skirt_from_dress_img', [('dress', 'skirt')], {}), ('dress', [('dress', 'dress')], {}), ('gown', [('dress', 'gown')], {}),
  ('outfit_tshirt_jeans', [('pants', 'jeans'), ('black-tshirt', 'tshirt')], {}),
  ('legs_out_of_frame', [('pants', 'jeans')], {'pose': {'drop': [25, 26, 27, 28]}}),
  ('arm_in_front', [('black-tshirt', 'tshirt')], {'armsCross': True, 'arms': True}),
  ('saree_legacy', [('saree', 'saree')], {}),
]
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 640, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    for name, items, o in cases:
        pg.goto(base); pg.wait_for_function('() => !!(window.VTO_TEST && window.show)')
        r = pg.evaluate('([items,o]) => window.show(items,o)', [[{'url': prod % u, 'category': c} for u, c in items], o])
        pg.locator('#out').screenshot(path=os.path.join(out, name + '.png')); res[name] = r
    b.close()
print(json.dumps(res)); print('console/page errors:', errs)
