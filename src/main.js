import { setIcon } from './icons.js';
import { applyAccent } from './chrome.js';
import { MODES, THEMES } from './themes.js';
import { AudioEngine } from './audio.js';
import { Renderer, loadExtraModes } from './visualizers.js';
import { fmtTime, pickRandom, fmtStamp, computePeaks, esc } from './utils.js';
import { filterCommands, clampActive } from './palette.js';
import { bindDragTrack, keyStep, makeDoubleTap } from './drag.js';
import { bindSheetDrag } from './sheet.js';
import {
  SETTINGS_KEY, serializeSettings, validateSettings, readSettings,
} from './settings.js';
/* localStorage writes throw in Safari private browsing and once the origin
   quota is full. Nothing here is worth failing over. See src/storage.js. */
import { readJSON, writeJSON, writeText, readText, remove as removeStored } from './storage.js';
import { readPresets, writePreset, PRESET_SLOTS } from './presets.js';
import {
  shouldEvaluate, nextTier, next2dQuality, estimateBaseline, baselineOr, initialTier,
  TIERS, SEVERE,
} from './adaptive.js';
import * as Library from './library.js';
import { AI_PRESETS, suggestPreset } from './ai.js';
import { detectPitch, freqToMidi, VoiceSynth } from './voice.js';
import { detectMood } from './mood.js';
import { generateAlbumArt } from './albumart.js';
import { extractPalette, paletteToTheme, hashStr } from './artpalette.js';
import { initWebGL2, renderWebGL2 } from './webgl2.js';
import { initWebGPU, renderWebGPU } from './webgpu.js';
import * as Social from './social.js';

const $ = (id) => document.getElementById(id);

const engine = new AudioEngine();
const renderer = new Renderer($('viz-canvas'));
/* The eighteen heavier Canvas2D modes ship in their own chunk. setMode()
   fetches it on demand, but that leaves a frame or two of bars on the first
   switch, so warm it once the browser is otherwise idle. */
const warmExtraModes = () => loadExtraModes(Renderer).catch(() => {});
if (typeof requestIdleCallback === 'function') requestIdleCallback(warmExtraModes, { timeout: 4000 });
else setTimeout(warmExtraModes, 1500);
/* RayStage carries the whole GLSL scene library (raystage + rayshader), by
   far the largest thing in the bundle, and every mode already has a working
   Canvas2D path. Start on a no-op stub that reports `ok: false` — which the
   render loop already treats as "use the 2D renderer" — and swap the real
   stage in once its chunk lands. */
let ray = {
  ok: false, lost: false, loading: true, error: null,
  canvas: $('ray-canvas'), beat: 0, w: 0, h: 0, quality: 'high',
  setMode() {}, setTheme() {}, setQuality() {}, setSensitivity() {},
  setBassFocus() {}, setColorPop() {}, setBloom() {}, resize() {}, render() {},
};

import('./raystage.js')
  .then(({ RayStage }) => {
    const stage = new RayStage($('ray-canvas'));
    ray = stage;
    if (!stage.ok && stage.error) console.warn('raytrace stage unavailable:', stage.error);
    // replay everything the stub swallowed while the chunk was in flight
    stage.setTheme(activeTheme());
    stage.setMode(state.modeId);
    stage.setQuality(initialTier(state.rayQuality));
    for (const [id, el] of Object.entries(sliderEls)) applySlider(id, parseFloat(el.value));
    if (renderer.w) stage.resize(renderer.w, renderer.h);
  })
  .catch((err) => {
    ray.loading = false;
    ray.error = err;
    console.warn('raytrace stage failed to load:', err);
  });
renderer.setTheme(THEMES.find((t) => t.id === 'brass'));
ray.setTheme(THEMES.find((t) => t.id === 'brass'));

const RAY_QUALITIES = ['low', 'medium', 'high', 'ultra'];

const state = {
  modeId: 'bars',
  themeId: 'brass',
  autopilot: false,
  autopilotTimer: null,
  drawerOpen: typeof window !== 'undefined' ? window.innerWidth > 640 : true,
  // what the user asked for, persisted; whether it's actually running is
  // ray.ok, which can flip on a GPU context loss
  raytraceWanted: true,
  rayQuality: 'high',
  fx: { reverb: false, limiter: false, lowpass: false, speed: false, autotune: false, chorus: false, echo: false, crush: false, chop: false, widener: false },
};

/* ---------- toasts ---------- */

const toasts = $('toasts');
function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = msg;
  toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 350);
  }, opts.duration || 2400);
  while (toasts.children.length > 3) toasts.firstChild.remove();
}

/* ---------- icons ---------- */

document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

/* ---------- drawer sections ---------- */

const modeList = $('mode-list');
MODES.forEach((m) => {
  const btn = document.createElement('button');
  btn.className = 'mode-card' + (m.id === state.modeId ? ' is-active' : '');
  /* The tile shows the mode. Every card used to carry a small line icon and
     nothing else, so the picker was 22 near-identical rectangles for a
     decision that is entirely visual — and two of the icons were reused
     across different modes. The icon stays underneath as the fallback: if
     the thumbnail is missing or fails to decode, the card looks exactly as
     it did before rather than showing a broken image. */
  btn.innerHTML = `
    <div class="mode-preview">
      <span class="ic" data-icon="${m.icon}"></span>
      <img class="mode-thumb" src="/modes/${m.id}.webp" alt="" aria-hidden="true"
           loading="lazy" decoding="async" width="176" height="108">
    </div>
    <span class="mode-name">${m.name}</span>`;
  const thumb = btn.querySelector('.mode-thumb');
  thumb.addEventListener('load', () => btn.classList.add('has-thumb'));
  thumb.addEventListener('error', () => {
    /* drop the class too, or the card keeps hiding the fallback icon and
       renders an empty box where the thumbnail used to be */
    btn.classList.remove('has-thumb');
    thumb.remove();
  });
  /* hover animation: a 10-frame sprite strip baked by make-thumbs.mjs,
     walked with a CSS steps() animation. The strip is only fetched the
     first time a card is hovered, so the drawer's first paint still costs
     just the static thumbnails. */
  const preview = btn.querySelector('.mode-preview');
  const anim = document.createElement('div');
  anim.className = 'mode-thumb-anim';
  preview.appendChild(anim);
  let stripRequested = false;
  btn.addEventListener('pointerenter', () => {
    if (!btn.classList.contains('has-thumb')) return;
    if (!stripRequested) {
      anim.style.backgroundImage = `url('/modes/${m.id}-anim.webp')`;
      stripRequested = true;
    }
    btn.classList.add('is-anim');
  });
  btn.addEventListener('pointerleave', () => btn.classList.remove('is-anim'));
  btn.addEventListener('click', () => setMode(m.id));
  modeList.appendChild(btn);
});
modeList.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

const themeRow = $('theme-row');
/* Auto leads the row: its palette comes from the current track's cover art
   (or, for artless local files, deterministically from the track name), so
   the swatch is a spectrum rather than any one colour. */
const autoDot = document.createElement('button');
autoDot.className = 'theme-dot theme-dot-auto';
autoDot.dataset.theme = 'auto';
autoDot.title = 'Auto — from album art';
autoDot.setAttribute('aria-label', 'Auto theme from album art');
autoDot.style.background = 'conic-gradient(from 210deg, #ff2bd6, #ff8a00, #ccff00, #00f0ff, #7b2bff, #ff2bd6)';
autoDot.addEventListener('click', () => setTheme('auto'));
themeRow.appendChild(autoDot);
THEMES.forEach((t) => {
  const btn = document.createElement('button');
  btn.className = 'theme-dot' + (t.id === state.themeId ? ' is-active' : '');
  btn.dataset.theme = t.id;
  btn.style.background = t.css;
  btn.title = t.name;
  btn.addEventListener('click', () => setTheme(t.id));
  themeRow.appendChild(btn);
});

const SLIDERS = [
  { id: 'sensitivity', label: 'Sensitivity', min: 0.4, max: 2.4, step: 0.05, value: 1.4, fmt: (v) => `x${v.toFixed(2)}` },
  { id: 'bass-focus', label: 'Bass Focus', min: 0, max: 1, step: 0.05, value: 0.5, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'smoothing', label: 'Smoothing', min: 0, max: 0.95, step: 0.01, value: 0.82, fmt: (v) => v.toFixed(2) },
  { id: 'color-pop', label: 'Color Pop', min: 0.6, max: 1.9, step: 0.05, value: 1.0, fmt: (v) => `${Math.round(v*100)}%` },
  { id: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.05, value: 0.5, fmt: (v) => `${Math.round(v*100)}%` },
];
const slidersWrap = $('sliders');
const sliderEls = {};
SLIDERS.forEach((cfg) => {
  const group = document.createElement('div');
  group.className = 'slider-group';
  group.innerHTML = `
    <div class="slider-head">
      <label class="slider-label mono">${cfg.label}</label>
      <span class="slider-value" id="sl-val-${cfg.id}">${cfg.fmt(cfg.value)}</span>
    </div>
    <input type="range" class="ctrl-slider" id="sl-${cfg.id}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${cfg.value}">`;
  slidersWrap.appendChild(group);
  const input = group.querySelector('input');
  sliderEls[cfg.id] = input;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    group.querySelector('.slider-value').textContent = cfg.fmt(v);
    applySlider(cfg.id, v);
    saveSettings();
  });
});

/**
 * Flip a control's visual state and the state it reports together.
 *
 * Every toggle in here used to set a class and nothing else, so a screen
 * reader announced "Reverb, button" whether reverb was on or off — the same
 * for Loop, Autopilot, Auto DJ, mic, capture and the panel toggles. Doing
 * both in one call is the only way they stay in step as this grows.
 */
/* Controls that are on/off rather than one-shot actions. Kept in one place
   so the boot-time seeding below and the test that checks it cannot drift
   from each other. */
const TOGGLE_SELECTOR = [
  '.fx-chip', '#loop-btn', '#shuffle-btn', '#rt-chip', '#autopilot-chip',
  '#autodj-chip', '#queue-btn', '#library-btn', '#mic-btn', '#capture-btn',
  '#voice-btn', '#party-btn',
].join(',');

function setToggle(el, on, cls = 'is-on') {
  if (!el) return;
  el.classList.toggle(cls, !!on);
  el.setAttribute('aria-pressed', String(!!on));
}

function applySlider(id, v) {
  if (id === 'sensitivity') {
    engine.sensitivity = v;
    renderer.setSensitivity(v);
    ray.setSensitivity(v);
  } else if (id === 'bass-focus') {
    engine.bassFocus = v;
    renderer.setBassFocus(v);
    ray.setBassFocus(v);
  } else if (id === 'smoothing') {
    engine.setSmoothing(v);
  } else if (id === 'color-pop') {
    renderer.setColorPop(v);
    ray.setColorPop(v);
  } else if (id === 'bloom') {
    renderer.setBloom(v);
    ray.setBloom(v);
  }
}

