/**
 * The lazy visualizer-mode split.
 *
 * The entry bundle only carries bars/waves/scope/particles; the other
 * eighteen modes arrive in modes-extra.js on first selection. That is a
 * bundle-size win with a real failure mode attached: a mode selected before
 * the chunk resolves must still draw something rather than calling an
 * undefined method, and the chunk must install every mode the UI offers.
 */
import { describe, it, expect } from 'vitest';
import { MODES } from '../src/themes.js';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';

const CORE = ['bars', 'waves', 'scope', 'particles'];

describe('lazy visualizer modes', () => {
  it('does not carry the extra modes until they are loaded', async () => {
    const mod = await import('../src/visualizers.js');
    expect(mod.extraModesLoaded()).toBe(false);
    expect(mod.Renderer.prototype._nebula).toBeUndefined();
  });

  it('installs every non-core mode the UI offers', async () => {
    const mod = await import('../src/visualizers.js');
    await mod.loadExtraModes(mod.Renderer);
    expect(mod.extraModesLoaded()).toBe(true);
    // every mode id must have a matching draw method after installation
    const missing = MODES
      .map((m) => m.id)
      .filter((id) => {
        const name = id === 'bloomfield' ? '_bloomField' : `_${id}`;
        return typeof mod.Renderer.prototype[name] !== 'function';
      });
    expect(missing).toEqual([]);
  });

  it('selecting an extra mode before the chunk lands still renders', async () => {
    ensureGlobals();
    const mod = await import('../src/visualizers.js');
    const r = new mod.Renderer(makeFakeCanvas());
    // deliberately do NOT await the fetch setMode kicks off
    r.setMode('nebula');
    expect(r.mode).toBe('nebula');
    const freq = new Uint8Array(1024).fill(90);
    const wave = new Uint8Array(1024).fill(128);
    expect(() => {
      r.render(false, freq, wave, { bass: 0.4, mid: 0.3, high: 0.2, level: 0.35 }, 16.7);
    }).not.toThrow();
  });

  it('keeps the core modes in the entry module', async () => {
    const mod = await import('../src/visualizers.js');
    for (const id of CORE) {
      expect(typeof mod.Renderer.prototype[`_${id}`]).toBe('function');
    }
  });

  it('loadExtraModes is idempotent and shares one in-flight fetch', async () => {
    const mod = await import('../src/visualizers.js');
    const a = mod.loadExtraModes(mod.Renderer);
    const b = mod.loadExtraModes(mod.Renderer);
    await Promise.all([a, b]);
    expect(mod.extraModesLoaded()).toBe(true);
    await expect(mod.loadExtraModes(mod.Renderer)).resolves.toBeUndefined();
  });
});
