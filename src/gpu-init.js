// @ts-check
import { initWebGPU } from './webgpu.js';
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

  const canvas = doc.getElementById('webgpu-canvas');
  if (canvas) {
    // WebGPU is preferred; WebGL2 is the fallback, then the Canvas2D stage.
    initWebGPU(canvas)
      .catch(() => null)
      .then((s) => {
        if (s) {
          webgpuState = s;
          backend = 'webgpu';
        } else {
          webgl2State = initWebGL2(canvas);
          backend = webgl2State ? 'webgl2' : null;
        }
        resolveReady(backend);
      });
  } else {
    resolveReady(null);
  }

  return {
    canvas,
    getWebgpu: () => webgpuState,
    getWebgl2: () => webgl2State,
    getBackend: () => backend,
    whenReady: () => ready,
  };
}
