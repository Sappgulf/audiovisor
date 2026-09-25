import { setIcon } from './icons.js';
import { applyAccent } from './chrome.js';
import { MODES, THEMES } from './themes.js';
import { modeArt } from './mode-art.js';
import { AudioEngine } from './audio.js';
import { Renderer, loadExtraModes } from './visualizers.js';
import { fmtTime, pickRandom } from './utils.js';
import { createToasts } from './toast.js';
import { createFavicon } from './favicon.js';
import { createShareCard } from './share-card.js';
import { createAboutPanel } from './about.js';
import { createShortcutsOverlay } from './shortcuts.js';
import { createPanels } from './panels.js';
import { createControls } from './controls.js';
import { createModePicker } from './mode-picker.js';
import { createDrawerTabs } from './drawer-tabs.js';
import { createSleepTimer } from './sleep-timer.js';
import { createLookPresets } from './look-presets.js';
import { createAiStudio } from './ai-studio.js';
import { createCollab } from './collab.js';
import { createRecorder } from './recorder.js';
import { createStageChrome } from './stage-chrome.js';
import { createKeyboardShortcuts } from './keyboard.js';
import { createAutoplayGuard } from './autoplay.js';
import { createOverflowMenu } from './overflow-menu.js';
import { createFileLoader } from './file-loader.js';
import { createCommandPalette } from './command-palette.js';
import { createDrawer } from './drawer.js';
import { createOnboarding } from './onboarding.js';
import { registerServiceWorker } from './pwa.js';
import { createGpuStage } from './gpu-init.js';
import { createTransport } from './transport.js';
import { SETTINGS_KEY, readSettings } from './settings.js';
/* localStorage writes throw in Safari private browsing and once the origin
   quota is full. Nothing here is worth failing over. See src/storage.js. */
import { writeJSON } from './storage.js';
import { initialTier } from './adaptive.js';
import { generateAlbumArt } from './albumart.js';
import { extractPalette, paletteToTheme, hashStr } from './artpalette.js';

import { createRenderLoop } from './render-loop.js';
import { createRaytraceControls } from './raytrace-controls.js';
import { createSettingsUI } from './settings-ui.js';
import { createVoiceInput } from './voice-ui.js';
import { createSocialFeed } from './social-ui.js';
import { createPlayState } from './play-state.js';
import { createConnectLoader } from './connect-loader.js';
import { createAutopilot } from './autopilot.js';
import { createTempoPrime } from './tempo-prime.js';
import { registerMode, registeredModes, isPluginMode } from './plugins.js';
import { createMidiInput } from './midi.js';

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
  // The stage is the product's first impression. Start in the visual workspace
  // and let the inspector open on demand; opening a dense control dock on boot
  // made the empty state feel like a settings screen.
  drawerOpen: false,
  // what the user asked for, persisted; whether it's actually running is
  // ray.ok, which can flip on a GPU context loss
  raytraceWanted: true,
  rayQuality: 'high',
  // offline tempo analysis for the current track, 0 until it lands
  analyzedBpm: 0,
  fx: { reverb: false, limiter: false, lowpass: false, speed: false, autotune: false, chorus: false, echo: false, crush: false, chop: false, widener: false },
};
/* ---------- toasts ---------- */

const toast = createToasts($('toasts'));

/* ---------- icons ---------- */

document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

/* ---------- mode & theme pickers ---------- */

const picker = createModePicker({
  modes: MODES,
  themes: THEMES,
  getModeId: () => state.modeId,
  getThemeId: () => state.themeId,
  onPickMode: (id) => setMode(id),
  onPickTheme: (id) => setTheme(id),
  setToggle,
});

/* Public plugin API: register a custom Canvas2D visualizer mode. */
window.AUDIOVISOR = {
  registerMode: (def) => {
    const mode = registerMode(def);
    picker.addMode(mode);
    toast('Custom mode <b>registered</b>', { duration: 1600 });
    return mode;
  },
  modes: registeredModes,
};

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

/* Sliders, FX chips and EQ bands are built in src/controls.js. Constructed
   here, after setToggle exists, since the FX chips report their state
   through it. */
