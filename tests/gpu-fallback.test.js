/**
 * WebGPU init must not consume the canvas before it is sure to succeed.
 *
 * A canvas keeps the first context type it is handed, so a successful
 * getContext('webgpu') makes getContext('webgl2') on that element return
 * null for good. main.js falls back to initWebGL2() on the same canvas when
 * WebGPU init returns null, so any failure *after* the context was claimed
 * left GPU Core with no renderer at all. The WGSL bug fixed in v8.9.1 took
 * exactly that path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWebGPU } from '../src/webgpu.js';

/** A canvas that records which context types were requested, spec-style. */
function makeCanvas() {
  const asked = [];
  let claimed = null;
  return {
    asked,
    get claimed() { return claimed; },
    getContext(type) {
      asked.push(type);
      if (claimed && claimed !== type) return null;   // one context type per canvas
      claimed = type;
      return type === 'webgpu'
        ? { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) }
        : {};
    },
  };
}

/** A navigator.gpu whose shader module reports the given compile messages. */
function stubGpu({ compileErrors = [], failPipeline = false, noAdapter = false } = {}) {
  return {
    getPreferredCanvasFormat: () => 'bgra8unorm',
    requestAdapter: async () => (noAdapter ? null : {
      requestDevice: async () => ({
        createShaderModule: () => ({
          getCompilationInfo: async () => ({
            messages: compileErrors.map((m) => ({ type: 'error', message: m })),
          }),
        }),
        createRenderPipeline: () => {
          if (failPipeline) throw new Error('pipeline creation failed');
          return { getBindGroupLayout: () => ({}) };
        },
        createBuffer: () => ({}),
        createBindGroup: () => ({}),
        queue: { writeBuffer() {} },
      }),
    }),
  };
}

const origGpu = globalThis.navigator?.gpu;
beforeEach(() => {
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
  if (!globalThis.navigator) globalThis.navigator = {};
});
afterEach(() => {
  if (globalThis.navigator) globalThis.navigator.gpu = origGpu;
});

describe('initWebGPU', () => {
  it('leaves the canvas free when the shader fails to compile', async () => {
    navigator.gpu = stubGpu({ compileErrors: ['cannot assign to let'] });
    const canvas = makeCanvas();
    expect(await initWebGPU(canvas)).toBeNull();
    // the whole point: WebGL2 must still be able to claim this canvas
    expect(canvas.asked).not.toContain('webgpu');
    expect(canvas.getContext('webgl2')).not.toBeNull();
  });

  it('leaves the canvas free when the pipeline fails', async () => {
    navigator.gpu = stubGpu({ failPipeline: true });
    const canvas = makeCanvas();
    expect(await initWebGPU(canvas)).toBeNull();
    expect(canvas.getContext('webgl2')).not.toBeNull();
  });

  it('leaves the canvas free when there is no adapter', async () => {
    navigator.gpu = stubGpu({ noAdapter: true });
    const canvas = makeCanvas();
    expect(await initWebGPU(canvas)).toBeNull();
    expect(canvas.getContext('webgl2')).not.toBeNull();
  });

  it('leaves the canvas free when WebGPU is absent entirely', async () => {
    navigator.gpu = undefined;
    const canvas = makeCanvas();
    expect(await initWebGPU(canvas)).toBeNull();
    expect(canvas.asked).toEqual([]);
    expect(canvas.getContext('webgl2')).not.toBeNull();
  });

  it('claims the canvas only on the success path', async () => {
    navigator.gpu = stubGpu();
    const canvas = makeCanvas();
    const state = await initWebGPU(canvas);
    expect(state).not.toBeNull();
    expect(canvas.claimed).toBe('webgpu');
    expect(state.context).toBeTruthy();
    expect(state.format).toBe('bgra8unorm');
  });

  it('resolves rather than rejecting, so the caller can fall back', async () => {
    navigator.gpu = {
      getPreferredCanvasFormat: () => 'bgra8unorm',
      requestAdapter: async () => { throw new Error('adapter exploded'); },
    };
    await expect(initWebGPU(makeCanvas())).resolves.toBeNull();
  });
});
