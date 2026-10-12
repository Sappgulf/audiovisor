import { describe, it, expect } from 'vitest';
import { THEMES } from '../src/themes.js';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';

async function renderer() {
  ensureGlobals();
  const { Renderer } = await import('../src/visualizers.js');
  const r = new Renderer(makeFakeCanvas(800, 600));
  r.setTheme(THEMES[0]);
  return r;
}

describe('palette and mode dissolves', () => {
  it('a palette change after a drawn frame dissolves from that frame', async () => {
    const r = await renderer();
    r._lastFrameDrawn = true;
    r.setTheme(THEMES[1]);
    expect(r._xfadeLeft).toBeGreaterThan(0);
    expect(r._xfadeCv).toBeTruthy();
  });

  it('a palette change before any frame is drawn does not dissolve', async () => {
    const r = await renderer();
    r._lastFrameDrawn = false;
    r.setTheme(THEMES[1]);
    expect(r._xfadeLeft).toBe(0);
  });

  it('re-applying the same palette does not dissolve', async () => {
    const r = await renderer();
    r._lastFrameDrawn = true;
    r.setTheme(THEMES[0]);
    expect(r._xfadeLeft).toBe(0);
  });

  it('a mode change still dissolves from the drawn frame', async () => {
    const r = await renderer();
    r._lastFrameDrawn = true;
    r.setMode('kaleido');
    expect(r._xfadeLeft).toBeGreaterThan(0);
  });
});
