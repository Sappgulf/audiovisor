import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';

/* Backing-store sizing for the Canvas2D stage. The DPR cap is applied once,
   in the Renderer constructor, and every resize reads it from there. */
describe('phone backing store', () => {
  let Renderer;
  beforeEach(async () => {
    ensureGlobals();
    vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 8 });
    ({ Renderer } = await import('../src/visualizers.js'));
  });
  afterEach(() => { vi.unstubAllGlobals(); ensureGlobals(); });

  it('caps a 3x phone at dpr 2', () => {
    globalThis.window.devicePixelRatio = 3;
    const r = new Renderer(makeFakeCanvas(390, 844));
    expect(r.dpr).toBe(2);
    expect(r._scale).toBe(2);
  });

  it('keeps a 2x phone at its own dpr', () => {
    globalThis.window.devicePixelRatio = 2;
    const r = new Renderer(makeFakeCanvas(390, 844));
    expect(r.dpr).toBe(2);
  });

  it('caps low-memory devices at 1.5', () => {
    globalThis.window.devicePixelRatio = 3;
    vi.stubGlobal('navigator', { deviceMemory: 2, hardwareConcurrency: 8 });
    const r = new Renderer(makeFakeCanvas(390, 844));
    expect(r.dpr).toBe(1.5);
  });

  it('does not reassign the backing store when the size has not changed', () => {
    globalThis.window.devicePixelRatio = 2;
    const canvas = makeFakeCanvas(390, 844);
    let widthSets = 0;
    let heightSets = 0;
    let w = 0;
    let h = 0;
    Object.defineProperty(canvas, 'width', { get: () => w, set: (v) => { w = v; widthSets++; } });
    Object.defineProperty(canvas, 'height', { get: () => h, set: (v) => { h = v; heightSets++; } });
    const r = new Renderer(canvas);
    expect(widthSets).toBe(1);
    expect(heightSets).toBe(1);
    r.resize();
    r.resize();
    expect(widthSets).toBe(1);
    expect(heightSets).toBe(1);
    expect(w).toBe(780);
    expect(h).toBe(1688);
  });

  it('reassigns only the dimension that changed', () => {
    globalThis.window.devicePixelRatio = 2;
    const canvas = makeFakeCanvas(390, 844);
    let widthSets = 0;
    let heightSets = 0;
    let w = 0;
    let h = 0;
    Object.defineProperty(canvas, 'width', { get: () => w, set: (v) => { w = v; widthSets++; } });
    Object.defineProperty(canvas, 'height', { get: () => h, set: (v) => { h = v; heightSets++; } });
    const r = new Renderer(canvas);
    canvas.getBoundingClientRect = () => ({ width: 390, height: 900 });
    r.resize();
    expect(widthSets).toBe(1);
    expect(heightSets).toBe(2);
    expect(h).toBe(1800);
  });
});
