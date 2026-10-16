// Bundled for the headless-Chromium harness (test/browser/run.py). Exposes engine pieces on window.VTO_TEST.
import { resolveGarment, prepareGarment } from '../src/detect/image.js';
import { createAdapter } from '../src/adapters/index.js';
import { Renderer } from '../src/renderer.js';
import { extractProduct, looksLikeProductPage } from '../src/detect/product.js';
import { resolveImageCandidates, selectionSignature } from '../src/detect/resolver.js';
import { familyOf } from '../src/fit/profiles.js';
window.VTO_TEST = { resolveGarment, prepareGarment, createAdapter, Renderer, extractProduct, looksLikeProductPage, resolveImageCandidates, selectionSignature, familyOf };
