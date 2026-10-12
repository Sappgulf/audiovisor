/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGpuStage } from '../src/gpu-init.js';

/* WebGPU that gets as far as claiming the canvas, then fails in configure() */
function claimingStub() {
  return {
    getPreferredCanvasFormat: () => 'bgra8unorm',
    requestAdapter: async () => ({
      requestDevice: async () => ({
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
        createBuffer: () => ({}),
        createBindGroup: () => ({}),
        queue: { writeBuffer() {} },
        destroy: vi.fn(),
      }),
    }),
  };
}

function fakeWebGL2() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, TRIANGLES: 4,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, useProgram: () => {},
    getUniformLocation: () => ({}), deleteShader: () => {}, deleteProgram: () => {},
  };
}

describe('GPU Core canvas after a failed WebGPU claim', () => {
  let original;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="webgpu-canvas" class="gpu"></canvas>';
    globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
    window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    navigator.gpu = claimingStub();
    original = document.getElementById('webgpu-canvas');
    // one context type per element: a claimed webgpu canvas refuses webgl2
    const claims = new WeakMap();
    HTMLCanvasElement.prototype.getContext = function getContext(type) {
      const cur = claims.get(this);
      if (cur && cur !== type) return null;
      claims.set(this, type);
      if (type === 'webgpu') {
        return { configure() { throw new Error('configure failed'); }, getCurrentTexture: () => ({ createView: () => ({}) }) };
      }
      return type === 'webgl2' ? fakeWebGL2() : null;
    };
  });

  afterEach(() => {
    delete window.WebGL2RenderingContext;
    delete globalThis.GPUBufferUsage;
    navigator.gpu = undefined;
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it('gives WebGL2 a fresh element in the same place rather than the claimed one', async () => {
    const gpu = createGpuStage(document);
    gpu.start();
    expect(await gpu.whenReady()).toBe('webgl2');
    expect(gpu.getWebgl2()).toBeTruthy();
    const current = gpu.canvas;
    expect(current).not.toBe(original);
    expect(current.id).toBe('webgpu-canvas');
    expect(current.className).toBe('gpu');
    expect(document.querySelectorAll('#webgpu-canvas')).toHaveLength(1);
    expect(current.isConnected).toBe(true);
  });

  it('releases the device made for the failed attempt', async () => {
    const devices = [];
    navigator.gpu.requestAdapter = async () => ({
      requestDevice: async () => {
        const d = {
          createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
          createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
          createBuffer: () => ({}), createBindGroup: () => ({}),
          queue: { writeBuffer() {} }, destroy: vi.fn(),
        };
        devices.push(d);
        return d;
      },
    });
    const gpu = createGpuStage(document);
    gpu.start();
    await gpu.whenReady();
    expect(devices).toHaveLength(1);
    expect(devices[0].destroy).toHaveBeenCalledTimes(1);
  });
});
