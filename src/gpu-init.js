// @ts-check
import { initWebGPU, webgpuClaimed } from './webgpu.js';
import { initWebGL2 } from './webgl2.js';

/**
 * WebGPU stage init with a WebGL2 fallback.
 *
 * The `gpu` visualizer mode renders on its own canvas; whichever context
 * initialises successfully is handed to the render loop, which falls back to
 * the Canvas2D renderer while neither is ready.
 *
 * @param {Document} [doc]
 */
export function createGpuStage(doc = document) {
  let webgpuState = null;
  let webgl2State = null;
  /** @type {'webgpu'|'webgl2'|null} */
  let backend = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  let canvas = doc.getElementById('webgpu-canvas');
  /* A canvas that took a 'webgpu' context cannot take 'webgl2' for good. When
     WebGPU claimed it and then failed, WebGL2 gets a fresh element in the same
     place instead of silently getting nothing. */
  const freshCanvas = (old) => {
    const fresh = old.cloneNode(false);
    old.parentNode?.replaceChild(fresh, old);
    return fresh;
  };
  /* Lazy: the GPU Core canvas only draws when the raytraced stage is off and
     that mode is showing. Initialising at load requested a second GPU device
     and built its pipeline on every visit, competing with the ray stage's
     startup for a mode most sessions never reach. */
  let started = false;
  function start() {
    if (started) return;
    started = true;
    if (!canvas) { resolveReady(null); return; }
    initWebGPU(canvas)
      .catch(() => null)
      .then((s) => {
        if (s) {
          webgpuState = s;
          backend = 'webgpu';
        } else {
          if (webgpuClaimed(canvas)) canvas = freshCanvas(canvas);
          webgl2State = initWebGL2(canvas);
          backend = webgl2State ? 'webgl2' : null;
        }
        resolveReady(backend);
      });
  }

  return {
    /* a getter: the element can be replaced after a failed WebGPU claim */
    get canvas() { return canvas; },
    start,
    getWebgpu: () => webgpuState,
    getWebgl2: () => webgl2State,
    getBackend: () => backend,
    whenReady: () => ready,
  };
}
