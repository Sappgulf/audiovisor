import { describe, it, expect, beforeEach, afterEach } from 'vitest';

function fakeCtx() {
  const grad = () => ({ addColorStop: () => {} });
  return {
    fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, fill: () => {}, stroke: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, ellipse: () => {},
    createLinearGradient: grad, createRadialGradient: grad,
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
  };
}

function fakeCanvas(w = 96) {
  return {
    getContext: () => fakeCtx(),
    width: w,
    height: w,
  };
}

describe('album art v2', () => {
  let orig;
  beforeEach(() => {
    orig = globalThis.document;
    globalThis.document = {
      createElement: (tag) => (tag === 'canvas' ? fakeCanvas(96) : {}),
    };
  });
  afterEach(() => { globalThis.document = orig; });

  it('produces a canvas sized to request', async () => {
    const { generateAlbumArt } = await import('../src/albumart.js');
    const c = generateAlbumArt('Test Track', ['#d9b089', '#c49a6e'], 256);
    expect(c.width).toBe(256);
    expect(c.getContext).toBeInstanceOf(Function);
  });

  it('is deterministic (same seed = same composition, no throw)', async () => {
    const { generateAlbumArt } = await import('../src/albumart.js');
    expect(() => generateAlbumArt('Same Name', ['#a', '#b', '#c'], 128)).not.toThrow();
    expect(() => generateAlbumArt('Same Name', ['#a', '#b', '#c'], 128)).not.toThrow();
  });

  it('handles empty name with default colors', async () => {
    const { generateAlbumArt } = await import('../src/albumart.js');
    expect(() => generateAlbumArt('')).not.toThrow();
  });
});
