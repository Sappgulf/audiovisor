import { describe, expect, it, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createChromeVisibility } from '../src/chrome-visibility.js';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const dom = new JSDOM('<!doctype html><div id="shell"><button id="transport">Pause</button><main id="stage"></main></div>');
  const { document } = dom.window;
  const events = new Map();
  const engine = {
    playing: false,
    activeInput: 'none',
    on(name, fn) { events.set(name, fn); },
  };
  const shell = document.getElementById('shell');
  const transport = document.getElementById('transport');
  const visibility = createChromeVisibility({ engine, shell, transport, doc: document });
  return { dom, document, events, engine, shell, transport, visibility };
}

describe('playback chrome visibility', () => {
  it('gives the stage space, hides after inactivity, and reveals on pointer activity', () => {
    const { dom, events, engine, shell } = setup();
    engine.playing = true;
    engine.activeInput = 'track';
    events.get('state')();
    expect(shell.classList.contains('is-auto-transport')).toBe(true);
    vi.advanceTimersByTime(3200);
    expect(shell.classList.contains('is-transport-hidden')).toBe(true);
    shell.dispatchEvent(new dom.window.Event('pointermove'));
    expect(shell.classList.contains('is-transport-hidden')).toBe(false);
    vi.advanceTimersByTime(3200);
    expect(shell.classList.contains('is-transport-hidden')).toBe(true);
  });

  it('keeps controls visible after pause and while a control has keyboard focus', () => {
    const { events, engine, shell, transport } = setup();
    engine.playing = true;
    engine.activeInput = 'track';
    events.get('state')();
    transport.focus();
    vi.advanceTimersByTime(3200);
    expect(shell.classList.contains('is-transport-hidden')).toBe(false);
    engine.playing = false;
    events.get('state')();
    expect(shell.classList.contains('is-auto-transport')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(shell.classList.contains('is-transport-hidden')).toBe(false);
  });

  it('uses the same reveal behavior in cinema and after leaving it', () => {
    const { dom, shell, visibility } = setup();
    shell.classList.add('is-cinema');
    visibility.refresh();
    vi.advanceTimersByTime(2200);
    expect(shell.classList.contains('is-chrome-hidden')).toBe(true);
    shell.dispatchEvent(new dom.window.Event('pointerdown'));
    expect(shell.classList.contains('is-chrome-hidden')).toBe(false);
    shell.classList.remove('is-cinema');
    visibility.refresh();
    vi.advanceTimersByTime(5000);
    expect(shell.classList.contains('is-chrome-hidden')).toBe(false);
  });

  it('does not auto-hide for reduced-motion users', () => {
    const { document, events, engine, shell } = setup();
    document.defaultView.matchMedia = () => ({ matches: true });
    engine.playing = true;
    engine.activeInput = 'track';
    events.get('state')();
    vi.advanceTimersByTime(5000);
    expect(shell.classList.contains('is-auto-transport')).toBe(false);
    expect(shell.classList.contains('is-transport-hidden')).toBe(false);
  });
});