const FX = ['reverb', 'limiter', 'lowpass', 'speed', 'autotune', 'chorus', 'echo', 'crush', 'chop', 'widener'];
const fxRow = $('fx-row');
const fxEls = {};
FX.forEach((fx) => {
  const btn = document.createElement('button');
  btn.className = 'fx-chip';
  btn.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${fx.toUpperCase()}</span>`;
  setToggle(btn, false, 'is-active');   // report "off" from the start, not nothing
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('is-active');
    setToggle(btn, on, 'is-active');
    engine.setFx(fx, on);
    state.fx[fx] = on;
    saveSettings();
    toast(`FX <b>${fx.toUpperCase()}</b> ${on ? 'engaged' : 'bypassed'}`, { duration: 1400 });
  });
  fxRow.appendChild(btn);
  fxEls[fx] = btn;
});

// EQ bands
const eqBands = document.getElementById('eq-bands');
const EQ_FREQS = [60, 250, 1000, 4000, 12000];
if (eqBands) {
  EQ_FREQS.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'eq-row';
    row.innerHTML = `<span class="mono eq-label">${f >= 1000 ? f/1000 + 'K' : f}</span><input type="range" class="ctrl-slider eq-slider" min="-10" max="10" step="0.5" value="0" /><span class="mono eq-val">0</span>`;
    eqBands.appendChild(row);
    row.querySelector('input').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      row.querySelector('.eq-val').textContent = v > 0 ? '+' + v : v;
      engine.setEq(i, v);
      saveSettings();
    });
  });
}

// Auto DJ
let autoDj = false;
let djFiring = false;
document.getElementById('autodj-chip')?.addEventListener('click', () => {
  autoDj = !autoDj;
  setToggle(document.getElementById('autodj-chip'), autoDj, 'is-active');
  toast(autoDj ? 'AUTO DJ <b>ON</b> — beat-matched crossfade' : 'AUTO DJ <b>OFF</b>', { duration: 1600 });
  saveSettings();
});

// Sleep timer — cycles OFF → 15 → 30 → 60 min, then fades out & pauses
const SLEEP_STEPS = [0, 15, 30, 60];
let sleepStep = 0;
let sleepEnd = 0;
let sleepTick = null;
const sleepLabel = document.getElementById('sleep-label');
document.getElementById('sleep-chip')?.addEventListener('click', () => {
  sleepStep = (sleepStep + 1) % SLEEP_STEPS.length;
  const mins = SLEEP_STEPS[sleepStep];
  if (!mins) {
    if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
    sleepEnd = 0;
    if (sleepLabel) sleepLabel.textContent = 'Sleep';
    toast('SLEEP timer <b>OFF</b>', { duration: 1400 });
    return;
  }
  sleepEnd = Date.now() + mins * 60000;
  if (sleepLabel) sleepLabel.textContent = `Sleep ${mins}m`;
  toast(`SLEEP <b>${mins} min</b> — fade out &amp; pause`, { duration: 1800 });
  if (sleepTick) clearInterval(sleepTick);
  sleepTick = setInterval(() => {
    const rem = sleepEnd - Date.now();
    if (rem <= 0) { fireSleep(); return; }
    if (sleepLabel) {
      if (rem <= 60000) sleepLabel.textContent = `${Math.ceil(rem / 1000)}s`;
      else sleepLabel.textContent = `Sleep ${Math.ceil(rem / 60000)}m`;
    }
  }, 500);
});
async function fireSleep() {
  if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
  sleepEnd = 0;
  const baseVol = engine.volume;
  for (let i = 10; i > 0; i--) {
    if (!engine.playing && !engine.micActive && !engine.captureActive) break;
    engine.setVolume(baseVol * (i / 10));
    $('volume-fill').style.width = `${engine.volume * 100}%`;
    await new Promise((r) => setTimeout(r, 700));
  }
  engine.pause();
  engine.setVolume(baseVol);
  $('volume-fill').style.width = `${baseVol * 100}%`;
  sleepStep = 0;
  if (sleepLabel) sleepLabel.textContent = 'Sleep';
  refreshStatus();
  saveSettings();
  toast('SLEEP — <b>goodnight</b>', { duration: 2600 });
}

// Look presets — click recalls a slot, right-click saves the current look
/* The vocabulary is built on demand rather than hoisted: MODES/THEMES/FX are
   module constants, but SETTINGS_VOCAB is defined further down and presets
   must not depend on statement order in this file. */
const presetVocab = () => ({
  modeIds: MODES.map((m) => m.id),
  themeIds: ['auto', ...THEMES.map((t) => t.id)],
  fxNames: FX,
});

function savePreset(slot) {
  const ok = writePreset(slot, { mode: state.modeId, theme: state.themeId, fx: { ...state.fx } }, presetVocab());
  toast(ok ? `LOOK <b>saved</b> to slot ${slot}` : 'Could not <b>save</b> — storage is full', { duration: 1600 });
  return ok;
}

function loadPreset(slot) {
  const p = readPresets(presetVocab())[slot];
  if (!p) { toast(`Slot <b>${slot}</b> is empty — right-click to save`, { duration: 2200 }); return; }
  if (p.mode) setMode(p.mode);
  if (p.theme) setTheme(p.theme);
  for (const [k, v] of Object.entries(p.fx)) {
    engine.setFx(k, v);
    setToggle(fxEls[k], v, 'is-active');
    state.fx[k] = v;
  }
  saveSettings();
  toast(`LOOK <b>recalled</b> from slot ${slot}`, { duration: 1600 });
}

const presetRow = document.getElementById('preset-row');
if (presetRow) {
  const stored = readPresets(presetVocab());
  for (const slot of PRESET_SLOTS) {
    const b = document.createElement('button');
    b.className = 'fx-chip' + (stored[slot] ? ' is-active' : '');
    b.title = 'Click to recall · right-click to save';
    b.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">P${slot}</span>`;
    b.addEventListener('click', () => loadPreset(slot));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // only light the chip if the write actually landed
      if (savePreset(slot)) b.classList.add('is-active');
    });
    presetRow.appendChild(b);
  }
}

