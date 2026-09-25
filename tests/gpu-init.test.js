/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGpuStage } from '../src/gpu-init.js';

function fakeWebGL2Context() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, TRIANGLES: 4,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, useProgram: () => {},
    getUniformLocation: () => ({}),
  };
}

describe('createGpuStage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="webgpu-canvas"></canvas>';
  });

  afterEach(() => {
    delete window.WebGL2RenderingContext;
  });

  it('reports no backend when there is no canvas', async () => {
    document.body.innerHTML = '';
    const gpu = createGpuStage(document);
    gpu.start();
    expect(await gpu.whenReady()).toBeNull();
    expect(gpu.getBackend()).toBeNull();
  });

  it('falls back to WebGL2 when WebGPU is unavailable', async () => {
    window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    const canvas = document.getElementById('webgpu-canvas');
    canvas.getContext = () => fakeWebGL2Context();
    const gpu = createGpuStage(document);
    gpu.start();
    expect(await gpu.whenReady()).toBe('webgl2');
    expect(gpu.getBackend()).toBe('webgl2');
    expect(gpu.getWebgl2()).toBeTruthy();
  });

  it('does not touch the GPU until started', () => {
    const canvas = document.getElementById('webgpu-canvas');
    let asked = 0;
    canvas.getContext = () => { asked++; return null; };
    const gpu = createGpuStage(document);
    expect(asked).toBe(0);
    expect(gpu.getBackend()).toBeNull();
  });

  it('reports null when neither WebGPU nor WebGL2 is available', async () => {
    const gpu = createGpuStage(document);
    gpu.start();
    expect(await gpu.whenReady()).toBeNull();
    expect(gpu.getBackend()).toBeNull();
  });
});
