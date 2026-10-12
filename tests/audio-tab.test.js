/**
 * @vitest-environment jsdom
 *
 * Audio tab extras: the speed chips, the visual sync slider and its reset,
 * the guards for an engine that lacks setSpeed or syncOffsetMs, and the
 * loader that builds them the first time the tab opens.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { createAudioTab } = await import('../src/audio-tab.js');
const { createDrawerSections } = await import('../src/drawer-sections.js');

const AUDIO_PANEL = `
  <div class="drawer-panel" id="panel-audio" data-panel="audio">
    <section>
      <h3 class="section-title">Engine Control</h3>
      <div class="sliders" id="sliders"></div>
    </section>
  </div>`;

let engine;
let saveSettings;

const chip = (speed) => document.querySelector(`[data-speed="${speed}"]`);
const slider = () => document.getElementById('sync-slider');
const label = () => document.getElementById('sync-val');

beforeEach(() => {
  document.body.innerHTML = AUDIO_PANEL;
  engine = { speed: 1, syncOffsetMs: 0, setSpeed: vi.fn((v) => { engine.speed = v; }) };
  saveSettings = vi.fn();
});

describe('speed chips', () => {
  it('offers 0.75x, 1x, 1.25x and 1.5x at the top of the first section', () => {
    createAudioTab({ engine, saveSettings });
    const labels = [...document.querySelectorAll('[data-speed]')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['0.75x', '1x', '1.25x', '1.5x']);
    const title = document.querySelector('#panel-audio .section-title');
    expect(title.nextElementSibling.id).toBe('audio-extras');
  });

  it('sets the engine speed, marks the chip active, and saves', () => {
    createAudioTab({ engine, saveSettings });
    chip(1.25).click();
    expect(engine.setSpeed).toHaveBeenCalledWith(1.25);
    expect(chip(1.25).classList.contains('is-active')).toBe(true);
    expect(chip(1.25).getAttribute('aria-pressed')).toBe('true');
    expect(chip(1).classList.contains('is-active')).toBe(false);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('marks the speed the engine already runs at', () => {
    engine.speed = 0.75;
    createAudioTab({ engine, saveSettings });
    expect(chip(0.75).classList.contains('is-active')).toBe(true);
    expect(chip(1).classList.contains('is-active')).toBe(false);
  });

  it('does not throw when the engine has no setSpeed', () => {
    delete engine.setSpeed;
    createAudioTab({ engine, saveSettings });
    expect(() => chip(1.5).click()).not.toThrow();
  });
});

describe('visual sync', () => {
  it('shows the current offset with a sign and sets the engine value on input', () => {
    createAudioTab({ engine, saveSettings });
    expect(label().textContent).toBe('0 ms');
    slider().value = '-120';
    slider().dispatchEvent(new Event('input'));
    expect(engine.syncOffsetMs).toBe(-120);
    expect(label().textContent).toBe('-120 ms');
    slider().value = '45';
    slider().dispatchEvent(new Event('input'));
    expect(label().textContent).toBe('+45 ms');
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it('spans -300 to +300 ms', () => {
    createAudioTab({ engine, saveSettings });
    expect(slider().min).toBe('-300');
    expect(slider().max).toBe('300');
  });

  it('reset sets the offset back to 0', () => {
    engine.syncOffsetMs = 200;
    createAudioTab({ engine, saveSettings });
    expect(label().textContent).toBe('+200 ms');
    document.getElementById('sync-reset').click();
    expect(engine.syncOffsetMs).toBe(0);
    expect(label().textContent).toBe('0 ms');
    expect(slider().value).toBe('0');
  });

  it('is disabled and writes nothing when the engine has no syncOffsetMs', () => {
    delete engine.syncOffsetMs;
    createAudioTab({ engine, saveSettings });
    expect(slider().disabled).toBe(true);
    expect(document.getElementById('sync-reset').disabled).toBe(true);
    slider().value = '80';
    slider().dispatchEvent(new Event('input'));
    expect(engine.syncOffsetMs).toBeUndefined();
  });
});

describe('loading the tab', () => {
  it('builds the controls once, on the first open, and not before', async () => {
    const deps = {
      state: {}, engine, toast: vi.fn(), setFx: vi.fn(), setTheme: vi.fn(), saveSettings,
    };
    const sections = createDrawerSections(deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('audio-extras')).toBeNull();

    await sections.ensureAudio();
    await sections.ensureAudio();
    expect(document.querySelectorAll('#audio-extras').length).toBe(1);
  });

  it('returns null when the Audio panel markup is missing', () => {
    document.body.innerHTML = '';
    expect(createAudioTab({ engine, saveSettings })).toBeNull();
  });
});

describe('repainting when the engine changes', () => {
  // the real engine, so these exercise the events it actually emits
  let AudioEngine;
  beforeEach(async () => {
    ({ AudioEngine } = await import('../src/audio.js'));
    engine = new AudioEngine();
  });

  it('moves the speed chips when the FX chain changes the speed', () => {
    createAudioTab({ engine, saveSettings });
    engine.setSpeed(1.5);
    expect(chip(1.5).classList.contains('is-active')).toBe(true);
    expect(chip(1).classList.contains('is-active')).toBe(false);
  });

  it('moves the sync slider and its label when the offset is set elsewhere', () => {
    createAudioTab({ engine, saveSettings });
    engine.syncOffsetMs = -90;
    expect(slider().value).toBe('-90');
    expect(label().textContent).toBe('-90 ms');
  });

  it('ignores changes made on a different engine', () => {
    createAudioTab({ engine, saveSettings });
    engine.setSpeed(1.25);
    expect(chip(1.25).classList.contains('is-active')).toBe(true);
    // another engine's changes do not reach this panel's chips
    const other = new AudioEngine();
    other.setSpeed(0.75);
    expect(chip(0.75).classList.contains('is-active')).toBe(false);
  });
});