// AI Remix Studio wiring
const aiStems = document.getElementById('ai-stems');
if (aiStems) {
  ['vocals','drums','bass'].forEach(s => {
    const b = document.createElement('button');
    b.className = 'fx-chip';
    b.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${s}</span>`;
    b.addEventListener('click', () => {
      b.classList.toggle('is-active');
      const on = b.classList.contains('is-active');
      if (!engine.filter) { toast('<b>Play something first</b>', { duration: 1600 }); b.classList.remove('is-active'); return; }
      // stem isolation via filter
      if (s === 'vocals') engine.filter.frequency.setTargetAtTime(on ? 3200 : 22050, engine.ctx?.currentTime || 0, 0.08);
      if (s === 'bass') engine.filter.frequency.setTargetAtTime(on ? 180 : 22050, engine.ctx?.currentTime || 0, 0.08);
      if (s === 'drums') engine.filter.frequency.setTargetAtTime(on ? 8000 : 22050, engine.ctx?.currentTime || 0, 0.08);
      engine.filter.type = 'bandpass';
      if (!on) { engine.filter.type = 'lowpass'; engine.filter.frequency.setTargetAtTime(engine.fx.lowpass ? 400 : 22050, engine.ctx?.currentTime || 0, 0.08); }
      toast(`Stem <b>${s}</b> ${on ? 'solo' : 'all'}`);
    });
    aiStems.appendChild(b);
  });
}
const aiPresetsEl = document.getElementById('ai-presets');
if (aiPresetsEl) {
  AI_PRESETS.forEach(pr => {
    const b = document.createElement('button');
    b.className = 'mini-btn';
    b.textContent = pr.name;
    b.addEventListener('click', () => {
      for (const [k,v] of Object.entries(pr.fx)) { engine.setFx(k, v); const el=fxEls[k]; if(el) el.classList.toggle('is-active', v); state.fx[k]=v; }
      if (pr.theme) setTheme(pr.theme);
      saveSettings();
      toast(`AI <b>${pr.name}</b> applied`);
    });
    aiPresetsEl.appendChild(b);
  });
}
document.getElementById('ai-suggest')?.addEventListener('click', () => {
  const pr = suggestPreset(Math.floor(Math.random()*9999));
  for (const [k,v] of Object.entries(pr.fx)) { engine.setFx(k, !!v); const el=fxEls[k]; if(el) el.classList.toggle('is-active', !!v); state.fx[k]=!!v; }
  setTheme(pr.theme);
  saveSettings();
  toast(`AI suggests <b>${pr.name}</b>`);
});

// Collab & Share wiring
const shareBtn = document.getElementById('share-btn');
shareBtn?.addEventListener('click', async () => {
  const data = btoa(JSON.stringify({ mode: state.modeId, theme: state.themeId, fx: state.fx }));
  const url = location.origin + location.pathname + '#share=' + data;
  try { await navigator.clipboard.writeText(url); toast('Link <b>copied</b>'); } catch { prompt('Copy link', url); }
  // store in local collab history
  const hist = readJSON('audiovisor.collab', []);
  hist.unshift({ url, at: Date.now() });
  writeJSON('audiovisor.collab', hist.slice(0, 20));
});
const partyBtn = document.getElementById('party-btn');
partyBtn?.addEventListener('click', () => {
  const qr = document.getElementById('party-qr');
  const urlEl = document.getElementById('qr-url');
  if (urlEl) urlEl.textContent = location.href;
  qr?.classList.toggle('is-hidden');
  toast('Party <b>QR</b> — others scan to join');
  // broadcast via BroadcastChannel for live sync
  try {
    const bc = new BroadcastChannel('audiovisor-party');
    bc.postMessage({ type: 'party', mode: state.modeId, theme: state.themeId });
  } catch {}
});
const commentInput = document.getElementById('comment-input');
const collabEl = document.getElementById('collab-comments');
function renderComments() {
  if (!collabEl) return;
  const list = readJSON('audiovisor.comments', []);
  collabEl.innerHTML = list.slice(-6).map(c => `<div style="font-size:11px; color:var(--text-60); padding:4px 6px; background:var(--glass); border-radius:6px"><b style="color:var(--accent)">${esc(c.user)}</b> ${esc(c.text)}</div>`).join('') || '<div style="font-size:10px; color:var(--text-20)">No comments yet</div>';
}
document.getElementById('comment-send')?.addEventListener('click', () => {
  const text = commentInput?.value.trim();
  if (!text) return;
  const list = readJSON('audiovisor.comments', []);
  list.push({ user: 'You', text, at: Date.now() });
  writeJSON('audiovisor.comments', list);
  if (commentInput) commentInput.value = '';
  renderComments();
  toast('Comment <b>posted</b>');
  // broadcast
  try { new BroadcastChannel('audiovisor-party').postMessage({ type: 'comment', text }); } catch {}
});
renderComments();
// party sync listener
try {
  const bc = new BroadcastChannel('audiovisor-party');
  bc.onmessage = (e) => {
    if (e.data?.type === 'party') { setMode(e.data.mode); setTheme(e.data.theme); toast('Party <b>sync</b>'); }
    if (e.data?.type === 'comment') {
      const list = readJSON('audiovisor.comments', []);
      list.push({ user: 'Guest', text: e.data.text, at: Date.now() });
      writeJSON('audiovisor.comments', list);
      renderComments();
    }
  };
} catch {}
// handle share hash on load
try {
  const h = location.hash;
  if (h.startsWith('#share=')) {
    const data = JSON.parse(atob(h.slice(7)));
    if (data.mode) setMode(data.mode);
    if (data.theme) setTheme(data.theme);
    if (data.fx) for (const [k,v] of Object.entries(data.fx)) { engine.setFx(k, v); const el=fxEls[k]; if(el) el.classList.toggle('is-active', v); }
    toast('Shared <b>remix</b> loaded');
  }
} catch {}


/* ---------- mode / theme switching ---------- */

function pulseStage() {
  const st = $('stage');
  st.classList.remove('is-look-change');
  void st.offsetWidth;
  st.classList.add('is-look-change');
}

function setMode(id) {
  /* Each mode has its own cost, and the tier adapted for the last one says
     nothing about this one — without this, stepping down for a heavy mode
     left every later mode stuck at that tier. */
  healthyStreak = 0;
  /* The first frames of a new mode include one-time setup — shader paths
     warming, history textures filling — and are not representative. Without
     skipping them, switching to a light mode could step down on the setup
     cost alone before recovering. */
  settleFrames = SETTLE_AFTER_MODE_CHANGE;
  frameTimes.length = 0;
  /* Restart from the tier this device should begin at rather than the
     ceiling. On a phone the ceiling is a guaranteed stutter that adaptive
     stepping then has to undo; the climb takes it back up if there is room. */
  const start = initialTier(state.rayQuality);
  if (ray.ok && ray.quality !== start) ray.setQuality(start);
  state.modeId = id;
  renderer.setMode(id);
  ray.setMode(id);
  [...modeList.children].forEach((c, i) => setToggle(c, MODES[i].id === id, 'is-active'));
  pulseStage();
  saveSettings();
}

/* ---------- Auto theme — palette from album art ---------- */

/* The palette built from the current track's cover (null until one has been
   extracted), plus a cache keyed by artwork URL so revisiting a track in a
   playlist reuses the palette instead of re-reading the image. */
let autoTheme = null;
let currentArtworkUrl = null;
const autoPaletteCache = new Map();

/**
 * Resolve state.themeId to a theme object the renderers accept. 'auto' has
 * no fixed entry in THEMES — it resolves to the last extracted palette, or
 * to brass until a track provides one.
 */
function activeTheme() {
  if (state.themeId === 'auto') return autoTheme || THEMES.find((t) => t.id === 'brass');
  return THEMES.find((t) => t.id === state.themeId);
}

function applyAutoPalette(colors, announce) {
  autoTheme = paletteToTheme(colors);
  if (state.themeId !== 'auto') return;
  renderer.setTheme(autoTheme);
  ray.setTheme(autoTheme);
  applyAccent(autoTheme);
  updateFavicon();
  /* deliberately no updateTrackUI() here: re-rendering the art element would
     reload the same cover, fire onArtworkLoaded again, and re-apply the same
     palette in a loop. The procedural art that updateTrackUI would re-tint
     only exists for local files, which take the name-derived palette below. */
  if (announce) toast('AUTO <b>theme</b> — from the album art');
}

/** Cover art finished loading: read its palette for the Auto theme and the
    transport card's artwork echo. */
function onArtworkLoaded(url, img) {
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, 48, 48);
    const colors = extractPalette(cx.getImageData(0, 0, 48, 48).data);
    if (!colors.length) return;
    autoPaletteCache.set(url, colors);
    applyArtColors(colors);
    if (state.themeId === 'auto') applyAutoPalette(colors, true);
  } catch {
    /* a cross-origin cover without CORS headers taints the canvas and makes
       getImageData throw — the art stays decorative, the theme stays put */
  }
}

/* Artless local files still get per-track personality: the track name hashes
   onto one of the 25 built-in palettes, so a given song always lands on the
   same look without pretending we read colours that were never there. */
function applyNamePalette(name) {
  const base = THEMES[hashStr(name || 'audiovisor') % THEMES.length];
  autoTheme = {
    id: 'auto',
    name: `Auto · ${base.name}`,
    colors: base.colors,
    css: base.css,
  };
  if (state.themeId !== 'auto') return;
  renderer.setTheme(autoTheme);
  ray.setTheme(autoTheme);
  applyAccent(autoTheme);
  updateFavicon();
  toast(`AUTO <b>theme</b> — ${base.name}`);
}

function setTheme(id) {
  state.themeId = id;
  /* switching to Auto with a palette already in hand (art seen earlier this
     session) applies it immediately instead of waiting for the next load */
  if (id === 'auto' && !autoTheme && currentArtworkUrl && autoPaletteCache.has(currentArtworkUrl)) {
    applyAutoPalette(autoPaletteCache.get(currentArtworkUrl), false);
  }
  const theme = activeTheme();
  renderer.setTheme(theme);
  ray.setTheme(theme);
  /* the interface follows the stage: without this, choosing Neon Cyber
     recoloured the visualiser and left every chip, tab and slider brass */
  applyAccent(theme);
  [...themeRow.children].forEach((c) => setToggle(c, c.dataset.theme === id, 'is-active'));
  updateFavicon();
  if (engine.track && !engine.isExternalMode()) {
    if (trackArtEl) trackArtEl._artName = null;
    updateTrackUI();
  }
  pulseStage();
  saveSettings();
}

function randomizeLook() {
  setMode(pickRandom(MODES).id);
  setTheme(pickRandom(THEMES).id);
}

/* ---------- autopilot ---------- */

function setAutopilot(on, opts = {}) {
  state.autopilot = on;
  setToggle($('autopilot-chip'), on, 'is-active');
  setToggle($('shuffle-btn'), on);
  if (on) {
    state.autopilotTimer = setInterval(randomizeLook, 12000);
    randomizeLook();
    if (!opts.silent) toast('AUTOPILOT <b>ON</b> — cycling modes &amp; themes', { duration: 1800 });
  } else if (state.autopilotTimer) {
    clearInterval(state.autopilotTimer);
    state.autopilotTimer = null;
    if (!opts.silent) toast('AUTOPILOT <b>OFF</b>', { duration: 1400 });
  }
  saveSettings();
}
$('autopilot-chip').addEventListener('click', () => setAutopilot(!state.autopilot));
$('shuffle-btn').addEventListener('click', () => setAutopilot(!state.autopilot));

/* ---------- persistence ---------- */

let _saveTimer = null;
/** Debounced: dragging a slider fires input on every pixel. */
function saveSettings() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveSettingsNow, 250);
}
// never let the debounce swallow the last change on the way out
window.addEventListener('pagehide', () => { clearTimeout(_saveTimer); saveSettingsNow(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(_saveTimer); saveSettingsNow(); }
});

function saveSettingsNow() {
  try {
    writeJSON(SETTINGS_KEY, currentSettings());
  } catch {}
}

/** The ids this build accepts; anything else in stored/imported JSON is dropped. */
const SETTINGS_VOCAB = {
  modeIds: MODES.map((m) => m.id),
  themeIds: ['auto', ...THEMES.map((t) => t.id)],
  sliderIds: SLIDERS.map((c) => c.id),
  fxNames: FX,
  rayQualities: RAY_QUALITIES,
  eqBands: EQ_FREQS.length,
};

/**
 * Apply an already-validated settings object. Shared by localStorage
 * restore and JSON import so both paths obey the same rules — import used
 * to skip validation entirely and could set a mode id that does not exist.
 */
function applySettings(s, { eq = false } = {}) {
  if (typeof s.raytrace === 'boolean') setRaytrace(s.raytrace, { quiet: true });   // stored intent, not availability
  if (s.rayQuality) setRayQuality(s.rayQuality, { quiet: true });
  if (s.mode) setMode(s.mode);
  if (s.theme) setTheme(s.theme);
  for (const [key, val] of Object.entries(s.sliders || {})) {
    const input = sliderEls[key];
    if (!input) continue;
    input.value = val;
    const cfg = SLIDERS.find((c) => c.id === key);
    const group = input.closest('.slider-group');
    const label = group?.querySelector('.slider-value');
    if (label) label.textContent = cfg.fmt(parseFloat(input.value));
    applySlider(key, parseFloat(input.value));
  }
  for (const [name, on] of Object.entries(s.fx || {})) {
    if (!fxEls[name]) continue;
    setToggle(fxEls[name], on, 'is-active');
    engine.setFx(name, on);
    state.fx[name] = on;
  }
  if (eq) {
    (s.eq || []).forEach((v, i) => {
      const input = document.querySelectorAll('.eq-row')[i]?.querySelector('input');
      if (input) { input.value = v; input.dispatchEvent(new Event('input')); }
    });
  }
  if (typeof s.volume === 'number') {
    engine.setVolume(s.volume);
    $('volume-fill').style.width = `${s.volume * 100}%`;
  }
  if (s.loop) {
    engine.loop = true;
    setToggle($('loop-btn'), true);
  }
  if (s.autopilot) setAutopilot(true, { silent: true });
  if (s.autoDj) { autoDj = true; setToggle(document.getElementById('autodj-chip'), true, 'is-active'); }
}

function loadSettings() {
  try {
    applySettings(readSettings(localStorage, SETTINGS_VOCAB));
  } catch (err) {
    console.warn('settings restore failed:', err);
  }
}

/* ---------- queue manager ---------- */

const queuePanel = document.createElement('div');
queuePanel.className = 'queue-panel is-hidden';
$('shell').appendChild(queuePanel);

const libraryPanel = document.createElement('div');
libraryPanel.className = 'library-panel is-hidden';
libraryPanel.setAttribute('role', 'dialog');
libraryPanel.setAttribute('aria-label', 'Library');
$('shell').appendChild(libraryPanel);

function renderQueue() {
  const q = engine.queue;
  let html = `
    <div class="queue-head">
      <span class="ic ic-lime" data-icon="list"></span>
      <span class="mono queue-title">QUEUE · ${q.length}</span>
      <button class="icon-x" id="queue-shuffle-btn" title="Shuffle queue"><span class="ic ic-sm" data-icon="shuffle"></span></button>
      <button class="icon-x" id="queue-close-btn" title="Close"><span class="ic ic-sm" data-icon="close"></span></button>
    </div>`;
  if (!q.length) {
    html += `<div class="queue-empty mono">DROP AUDIO FILES TO BUILD A QUEUE</div>`;
  } else {
    html += `<div class="queue-list">` + q.map((t, i) => `
      <div class="queue-row${i === engine.queueIndex ? ' is-active' : ''}" data-i="${i}">
        <span class="mono queue-idx">${i === engine.queueIndex ? '▶' : String(i + 1).padStart(2, '0')}</span>
        <span class="queue-name">${esc(t.meta.name)}</span>
        <span class="mono queue-dur">${fmtTime(t.meta.duration)}</span>
        <button class="icon-x queue-remove" data-i="${i}" title="Remove"><span class="ic ic-sm" data-icon="close"></span></button>
      </div>`).join('') + `</div>`;
  }
  queuePanel.innerHTML = html;
  queuePanel.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

  queuePanel.querySelectorAll('.queue-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.queue-remove')) return;
      if (engine.captureActive || engine.micActive || engine.mode !== 'file') return;
      engine.playTrack(Number(row.dataset.i));
      renderQueue();
    });
  });
  queuePanel.querySelectorAll('.queue-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.i);
      engine.removeFromQueue(i);
      renderQueue();
    });
  });
  queuePanel.querySelector('#queue-shuffle-btn')?.addEventListener('click', () => {
    engine.shuffleQueue();
    renderQueue();
    toast('QUEUE <b>SHUFFLED</b>', { duration: 1200 });
  });
  queuePanel.querySelector('#queue-close-btn')?.addEventListener('click', () => toggleQueue(false));
}

function toggleQueue(force) {
  const show = force ?? queuePanel.classList.contains('is-hidden');
  queuePanel.classList.toggle('is-hidden', !show);
  setToggle($('queue-btn'), show);
  if (show) renderQueue();
}

$('queue-btn').addEventListener('click', () => toggleQueue());
$('save-library-btn')?.addEventListener('click', saveToLibrary);

async function renderLibrary() {
  let meta = await Library.listLibraryMeta();
  let html = `<div class="library-head"><span class="ic ic-lime" data-icon="layers"></span><span class="mono library-title">LIBRARY · ${meta.length}</span><button class="icon-x" id="lib-close" title="Close"><span class="ic ic-sm" data-icon="close"></span></button></div>
  <div style="padding:8px 12px; border-bottom:1px solid var(--border-soft)"><input id="lib-search" class="connect-input" placeholder="Search library…" style="width:100%; padding:7px 10px; font-size:11px"/></div>`;
  if (!meta.length) {
    html += `<div class="library-empty mono">NO SAVED TRACKS — PLAY A TRACK THEN HIT SAVE</div>`;
  } else {
    html += `<div class="library-list">` + meta.map(m => `
      <div class="library-row ${m.edits ? 'is-remix' : ''}" data-id="${m.id}">
        <div style="flex:1; min-width:0">
          <div class="library-name">${esc(m.name)} ${m.edits ? '<span style="font-size:9px; color:var(--accent); margin-left:6px">REMIX</span>' : ''}</div>
          <div class="mono library-meta">${esc(m.ext)} · ${(m.duration||0).toFixed(1)}s${m.edits ? ' · ' + Object.keys(m.edits).filter(k=>m.edits[k]).join(', ') : ''}</div>
        </div>
        <div class="library-actions">
          <button class="ghost-btn lib-play" data-id="${m.id}" title="Play"><span class="ic ic-sm" data-icon="play"></span></button>
          <button class="ghost-btn lib-export" data-id="${m.id}" title="Export WAV"><span class="ic ic-sm" data-icon="link"></span></button>
          <button class="icon-x lib-del" data-id="${m.id}" title="Delete"><span class="ic ic-sm" data-icon="close"></span></button>
        </div>
      </div>`).join('') + `</div>`;
  }
  // filter by search
  const q = (document.getElementById('lib-search')?.value || '').toLowerCase();
  // eslint-disable-next-line no-useless-assignment
  if (q) meta = meta.filter(m => m.name.toLowerCase().includes(q) || (m.ext||'').toLowerCase().includes(q));
  libraryPanel.innerHTML = html;
  libraryPanel.querySelectorAll('[data-icon]').forEach(el => setIcon(el, el.dataset.icon));
  // re-attach search listener
  const sInput = libraryPanel.querySelector('#lib-search');
  if (sInput) {
    sInput.value = q;
    sInput.addEventListener('input', () => renderLibrary());
    // focus and keep cursor at end
    sInput.focus();
    sInput.setSelectionRange(sInput.value.length, sInput.value.length);
  }
  libraryPanel.querySelector('#lib-close')?.addEventListener('click', () => toggleLibrary(false));
  libraryPanel.querySelectorAll('.lib-play').forEach(b => b.addEventListener('click', async () => {
    const rec = await Library.getLibraryEntry(b.dataset.id);
    if (!rec) return;
    if (engine.captureActive) await engine.toggleCapture();
    if (engine.micActive) await engine.toggleMic();
    if (engine.isExternal()) engine.pause();
    engine.stopStream();
    // reconstruct file-like for engine
    const blob = new Blob([rec.arrayBuffer]);
    const file = new File([blob], rec.name + '.' + rec.ext.toLowerCase());
    // add to queue and play, then apply edits if any
    await engine.addToQueue([file]);
    if (rec.edits) {
      for (const [k,v] of Object.entries(rec.edits)) if (v) engine.setFx(k, true);
    }
    toggleLibrary(false);
    toast(`Loaded <b>${esc(rec.name)}</b> from library`);
  }));
  libraryPanel.querySelectorAll('.lib-export').forEach(b => b.addEventListener('click', async () => {
    const rec = await Library.getLibraryEntry(b.dataset.id);
    if (!rec || !rec.arrayBuffer) return;
    toast('Rendering <b>remix</b>…', { duration: 1600 });
    try {
      const buf = await engine.ctx.decodeAudioData(rec.arrayBuffer.slice(0));
      const blob = await Library.renderRemixToWav(buf, rec.edits || engine.fx);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${rec.name}-remix.wav`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      toast('Remix <b>exported</b> as WAV', { duration: 2200 });
    } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
  }));
  libraryPanel.querySelectorAll('.lib-del').forEach(b => b.addEventListener('click', async () => {
    await Library.removeFromLibrary(b.dataset.id);
    renderLibrary();
  }));
}
function toggleLibrary(force) {
  const show = force ?? libraryPanel.classList.contains('is-hidden');
  libraryPanel.classList.toggle('is-hidden', !show);
  setToggle($('library-btn'), show);
  if (show) renderLibrary();
  if (show) { queuePanel.classList.add('is-hidden'); setToggle($('queue-btn'), false); }
}
$('library-btn').addEventListener('click', () => toggleLibrary());
// add to library from current track
async function saveToLibrary() {
  if (!engine.buffer || !engine.track) { toast('<b>No track</b> to save', { duration: 1600 }); return; }
  // need raw ArrayBuffer: encode current buffer to wav then back? For now, try to get from queue item's original? We stored buffer, but need ArrayBuffer
  // Fallback: render current buffer to wav and store that
  try {
    const ch = engine.buffer.numberOfChannels;
    const len = engine.buffer.length;
    const tmp = new OfflineAudioContext(ch, len, engine.buffer.sampleRate);
    const src = tmp.createBufferSource(); src.buffer = engine.buffer; src.connect(tmp.destination); src.start(0);
    const rendered = await tmp.startRendering();
    // encode rendered to ArrayBuffer via wav blob then arrayBuffer
    const blob = await Library.renderRemixToWav(rendered, {});
    const ab = await blob.arrayBuffer();
    const edits = { ...engine.fx };
    const rec = await Library.addToLibrary({
      name: engine.track.name + (Object.values(edits).some(Boolean) ? ' (remix)' : ''),
      ext: 'WAV',
      sampleRate: engine.buffer.sampleRate,
      channels: ch,
      duration: engine.buffer.duration,
      arrayBuffer: ab,
      edits,
      sourceName: engine.track.name,
    });
    toast(`Saved <b>${esc(rec.name)}</b> to library`, { duration: 2000 });
  } catch (e) { console.error(e); toast('<b>Save failed</b>', { duration: 2000 }); }
}

/* ---------- track display ---------- */

const trackArtEl = $('track-art');
const trackInfoEl = $('track-info');

/* The transport card echoes the cover: its two lead colours become a wash
   behind the card and a coloured shadow on the art. Runs for every real
   artwork, independent of the Auto theme. */
function applyArtColors(colors) {
  if (!trackInfoEl) return;
  trackInfoEl.classList.add('has-art');
  trackInfoEl.style.setProperty('--art-c1', colors[0] || 'var(--accent)');
  trackInfoEl.style.setProperty('--art-c2', colors[1] || colors[0] || 'var(--accent)');
}

