import { describe, it, expect, afterEach, vi } from 'vitest';
import { MODES } from '../src/themes.js';
import {
  registerMode, getPluginMode, isPluginMode, registeredModes, _clearPlugins,
} from '../src/plugins.js';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';

afterEach(() => _clearPlugins());

describe('plugin registry', () => {
  it('registers a mode and exposes it on the live MODES array', () => {
    const mode = registerMode({ id: 'test-mode', name: 'Test Mode', draw: () => {} });
    expect(mode).toEqual({ id: 'test-mode', name: 'Test Mode', icon: 'sparkles' });
    expect(MODES.some((m) => m.id === 'test-mode')).toBe(true);
    expect(isPluginMode('test-mode')).toBe(true);
    expect(getPluginMode('test-mode').draw).toBeTypeOf('function');
    expect(registeredModes()).toEqual([{ id: 'test-mode', name: 'Test Mode', icon: 'sparkles' }]);
  });

  it('defaults the name to the id', () => {
    const mode = registerMode({ id: 'anon', draw: () => {} });
    expect(mode.name).toBe('anon');
  });

  it('rejects a duplicate id', () => {
    registerMode({ id: 'dupe', draw: () => {} });
    expect(() => registerMode({ id: 'dupe', draw: () => {} })).toThrow(/already exists/);
  });

  it('rejects a built-in id', () => {
    expect(() => registerMode({ id: 'bars', draw: () => {} })).toThrow(/already exists/);
  });

  it('requires an id and a draw function', () => {
    expect(() => registerMode({ draw: () => {} })).toThrow(/id/);
    expect(() => registerMode({ id: 'x' })).toThrow(/draw/);
  });

  it('removes registered modes when cleared', () => {
    registerMode({ id: 'temp', draw: () => {} });
    _clearPlugins();
    expect(isPluginMode('temp')).toBe(false);
    expect(MODES.some((m) => m.id === 'temp')).toBe(false);
  });
});

describe('plugin rendering', () => {
  it('dispatches to the registered draw during render', async () => {
    ensureGlobals();
    const { Renderer, loadExtraModes } = await import('../src/visualizers.js');
    await loadExtraModes(Renderer);
    const draw = vi.fn();
    registerMode({ id: 'plug', name: 'Plug', draw });

    const renderer = new Renderer(makeFakeCanvas(320, 240));
    renderer.resize();
    renderer.setMode('plug');
    renderer.render(false, new Uint8Array(1024), new Uint8Array(2048), {
      bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beatPulse: 0, beatPhase: 0, bpm: 120,
    }, 16.7);

    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][0]).toBe(renderer);
    expect(draw.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
  });
});