const controls = createControls({
  engine, renderer, getRay: () => ray, state, toast, setToggle, saveSettings,
});
const { SLIDERS, FX, EQ_FREQS, sliderEls, fxEls, applySlider, setFx } = controls;

/** Set a slider from a 0..1 value, mirroring the input handler so MIDI and
    the on-screen control always agree. */
function setSliderNormalized(id, norm) {
  const input = sliderEls[id];
  const cfg = SLIDERS.find((c) => c.id === id);
  if (!input || !cfg) return;
  const v = cfg.min + Math.max(0, Math.min(1, norm)) * (cfg.max - cfg.min);
  input.value = String(v);
  const label = input.closest('.slider-group')?.querySelector('.slider-value');
  if (label) label.textContent = cfg.fmt(v);
  applySlider(id, v);
  saveSettings();
}

/* MIDI input — opt-in via the MIDI chip in the Look tab. */
createMidiInput({
  chip: $('midi-chip'),
  fxNames: FX,
  modes: MODES,
  setSlider: setSliderNormalized,
  setFx,
  setMode,
  toast,
  setToggle,
});

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
createSleepTimer({
  engine,
  toast,
  refreshStatus: () => refreshStatus(),
  saveSettings,
  volumeFill: $('volume-fill'),
  chip: $('sleep-chip'),
  label: $('sleep-label'),
});

/* ---------- look presets, AI studio, collab ---------- */

const { savePreset, loadPreset } = createLookPresets({
  state,
  fxNames: FX,
  toast,
  setMode,
  setTheme,
  setFx,
  saveSettings,
  row: document.getElementById('preset-row'),
});

createAiStudio({ engine, toast, setFx, setTheme, saveSettings });

createCollab({ state, toast, setMode, setTheme, setFx });


/* ---------- mode / theme switching ---------- */

function pulseStage() {
  const st = $('stage');
  st.classList.remove('is-look-change');
  void st.offsetWidth;
  st.classList.add('is-look-change');
}

function setModeStory(id) {
  const story = modeArt(id);
  $('stage').dataset.mode = id;
  $('mode-story-chapter').textContent = story.chapter;
  $('mode-story-title').textContent = story.title;
  $('mode-story-copy').textContent = story.story;
}

function setMode(id, { restore = false } = {}) {
  if (!MODES.some((m) => m.id === id)) return;
  /* The stage stays blank until the user picks a mode themselves; restoring
     the saved mode on load must not reveal it. */
  if (!restore) document.documentElement.classList.remove('mode-unchosen');
  /* Each mode has its own cost, and the tier adapted for the last one says
     nothing about this one — without this, stepping down for a heavy mode
     left every later mode stuck at that tier. The render loop also skips the
     first frames of a new mode, which include one-time setup. */
  renderLoop.resetAdaptation();
  /* Restart from the tier this device should begin at rather than the
     ceiling. On a phone the ceiling is a guaranteed stutter that adaptive
     stepping then has to undo; the climb takes it back up if there is room. */
  const start = initialTier(state.rayQuality);
  if (ray.ok && ray.quality !== start) ray.setQuality(start);
  state.modeId = id;
  setModeStory(id);
  renderer.setMode(id);
  ray.setMode(id);
  picker.setActiveMode(id);
  syncStageContext();
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

function syncStageContext() {
  const mode = MODES.find((m) => m.id === state.modeId);
  const theme = activeTheme();
  const modeLabel = $('active-mode-label');
  const themeLabel = $('active-theme-label');
  const modeIcon = $('active-mode-icon');
  const context = $('stage-context');
  if (modeLabel) modeLabel.textContent = mode?.name || 'Stage';
  if (themeLabel) themeLabel.textContent = theme?.name || 'Warm Brass';
  if (modeIcon) setIcon(modeIcon, mode?.icon || 'activity');
  if (context) {
    const label = `${mode?.name || 'Stage'} · ${theme?.name || 'Warm Brass'}`;
    context.title = label;
    context.setAttribute('aria-label', label);
  }
}

function applyAutoPalette(colors, announce) {
  autoTheme = paletteToTheme(colors);
  if (state.themeId !== 'auto') return;
  renderer.setTheme(autoTheme);
  ray.setTheme(autoTheme);
  applyAccent(autoTheme);
  syncStageContext();
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
  syncStageContext();
  updateFavicon();
  toast(`AUTO <b>theme</b> — ${base.name}`);
}

function setTheme(id) {
  if (id !== 'auto' && !THEMES.some((t) => t.id === id)) return;
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
  picker.setActiveTheme(id);
  syncStageContext();
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

const { setAutopilot } = createAutopilot({
  state,
  chip: $('autopilot-chip'),
  shuffleBtn: $('shuffle-btn'),
  toast,
  setToggle,
  saveSettings,
  randomizeLook,
});


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
  if (s.mode) setMode(s.mode, { restore: true });
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
    setFx(name, on);
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

/* ---------- queue & library panels ---------- */

createTempoPrime({ engine, state });

const panels = createPanels({
  shell: $('shell'),
  engine,
  toast,
  setToggle,
  triggerQueue: $('queue-btn'),
  triggerLibrary: $('library-btn'),
  saveLibraryBtn: $('save-library-btn'),
});


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
  trackInfoEl.classList.toggle('has-track', input !== 'none');

  const connect = connectLoader.getConnect();
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
  } else {
    $('track-name').textContent = 'No track loaded';
    $('track-spec').textContent = 'Drop audio or pick a source';
    $('time-total').textContent = '00:00';
    trackArtEl.innerHTML = '<span class="ic" data-icon="layers"></span>';
    setIcon(trackArtEl.querySelector('.ic'), 'layers');
    trackInfoEl.classList.remove('has-art');
    currentArtworkUrl = null;
  }
  updateMediaSession();
}

