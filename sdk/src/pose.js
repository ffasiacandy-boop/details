// Pose + body segmentation run fully in the browser with MediaPipe Tasks Vision (WASM + WebGL/GPU, CPU fallback).
// Only the library and model files are downloaded; no camera data is ever sent anywhere.
// Self-hosting: copy these files to your own server and pass `assets` to VirtualTryOn.init().
// The model used is pose_landmarker_LITE (fastest). `heavy`/`full` are more accurate but slower: set assets.model.
const VERSION = '0.10.14';
export const DEFAULT_ASSETS = {
  bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`,
  wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`,
  model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
const MASK_W = 160;                                    // person mask is downsampled to this width (cheap to copy / dilate)

export class PoseTracker {
  constructor(assets, { segmentation = true } = {}) {
    this.assets = { ...DEFAULT_ASSETS, ...(assets || {}) };
    this.landmarker = null; this.delegate = null; this.lastTs = 0; this.vision = null; this.files = null;
    this.segmentation = segmentation; this.segFailures = 0; this.mask = null;
  }

  async _create(seg) {
    const create = (delegate) => this.vision.PoseLandmarker.createFromOptions(this.files, {
      baseOptions: { modelAssetPath: this.assets.model, delegate },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: !!seg,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.landmarker = await create('GPU'); this.delegate = 'GPU'; }
    catch { this.landmarker = await create('CPU'); this.delegate = 'CPU'; }
  }

  async load() {
    if (this.landmarker) return;
    this.vision = await import(this.assets.bundle);
    this.files = await this.vision.FilesetResolver.forVisionTasks(this.assets.wasm);
    await this._create(this.segmentation);
  }

  /** Turn segmentation off (e.g. the device is too slow): recreates the landmarker without the mask output. */
  async disableSegmentation() {
    if (!this.segmentation) return;
    this.segmentation = false; this.mask = null;
    try { this.landmarker && this.landmarker.close(); } catch { /* ignore */ }
    this.landmarker = null; await this._create(false);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {boolean} wantMask copy the person mask this frame (it is costlier than the landmarks)
   * @returns normalized landmarks array (33) or null; the latest person mask is in this.mask = {data:Uint8Array(alpha), w, h}
   */
  detect(video, wantMask = false) {
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(video, ts);
    if (res && res.segmentationMasks && res.segmentationMasks[0]) {
      const m = res.segmentationMasks[0];
      try { if (wantMask) this.mask = this._downsample(m); }
      catch { if (++this.segFailures > 5) this.segmentation = false; }
      finally { try { m.close(); } catch { /* ignore */ } }
    }
    return res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
  }

  _downsample(m) {
    const f = m.getAsFloat32Array(), W = m.width, H = m.height, w = MASK_W, h = Math.max(2, Math.round((H / W) * MASK_W));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const sy = Math.min(H - 1, Math.floor(((y + 0.5) / h) * H)) * W; for (let x = 0; x < w; x++) out[y * w + x] = f[sy + Math.min(W - 1, Math.floor(((x + 0.5) / w) * W))] > 0.5 ? 255 : 0; }
    return { data: out, w, h };
  }

  close() { try { this.landmarker && this.landmarker.close(); } catch { /* ignore */ } this.landmarker = null; }
}
