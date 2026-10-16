# Rendering architecture, AI-model evaluation and limits

## What ships (v3 engine)
Browser-only, no per-try cost, no camera upload:

| Stage | Implementation | Where |
|---|---|---|
| Body tracking | MediaPipe Pose Landmarker **lite**, GPU delegate with CPU fallback, adaptive detection rate | `sdk/src/pose.js` |
| Smoothing | One-Euro filter per landmark axis; hidden landmarks estimated from body proportions | `adapters/family.js`, `fit/rig.js` |
| Body mask | MediaPipe segmentation mask (160 px wide), read every 3rd detection, auto-disabled on slow devices; used to trim **top wear** to the (dilated) silhouette | `pose.js`, `renderer.js` |
| Category fitting | 3 families (top / bottom / full-body), per-category profile (hem, ease, rise, taper...) | `fit/profiles.js`, `fit/rig.js` |
| Cloth adaptation | Garment cut into 30 strips placed/rotated/scaled along the **spine** (tops, dresses, skirts) or each **hip->knee->ankle chain** (trousers, jeans, shorts) | `fit/strips.js` |
| Layers | bottom, full-body, top; top over bottom; full-body replaces both | `renderer.js`, `index.js` |
| Realism extras | room-brightness matching, soft contact shadow, forearm/hand re-drawn from the camera when in front of the torso | `renderer.js`, `index.js` |

This is a **2D warp of a flat garment image, not cloth simulation and not neural rendering**. Known consequences:
sleeves are not articulated (they keep the flat-lay shape), garments have no folds or 3D volume, the wearer's own clothes
are not removed (stand in close-fitting clothes), side/back poses are not supported (front view only).

## Why no neural try-on model is integrated
The brief says not to run a slow generator per frame and to verify licence/latency before integrating. I had **no network, no
GPU and no model weights** in the build environment, so nothing below was measured or licence-checked by me. Status of each
candidate family (from general knowledge; **verify each repository's LICENSE and model card before any use**):

| Candidate | Garment categories (as published) | Inference style | Real-time in browser? | Commercial use |
|---|---|---|---|---|
| IDM-VTON, OOTDiffusion, CatVTON, FitDiT, Leffa (diffusion) | upper / lower / dress (varies; some need a category flag per model) | one still image, several seconds on a datacentre GPU | **No** | Several released checkpoints are non-commercial (CC BY-NC-SA) licences - **not cleared** for a paid SaaS until read |
| HR-VITON, StableVITON, GP-VTON (warp + generator) | mostly upper body (some trained for lower body/dress) | still image, ~1 s class on GPU | No | Dataset (VITON-HD, DressCode) terms are typically research-only - **not cleared** |
| Real-time neural clothing renderers | none I can point to that is open, covers all three families, and runs in a browser | - | Not available | - |

Additional blocker: a server-side generator needs the **camera frame uploaded**, which breaks this product's stated privacy
promise ("processed locally, not uploaded") and its "no per-try AI cost" model. Therefore: **documented, not built.**
If you want it later, the safe shape is an *optional, opt-in "HD preview" button* that sends one user-confirmed frame to a
GPU worker you operate, using a model whose licence permits commercial SaaS use. Measure per-image latency on your GPU first.

## Latency / performance - what is and is not known
* **No frame rate is claimed.** Nothing here was measured on a phone or laptop with a real camera.
* Built-in protections that exist in code: detection interval adapts to measured inference time (30/20/12/8 Hz), segmentation
  is switched off automatically after ~40 slow detections, strips are drawn with cheap 2D canvas calls, preprocessing is cached per
  image URL, the camera stream and pose model are reused when the garment changes.
* Not done: moving pose inference into a Web Worker (MediaPipe Tasks needs the video element on the main thread in this
  version; `VideoFrame`/`OffscreenCanvas` worker mode is a future experiment). Measure before deciding it is needed.
* To measure: open the try-on, then in the console `performance.now()` around `tracker.detect` is already smoothed in the
  loop (`infMs`); add `console.log(infMs)` temporarily on your target devices.

## Fallbacks
`VirtualTryOn.init({ ..., fitting: 'legacy' })` (or `data-fitting="legacy"`) uses the previous single-anchor overlay adapters.
`data-segmentation="false"` disables the body mask.