function updateTrackUI() {
  const input = engine.activeInput;

  if ((input === 'spotify' || input === 'apple') && connect?.currentTrack) {
    const t = connect.currentTrack;
    $('track-name').textContent = t.name;
    $('track-spec').textContent = `${t.artists} · ${t.kind}`;
    $('time-total').textContent = fmtTime(t.duration);
    const icon = t.provider === 'apple' ? 'music2' : 'spotify';
    trackArtEl.innerHTML = t.artwork
      ? `<img class="track-art-img" src="${t.artwork}" alt="" />`
      : `<span class="ic" data-icon="${icon}"></span>`;
    if (!t.artwork) {
      setIcon(trackArtEl.querySelector('.ic'), icon);
      trackInfoEl.classList.remove('has-art');
    }
    /* the cover doubles as palette source for the Auto theme */
    currentArtworkUrl = t.artwork || null;
    const artImg = t.artwork && trackArtEl.querySelector('img');
    if (artImg) {
      artImg.crossOrigin = 'anonymous';
      artImg.addEventListener('load', () => onArtworkLoaded(t.artwork, artImg), { once: true });
    }
  } else if (input === 'stream' && engine.streamTrack) {
    $('track-name').textContent = engine.streamTrack.name;
    $('track-spec').textContent = `LIVE STREAM · ${engine.streamTrack.ext}`;
    $('time-total').textContent = fmtTime(engine.getDuration());
    trackArtEl.innerHTML = '<span class="ic" data-icon="link"></span>';
    setIcon(trackArtEl.querySelector('.ic'), 'link');
    currentArtworkUrl = null;
    trackInfoEl.classList.remove('has-art');
  } else if (engine.track) {
    const t = engine.track;
    const idx = engine.queue.length > 1 ? ` · ${engine.queueIndex + 1}/${engine.queue.length}` : '';
    $('track-name').textContent = t.name + idx;
    $('track-spec').textContent = `${(t.sampleRate / 1000).toFixed(1)}kHz / ${t.channels === 1 ? 'MONO' : 'STEREO'} · ${t.ext}`;
    $('time-total').textContent = fmtTime(t.duration);
    drawWaveform(engine.buffer);
    currentArtworkUrl = null;
    trackInfoEl.classList.remove('has-art');
    // procedural album art
    if (trackArtEl && (!trackArtEl._artName || trackArtEl._artName !== t.name)) {
      trackArtEl._artName = t.name;
      const art = generateAlbumArt(t.name, activeTheme()?.colors || ['#d9b089','#c49a6e','#f5e6d3'], 96);
      trackArtEl.innerHTML = '';
      trackArtEl.appendChild(art);
      trackArtEl.querySelector('canvas')?.classList.add('track-art-img');
      /* no cover to read, so Auto derives this track's look from its name */
      if (state.themeId === 'auto') applyNamePalette(t.name);
    }
  }
  updateMediaSession();
}

/* ---------- play state sync ---------- */

let wakeLock = null;
async function syncWakeLock(playing) {
  try {
    if (playing && navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!playing && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
function refreshStatus() {
  const playing = engine.playing;
  syncWakeLock(playing);
  const icon = playing ? 'pause' : 'play';
  setIcon($('play-pause-icon'), icon);

  $('track-info').classList.toggle('is-playing', playing);
  setToggle($('capture-btn'), engine.captureActive);
  setToggle($('mic-btn'), engine.micActive);

  let text = 'Engine: Idle';
  switch (engine.activeInput) {
    case 'mic': text = playing || engine.micActive ? 'Engine: Live · MIC' : 'Engine: MIC'; break;
    case 'capture': text = 'Engine: Live · CAPTURE'; break;
    case 'spotify': text = playing ? 'SPOTIFY · Live' : 'SPOTIFY · Paused'; break;
    case 'apple': text = playing ? 'APPLE MUSIC · Live' : 'APPLE MUSIC · Paused'; break;
    case 'stream': text = playing ? 'STREAM · Live' : 'STREAM · Paused'; break;
    case 'track': text = playing ? 'Engine: Live' : 'Engine: Paused'; break;
  }
  $('status-text').textContent = text;
  refreshStatusDot();
  syncDropzone();
}

function refreshStatusDot() {
  const dot = document.querySelector('#status-pill .status-dot');
  const live = engine.playing || engine.micActive || engine.captureActive;
  dot.classList.toggle('is-live', live);
}

function syncDropzone() {
  dropzone.classList.toggle('is-hidden', engine.activeInput !== 'none');
}

engine.on('state', refreshStatus);
engine.on('source', () => {
  refreshStatus();
  updateTrackUI();
});
engine.onQueueChange = () => {
  updateTrackUI();
  if (!queuePanel.classList.contains('is-hidden')) renderQueue();
};

/* ---------- music account connect panel ---------- */

/* ConnectPanel pulls in the Spotify and Apple Music SDK clients, which a
   guest playing local files never touches. Load it on demand: when the user
   opens the Source tab, or immediately if we are returning from a provider
   OAuth redirect and there is a code to exchange. */
let connect = null;
let _connectLoad = null;
function connectPending() {
  const q = new URLSearchParams(window.location.search);
  return q.has('code') || q.has('error');
}
function ensureConnect() {
  if (_connectLoad) return _connectLoad;
  _connectLoad = import('./connect.js')
    .then(({ ConnectPanel }) => {
      connect = new ConnectPanel($('connect-root'), {
        engine,
        toast,
        onExternalTrack: async () => { updateTrackUI(); },
      });
      return connect.boot().then(() => connect);
    })
    .catch((err) => {
      console.error('connect panel failed to load:', err);
      /* Only re-arm the retry if no panel was ever built. Clearing this
         unconditionally meant a failure *after* construction let a second
         ConnectPanel be created over the same root — two sets of engine
         subscribers, every toast fired twice. */
      if (!connect) _connectLoad = null;
      toast('<b>Music accounts unavailable</b> — could not load the panel', { duration: 3600 });
      return null;
    });
  return _connectLoad;
}
// an OAuth redirect carries a code that expires; exchange it without waiting
// for the user to find the Source tab
if (connectPending()) ensureConnect();

/* ---------- capture (topbar shortcut) ---------- */

$('capture-btn').addEventListener('click', async () => {
  try {
    const on = await engine.toggleCapture();
    toast(on
      ? 'CAPTURE <b>LIVE</b> — visualizing shared audio'
      : 'Capture <b>OFF</b>', { duration: 2000 });
  } catch (err) {
    console.error(err);
    toast(`<b>Capture blocked</b> — ${err.message || 'permission denied'}`, { duration: 3600 });
  }
});

/* ---------- autoplay policy safety net ---------- */

let _armedForGesture = false;
/**
 * Browsers only let an AudioContext run off a user gesture. If the gesture
 * that loaded the file doesn't carry (Safari is strict about this, and a
 * file-picker selection isn't always enough), the engine reports playing
 * while nothing is audible. Detect that and resume on the next interaction
 * instead of leaving the user with a silent stage.
 */
function ensureAudible() {
  const ctx = engine.ctx;
  if (!ctx || ctx.state !== 'suspended' || _armedForGesture) return;
  _armedForGesture = true;
  toast('Tap anywhere to <b>start audio</b>', { duration: 5000 });
  const kick = () => {
    ctx.resume().then(() => {
      _armedForGesture = false;
      if (!engine.playing) engine.play();
      refreshStatus();
    }).catch(() => {});
    window.removeEventListener('pointerdown', kick, true);
    window.removeEventListener('keydown', kick, true);
  };
  window.addEventListener('pointerdown', kick, true);
  window.addEventListener('keydown', kick, true);
}

/* ---------- overflow menu ---------- */

const moreMenu = $('more-menu');
const moreBtn = $('more-btn');
function closeMore() {
  moreMenu?.classList.add('is-hidden');
  moreBtn?.setAttribute('aria-expanded', 'false');
}
function toggleMore() {
  const open = moreMenu?.classList.toggle('is-hidden') === false;
  moreBtn?.setAttribute('aria-expanded', String(open));
}
moreBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
document.addEventListener('click', (e) => {
  if (!moreMenu || moreMenu.classList.contains('is-hidden')) return;
  if (e.target.closest('#more-menu') || e.target.closest('#more-btn')) return;
  closeMore();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
// every tool in the menu closes it after firing
moreMenu?.querySelectorAll('.more-item').forEach((el) => {
  if (el.id !== 'add-more-btn') el.addEventListener('click', () => setTimeout(closeMore, 0));
});

/* ---------- file loading ---------- */

const fileInput = $('file-input');
const dropzone = $('dropzone');

async function loadFiles(files) {
  if (!files || !files.length) return;
  const audioFiles = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i.test(f.name));
  if (!audioFiles.length) {
    toast('<b>Unsupported</b> — drop an audio file');
    return;
  }
  if (engine.captureActive) await engine.toggleCapture();
  if (engine.isExternal()) engine.pause();
  engine.stopStream();
  $('status-text').textContent = 'Engine: Decoding';
  try {
    const errors = await engine.addToQueue(audioFiles);
    if (!engine.hasTrack) {
      toast('<b>Decode failed</b> — no playable files', { duration: 3000 });
      return;
    }
    dropzone.classList.add('is-hidden');
    // never let a UI hiccup abort the load: the audio decoded fine by here
    try { updateTrackUI(); } catch (err) { console.error('track UI failed', err); }
    engine.play();
    ensureAudible();
    const loaded = audioFiles.length - errors.length;
    if (engine.evicted) {
      toast(`<b>${engine.evicted}</b> track${engine.evicted > 1 ? 's' : ''} unloaded to save memory — they reload on play`, { duration: 3200 });
    }
    toast(errors.length
      ? `Loaded <b>${loaded}</b> · skipped <b>${errors.length}</b> corrupt`
      : (loaded > 1 ? `Loaded <b>${loaded} tracks</b> — queue playing` : `Loaded <b>${engine.track.name}</b>`));
  } catch (err) {
    console.error(err);
    $('status-text').textContent = 'Engine: Decode Failed';
    toast('<b>Decode failed</b> — file may be corrupted', { duration: 3000 });
  }
}

fileInput.addEventListener('change', () => {
  loadFiles(fileInput.files);
  fileInput.value = '';
});

/* One entry point for the picker.
 *
 * The Add control and the Browse button in the drop card are <label for>
 * elements, so the browser opens the picker natively with no JS involved —
 * that path can't be defeated by user-activation rules. This function is the
 * programmatic fallback for the stage shortcut, the command palette and the
 * transport play button. showPicker() is preferred where available because
 * .click() on a file input is unreliable in some browsers. */
function openFilePicker() {
  try {
    if (typeof fileInput.showPicker === 'function') { fileInput.showPicker(); return; }
  } catch { /* NotAllowedError outside a user gesture — fall through */ }
  try {
    fileInput.click();
  } catch {
    toast('Could not open the file picker — use <b>Browse files</b> on the stage', { duration: 4000 });
  }
}
// labels open the picker themselves; these keep keyboard users working
$('add-btn')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
});
$('browse-label')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
});
$('add-more-btn')?.addEventListener('click', () => { closeMore(); openFilePicker(); });
$('stage').addEventListener('click', (e) => {
  // clicking the empty stage is a shortcut for "add files"; once a track is
  // loaded the stage belongs to the visuals
  if (dropzone.classList.contains('is-hidden')) return;
  // the drop card carries its own <label for>, so don't double-fire on it
  if (e.target.closest('button, label')) return;
  openFilePicker();
});

['dragenter', 'dragover'].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.querySelector('.dropzone').classList.add('drag-over');
  })
);
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropzone.querySelector('.dropzone').classList.remove('drag-over');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.querySelector('.dropzone').classList.remove('drag-over');
  loadFiles(e.dataTransfer.files);
});

/* ---------- media session ---------- */

async function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    const input = engine.activeInput;
    if ((input === 'spotify' || input === 'apple') && connect?.currentTrack) {
      const t = connect.currentTrack;
      const artwork = t.artwork ? [{ src: t.artwork, sizes: '640x640', type: 'image/jpeg' }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name,
        artist: t.artists,
        album: `${t.album} · AUDIOVISOR`,
        artwork,
      });
    } else if (input === 'stream' && engine.streamTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: engine.streamTrack.name,
        artist: 'LIVE STREAM',
        album: 'AUDIOVISOR',
      });
    } else if (engine.track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: engine.track.name,
        artist: 'AUDIOVISOR',
        album: 'Local File',
      });
    }
  } catch {}
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const actions = {
    play: () => engine.play(),
    pause: () => engine.pause(),
    seekbackward: (d) => engine.skip(-(d.seekOffset || 10)),
    seekforward: (d) => engine.skip(d.seekOffset || 10),
    previoustrack: () => engine.prevTrack(),
    nexttrack: () => engine.nextTrack(),
    seekto: (d) => { if (d.seekTime != null) engine.seek(d.seekTime); },
  };
  for (const [name, fn] of Object.entries(actions)) {
    try { ms.setActionHandler(name, fn); } catch {}
  }
}

/* ---------- transport ---------- */

const playPauseBtn = $('play-pause-btn');


function transportToggle() {
  if (engine.activeInput === 'none') {
    openFilePicker();
    return;
  }
  engine.toggle();
}

playPauseBtn.addEventListener('click', transportToggle);

$('prev-btn').addEventListener('click', () => engine.prevTrack());
$('next-btn').addEventListener('click', () => engine.nextTrack());
$('loop-btn').addEventListener('click', () => {
  engine.loop = !engine.loop;
  setToggle($('loop-btn'), engine.loop);
  saveSettings();
  toast(engine.loop ? 'LOOP <b>ON</b>' : 'LOOP <b>OFF</b>', { duration: 1200 });
});

