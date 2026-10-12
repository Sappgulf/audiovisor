import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The share card counts as fetched when its factory runs. The factory stands
   in for the compositor, so only the loader's behaviour is under test. */
const loads = vi.hoisted(() => ({ count: 0, fail: false, deps: null, snapshot: null }));

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('share card is loaded on the first snapshot', () => {
  let mod;
  let deps;

  beforeEach(async () => {
    vi.resetModules();
    loads.count = 0;
    loads.fail = false;
    loads.snapshot = null;
    vi.doMock('../src/share-card.js', () => {
      loads.count++;
      if (loads.fail) throw new Error('offline');
      return {
        createShareCard: (d) => {
          loads.deps = d;
          loads.snapshot = vi.fn();
          return { renderShareCard: vi.fn(), snapshot: loads.snapshot };
        },
      };
    });
    mod = await import('../src/share-card-loader.js');
    deps = {
      getTheme: vi.fn(), getModeName: vi.fn(), getTrackName: vi.fn(),
      getLiveCanvas: vi.fn(), download: vi.fn(), toast: vi.fn(),
    };
  });

  afterEach(() => {
    vi.doUnmock('../src/share-card.js');
  });

  it('creating the loader does not request share-card.js', async () => {
    mod.createShareCardLoader(deps);
    await settle();
    expect(loads.count).toBe(0);
  });

  it('the first snapshot requests share-card.js and takes the picture', async () => {
    const { snapshot } = mod.createShareCardLoader(deps);
    snapshot();
    await settle();
    expect(loads.count).toBe(1);
    expect(loads.snapshot).toHaveBeenCalledTimes(1);
    expect(loads.deps.download).toBe(deps.download);
  });

  it('later snapshots reuse the module that is already loaded', async () => {
    const { snapshot } = mod.createShareCardLoader(deps);
    snapshot();
    await settle();
    snapshot();
    await settle();
    expect(loads.count).toBe(1);
    expect(loads.snapshot).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch toasts and the next snapshot retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { snapshot } = mod.createShareCardLoader(deps);
      loads.fail = true;
      snapshot();
      await settle();
      expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('Snapshot unavailable'), expect.anything());

      loads.fail = false;
      snapshot();
      await settle();
      expect(loads.snapshot).toHaveBeenCalledTimes(1);
    } finally { err.mockRestore(); }
  });
});
