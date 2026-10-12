/**
 * The service-worker reload. A new worker claims the page on install, which
 * fires controllerchange. Reloading on that is right when the page was served
 * by an older worker, and wasteful on a first visit, where the page is already
 * the current build and the reload just doubles the cold start.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerServiceWorker } from '../src/pwa.js';
import { readFileSync } from 'node:fs';

let listeners, sw, doc, reload;

function fakeServiceWorker(controller) {
  listeners = {};
  return {
    controller,
    register: vi.fn(() => Promise.resolve({ update: vi.fn(() => Promise.resolve()) })),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    fire: (type) => (listeners[type] || []).forEach((fn) => fn()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  reload = vi.fn();
  doc = { defaultView: { location: { reload } } };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(controller) {
  sw = fakeServiceWorker(controller);
  vi.stubGlobal('navigator', { serviceWorker: sw });
}

describe('registerServiceWorker reload', () => {
  it('registers the worker at the root scope, bypassing the HTTP cache', () => {
    mount(null);
    registerServiceWorker(doc);
    expect(sw.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
  });

  it('does not reload on a first visit when no worker controlled the page', () => {
    mount(null);
    registerServiceWorker(doc);
    sw.fire('controllerchange');
    vi.runAllTimers();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a new worker replaces the one serving this page', () => {
    mount({ state: 'activated' });
    registerServiceWorker(doc);
    sw.fire('controllerchange');
    sw.fire('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('holds the reload while the app reports it is busy, then reloads', () => {
    mount({ state: 'activated' });
    let busy = true;
    registerServiceWorker(doc, { isBusy: () => busy });
    sw.fire('controllerchange');
    vi.advanceTimersByTime(15000);
    expect(reload).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(15000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('main.js wiring for the reload guard and calm mode', () => {
  // read the source rather than boot the app: the wiring is the point, not the behaviour
  const main = readFileSync('src/main.js', 'utf8');
  const audio = readFileSync('src/audio.js', 'utf8');

  it('holds the reload while audio plays or capture is live', () => {
    expect(main).toMatch(/isBusy: \(\) => engine\.playing \|\| engine\.captureActive/);
  });

  it('the engine really exposes the two properties the busy check reads', () => {
    expect(audio).toMatch(/this\.playing = false;/);
    expect(audio).toMatch(/this\.captureActive = false;/);
  });

  it('sets the renderer calm mode only when the renderer has that property', () => {
    expect(main).toMatch(/if \('calm' in renderer\) renderer\.calm = state\.reduceFlashing;/);
  });
});