const seekTrack = $('seek-track');
bindDragTrack(seekTrack, (ratio) => {
  const d = engine.getDuration();
  if (d > 0) engine.seek(ratio * d);
});
// arrow keys on a focused seek bar, for keyboard and switch-control users
seekTrack.addEventListener('keydown', (e) => {
  const d = engine.getDuration();
  if (d <= 0) return;
  const next = keyStep(e.key, engine.getTime() / d, 0.02);
  if (next === null) return;
  e.preventDefault();
  engine.seek(next * d);
});

const volumeTrack = $('volume-track');
function setVolumeUI(v) {
  v = Math.max(0, Math.min(1, v));
  engine.setVolume(v);
  $('volume-fill').style.width = `${v * 100}%`;
  volumeTrack?.setAttribute('aria-valuenow', String(Math.round(v * 100)));
}
bindDragTrack(volumeTrack, (ratio, phase) => {
  setVolumeUI(ratio);
  if (phase === 'end') saveSettings();
});
volumeTrack?.addEventListener('keydown', (e) => {
  const next = keyStep(e.key, engine.volume);
  if (next === null) return;
  e.preventDefault();
  setVolumeUI(next);
  saveSettings();
});
$('stage').addEventListener('wheel', (e) => {
  e.preventDefault();
  setVolumeUI(engine.volume - Math.sign(e.deltaY) * 0.05);
  saveSettings();
}, { passive: false });

$('fullscreen-btn').addEventListener('click', () => {
  const shell = $('shell');
  if (document.fullscreenElement) document.exitFullscreen();
  else shell.requestFullscreen?.();
});
document.addEventListener('fullscreenchange', () => {
  const shell = $('shell');
  const isFs = !!document.fullscreenElement;
  shell.classList.toggle('is-cinema', isFs);
  if (isFs) {
    // auto-hide chrome after 2.2s
    let hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
    const show = () => {
      shell.classList.remove('is-chrome-hidden');
      clearTimeout(hid);
      hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
    };
    const onMove = () => show();
    /* pointermove covers the mouse; a touch device never emits it while the
       finger is off the glass, so without pointerdown the chrome hid after
       2.2s in fullscreen and there was no way to bring it back. */
    shell.addEventListener('pointermove', onMove);
    shell.addEventListener('pointerdown', onMove);
    const clr = () => {
      shell.removeEventListener('pointermove', onMove);
      shell.removeEventListener('pointerdown', onMove);
      document.removeEventListener('fullscreenchange', clr);
      clearTimeout(hid);
    };
    // cleanup when exiting handled by next fullscreenchange
    shell._cinemaCleanup = clr;
  } else {
    shell.classList.remove('is-cinema', 'is-chrome-hidden');
    if (shell._cinemaCleanup) { try { shell._cinemaCleanup(); } catch {} shell._cinemaCleanup = null; }
  }
});
/* Double-tap the stage for cinema mode. dblclick is unreliable on touch —
   Safari withholds it, and elsewhere it arrives after a 300ms delay — so
   taps are paired here. A second tap only counts if it lands near the first,
   which keeps a quick tap on two different controls from triggering it. */
$('stage').addEventListener('dblclick', () => $('fullscreen-btn').click());
const stageDoubleTap = makeDoubleTap();
$('stage').addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;   // dblclick already covers the mouse
  if (stageDoubleTap(e.clientX, e.clientY, e.timeStamp)) $('fullscreen-btn').click();
});

/* ---------- snapshot & session recorder ---------- */

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function liveCanvas() {
  return state.raytraceWanted && ray.ok && !raySuspended ? ray.canvas : renderer.canvas;
}

/* ---------- share card ---------- */

/* The snapshot used to be the raw stage canvas — a frame of pixels with no
   context, which never made it past a group chat. This composites it into a
   1200x675 card in the language of the og image: the stage cover-fit behind
   scrims, the equalizer mark, the wordmark, the track, and the look's mode
   + theme chips. */
const CARD_W = 1200;
const CARD_H = 675;

function cardRoundRect(x, cx, cy, w, h, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  else x.rect(cx - w / 2, cy - h / 2, w, h);
}

async function renderShareCard() {
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const x = cv.getContext('2d');
  const accent = activeTheme()?.colors[0] || '#d9b089';

  /* stage frame, cover-fit */
  const src = liveCanvas();
  if (src.width > 0 && src.height > 0) {
    const sR = src.width / src.height;
    const tR = CARD_W / CARD_H;
    let sw = src.width;
    let sh = src.height;
    if (sR > tR) sw = src.height * tR;
    else sh = src.width / tR;
    x.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, CARD_W, CARD_H);
  } else {
    x.fillStyle = '#14110f';
    x.fillRect(0, 0, CARD_W, CARD_H);
  }

  /* scrims so the lockup always reads */
  const sb = x.createLinearGradient(0, CARD_H * 0.5, 0, CARD_H);
  sb.addColorStop(0, 'rgba(0,0,0,0)');
  sb.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  sb.addColorStop(1, 'rgba(0,0,0,0.72)');
  x.fillStyle = sb;
  x.fillRect(0, 0, CARD_W, CARD_H);
  const sl = x.createLinearGradient(0, 0, CARD_W * 0.58, 0);
  sl.addColorStop(0, 'rgba(0,0,0,0.50)');
  sl.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sl;
  x.fillRect(0, 0, CARD_W, CARD_H);

  const left = 56;
  const bottom = 54;
  const wmSize = 62;

  /* equalizer mark — same proportions as the icons (see scripts/make-icons) */
  const mSize = 74;
  const mX = left + mSize / 2;
  const mY = CARD_H - bottom - mSize / 2 - 118;
  x.fillStyle = 'rgba(10,10,10,0.55)';
  cardRoundRect(x, mX, mY, mSize, mSize, 17);
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.16)';
  x.lineWidth = 1;
  x.stroke();
  x.beginPath();
  x.arc(mX, mY, mSize * 0.306, 0, Math.PI * 2);
  x.strokeStyle = 'rgba(255,255,255,0.30)';
  x.lineWidth = Math.max(1, mSize * 0.042);
  x.stroke();
  const half = mSize * 0.14375;
  x.save();
  x.translate(mX, mY);
  x.rotate(Math.PI / 4);
  x.fillStyle = accent;
  x.fillRect(-half, -half, half * 2, half * 2);
  x.restore();
  x.fillStyle = '#0b0b0b';
  const bw = mSize * 0.0469;
  const bars = [[-0.0844, 0.08125], [0, 0.1375], [0.0844, 0.10625]];
  for (const [bx, bh] of bars) {
    cardRoundRect(x, mX + bx * mSize, mY, bw, bh * 2 * mSize, bw / 2);
    x.fill();
  }

  /* wordmark + tagline */
  const wmX = left + mSize + 22;
  x.fillStyle = '#ffffff';
  x.font = `700 ${wmSize}px "Space Grotesk", system-ui, sans-serif`;
  x.textBaseline = 'alphabetic';
  x.fillText('AUDIOVISOR', wmX, mY + 14);
  x.font = '500 15px "JetBrains Mono", ui-monospace, monospace';
  x.letterSpacing = '0.3em';
  x.fillStyle = accent;
  x.fillText('REAL-TIME AUDIO VISUALIZER', wmX, mY + 46);
  x.letterSpacing = '0em';

  /* now playing */
  const trackNameEl = $('track-name');
  const trackName = trackNameEl?.textContent;
  if (trackName && !trackName.includes('Waiting for input')) {
    x.fillStyle = 'rgba(255,255,255,0.78)';
    x.font = '600 24px "Space Grotesk", system-ui, sans-serif';
    const label = trackName.length > 52 ? `${trackName.slice(0, 51)}…` : trackName;
    x.fillText(label, wmX, mY + 92);
  }

  /* chips */
  const chipY = CARD_H - bottom - 30;
  const chips = [
    { t: modeName(), fill: accent },
    { t: activeTheme()?.name || 'Theme', fill: '#ffffff' },
  ];
  let cx0 = wmX;
  x.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
  for (const chip of chips) {
    const tw = x.measureText(chip.t.toUpperCase()).width;
    const pw = tw + 28;
    x.beginPath();
    if (x.roundRect) x.roundRect(cx0, chipY - 15, pw, 30, 15);
    else x.rect(cx0, chipY - 15, pw, 30);
    x.fillStyle = 'rgba(8,8,8,0.5)';
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.17)';
    x.lineWidth = 1;
    x.stroke();
    x.fillStyle = chip.fill;
    x.textBaseline = 'middle';
    x.fillText(chip.t.toUpperCase(), cx0 + 14, chipY + 1);
    cx0 += pw + 10;
  }

  /* wordmark baseline sits above the mark box; chips under the mark */
  x.textBaseline = 'alphabetic';
  return cv;
}

function modeName() {
  return MODES.find((m) => m.id === state.modeId)?.name || 'Stage';
}

function snapshot() {
  (async () => {
    try { await document.fonts?.ready; } catch { /* jsdom / no FontFaceSet */ }
    try {
      const card = await renderShareCard();
      card.toBlob((blob) => {
        if (!blob) return;
        downloadBlob(blob, `audiovisor-${fmtStamp()}.png`);
        toast('SHARE <b>CARD</b> saved', { duration: 1400 });
      }, 'image/png');
    } catch (err) {
      console.error(err);
      toast('<b>Snapshot failed</b>', { duration: 2000 });
    }
  })();
}

