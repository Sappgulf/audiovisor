import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The two art modules count as fetched when their factories run. They stand
   in for the real generator and palette reader, so only the loader's
   boundaries are under test. */
const loads = vi.hoisted(() => ({ album: 0, palette: 0, fail: false }));

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('cover-art modules load on first use', () => {
  let mod;
  let toast;

  beforeEach(async () => {
    vi.resetModules();
    loads.album = 0;
    loads.palette = 0;
    loads.fail = false;
    vi.doMock('../src/albumart.js', () => {
      loads.album++;
      if (loads.fail) throw new Error('offline');
      return { generateAlbumArt: vi.fn(() => 'art') };
    });
    vi.doMock('../src/artpalette.js', () => {
      loads.palette++;
      return { extractPalette: vi.fn(() => ['#000000']), paletteToTheme: vi.fn((c) => ({ colors: c })) };
    });
    mod = await import('../src/art-loader.js');
    toast = vi.fn();
  });

  afterEach(() => {
    vi.doUnmock('../src/albumart.js');
    vi.doUnmock('../src/artpalette.js');
  });

  it('creating the loader requests neither module', async () => {
    const art = mod.createArtLoader({ toast });
    await settle();
    expect(loads.album).toBe(0);
    expect(loads.palette).toBe(0);
    expect(art.getPalette()).toBeNull();
  });

  it('an artless local track loads procedural art and never the palette reader', async () => {
    const art = mod.createArtLoader({ toast });
    const album = await art.loadAlbumArt();
    expect(typeof album.generateAlbumArt).toBe('function');
    expect(loads.album).toBe(1);
    expect(loads.palette).toBe(0);
  });

  it('a provider cover loads the palette reader once and keeps it', async () => {
    const art = mod.createArtLoader({ toast });
    const palette = await art.loadPalette();
    expect(typeof palette.extractPalette).toBe('function');
    expect(art.getPalette()).toBe(palette);
    await art.loadPalette();
    expect(loads.palette).toBe(1);
    expect(loads.album).toBe(0);
  });

  it('a failed fetch toasts and the next use retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const art = mod.createArtLoader({ toast });
      loads.fail = true;
      expect(await art.loadAlbumArt()).toBeNull();
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('Track art unavailable'), expect.anything());

      loads.fail = false;
      expect(await art.loadAlbumArt()).not.toBeNull();
      expect(loads.album).toBe(2);
    } finally { err.mockRestore(); }
  });
});