/* ---------- play state sync ---------- */

const { refreshStatus } = createPlayState({
  engine,
  panels,
  setIcon,
  setToggle,
  getDropzone: () => dropzone,
  onTrackChange: () => updateTrackUI(),
});


/* ---------- music account connect panel ---------- */

const connectLoader = createConnectLoader({
  engine,
  toast,
  onExternalTrack: () => updateTrackUI(),
});


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

const { ensureAudible } = createAutoplayGuard({ engine, toast, refreshStatus });

/* ---------- overflow menu ---------- */

const { closeMore } = createOverflowMenu();

/* ---------- file loading ---------- */

const { openFilePicker, dropzone } = createFileLoader({
  engine,
  toast,
  updateTrackUI,
  ensureAudible,
  closeMore,
});


/* ---------- media session & transport ---------- */

const transport = createTransport({
  engine,
  getConnect: connectLoader.getConnect,
  setToggle,
  saveSettings,
  toast,
  openFilePicker,
});
const { transportToggle, setVolumeUI, updateMediaSession, seekTrack } = transport;


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
  return state.raytraceWanted && ray.ok && !renderLoop.isSuspended() && !isPluginMode(state.modeId)
    ? ray.canvas
    : renderer.canvas;
}

/* ---------- share card ---------- */

/* The snapshot used to be the raw stage canvas — a frame of pixels with no
   context, which never made it past a group chat. The compositing now lives
   in src/share-card.js; here we just supply it the current look and canvas. */
const { snapshot } = createShareCard({
  getTheme: activeTheme,
  getModeName: () => MODES.find((m) => m.id === state.modeId)?.name || 'Stage',
  getTrackName: () => $('track-name')?.textContent,
  getLiveCanvas: liveCanvas,
  download: downloadBlob,
  toast,
});

$('snapshot-btn').addEventListener('click', snapshot);

createRecorder({ engine, getLiveCanvas: liveCanvas, download: downloadBlob, toast });


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

const about = createAboutPanel({
  shell: $('shell'),
  trigger: $('nav-about'),
  modeCount: MODES.length,
  themeCount: THEMES.length,
});

createDrawer({ state });

// The empty state offers a clear path into the mode browser without requiring
// users to understand the settings dock first.
$('explore-modes')?.addEventListener('click', () => {
  if (!state.drawerOpen) $('nav-settings')?.click();
  $('tab-look')?.click();
  requestAnimationFrame(() => $('mode-filter')?.focus({ preventScroll: true }));
});

/* ---------- keyboard ---------- */

createKeyboardShortcuts({
  engine,
  setVolumeUI,
  transportToggle,
  setMode,
  setTheme,
  randomizeLook,
  toast,
  snapshot,
  panels,
  about,
  getFxEl: (name) => fxEls[name],
  setFx,
  getModeId: () => state.modeId,
  getThemeId: () => state.themeId,
  isTypingTarget,
});