$('snapshot-btn').addEventListener('click', snapshot);
$('export-remix-btn')?.addEventListener('click', async () => {
  if (!engine.buffer) { toast('<b>No track</b> to export', { duration: 1600 }); return; }
  toast('Rendering <b>remix</b>…', { duration: 1600 });
  try {
    const blob = await Library.renderRemixToWav(engine.buffer, engine.fx);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${engine.track?.name || 'remix'}-remix.wav`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    toast('Remix <b>exported</b>', { duration: 2000 });
  } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
});

let recorder = null;
let recChunks = [];

function setRecBtn(on) {
  $('record-btn').classList.toggle('is-rec', on);
}

function startRecording() {
  if (!('MediaRecorder' in window) || !liveCanvas().captureStream) {
    toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
    return;
  }
  try {
    const stream = liveCanvas().captureStream(60);
    try {
      const audio = engine.getRecordStream();
      if (audio) audio.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {}
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recChunks = [];
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.start(1000);
    setRecBtn(true);
    toast('RECORDING <b>LIVE</b> — press again to save', { duration: 2200 });
  } catch (err) {
    console.error(err);
    recorder = null;
    toast('<b>Recording failed to start</b>', { duration: 2600 });
  }
}

function stopRecording() {
  const r = recorder;
  if (!r) return;
  recorder = null;
  setRecBtn(false);
  r.onstop = () => {
    const blob = new Blob(recChunks, { type: r.mimeType || 'video/webm' });
    recChunks = [];
    if (!blob.size) return;
    downloadBlob(blob, `audiovisor-session-${fmtStamp()}.webm`);
    toast('SESSION <b>SAVED</b> — WebM downloaded', { duration: 2800 });
  };
  if (r.state !== 'inactive') r.stop();
  else r.onstop();
}

$('record-btn').addEventListener('click', () => {
  if (recorder) stopRecording();
  else startRecording();
});

/* ---------- mic ---------- */

$('mic-btn').addEventListener('click', async () => {
  try {
    const on = await engine.toggleMic();
    setToggle($('mic-btn'), on);
    refreshStatus();
    toast(on ? 'MIC <b>LIVE</b> — engine listening' : 'MIC <b>OFF</b>', { duration: 1600 });
  } catch (err) {
    console.error(err);
    toast('<b>Mic blocked</b> — allow microphone access', { duration: 3000 });
  }
});

/* ---------- nav ---------- */

const aboutPanel = document.createElement('div');
aboutPanel.id = 'about-panel';
aboutPanel.className = 'about-panel';
aboutPanel.setAttribute('role', 'dialog');
aboutPanel.setAttribute('aria-modal', 'true');
aboutPanel.setAttribute('aria-hidden', 'true');
aboutPanel.setAttribute('aria-labelledby', 'about-title');
aboutPanel.setAttribute('aria-describedby', 'about-description');
aboutPanel.tabIndex = -1;
aboutPanel.innerHTML = `
  <div class="about-card">
    <button class="about-close" type="button" aria-label="Close About">×</button>
    <h2 id="about-title">AUDIOVISOR</h2>
    <div class="about-tag mono">Real-time audio visualizer</div>
    <p id="about-description">Drop in a track, stream a URL, capture any app's audio or connect your
    Spotify account — twenty-two stage modes, twenty-five theme moods, a full
    FX chain and a beat tracker, all rendered live.</p>
    <div class="about-keys">
      <div class="about-key"><kbd>SPACE</kbd><span>Play / Pause</span></div>
      <div class="about-key"><kbd>← →</kbd><span>Seek 10s</span></div>
      <div class="about-key"><kbd>↑ ↓</kbd><span>Volume ±5%</span></div>
      <div class="about-key"><kbd>M</kbd><span>Cycle Mode</span></div>
      <div class="about-key"><kbd>T</kbd><span>Cycle Theme</span></div>
      <div class="about-key"><kbd>R</kbd><span>Random Look</span></div>
      <div class="about-key"><kbd>1-9</kbd><span>Jump Mode</span></div>
      <div class="about-key"><kbd>Q</kbd><span>Queue Manager</span></div>
      <div class="about-key"><kbd>P</kbd><span>Share card (PNG)</span></div>
      <div class="about-key"><kbd>C</kbd><span>Chop N Screw</span></div>
      <div class="about-key"><kbd>L</kbd><span>Library</span></div>
      <div class="about-key"><kbd>F</kbd><span>Fullscreen</span></div>
    </div>
  </div>`;
$('shell').appendChild(aboutPanel);
aboutPanel.inert = true;

const aboutClose = aboutPanel.querySelector('.about-close');
let aboutReturnFocus = null;
function setAboutOpen(open) {
  aboutPanel.classList.toggle('is-open', open);
  $('nav-about').setAttribute('aria-expanded', String(open));
  if (open) {
    aboutPanel.inert = false;
    aboutPanel.setAttribute('aria-hidden', 'false');
    aboutReturnFocus = document.activeElement;
    requestAnimationFrame(() => aboutClose?.focus());
  } else {
    const restore = aboutReturnFocus;
    aboutReturnFocus = null;
    if (aboutPanel.contains(document.activeElement)) document.activeElement.blur();
    aboutPanel.inert = true;
    aboutPanel.setAttribute('aria-hidden', 'true');
    restore?.focus?.();
  }
}
$('nav-about').addEventListener('click', () => {
  setAboutOpen(!aboutPanel.classList.contains('is-open'));
});
aboutPanel.addEventListener('click', (e) => {
  if (e.target === aboutPanel) setAboutOpen(false);
});
aboutClose?.addEventListener('click', () => setAboutOpen(false));
aboutPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    setAboutOpen(false);
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = [...aboutPanel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

const drawer = $('drawer');
function syncDrawerA11y() {
  if (!state.drawerOpen && drawer.contains(document.activeElement)) document.activeElement.blur();
  $('nav-settings').setAttribute('aria-expanded', String(state.drawerOpen));
  $('drawer-toggle')?.setAttribute('aria-expanded', String(state.drawerOpen));
  drawer.setAttribute('aria-hidden', String(!state.drawerOpen));
  drawer.inert = !state.drawerOpen;
  $('shell').classList.toggle('drawer-open', state.drawerOpen);
  const transport = document.querySelector('.transport');
  if (transport) transport.inert = state.drawerOpen && window.innerWidth <= 640;
}
const sheetScrim = $('sheet-scrim');
/** True while the drawer is presented as a bottom sheet rather than a panel. */
const isSheet = () => window.matchMedia('(max-width: 640px)').matches;

function syncDrawer() {
  drawer.classList.toggle('is-closed', !state.drawerOpen);
  $('nav-settings').classList.toggle('is-active', state.drawerOpen);
  $('drawer-toggle')?.classList.toggle('is-on', state.drawerOpen);
  if (sheetScrim) {
    const show = state.drawerOpen && isSheet();
    sheetScrim.hidden = !show;
    // let the element exist for a frame before fading in, or the transition
    // has nothing to animate from
    if (show) requestAnimationFrame(() => sheetScrim.classList.add('is-visible'));
    else sheetScrim.classList.remove('is-visible');
  }
  syncDrawerA11y();
}

function setDrawerOpen(open) {
  if (state.drawerOpen === open) return;
  state.drawerOpen = open;
  syncDrawer();
}
function toggleDrawer() { setDrawerOpen(!state.drawerOpen); }

$('nav-settings').addEventListener('click', toggleDrawer);
$('drawer-toggle')?.addEventListener('click', toggleDrawer);
// tapping the dimmed area behind a sheet closes it, as every sheet does
sheetScrim?.addEventListener('click', () => setDrawerOpen(false));
// drag the grabber down to dismiss
bindSheetDrag(drawer, {
  handle: $('sheet-handle') || undefined,
  isOpen: () => state.drawerOpen && isSheet(),
  onDismiss: () => setDrawerOpen(false),
});
// a sheet dragged part-way and then rotated to a wide layout would keep a
// stale inline transform
window.addEventListener('resize', () => { if (!isSheet()) drawer.style.transform = ''; });
syncDrawer();

/* ---------- keyboard ---------- */

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      transportToggle();
      break;
    case 'ArrowLeft':
      engine.skip(e.shiftKey ? -3 : -10);
      break;
    case 'ArrowRight':
      engine.skip(e.shiftKey ? 3 : 10);
      break;
    case 'ArrowUp':
      e.preventDefault();
      setVolumeUI(engine.volume + 0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      setVolumeUI(engine.volume - 0.05);
      break;
    case 'KeyM': {
      const i = (MODES.findIndex((m) => m.id === state.modeId) + 1) % MODES.length;
      setMode(MODES[i].id);
      break;
    }
    case 'KeyT': {
      const i = (THEMES.findIndex((t) => t.id === state.themeId) + 1) % THEMES.length;
      setTheme(THEMES[i].id);
      break;
    }
    case 'KeyR':
      randomizeLook();
      toast('LOOK <b>RANDOMIZED</b>', { duration: 1200 });
      break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
    case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
      const idx = Number(e.code.slice(5)) - 1;
      if (MODES[idx]) setMode(MODES[idx].id);
      break;
    }
    case 'KeyP':
      snapshot();
      break;
    case 'KeyQ':
      toggleQueue();
      break;
    case 'KeyF':
      $('fullscreen-btn').click();
      break;
    case 'KeyL':
      toggleLibrary();
      break;
    case 'KeyC': {
      const btn = fxEls['chop'];
      if (btn) btn.click();
      else { const on = !engine.fx.chop; engine.setFx('chop', on); toast(`FX <b>CHOP</b> ${on ? 'engaged — screwed' : 'bypassed'}`, { duration: 1400 }); }
      break;
    }
    case 'Escape': {
      if (!queuePanel.classList.contains('is-hidden')) toggleQueue(false);
      if (!libraryPanel.classList.contains('is-hidden')) toggleLibrary(false);
      if (aboutPanel.classList.contains('is-open')) setAboutOpen(false);
      break;
    }
  }
});

/* ---------- waveform seek preview ---------- */

function drawWaveform(buffer) {
  const c = document.getElementById('seek-wave');
  if (!c || !buffer) return;
  const W = c.clientWidth || 600;
  const H = c.clientHeight || 24;
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const peaks = computePeaks(buffer, Math.min(240, Math.floor(W / 2)));
  const bw = W / peaks.length;
  const mid = H / 2;
  ctx.fillStyle = 'rgba(255,235,205,0.22)';
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * (H - 4));
    ctx.fillRect(i * bw + bw * 0.15, mid - h / 2, bw * 0.7, h);
  }
}

/* ---------- live VU meter (bass / mid / high) ---------- */

let vuPeaks = [0, 0, 0];
function drawVu() {
  const c = document.getElementById('vu-meter');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const idle = engine.activeInput === 'none';
  c.style.opacity = idle ? 0.3 : 1;
  const bands = [renderer.sm.bass, renderer.sm.mid, renderer.sm.high];
  const colors = (activeTheme()?.colors) || ['#d9b089', '#c49a6e', '#f5e6d3'];
  const bw = 12, gap = (W - bw * 3) / 2;
  for (let i = 0; i < 3; i++) {
    const v = Math.min(1.2, bands[i] * renderer.sensitivity * 0.85);
    vuPeaks[i] = Math.max(v, vuPeaks[i] - 0.012);
    const x = i * (bw + gap);
    const bh = Math.max(2, v * (H - 6));
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, 3, bw, H - 6);
    const g = ctx.createLinearGradient(0, H - 3 - bh, 0, H - 3);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, colors[i % colors.length]);
    g.addColorStop(1, hexRgbaLocal(colors[i % colors.length], 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(x, H - 3 - bh, bw, bh);
    /* peak cap */
    const py = H - 3 - Math.max(2, vuPeaks[i] * (H - 6)) - 1;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x, py, bw, 1.4);
  }
}
function hexRgbaLocal(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------- theme-reactive favicon ---------- */

let favLinkEl = null;
function updateFavicon() {
  const colors = activeTheme()?.colors || ['#d9b089', '#8a6a4a'];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c2 = cv.getContext('2d');
  /* the same mark as public/icons: obsidian field, theme-lit ring, theme
     diamond with the equalizer slots cut back through it */
  c2.fillStyle = '#14110f';
  c2.beginPath();
  if (c2.roundRect) c2.roundRect(0, 0, 64, 64, 14);
  else c2.rect(0, 0, 64, 64);
  c2.fill();
  c2.strokeStyle = hexRgbaLocal(colors[colors.length - 1] || colors[0], 0.4);
  c2.lineWidth = 2.8;
  c2.beginPath();
  c2.arc(32, 32, 19.6, 0, Math.PI * 2);
  c2.stroke();
  c2.save();
  c2.translate(32, 32);
  c2.rotate(Math.PI / 4);
  c2.fillStyle = colors[0];
  c2.fillRect(-9.2, -9.2, 18.4, 18.4);
  c2.restore();
  c2.fillStyle = '#14110f';
  for (const [bx, bh] of [[-4.8, 5.2], [0, 8.8], [4.8, 6.8]]) {
    c2.beginPath();
    if (c2.roundRect) c2.roundRect(32 + bx - 1.5, 32 - bh, 3, bh * 2, 1.5);
    else c2.rect(32 + bx - 1.5, 32 - bh, 3, bh * 2);
    c2.fill();
  }
  if (!favLinkEl) {
    favLinkEl = document.createElement('link');
    favLinkEl.rel = 'icon';
    favLinkEl.type = 'image/png';
    document.head.appendChild(favLinkEl);
  }
  try {
    favLinkEl.href = cv.toDataURL('image/png');
  } catch { /* non-browser env (tests) without toDataURL */ }
}

/* ---------- resize + adaptive quality ---------- */

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    renderer.resize();
    ray.resize(renderer.w, renderer.h);
    if (engine.buffer && engine.mode === 'file') drawWaveform(engine.buffer);
  }).observe($('stage'));
} else {
  window.addEventListener('resize', () => { renderer.resize(); ray.resize(renderer.w, renderer.h); });
}

/* ---------- render loop ---------- */

let rayDropped = false;
let raySuspended = false;   // runtime-only kill switch, never persisted
let _lastSecs = -1;
let _vuAcc = 0;
let _lastBeatWritten = -1;
let _stageLive = null;
let _uiAcc = 0;
const seekFillEl = $('seek-fill');
const timeCurrentEl = $('time-current');
const bpmValueEl = $('bpm-value');
const bassChipEl = $('bass-chip');
const moodChipEl = $('mood-chip');
const moodValueEl = $('mood-value');
const shellEl = $('shell');
const frameTimes = [];
/* the display's natural frame interval, learned from the fastest frames we
   see rather than assumed to be 60Hz; null until one has been seen */
let rayBaselineEstimate = null;
/* consecutive healthy windows; vsync hides headroom, so climbing back up is
   earned by a run of clean windows rather than measured directly */
let healthyStreak = 0;
/* frames to ignore after a mode change, while one-time setup settles */
const SETTLE_AFTER_MODE_CHANGE = 5;
let settleFrames = SETTLE_AFTER_MODE_CHANGE;
let lastFrameTs = performance.now();
let _frameErrors = 0;
function frame(now) {
  try {
    frameStep(now);
    _frameErrors = 0;
  } catch (err) {
    if (_frameErrors++ < 3) console.error('frame error', err);
    // a renderer that throws every frame would otherwise spin forever; drop
    // to the Canvas2D stage for this session only — the stored preference is
    // deliberately left alone so a transient fault isn't made permanent
    if (_frameErrors === 8 && state.raytraceWanted && !raySuspended) {
      raySuspended = true;
      toast('Raytrace <b>suspended</b> — the stage kept erroring', { duration: 3600 });
    }
  }
  requestAnimationFrame(frame);
}
function frameStep(now) {
  /* The gap since the last frame is what a viewer experiences, and the only
     figure that reflects GPU cost — the CPU time this function takes is
     ~0.1ms whatever the scene, because WebGL work is queued rather than
     run. Animation still uses the clamped value so a tab restore does not
     jump the scene; the adaptive sampler wants the real interval. */
  const frameGap = now - lastFrameTs;
  const dtMs = Math.min(50, frameGap);
  lastFrameTs = now;

  const input = engine.activeInput;
  const idle = input === 'none';
  /* The render loop is the only thing that knows whether the stage is
     actually animating — toggle the class once per change so the CSS can
     drop the expensive chrome blur while it is (see style.css). */
  if (idle !== _stageLive) {
    _stageLive = idle;
    document.documentElement.classList.toggle('stage-live', !idle);
  }

  engine.syncExternal();
  const audioTime = idle ? 0 : engine.getTime();

  let levels = null;
  let freq = null;
  let wave = null;
  let stereoL = null;
  let stereoR = null;
  if (!idle) {
    const d = engine.getData(audioTime);
    if (!d) {
      freq = wave = null;
    } else {
      freq = d.freq;
      wave = d.wave;
      stereoL = d.stereoL || null;
      stereoR = d.stereoR || null;
      if (engine.playing || engine.micActive || engine.captureActive) {
        levels = engine.getLevels(d, audioTime);
      }
    }
  }

  const rtOn = state.raytraceWanted && ray.ok && !raySuspended;
  // surface a GPU context loss instead of silently swapping renderers
  if (state.raytraceWanted && !ray.ok && !ray.loading && !rayDropped) {
    rayDropped = true;
    toast(ray.lost
      ? 'GPU context lost — <b>Canvas2D stage</b> until it recovers'
      : '<b>WebGL2 unavailable</b> — Canvas2D stage', { duration: 3200 });
  } else if (rtOn && rayDropped) {
    rayDropped = false;
    toast('RAYTRACE <b>recovered</b>', { duration: 1800 });
  }
  /* A custom-property write invalidates every rule that reads --beat (logo,
     BPM chip). The value moves in tiny increments 60+ times a second, so
     only touch the style when it has moved enough to see. */
  {
    const beatVal = rtOn ? ray.beat : renderer.beat;
    if (Math.abs(beatVal - _lastBeatWritten) > 0.004) {
      _lastBeatWritten = beatVal;
      shellEl.style.setProperty('--beat', beatVal.toFixed(3));
    }
  }

  if (rtOn) {
    // raytraced stage owns every mode; the 2D renderer still advances its
    // beat envelope so chrome (VU, chips, favicon) keeps working
    if (ray.w !== renderer.w || ray.h !== renderer.h) ray.resize(renderer.w, renderer.h);
    $('ray-canvas').classList.add('is-live');
    $('viz-canvas').classList.add('is-off');
    if (webgpuCanvas) webgpuCanvas.style.display = 'none';
    renderer.updateAnalysis(levels, dtMs);
    /* drop slow-mo: scene time stretches (up to ~45%) while the drop
       envelope is hot. Analysis smoothing keeps the real dt so reactivity
       is untouched — only motion slows. */
    const drop = levels?.drop || 0;
    const dtMotion = dtMs * (1 - 0.45 * drop);
    ray.render(idle, freq, wave, levels, dtMotion, null, stereoL, stereoR);
  } else {
    $('ray-canvas').classList.remove('is-live');
    const gpuReady = !!(webgpuState || webgl2State);
    const gpuMode = state.modeId === 'gpu' && gpuReady;
    if (webgpuCanvas && gpuReady && (webgpuCanvas.width !== Math.round(renderer.w * renderer.dpr) || webgpuCanvas.height !== Math.round(renderer.h * renderer.dpr))) {
      webgpuCanvas.width = Math.round(renderer.w * renderer.dpr);
      webgpuCanvas.height = Math.round(renderer.h * renderer.dpr);
    }
    if (webgpuCanvas) webgpuCanvas.style.display = gpuMode ? 'block' : 'none';
    $('viz-canvas').classList.toggle('is-off', gpuMode);
    if (gpuMode && !idle && levels) {
      if (webgpuState) renderWebGPU(webgpuState, renderer.t, levels.level);
      else renderWebGL2(webgl2State, renderer.t, levels.level, webgpuCanvas.width, webgpuCanvas.height);
    } else {
      const effMode = state.modeId === 'gpu' ? 'void' : null;
      if (effMode) renderer.setMode(effMode);
      renderer.render(idle, freq, wave, levels, dtMs * (1 - 0.45 * (levels?.drop || 0)), stereoL, stereoR);
      if (effMode) renderer.setMode('gpu');
    }
  }

  if (!idle) {
    const t = audioTime;
    const dur = engine.getDuration();
    seekFillEl.style.width = `${dur ? (t / dur) * 100 : 0}%`;
    _vuAcc += dtMs;
    // the clock only ticks once a second — skip 59 of 60 text writes
    const secs = Math.floor(t);
    if (secs !== _lastSecs) {
      _lastSecs = secs;
      timeCurrentEl.textContent = fmtTime(t);
      // the seek bar is a slider now; keep assistive tech in step with it,
      // at the same once-a-second cadence as the visible clock
      seekTrack.setAttribute('aria-valuenow', String(dur ? Math.round((t / dur) * 100) : 0));
      seekTrack.setAttribute('aria-valuetext', `${fmtTime(t)} of ${fmtTime(dur)}`);
    }
    if (_vuAcc >= 33) { _vuAcc = 0; drawVu(); }
    _uiAcc += dtMs;
    if (_uiAcc >= 100) {
      _uiAcc = 0;
      const bi = engine.beatInfo;
      bpmValueEl.textContent = bi.bpm && bi.confidence > 0.25 ? bi.bpm.toFixed(2) : '--.--';
      bassChipEl.classList.toggle('is-hidden', !(renderer.sm.bass > 0.35));
      if (levels) {
        const mood = detectMood({ bpm: levels.bpm, bass: levels.bass, mid: levels.mid, high: levels.high });
        if (mood) { moodValueEl.textContent = mood.tag; moodChipEl.classList.remove('is-hidden'); }
        else moodChipEl.classList.add('is-hidden');
      }
    }
    // Auto DJ crossfade near track end
    if (autoDj && !djFiring && engine.playing && engine.mode === 'file' && engine.queue.length > 1) {
      const rem = engine.getDuration() - audioTime;
      if (rem < 6) {
        djFiring = true;
        engine.crossfadeTo((engine.queueIndex + 1) % engine.queue.length, 4);
        toast('AUTO DJ — <b>crossfading</b>');
        setTimeout(() => { djFiring = false; }, 5200);
      }
    }
  }

  // the interval, not this callback's CPU time — see src/adaptive.js
  rayBaselineEstimate = estimateBaseline(frameTimes, rayBaselineEstimate);
  const rayBaseline = baselineOr(rayBaselineEstimate);
  if (settleFrames > 0) {
    settleFrames--;
    /* A mode change used to deliver 12 fully-rendered jank frames before the
       sampler had a single sample: at ~172ms that was two seconds of stutter
       in a row for Aurora Terrain before anything reacted. Settle exists so a
       spiky cold frame cannot poison the *average* window — but one interval
       three and a half times over budget is not noise, and the climb will
       undo a wrong guess in a couple of seconds. Step down right now. */
    if (state.raytraceWanted && ray.ok && Number.isFinite(frameGap)
        && frameGap > rayBaseline * SEVERE && TIERS.indexOf(ray.quality) > 0) {
      const { tier } = nextTier(ray.quality, frameGap, state.rayQuality, rayBaseline);
      if (tier !== ray.quality) ray.setQuality(tier);
    }
  } else if (Number.isFinite(frameGap) && frameGap > 0) frameTimes.push(frameGap);
  /* Normally this waits for a full window before judging, but that window
     costs more wall-clock the slower things are — on a mode running several
     times over budget that was seconds of stutter before anything happened. shouldEvaluate() acts on a
     short window when every sample in it is severely over budget, which is
     not an ambiguous signal. See src/adaptive.js. */
  if (shouldEvaluate(frameTimes, rayBaseline)) {
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes.length = 0;
    if (state.raytraceWanted && ray.ok) {
      const { tier, streak } = nextTier(ray.quality, avg, state.rayQuality, rayBaseline, healthyStreak);
      healthyStreak = streak;
      if (tier !== ray.quality) ray.setQuality(tier);
    } else {
      renderer.setQuality(next2dQuality(renderer.quality, avg, rayBaseline));
    }
  }

}

loadSettings();
/* The CSS ships the brass tokens and state defaults to the brass theme, so
   first run happens to line up — but that is a coincidence between two files,
   and it breaks silently the day the default theme changes. Derive the accent
   from whatever theme is actually active once settings have been restored. */
applyAccent(activeTheme());

/* Seed every toggle's reported state from the class it is already wearing.
   Without this a control announces nothing at all until the first time it
   is used — "Loop, button" rather than "Loop, button, not pressed" — and
   several are only ever touched through paths that set the class directly.
   Runs after loadSettings so restored preferences are reflected. */
for (const el of document.querySelectorAll(TOGGLE_SELECTOR)) {
  if (el.hasAttribute('aria-pressed')) continue;
  el.setAttribute('aria-pressed', String(el.classList.contains('is-on') || el.classList.contains('is-active')));
}

refreshStatus();
updateFavicon();
requestAnimationFrame(frame);

// Onboarding tour
function runTour() {
  const steps = [
    ['Drop <b>audio</b> or press <b>Space</b> to begin', 800],
    ['<b>M</b> cycles 22 modes · <b>T</b> cycles 25 themes', 3800],
    ['<b>C</b> Chop N Screwed · <b>L</b> Library · <b>F</b> Cinema', 6800],
    ['<b>R</b> random look · right-click P1-P3 to save looks', 9800],
  ];
  steps.forEach(([msg, at]) => setTimeout(() => toast(msg, { duration: 3000 }), at));
  writeText('audiovisor.tour', '1');
}
if (!readText('audiovisor.tour')) runTour();
document.getElementById('tour-replay')?.addEventListener('click', () => { toast('TOUR <b>restarted</b>'); runTour(); });

// Command palette (Cmd+K)
const cmdPalette = document.getElementById('cmd-palette');
const cmdInput = document.getElementById('cmd-input');
const cmdList = document.getElementById('cmd-list');
let cmdActive = 0;
function buildCmds() {
  const cmds = [];
  MODES.forEach(m => cmds.push({ label: `Mode: ${m.name}`, action: () => setMode(m.id), keys: m.id }));
  THEMES.forEach(th => cmds.push({ label: `Theme: ${th.name}`, action: () => setTheme(th.id), keys: th.id }));
  FX.forEach(fx => cmds.push({ label: `FX: ${fx.toUpperCase()}`, action: () => { const btn = fxEls[fx]; if (btn) btn.click(); }, keys: fx }));
  cmds.push({ label: 'Random Look', action: randomizeLook, keys: 'random' });
  for (const slot of [1, 2, 3]) {
    cmds.push({ label: `Save Preset ${slot}`, action: () => savePreset(slot), keys: `save preset ${slot}` });
    cmds.push({ label: `Load Preset ${slot}`, action: () => loadPreset(slot), keys: `load preset ${slot}` });
  }
  cmds.push({ label: 'Sleep Timer 30m', action: () => document.getElementById('sleep-chip')?.click(), keys: 'sleep timer' });
  cmds.push({ label: 'Toggle Library', action: () => toggleLibrary(), keys: 'library' });
  cmds.push({ label: 'Toggle Queue', action: () => toggleQueue(), keys: 'queue' });
  cmds.push({ label: 'Toggle Fullscreen', action: () => document.getElementById('fullscreen-btn')?.click(), keys: 'fullscreen' });
  cmds.push({ label: 'Share card (PNG)', action: snapshot, keys: 'snapshot' });
  cmds.push({ label: 'Keyboard Shortcuts', action: () => document.getElementById('help-btn')?.click(), keys: 'shortcuts help keys' });
  cmds.push({ label: 'Toggle Raytrace', action: () => document.getElementById('rt-chip')?.click(), keys: 'raytrace rt gpu renderer' });
  RAY_QUALITIES.forEach((q) => cmds.push({
    label: `Raytrace Quality: ${q[0].toUpperCase()}${q.slice(1)}`,
    action: () => setRayQuality(q),
    keys: `raytrace quality ${q}`,
  }));
  ['source', 'look', 'audio', 'studio'].forEach((t) => cmds.push({
    label: `Settings: ${t[0].toUpperCase()}${t.slice(1)} tab`,
    action: () => { if (!state.drawerOpen) document.getElementById('nav-settings')?.click(); document.getElementById(`tab-${t}`)?.click(); },
    keys: `tab ${t}`,
  }));
  cmds.push({ label: 'Export Remix', action: () => document.getElementById('export-remix-btn')?.click(), keys: 'export' });
  return cmds;
}
let allCmds = buildCmds();
let cmdReturnFocus = null;
/** The list currently on screen — what Enter must index into. */
let cmdVisible = [];
function renderCmds(filter = '') {
  cmdVisible = filterCommands(allCmds, filter);
  cmdActive = clampActive(cmdActive, cmdVisible.length);
  cmdList.innerHTML = cmdVisible.map((c, i) => `<div class="cmd-item ${i===cmdActive?'is-active':''}" data-i="${i}"><span>${esc(c.label)}</span><kbd>↵</kbd></div>`).join('') || '<div style="padding:12px; font-size:11px; color:var(--text-40)">No matches</div>';
  cmdList.querySelectorAll('.cmd-item').forEach(el => el.addEventListener('click', () => { const c = cmdVisible[Number(el.dataset.i)]; if (c) { c.action(); closeCmd(); }}));
}
function openCmd() { cmdReturnFocus = document.activeElement; cmdPalette.classList.remove('is-hidden'); cmdPalette.setAttribute('aria-hidden', 'false'); cmdInput.value = ''; cmdActive = 0; renderCmds(''); cmdInput.focus(); }
function closeCmd() {
  if (cmdPalette.contains(document.activeElement)) document.activeElement.blur();
  cmdPalette.classList.add('is-hidden');
  cmdPalette.setAttribute('aria-hidden', 'true');
  const restore = cmdReturnFocus;
  cmdReturnFocus = null;
  restore?.focus?.();
}
cmdPalette?.addEventListener('click', (e) => { if (e.target === cmdPalette) closeCmd(); });
cmdInput?.addEventListener('input', () => { cmdActive = 0; renderCmds(cmdInput.value); });
cmdInput?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdActive = clampActive(cmdActive + 1, cmdVisible.length); renderCmds(cmdInput.value); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdActive = clampActive(cmdActive - 1, cmdVisible.length); renderCmds(cmdInput.value); }
  else if (e.key === 'Enter') { e.preventDefault(); const c = cmdVisible[cmdActive]; if (c) { c.action(); closeCmd(); } }
  else if (e.key === 'Escape') closeCmd();
});
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (cmdPalette.classList.contains('is-hidden')) openCmd(); else closeCmd(); }
  if (e.key === 'Escape' && !cmdPalette.classList.contains('is-hidden')) closeCmd();
});

document.getElementById('settings-reset')?.addEventListener('click', () => {
  removeStored(SETTINGS_KEY);
  removeStored('audiovisor.tour');
  location.reload();
});

// Settings export/import
function currentSettings() {
  return serializeSettings({
    mode: state.modeId,
    theme: state.themeId,
    autopilot: state.autopilot,
    raytrace: state.raytraceWanted,
    rayQuality: state.rayQuality,
    fx: state.fx,
    sliders: Object.fromEntries(Object.entries(sliderEls).map(([k, el]) => [k, parseFloat(el.value)])),
    eq: EQ_FREQS.map((_, i) => engine.eqFilters?.[i]?.gain.value || 0),
    volume: engine.volume,
    loop: engine.loop,
    autoDj,
  });
}
document.getElementById('settings-export')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(currentSettings(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'audiovisor-settings.json');
  toast('Settings <b>exported</b>');
});
document.getElementById('settings-import')?.addEventListener('click', () => document.getElementById('settings-file')?.click());
document.getElementById('settings-file')?.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    try {
      const s = validateSettings(JSON.parse(txt), SETTINGS_VOCAB);
      if (!Object.keys(s).length) { toast('<b>Import failed</b> — nothing usable in that file'); return; }
      applySettings(s, { eq: true });
      saveSettings();
      toast('Settings <b>imported</b>');
    } catch { toast('<b>Import failed</b>'); }
  });
  e.target.value = '';
});

// PWA — register + force update so stale cache-first HTML self-heals
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  // A new worker taking control means the build changed under us; reload once
  // so the running page isn't a mix of old JS and new assets. Without this a
  // returning visitor could sit on a stale build indefinitely.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
// WebGPU init
let webgpuState = null;
let webgl2State = null;
const webgpuCanvas = document.getElementById('webgpu-canvas');
if (webgpuCanvas) {
  initWebGPU(webgpuCanvas)
    .catch(() => null)
    .then((s) => {
      webgpuState = s;
      if (!s) webgl2State = initWebGL2(webgpuCanvas);
    });
}
// Voice AI
let voiceSynth = null;
let voiceActive = false;
let voiceRaf = null;
let voiceStream = null;
document.getElementById('voice-btn')?.addEventListener('click', async () => {
  if (voiceActive) {
    voiceActive = false;
    document.getElementById('voice-btn').classList.remove('is-on');
    if (voiceRaf) cancelAnimationFrame(voiceRaf);
    voiceSynth?.stop();
    if (voiceStream) { voiceStream.getTracks().forEach(tr => tr.stop()); voiceStream = null; }
    toast('Voice AI <b>off</b>');
    return;
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const stream = voiceStream;
    // warm context already ensured via engine
    if (!engine.ctx) engine._ensureCtx();
    voiceSynth = new VoiceSynth(engine.ctx);
    const src = engine.ctx.createMediaStreamSource(stream);
    const analyser = engine.ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    voiceActive = true;
    document.getElementById('voice-btn').classList.add('is-on');
    toast('Voice AI <b>listening</b> — hum to play');
    const loop = () => {
      if (!voiceActive) return;
      analyser.getFloatTimeDomainData(buf);
      const freq = detectPitch(buf, engine.ctx.sampleRate);
      if (freq > 80 && freq < 1000) {
        const midi = freqToMidi(freq);
        const f = 440 * Math.pow(2, (midi-69)/12);
        voiceSynth.play(f, 0.25);
        renderer.beat = 0.7;
      } else {
        voiceSynth.stop();
      }
      voiceRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch { toast('<b>Mic denied</b>'); }
});

// Social feed wiring
Social.seedFeed();
function renderSocial() {
  const el = document.getElementById('social-feed');
  if (!el) return;
  const feed = Social.getFeed();
  el.innerHTML = feed.slice(0,8).map(e => `
    <div style="padding:8px 10px; background:var(--glass); border:1px solid var(--border-soft); border-radius:8px; display:flex; justify-content:space-between; align-items:center">
      <div style="min-width:0">
        <div style="font-size:11px; font-weight:600; color:var(--text)">${esc(e.title)}</div>
        <div style="font-size:10px; color:var(--text-40)">${esc(e.user)} · ${esc(e.mode)} · ${e.likes}♥</div>
      </div>
      <button class="ghost-btn" data-like="${e.id}" style="width:28px; height:28px; flex-shrink:0"><span class="ic ic-sm" data-icon="record"></span></button>
    </div>`).join('');
  el.querySelectorAll('[data-like]').forEach(b=>b.addEventListener('click', ()=>{ Social.likeFeed(b.dataset.like); renderSocial(); }));
}
document.getElementById('social-post')?.addEventListener('click', () => {
  const inp = document.getElementById('social-input');
  const title = inp?.value.trim();
  if (!title) return;
  Social.postToFeed({ title, mode: state.modeId, theme: state.themeId, fx: state.fx });
  if (inp) inp.value = '';
  renderSocial();
  toast('Posted to <b>feed</b>');
});
renderSocial();
// hook frame to also render WebGPU when available


/* ---------- raytrace controls ---------- */

function setRaytrace(on, { quiet = false } = {}) {
  state.raytraceWanted = on;
  if (on) raySuspended = false;
  const chip = $('rt-chip');
  chip?.classList.toggle('is-active', on);
  chip?.setAttribute('aria-pressed', String(on));
  if (on && ray.ok) {
    ray.setMode(state.modeId);
    ray.setTheme(activeTheme());
    ray.resize(renderer.w, renderer.h);
  }
  if (!quiet) {
    toast(on ? 'RAYTRACE <b>engaged</b>' : 'Raytrace <b>off</b> — Canvas2D stage', { duration: 1600 });
    saveSettings();
  }
}
function setRayQuality(q, { quiet = false } = {}) {
  if (!RAY_QUALITIES.includes(q)) return;
  /* What the user picks is a ceiling. On a device that cannot hold it, the
     stage starts lower and the adaptive climb walks up to whatever this
     hardware can actually sustain. */
  state.rayQuality = q;
  ray.setQuality(initialTier(q));
  const label = $('rt-quality-label');
  if (label) label.textContent = `Quality: ${q[0].toUpperCase()}${q.slice(1)}`;
  if (!quiet) {
    toast(`Raytrace quality <b>${q}</b>`, { duration: 1400 });
    saveSettings();
  }
}
$('rt-chip')?.addEventListener('click', () => {
  if (ray.loading) { toast('Raytrace stage <b>still loading</b>…', { duration: 1600 }); return; }
  if (!ray.ok && !ray.lost) { toast('<b>Raytrace unavailable</b> — WebGL2 required', { duration: 2400 }); return; }
  setRaytrace(!state.raytraceWanted);
});
$('rt-quality')?.addEventListener('click', () => {
  const i = (RAY_QUALITIES.indexOf(state.rayQuality) + 1) % RAY_QUALITIES.length;
  setRayQuality(RAY_QUALITIES[i]);
});
if (!ray.ok) {
  $('rt-chip')?.classList.add('is-disabled');
  $('rt-quality')?.classList.add('is-disabled');
}
// re-apply whatever loadSettings() restored (or the defaults) now that the
// chips exist in the DOM
setRaytrace(state.raytraceWanted, { quiet: true });
setRayQuality(state.rayQuality, { quiet: true });


/* ---------- drawer tabs (v8.7) ---------- */

const TAB_KEY = 'audiovisor.drawerTab';
const drawerTabs = [...document.querySelectorAll('.drawer-tab')];
const drawerPanels = [...document.querySelectorAll('.drawer-panel')];
const tabInk = document.getElementById('drawer-tab-ink');
const drawerScroll = document.querySelector('.drawer-scroll');

function moveInk(btn) {
  if (!tabInk || !btn) return;
  tabInk.style.width = `${btn.offsetWidth}px`;
  tabInk.style.transform = `translateX(${btn.offsetLeft}px)`;
}
function setDrawerTab(id, { persist = true } = {}) {
  const btn = drawerTabs.find((b) => b.dataset.tab === id) || drawerTabs[0];
  if (!btn) return;
  drawerTabs.forEach((b) => {
    const on = b === btn;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  drawerPanels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === btn.dataset.tab));
  if (btn.dataset.tab === 'source') ensureConnect();
  if (drawerScroll) drawerScroll.scrollTop = 0;
  moveInk(btn);
  if (persist) writeText(TAB_KEY, btn.dataset.tab);
}
drawerTabs.forEach((btn, i) => {
  btn.addEventListener('click', () => setDrawerTab(btn.dataset.tab));
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = drawerTabs[(i + (e.key === 'ArrowRight' ? 1 : drawerTabs.length - 1)) % drawerTabs.length];
    next.focus();
    setDrawerTab(next.dataset.tab);
  });
});
setDrawerTab(readText(TAB_KEY) || 'look', { persist: false });
// ink position depends on layout/fonts — re-measure once settled and on resize
window.addEventListener('load', () => moveInk(drawerTabs.find((b) => b.getAttribute('aria-selected') === 'true')));
window.addEventListener('resize', () => moveInk(drawerTabs.find((b) => b.getAttribute('aria-selected') === 'true')));

/* ---------- mode filter ---------- */

const modeFilter = document.getElementById('mode-filter');
const modeEmpty = document.getElementById('mode-empty');
modeFilter?.addEventListener('input', () => {
  const q = modeFilter.value.trim().toLowerCase();
  let shown = 0;
  [...modeList.children].forEach((card, i) => {
    const m = MODES[i];
    const hit = !q || (m && (m.name.toLowerCase().includes(q) || m.id.includes(q)));
    card.classList.toggle('is-filtered', !hit);
    if (hit) shown++;
  });
  modeEmpty?.classList.toggle('is-hidden', shown > 0);
});
modeFilter?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { modeFilter.value = ''; modeFilter.dispatchEvent(new Event('input')); modeFilter.blur(); }
  if (e.key === 'Enter') {
    const first = [...modeList.children].find((c) => !c.classList.contains('is-filtered'));
    if (first) first.click();
  }
});

/* ---------- keyboard shortcuts overlay ---------- */

const SHORTCUTS = [
  ['Transport', [
    ['Play / pause', 'Space'],
    ['Seek ±10s', '← / →'],
    ['Fine seek ±3s', 'Shift + ← / →'],
    ['Volume', '↑ / ↓'],
    ['Volume (stage)', 'Scroll wheel'],
  ]],
  ['Look', [
    ['Next stage mode', 'M'],
    ['Next theme', 'T'],
    ['Random look', 'R'],
    ['Jump to mode 1–9', '1 … 9'],
    ['Chop N Screwed FX', 'C'],
  ]],
  ['Panels', [
    ['Command palette', '⌘ / Ctrl + K'],
    ['Keyboard shortcuts', '?'],
    ['Library', 'L'],
    ['Queue', 'Q'],
    ['Cinema fullscreen', 'F'],
    ['Share card (PNG)', 'P'],
    ['Close any panel', 'Esc'],
  ]],
];
const shortcutsOverlay = document.getElementById('shortcuts-overlay');
const shortcutsGrid = document.getElementById('shortcuts-grid');
let shortcutsReturnFocus = null;
if (shortcutsGrid) {
  shortcutsGrid.innerHTML = SHORTCUTS.map(([group, rows]) =>
    `<div class="shortcuts-group">${group}</div>` +
    rows.map(([label, key]) => `<div class="shortcut-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')
  ).join('');
}
function toggleShortcuts(force) {
  if (!shortcutsOverlay) return;
  const hidden = shortcutsOverlay.classList.contains('is-hidden');
  const open = force === undefined ? hidden : force;
  if (open) shortcutsReturnFocus = document.activeElement;
  else if (shortcutsOverlay.contains(document.activeElement)) document.activeElement.blur();
  shortcutsOverlay.classList.toggle('is-hidden', !open);
  shortcutsOverlay.setAttribute('aria-hidden', String(!open));
  if (open) document.getElementById('shortcuts-close')?.focus();
  else {
    const restore = shortcutsReturnFocus;
    shortcutsReturnFocus = null;
    restore?.focus?.();
  }
}
document.getElementById('help-btn')?.addEventListener('click', () => toggleShortcuts());
document.getElementById('shortcuts-close')?.addEventListener('click', () => toggleShortcuts(false));
shortcutsOverlay?.addEventListener('click', (e) => { if (e.target === shortcutsOverlay) toggleShortcuts(false); });
window.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
  if (!typing && (e.key === '?' || (e.key === '/' && !e.shiftKey))) { e.preventDefault(); toggleShortcuts(); }
  else if (e.key === 'Escape') toggleShortcuts(false);
});


