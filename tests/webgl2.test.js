/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWebGL2 } from '../src/webgl2.js';

function fakeWebGL2Context({ linkStatus = () => true } = {}) {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, TRIANGLES: 4,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: linkStatus, useProgram: () => {},
    getUniformLocation: () => ({}),
    deleteShader: () => {}, deleteProgram: () => {},
    uniform1f: () => {}, uniform2f: () => {}, viewport: () => {}, drawArrays: () => {},
  };
}

describe('WebGL2 fallback lifecycle', () => {
  beforeEach(() => {
    window.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  });
  afterEach(() => {
    delete window.WebGL2RenderingContext;
  });

  it('rebuilds its program when the context is restored', () => {
    const gl = fakeWebGL2Context();
    const canvas = document.createElement('canvas');
    canvas.getContext = () => gl;
    const state = initWebGL2(canvas);
    expect(state).toBeTruthy();
    expect(state.lost).toBe(false);

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(state.lost).toBe(true);

    /* the old code left lost = true on restore, so GPU Core stayed dead */
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(state.lost).toBe(false);
    expect(state.prog).toBeTruthy();
  });

  it('stays lost if the rebuild fails', () => {
    let linked = true;
    const gl = fakeWebGL2Context({ linkStatus: () => linked });
    const canvas = document.createElement('canvas');
    canvas.getContext = () => gl;
    const state = initWebGL2(canvas);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    linked = false;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(state.lost).toBe(true);
  });
});