/* ---------- waveform seek preview + VU meter ---------- */

const { drawWaveform, drawVu } = createStageChrome({
  engine,
  renderer,
  getTheme: activeTheme,
});

/* ---------- theme-reactive favicon ---------- */

const updateFavicon = createFavicon(() => activeTheme()?.colors);

/* ---------- render loop ---------- */

const renderLoop = createRenderLoop({
  engine,
  renderer,
  getRay: () => ray,
  state,
  toast,
  getGpu: () => ({ webgpuState: gpu.getWebgpu(), webgl2State: gpu.getWebgl2(), webgpuCanvas: gpu.canvas }),
  drawVu,
  drawWaveform,
  seekTrack,
  getAutoDj: () => autoDj,
  isDjFiring: () => djFiring,
  setDjFiring: (v) => { djFiring = v; },
  onQualityChange: (tier) => showEffectiveTier(tier),
});

const { setRaytrace, setRayQuality, showEffectiveTier } = createRaytraceControls({
  state,
  getRay: () => ray,
  getTheme: activeTheme,
  renderer,
  rayQualities: RAY_QUALITIES,
  toast,
  saveSettings,
  resume: renderLoop.resume,
});

loadSettings();
setModeStory(state.modeId);
/* The CSS ships the brass tokens and state defaults to the brass theme, so
   first run happens to line up — but that is a coincidence between two files,
   and it breaks silently the day the default theme changes. Derive the accent
   from whatever theme is actually active once settings have been restored. */
applyAccent(activeTheme());
syncStageContext();

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
renderLoop.start();

// Onboarding tour
createOnboarding({ toast, modeCount: MODES.length, themeCount: THEMES.length });

// Command palette (Cmd+K)
function buildCommands() {
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
  cmds.push({ label: 'Toggle Library', action: () => panels.toggleLibrary(), keys: 'library' });
  cmds.push({ label: 'Toggle Queue', action: () => panels.toggleQueue(), keys: 'queue' });
  cmds.push({ label: 'Clear Queue', action: () => panels.clearQueue(), keys: 'clear queue' });
  cmds.push({ label: 'Toggle Fullscreen', action: () => document.getElementById('fullscreen-btn')?.click(), keys: 'fullscreen' });
  cmds.push({ label: 'Toggle MIDI input', action: () => document.getElementById('midi-chip')?.click(), keys: 'midi' });
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

createCommandPalette({ commands: buildCommands() });

function isTypingTarget(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

const { currentSettings } = createSettingsUI({
  state,
  engine,
  sliderEls,
  eqFreqs: EQ_FREQS,
  getAutoDj: () => autoDj,
  vocab: SETTINGS_VOCAB,
  applySettings,
  saveSettings,
  download: downloadBlob,
  toast,
});

// PWA — register + force update so stale cache-first HTML self-heals
registerServiceWorker();

// WebGPU init with WebGL2 fallback
const gpu = createGpuStage();
/* Surface which backend the GPU Core mode ended up on. WebGPU is preferred;
   WebGL2 is the fallback, and the Canvas2D stage covers the rest. */
gpu.whenReady().then((backend) => {
  const el = document.getElementById('gpu-backend');
  if (el) {
    el.textContent = backend === 'webgpu' ? 'GPU Core · WebGPU'
      : backend === 'webgl2' ? 'GPU Core · WebGL2 (WebGPU unavailable)'
        : 'GPU Core · unavailable — Canvas2D stage';
  }
  if (window.__av) window.__av.gpuBackend = backend;
});

// Voice AI
createVoiceInput({ engine, renderer, toast });

// Social feed wiring
createSocialFeed({ state, toast });

/* ---------- drawer tabs (v8.7) ---------- */

createDrawerTabs({ onSourceTab: connectLoader.ensureConnect });

/* ---------- keyboard shortcuts overlay ---------- */

createShortcutsOverlay({ isTypingTarget });


/* debug/testing hook */
window.__av = {
  engine, renderer, state,
  get ray() { return ray; },
  get connect() { return connectLoader.getConnect(); },
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