/* debug/testing hook */
window.__av = {
  engine, renderer, state,
  get ray() { return ray; },
  get connect() { return connect; },
};

/* Dev-only: drive the ray stage with a synthetic track so scenes can be
   inspected (and screenshotted) without loading audio. */
if (import.meta.env?.DEV) {
  window.__av.pump = (modeIdx, frames = 30, t0 = 3) => {
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
    ray.setMode(MODES[modeIdx]?.id || 'bars');
    for (let f = 0; f < frames; f++) {
      const t = t0 + f * 0.033;
      for (let i = 0; i < 1024; i++) {
        const u = i / 1024;
        const v = 0.06
          + 0.7 * Math.exp(-Math.pow((u - 0.02) * 16, 2))
          + 0.45 * Math.abs(Math.sin(u * 26 + t)) * Math.exp(-u * 2.4)
          + 0.25 * Math.exp(-Math.pow((u - 0.3) * 10, 2))
          + 0.12 * Math.abs(Math.sin(u * 90 + t * 3.7)) * Math.exp(-u * 4.2);
        freq[i] = Math.max(0, Math.min(255, v * 255));
      }
      for (let i = 0; i < 2048; i++) wave[i] = 128 + 90 * Math.sin(i * 0.017 + t * 2.2) + 20 * Math.sin(i * 0.0053 - t);
      const beat = (t % 0.55) < 0.12 ? 0.85 : 0;
      ray.render(false, freq, wave, {
        bass: 0.6, mid: 0.45, high: 0.3, level: 0.55,
        beatPulse: beat, beatPhase: (t % 0.55) / 0.55, bpm: 109, beatConfidence: 0.9,
      }, 33, t);
    }
    $('ray-canvas').classList.add('is-live');
    $('viz-canvas').classList.add('is-off');
    $('dropzone').style.display = 'none';
    if (state.drawerOpen) $('nav-settings').click();
    return { mode: MODES[modeIdx]?.id, res: `${ray.rw}x${ray.rh}`, glError: ray.gl.getError() };
  };
}
