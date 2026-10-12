/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTransport } from '../src/transport.js';

const TRANSPORT_DOM = `
  <div id="shell">
    <footer class="transport" id="transport">
      <button id="play-pause-btn"></button>
      <button id="prev-btn"></button>
      <button id="next-btn"></button>
      <button id="loop-btn"></button>
      <div id="seek-track" role="slider" tabindex="0"></div>
      <div id="volume-track" role="slider" tabindex="0"><div id="volume-fill"></div></div>
      <button id="fullscreen-btn"></button>
      <button id="tap-tempo-btn"><span id="tap-tempo-label">Tap tempo</span></button>
      <button id="loop-ab-btn"><span id="loop-ab-label">A-B loop</span></button>
    </footer>
    <main class="stage" id="stage"></main>
  </div>`;

function setup(engineExtra = {}) {
  document.body.innerHTML = TRANSPORT_DOM;
  const listeners = {};
  const engine = {
    activeInput: 'local', playing: false, volume: 1, loop: false, repeat: false, time: 12,
    toggle: vi.fn(), skip: vi.fn(), seek: vi.fn(), setVolume: vi.fn(),
    prevTrack: vi.fn(), nextTrack: vi.fn(), getDuration: () => 100,
    getTime: vi.fn(() => engine.time),
    on: vi.fn((name, fn) => { (listeners[name] ||= []).push(fn); }),
    ...engineExtra,
  };
  const saveSettings = vi.fn();
  const toast = vi.fn();
  const setToggle = vi.fn((el, on, cls = 'is-on') => el?.classList.toggle(cls, !!on));
  createTransport({
    engine, getConnect: () => null, setToggle, saveSettings, toast,
    openFilePicker: vi.fn(), doc: document,
  });
  return { engine, toast, setToggle, saveSettings, listeners };
}

const click = (id) => document.getElementById(id).click();

describe('tap tempo button', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows the BPM the engine reports', () => {
    const { engine } = setup({ tapTempo: vi.fn(() => ({ bpm: 121.6, confidence: 0.8 })) });
    click('tap-tempo-btn');
    expect(engine.tapTempo).toHaveBeenCalledTimes(1);
    expect(document.getElementById('tap-tempo-label').textContent).toBe('122 BPM');
  });

  it('keeps its label when the engine has no tempo yet, or no tapTempo at all', () => {
    setup({ tapTempo: vi.fn(() => null) });
    click('tap-tempo-btn');
    expect(document.getElementById('tap-tempo-label').textContent).toBe('Tap tempo');
  });

  it('does not throw when the audio engine lacks the method', () => {
    setup({ tapTempo: undefined });
    expect(() => click('tap-tempo-btn')).not.toThrow();
    expect(document.getElementById('tap-tempo-label').textContent).toBe('Tap tempo');
  });
});

describe('A-B loop button', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('sets A, then B with setLoop, then clears on the third press', () => {
    const setLoop = vi.fn();
    const clearLoop = vi.fn();
    const { engine } = setup({ setLoop, clearLoop });
    engine.time = 12;
    click('loop-ab-btn');
    expect(setLoop).not.toHaveBeenCalled();
    expect(document.getElementById('loop-ab-label').textContent).toBe('A 0:12, set B');

    engine.time = 40;
    click('loop-ab-btn');
    expect(setLoop).toHaveBeenCalledWith(12, 40);
    expect(document.getElementById('loop-ab-btn').classList.contains('is-active')).toBe(true);
    expect(document.getElementById('loop-ab-label').textContent).toBe('A-B 0:12-0:40');

    click('loop-ab-btn');
    expect(clearLoop).toHaveBeenCalledTimes(1);
    expect(document.getElementById('loop-ab-btn').classList.contains('is-active')).toBe(false);
    expect(document.getElementById('loop-ab-label').textContent).toBe('A-B loop');
  });

  it('refuses a B at or before A and stays waiting for B', () => {
    const setLoop = vi.fn();
    const { engine, toast } = setup({ setLoop });
    engine.time = 30;
    click('loop-ab-btn');
    engine.time = 10;
    click('loop-ab-btn');
    expect(setLoop).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });

  it('reads the region from engine.loop when the engine sets one', () => {
    const clearLoop = vi.fn();
    setup({ loop: { start: 5, end: 9 }, clearLoop });
    expect(document.getElementById('loop-ab-label').textContent).toBe('A-B 0:05-0:09');
    expect(document.getElementById('loop-ab-btn').classList.contains('is-active')).toBe(true);
    click('loop-ab-btn');   // a region already exists: the press clears it
    expect(clearLoop).toHaveBeenCalledTimes(1);
  });

  it('starts over when the source changes', () => {
    const { engine, listeners } = setup();
    engine.time = 3;
    click('loop-ab-btn');
    expect(document.getElementById('loop-ab-label').textContent).toBe('A 0:03, set B');
    listeners.source.forEach((fn) => fn());
    expect(document.getElementById('loop-ab-label').textContent).toBe('A-B loop');
  });
});

describe('repeat (loop) button', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('toggles the repeat boolean when no A-B region is set', () => {
    const { engine, saveSettings } = setup({ repeat: false, loop: null });
    click('loop-btn');
    expect(engine.repeat).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('does not overwrite an A-B region with a boolean', () => {
    const region = { start: 5, end: 9 };
    const { engine, toast } = setup({ loop: region, repeat: false });
    click('loop-btn');
    expect(engine.repeat).toBe(false);
    expect(engine.loop).toBe(region);
    expect(toast).toHaveBeenCalled();
  });
});

describe('stage double-tap', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const fire = (type, props) => {
    const e = new Event(type, { bubbles: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
    return e;
  };

  it('toggles cinema once for a touch double-tap', () => {
    setup();
    const btn = document.getElementById('fullscreen-btn');
    const spy = vi.fn();
    btn.addEventListener('click', spy);
    const stage = document.getElementById('stage');
    stage.dispatchEvent(fire('pointerup', { pointerType: 'touch', clientX: 50, clientY: 50, timeStamp: 1000 }));
    stage.dispatchEvent(fire('pointerup', { pointerType: 'touch', clientX: 52, clientY: 51, timeStamp: 1150 }));
    // the browser's trailing dblclick must not toggle it back
    stage.dispatchEvent(fire('dblclick', { timeStamp: 1300 }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not treat taps on a control inside the stage as a gesture on the stage', () => {
    document.getElementById('stage')?.remove();
    document.body.innerHTML = TRANSPORT_DOM.replace('<main class="stage" id="stage"></main>',
      '<main class="stage" id="stage"><button id="demo">Demo</button></main>');
    createTransport({
      engine: { activeInput: 'none', playing: false, volume: 1, loop: false, on: () => {}, getTime: () => 0, getDuration: () => 0 },
      getConnect: () => null, setToggle: vi.fn(), saveSettings: vi.fn(), toast: vi.fn(), openFilePicker: vi.fn(), doc: document,
    });
    const spy = vi.fn();
    document.getElementById('fullscreen-btn').addEventListener('click', spy);
    const demo = document.getElementById('demo');
    demo.dispatchEvent(fire('pointerup', { pointerType: 'touch', clientX: 5, clientY: 5, timeStamp: 10, target: demo }));
    demo.dispatchEvent(fire('pointerup', { pointerType: 'touch', clientX: 5, clientY: 5, timeStamp: 60, target: demo }));
    expect(spy).not.toHaveBeenCalled();
  });
});
