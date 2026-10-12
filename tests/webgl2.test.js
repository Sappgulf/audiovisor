/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { initWebGL2 } from '../src/webgl2.js';

/** A WebGL2 stand-in that records the order of link and shader deletion. */
function fakeGl({ linkOk = true } = {}) {
  const order = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, TRIANGLES: 4,
    createShader: vi.fn(() => ({ id: Math.random() })),
    shaderSource: () => {}, compileShader: () => {},
    createProgram: () => ({ prog: true }),
    attachShader: () => {},
    linkProgram: vi.fn(() => order.push('link')),
    getProgramParameter: () => linkOk,
    deleteShader: vi.fn(() => order.push('deleteShader')),
    deleteProgram: vi.fn(() => order.push('deleteProgram')),
    useProgram: () => {},
    getUniformLocation: () => ({}),
    uniform1f: () => {}, uniform2f: () => {}, viewport: () => {}, drawArrays: () => {},
  };
  return { gl, order };
}

function fakeCanvas(gl) {
  return {
    getContext: () => gl,
    addEventListener() {},
  };
}

describe('initWebGL2 program build', () => {
  afterEach(() => { delete window.WebGL2RenderingContext; });

  it('deletes both shader objects once the program is linked', () => {
    window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    const { gl, order } = fakeGl();
    const state = initWebGL2(fakeCanvas(gl));
    expect(state).toBeTruthy();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(order.indexOf('deleteShader')).toBeGreaterThan(order.indexOf('link'));
  });

  it('frees the program and both shaders when linking fails', () => {
    window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    const { gl } = fakeGl({ linkOk: false });
    expect(initWebGL2(fakeCanvas(gl))).toBeNull();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });
});
