/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFavicon } from '../src/favicon.js';

function fakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    beginPath: () => {}, roundRect: () => {}, rect: () => {},
    fill: () => {}, arc: () => {}, stroke: () => {},
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
    fillRect: () => {},
  };
}

describe('createFavicon', () => {
  let originalGetContext;
  let originalToDataURL;

  beforeEach(() => {
    document.head.innerHTML = '';
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    vi.restoreAllMocks();
  });

  it('returns a repaint function', () => {
    expect(typeof createFavicon(() => ['#fff'])).toBe('function');
  });

  it('creates one icon link and reuses it across repaints', () => {
    HTMLCanvasElement.prototype.getContext = () => fakeCtx();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAA';
    const update = createFavicon(() => ['#ccff00', '#ff2bd6']);

    update();
    update();

    const links = document.head.querySelectorAll('link[rel="icon"]');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('data:image/png;base64,AAA');
  });

  it('falls back to the default palette when no theme is active', () => {
    HTMLCanvasElement.prototype.getContext = () => fakeCtx();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BBB';
    const update = createFavicon(() => undefined);
    expect(() => update()).not.toThrow();
    expect(document.head.querySelector('link[rel="icon"]')).toBeTruthy();
  });

  it('degrades quietly when there is no 2d context', () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const update = createFavicon(() => ['#fff']);
    expect(() => update()).not.toThrow();
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull();
  });
});
