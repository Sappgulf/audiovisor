import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RESONANCE, resonancePhase, ResonanceLayer } from '../src/resonance.js';
import { MODES, THEMES } from '../src/themes.js';
import { makeFakeCanvas } from './helpers/canvas.js';

describe('resonant stage fields', () => {
  it('gives every mode a distinct profile', () => {
    expect(Object.keys(RESONANCE).sort()).toEqual(MODES.map((m) => m.id).sort());
    expect(new Set(Object.values(RESONANCE).map(String)).size).toBe(MODES.length);
  });

  it.each(MODES)('$id stays finite and has real zero crossings at silence and peak input', ({ id }) => {
    for (const level of [0, 0.5, 1]) {
      for (const time of [0, 4.5, 600]) {
        const values = [];
        for (let y = -1; y <= 1; y += 0.1) {
          for (let x = -2; x <= 2; x += 0.1) {
            const value = resonancePhase(RESONANCE[id], x, y, time, level, level, level);
            expect(Number.isFinite(value)).toBe(true);
            values.push(value);
          }
        }
        expect(resonancePhase(RESONANCE[id], 0, 0, time, level, level, level)).toBeTypeOf('number');
        expect(Math.min(...values)).toBeLessThan(-0.1);
        expect(Math.max(...values)).toBeGreaterThan(0.1);
      }
    }
  });
});

describe('Canvas contour layer', () => {
  let layer, renderer, strokes, output;
  beforeEach(() => {
    const canvas = makeFakeCanvas();
    globalThis.document = { createElement: () => canvas };
    layer = new ResonanceLayer();
    strokes = vi.spyOn(canvas._ctx, 'stroke');
    output = makeFakeCanvas();
    renderer = {
      ctx: output._ctx, w: 1280, h: 800, mode: 'waves', theme: THEMES[0],
      t: 1, sm: { bass: 0.6, mid: 0.4, high: 0.3, level: 0.5 }, beat: 0.8, quality: 'high',
    };
  });

  it('reuses geometry between samples while compositing each frame', () => {
    const composites = vi.spyOn(output._ctx, 'drawImage');
    layer.draw(renderer);
    const values = layer.values;
    layer.draw(renderer);
    expect(strokes).toHaveBeenCalledTimes(1);
    expect(composites).toHaveBeenCalledTimes(2);
    renderer.t += 0.1;
    layer.draw(renderer);
    expect(strokes).toHaveBeenCalledTimes(2);
    expect(layer.values).toBe(values);
  });

  it('reuses the backing store and palette gradient across timed refreshes', () => {
    let w = layer.canvas.width, h = layer.canvas.height;
    const width = vi.fn((value) => { w = value; });
    const height = vi.fn((value) => { h = value; });
    Object.defineProperty(layer.canvas, 'width', { get: () => w, set: width });
    Object.defineProperty(layer.canvas, 'height', { get: () => h, set: height });
    const gradients = vi.spyOn(layer.ctx, 'createLinearGradient');
    layer.draw(renderer);
    renderer.t += 0.1; layer.draw(renderer);
    renderer.t += 0.1; layer.draw(renderer);
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
    expect(gradients).toHaveBeenCalledTimes(1);
    renderer.theme = { ...THEMES[0], colors: ['#fff', '#000'] };
    layer.draw(renderer);
    expect(gradients).toHaveBeenCalledTimes(2);
  });

  it('refreshes mode and palette changes inside the same sample tick', () => {
    layer.draw(renderer);
    renderer.mode = 'fluid';
    layer.draw(renderer);
    renderer.theme = { ...THEMES[0], colors: ['#ff0000', '#0000ff'] };
    layer.draw(renderer);
    expect(strokes).toHaveBeenCalledTimes(3);
    expect(layer.theme.colors).toEqual(['#ff0000', '#0000ff']);
  });

  it.each([[3840, 2160], [390, 844], [100, 10000], [1, 1]])('bounds its cache at %sx%s and emits finite coordinates', (w, h) => {
    renderer.w = w; renderer.h = h;
    const points = vi.spyOn(layer.ctx, 'lineTo');
    layer.draw(renderer);
    expect(Math.max(layer.canvas.width, layer.canvas.height)).toBeLessThanOrEqual(640);
    expect(points.mock.calls.flat().every(Number.isFinite)).toBe(true);
    expect(layer.values.length).toBeLessThanOrEqual(73 * 121);
  });

  it('reduces geometry work on the low quality tier', () => {
    layer.draw(renderer);
    const highCount = layer.values.length;
    renderer.quality = 'low';
    layer.draw(renderer);
    expect(layer.values.length).toBeLessThan(highCount);
  });

  it('leaves the full-screen Chladni field and plugin stages alone', () => {
    renderer.mode = 'chladni'; layer.draw(renderer);
    renderer.mode = 'plugin:custom'; layer.draw(renderer);
    expect(strokes).not.toHaveBeenCalled();
  });
});
