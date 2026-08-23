import { setIcon } from './icons.js';
import { MODES, THEMES } from './themes.js';
import { AudioEngine } from './audio.js';
import { Renderer } from './visualizers.js';
import { ConnectPanel } from './connect.js';
import { fmtTime, pickRandom, fmtStamp } from './utils.js';
import * as Library from './library.js';
import { AI_PRESETS, suggestPreset } from './ai.js';
import { detectPitch, freqToMidi, VoiceSynth } from './voice.js';
import { detectMood } from './mood.js';
import { generateAlbumArt } from './albumart.js';
import { initWebGL2, renderWebGL2 } from './webgl2.js';
import { initWebGPU, renderWebGPU } from './webgpu.js';
import * as Social from './social.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const engine = new AudioEngine();
const renderer = new Renderer($('viz-canvas'));

const SETTINGS_KEY = 'audiovisor.settings.v2';

const state = {
  modeId: 'bars',
  themeId: 'lime',
  autopilot: false,
  autopilotTimer: null,
  drawerOpen: true,
  fx: { reverb: false, limiter: false, lowpass: false, speed: false, autotune: false, chorus: false, echo: false, crush: false, chop: false },
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
  btn.innerHTML = `
    <div class="mode-preview"><span class="ic" data-icon="${m.icon}"></span></div>
    <span class="mode-name">${m.name}</span>`;
  btn.addEventListener('click', () => setMode(m.id));
  modeList.appendChild(btn);
});
modeList.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

const themeRow = $('theme-row');
THEMES.forEach((t) => {
  const btn = document.createElement('button');
  btn.className = 'theme-dot' + (t.id === state.themeId ? ' is-active' : '');
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

function applySlider(id, v) {
  if (id === 'sensitivity') {
    engine.sensitivity = v;
    renderer.setSensitivity(v);
  } else if (id === 'bass-focus') {
    engine.bassFocus = v;
    renderer.setBassFocus(v);
  } else if (id === 'smoothing') {
    engine.setSmoothing(v);
  } else if (id === 'color-pop') {
    renderer.setColorPop(v);
  } else if (id === 'bloom') {
    renderer.setBloom(v);
  }
}

const FX = ['reverb', 'limiter', 'lowpass', 'speed', 'autotune', 'chorus', 'echo', 'crush', 'chop'];
const fxRow = $('fx-row');
const fxEls = {};
FX.forEach((fx) => {
  const btn = document.createElement('button');
  btn.className = 'fx-chip';
  btn.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${fx.toUpperCase()}</span>`;
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('is-active');
    btn.classList.toggle('is-active', on);
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
  document.getElementById('autodj-chip').classList.toggle('is-active', autoDj);
  toast(autoDj ? 'AUTO DJ <b>ON</b> — beat-matched crossfade' : 'AUTO DJ <b>OFF</b>', { duration: 1600 });
  saveSettings();
});

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
  const hist = JSON.parse(localStorage.getItem('audiovisor.collab')||'[]');
  hist.unshift({ url, at: Date.now() });
  localStorage.setItem('audiovisor.collab', JSON.stringify(hist.slice(0,20)));
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
  const list = JSON.parse(localStorage.getItem('audiovisor.comments')||'[]');
  collabEl.innerHTML = list.slice(-6).map(c => `<div style="font-size:11px; color:var(--text-60); padding:4px 6px; background:var(--glass); border-radius:6px"><b style="color:var(--accent)">${esc(c.user)}</b> ${esc(c.text)}</div>`).join('') || '<div style="font-size:10px; color:var(--text-20)">No comments yet</div>';
}
document.getElementById('comment-send')?.addEventListener('click', () => {
  const text = commentInput?.value.trim();
  if (!text) return;
  const list = JSON.parse(localStorage.getItem('audiovisor.comments')||'[]');
  list.push({ user: 'You', text, at: Date.now() });
  localStorage.setItem('audiovisor.comments', JSON.stringify(list));
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
    if (e.data?.type === 'comment') { const list = JSON.parse(localStorage.getItem('audiovisor.comments')||'[]'); list.push({ user: 'Guest', text: e.data.text, at: Date.now() }); localStorage.setItem('audiovisor.comments', JSON.stringify(list)); renderComments(); }
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

function setMode(id) {
  state.modeId = id;
  renderer.setMode(id);
  [...modeList.children].forEach((c, i) => c.classList.toggle('is-active', MODES[i].id === id));
  saveSettings();
}

function setTheme(id) {
  state.themeId = id;
  renderer.setTheme(THEMES.find((t) => t.id === id));
  [...themeRow.children].forEach((c, i) => c.classList.toggle('is-active', THEMES[i].id === id));
  saveSettings();
}

function randomizeLook() {
  setMode(pickRandom(MODES).id);
  setTheme(pickRandom(THEMES).id);
}

/* ---------- autopilot ---------- */

function setAutopilot(on, opts = {}) {
  state.autopilot = on;
  $('autopilot-chip').classList.toggle('is-active', on);
  $('shuffle-btn').classList.toggle('is-on', on);
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

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      mode: state.modeId,
      theme: state.themeId,
      autopilot: state.autopilot,
      fx: state.fx,
      sliders: {
        sensitivity: parseFloat(sliderEls.sensitivity.value),
        'bass-focus': parseFloat(sliderEls['bass-focus'].value),
        smoothing: parseFloat(sliderEls.smoothing.value),
        'color-pop': parseFloat(sliderEls['color-pop']?.value || 1),
        bloom: parseFloat(sliderEls.bloom?.value || 0.5),
      },
      volume: engine.volume,
      loop: engine.loop,
    }));
  } catch {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem('audiovisor.settings.v1');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (MODES.some((m) => m.id === s.mode)) setMode(s.mode);
    if (THEMES.some((t) => t.id === s.theme)) setTheme(s.theme);
    for (const [key, val] of Object.entries(s.sliders || {})) {
      const input = sliderEls[key];
      if (!input) continue;
      input.value = val;
      const cfg = SLIDERS.find((c) => c.id === key);
      const group = input.closest('.slider-group');
      group.querySelector('.slider-value').textContent = cfg.fmt(parseFloat(val));
      applySlider(key, parseFloat(val));
    }
    for (const [name, on] of Object.entries(s.fx || {})) {
      if (fxEls[name] && on) {
        fxEls[name].classList.add('is-active');
        engine.setFx(name, true);
        state.fx[name] = true;
      }
    }
    if (typeof s.volume === 'number') {
      engine.setVolume(s.volume);
      $('volume-fill').style.width = `${s.volume * 100}%`;
    }
    if (s.loop) {
      engine.loop = true;
      $('loop-btn').classList.add('is-on');
    }
    if (s.autopilot) setAutopilot(true, { silent: true });
  } catch {}
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
  $('queue-btn').classList.toggle('is-on', show);
  if (show) renderQueue();
}

$('queue-btn').addEventListener('click', () => toggleQueue());
$('save-library-btn')?.addEventListener('click', saveToLibrary);

async function renderLibrary() {
  const meta = await Library.listLibraryMeta();
  let html = `<div class="library-head"><span class="ic ic-lime" data-icon="layers"></span><span class="mono library-title">LIBRARY · ${meta.length}</span><button class="icon-x" id="lib-close" title="Close"><span class="ic ic-sm" data-icon="close"></span></button></div>`;
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
  libraryPanel.innerHTML = html;
  libraryPanel.querySelectorAll('[data-icon]').forEach(el => setIcon(el, el.dataset.icon));
  libraryPanel.querySelector('#lib-close')?.addEventListener('click', () => toggleLibrary(false));
  libraryPanel.querySelectorAll('.lib-play').forEach(b => b.addEventListener('click', async () => {
    const rec = await Library.getLibraryEntry(b.dataset.id);
    if (!rec) return;
    if (engine.captureActive) await engine.toggleCapture();
    if (engine.micActive) await engine.toggleMic();
    if (engine.mode === 'spotify') engine.pause();
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
  $('library-btn').classList.toggle('is-on', show);
  if (show) renderLibrary();
  if (show) { queuePanel.classList.add('is-hidden'); $('queue-btn').classList.remove('is-on'); }
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

function updateTrackUI() {
  const input = engine.activeInput;

  if (input === 'spotify' && connect.client.track) {
    const t = connect.client.track;
    $('track-name').textContent = t.name;
    $('track-spec').textContent = `${t.artists} · SPOTIFY`;
    $('time-total').textContent = fmtTime(t.durationMs / 1000);
    trackArtEl.innerHTML = spotifyArtwork
      ? `<img class="track-art-img" src="${spotifyArtwork}" alt="" />`
      : '<span class="ic" data-icon="spotify"></span>';
    if (spotifyArtwork == null) setIcon(trackArtEl.querySelector('.ic'), 'spotify');
  } else if (input === 'stream' && engine.streamTrack) {
    $('track-name').textContent = engine.streamTrack.name;
    $('track-spec').textContent = `LIVE STREAM · ${engine.streamTrack.ext}`;
    $('time-total').textContent = fmtTime(engine.getDuration());
    trackArtEl.innerHTML = '<span class="ic" data-icon="link"></span>';
    setIcon(trackArtEl.querySelector('.ic'), 'link');
  } else if (engine.track) {
    const t = engine.track;
    const idx = engine.queue.length > 1 ? ` · ${engine.queueIndex + 1}/${engine.queue.length}` : '';
    $('track-name').textContent = t.name + idx;
    $('track-spec').textContent = `${(t.sampleRate / 1000).toFixed(1)}kHz / ${t.channels === 1 ? 'MONO' : 'STEREO'} · ${t.ext}`;
    $('time-total').textContent = fmtTime(t.duration);
    drawWaveform(engine.buffer);
    // procedural album art
    if (!trackArtEl._artName || trackArtEl._artName !== t.name) {
      trackArtEl._artName = t.name;
      const art = generateAlbumArt(t.name, THEMES.find(th => th.id === state.themeId)?.colors || ['#d9b089','#c49a6e','#f5e6d3'], 160);
      trackArtEl.innerHTML = '';
      trackArtEl.appendChild(art);
      trackArtEl.querySelector('canvas')?.classList.add('track-art-img');
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
  setIcon($('header-play-icon'), icon);
  $('track-info').classList.toggle('is-playing', playing);
  $('capture-btn').classList.toggle('is-on', engine.captureActive);
  $('mic-btn').classList.toggle('is-on', engine.micActive);

  let text = 'Engine: Idle';
  switch (engine.activeInput) {
    case 'mic': text = playing || engine.micActive ? 'Engine: Live · MIC' : 'Engine: MIC'; break;
    case 'capture': text = 'Engine: Live · CAPTURE'; break;
    case 'spotify': text = playing ? 'SPOTIFY · Live' : 'SPOTIFY · Paused'; break;
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

/* ---------- spotify connect panel ---------- */

let spotifyArtwork = null;
const connect = new ConnectPanel($('connect-root'), {
  engine,
  toast,
  onSpotifyTrack: async (info) => {
    if (!info) {
      spotifyArtwork = null;
      updateTrackUI();
      return;
    }
    spotifyArtwork = info.artwork || null;
    updateTrackUI();
  },
});
connect.boot();

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
  if (engine.mode === 'spotify') engine.pause();
  engine.stopStream();
  $('status-text').textContent = 'Engine: Decoding';
  try {
    const errors = await engine.addToQueue(audioFiles);
    if (!engine.hasTrack) {
      toast('<b>Decode failed</b> — no playable files', { duration: 3000 });
      return;
    }
    dropzone.classList.add('is-hidden');
    updateTrackUI();
    engine.play();
    const loaded = audioFiles.length - errors.length;
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

dropzone.addEventListener('click', () => fileInput.click());
$('stage').addEventListener('click', (e) => {
  if (dropzone.classList.contains('is-hidden')) return;
  if (e.target.closest('.dropzone')) return;
  fileInput.click();
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
    if (input === 'spotify' && connect.client.track) {
      const t = connect.client.track;
      const artwork = spotifyArtwork ? [{ src: spotifyArtwork, sizes: '640x640', type: 'image/jpeg' }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name,
        artist: t.artists,
        album: 'Spotify · AUDIOVISOR',
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
const headerPlayBtn = $('header-play-btn');

function transportToggle() {
  if (engine.activeInput === 'none') {
    fileInput.click();
    return;
  }
  engine.toggle();
}

[playPauseBtn, headerPlayBtn].forEach((btn) => btn.addEventListener('click', transportToggle));

$('prev-btn').addEventListener('click', () => engine.prevTrack());
$('next-btn').addEventListener('click', () => engine.nextTrack());
$('loop-btn').addEventListener('click', () => {
  engine.loop = !engine.loop;
  $('loop-btn').classList.toggle('is-on', engine.loop);
  saveSettings();
  toast(engine.loop ? 'LOOP <b>ON</b>' : 'LOOP <b>OFF</b>', { duration: 1200 });
});

const seekTrack = $('seek-track');
function seekFromEvent(e) {
  if (engine.getDuration() <= 0) return;
  const rect = seekTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  engine.seek(ratio * engine.getDuration());
}
let seeking = false;
seekTrack.addEventListener('mousedown', (e) => { seeking = true; seekFromEvent(e); });
window.addEventListener('mousemove', (e) => { if (seeking) seekFromEvent(e); });
window.addEventListener('mouseup', () => { seeking = false; });

const volumeTrack = $('volume-track');
function setVolumeUI(v) {
  v = Math.max(0, Math.min(1, v));
  engine.setVolume(v);
  $('volume-fill').style.width = `${v * 100}%`;
}
function volumeFromEvent(e) {
  const rect = volumeTrack.getBoundingClientRect();
  setVolumeUI((e.clientX - rect.left) / rect.width);
}
let volDragging = false;
volumeTrack.addEventListener('mousedown', (e) => { volDragging = true; volumeFromEvent(e); });
window.addEventListener('mousemove', (e) => { if (volDragging) volumeFromEvent(e); });
window.addEventListener('mouseup', () => { volDragging = false; saveSettings(); });
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
    shell.addEventListener('mousemove', onMove);
    const clr = () => { shell.removeEventListener('mousemove', onMove); document.removeEventListener('fullscreenchange', clr); clearTimeout(hid); };
    // cleanup when exiting handled by next fullscreenchange
    shell._cinemaCleanup = clr;
  } else {
    shell.classList.remove('is-cinema', 'is-chrome-hidden');
    if (shell._cinemaCleanup) { try { shell._cinemaCleanup(); } catch {} shell._cinemaCleanup = null; }
  }
});
// also toggle cinema on stage double-click
$('stage').addEventListener('dblclick', () => $('fullscreen-btn').click());

/* ---------- snapshot & session recorder ---------- */

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function snapshot() {
  try {
    renderer.canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `audiovisor-snapshot-${fmtStamp()}.png`);
      toast('SNAPSHOT <b>SAVED</b>', { duration: 1400 });
    }, 'image/png');
  } catch (err) {
    console.error(err);
    toast('<b>Snapshot failed</b>', { duration: 2000 });
  }
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
  if (!('MediaRecorder' in window) || !renderer.canvas.captureStream) {
    toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
    return;
  }
  try {
    const stream = renderer.canvas.captureStream(60);
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
    $('mic-btn').classList.toggle('is-on', on);
    refreshStatus();
    toast(on ? 'MIC <b>LIVE</b> — engine listening' : 'MIC <b>OFF</b>', { duration: 1600 });
  } catch (err) {
    console.error(err);
    toast('<b>Mic blocked</b> — allow microphone access', { duration: 3000 });
  }
});

/* ---------- nav ---------- */

const aboutPanel = document.createElement('div');
aboutPanel.className = 'about-panel';
aboutPanel.innerHTML = `
  <div class="about-card">
    <h2>AUDIOVISOR</h2>
    <div class="about-tag mono">Real-time audio visualizer</div>
    <p>Drop in a track, stream a URL, capture any app's audio or connect your
    Spotify account — nine stage modes, eight theme moods, a full FX chain and
    a beat tracker, all rendered live.</p>
    <div class="about-keys">
      <div class="about-key"><kbd>SPACE</kbd><span>Play / Pause</span></div>
      <div class="about-key"><kbd>← →</kbd><span>Seek 10s</span></div>
      <div class="about-key"><kbd>↑ ↓</kbd><span>Volume ±5%</span></div>
      <div class="about-key"><kbd>M</kbd><span>Cycle Mode</span></div>
      <div class="about-key"><kbd>T</kbd><span>Cycle Theme</span></div>
      <div class="about-key"><kbd>R</kbd><span>Random Look</span></div>
      <div class="about-key"><kbd>Q</kbd><span>Queue Manager</span></div>
      <div class="about-key"><kbd>P</kbd><span>Snapshot PNG</span></div>
      <div class="about-key"><kbd>C</kbd><span>Chop N Screw</span></div>
      <div class="about-key"><kbd>L</kbd><span>Library</span></div>
      <div class="about-key"><kbd>F</kbd><span>Fullscreen</span></div>
    </div>
  </div>`;
$('shell').appendChild(aboutPanel);

$('nav-about').addEventListener('click', () => {
  aboutPanel.classList.toggle('is-open');
});
aboutPanel.addEventListener('click', (e) => {
  if (e.target === aboutPanel) aboutPanel.classList.remove('is-open');
});

const drawer = $('drawer');
function syncDrawerA11y() {
  $('nav-settings').setAttribute('aria-expanded', String(state.drawerOpen));
  drawer.setAttribute('aria-hidden', String(!state.drawerOpen));
}
$('nav-settings').addEventListener('click', () => {
  state.drawerOpen = !state.drawerOpen;
  drawer.classList.toggle('is-closed', !state.drawerOpen);
  $('nav-settings').classList.toggle('is-active', state.drawerOpen);
  syncDrawerA11y();
});
syncDrawerA11y();

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
      if (aboutPanel.classList.contains('is-open')) aboutPanel.classList.remove('is-open');
      break;
    }
  }
});

/* ---------- waveform seek preview ---------- */

function computePeaks(buffer, buckets = 240) {
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / buckets));
  const peaks = new Float32Array(buckets);
  const sub = Math.max(1, Math.floor(step / 64));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const end = Math.min(ch.length, (b + 1) * step);
    for (let i = b * step; i < end; i += sub) {
      const v = Math.abs(ch[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  const m = Math.max(...peaks) || 1;
  for (let i = 0; i < buckets; i++) peaks[i] /= m;
  return peaks;
}

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

/* ---------- resize + adaptive quality ---------- */

new ResizeObserver(() => {
  renderer.resize();
  if (engine.buffer && engine.mode === 'file') drawWaveform(engine.buffer);
}).observe($('viz-canvas'));

/* ---------- render loop ---------- */

const frameTimes = [];
let lastFrameTs = performance.now();
function frame(now) {
  const t0 = performance.now();
  const dtMs = Math.min(50, now - lastFrameTs);
  lastFrameTs = now;

  const input = engine.activeInput;
  const idle = input === 'none';

  engine.syncExternal();

  let levels = null;
  let freq = null;
  let wave = null;
  if (!idle) {
    const d = engine.getData();
    if (!d) {
      freq = wave = null;
    } else {
      freq = d.freq;
      wave = d.wave;
      if (engine.playing || engine.micActive || engine.captureActive) {
        levels = engine.getLevels(d);
      }
    }
  }

  const gpuReady = !!(webgpuState || webgl2State);
  const gpuMode = state.modeId === 'gpu' && gpuReady;
  // fit GPU canvas to stage
  if (webgpuCanvas && gpuReady && (webgpuCanvas.width !== Math.round(renderer.w * renderer.dpr) || webgpuCanvas.height !== Math.round(renderer.h * renderer.dpr))) {
    webgpuCanvas.width = Math.round(renderer.w * renderer.dpr);
    webgpuCanvas.height = Math.round(renderer.h * renderer.dpr);
  }
  webgpuCanvas.style.display = gpuMode ? 'block' : 'none';
  $('viz-canvas').style.display = gpuMode ? 'none' : 'block';
  if (gpuMode && !idle && levels) {
    if (webgpuState) renderWebGPU(webgpuState, renderer.t, levels.level);
    else renderWebGL2(webgl2State, renderer.t, levels.level, webgpuCanvas.width, webgpuCanvas.height);
  } else {
    // gpu mode without gpu support falls back to void core 2D
    const effMode = state.modeId === 'gpu' ? 'void' : null;
    if (effMode) renderer.setMode(effMode);
    renderer.render(idle, freq, wave, levels, dtMs);
    if (effMode) renderer.setMode('gpu');
  }

  if (!idle) {
    const t = engine.getTime();
    const dur = engine.getDuration();
    $('seek-fill').style.width = `${dur ? (t / dur) * 100 : 0}%`;
    $('time-current').textContent = fmtTime(t);
    const bi = engine.beatInfo;
    $('bpm-value').textContent = bi.bpm && bi.confidence > 0.25 ? bi.bpm.toFixed(2) : '--.--';
    $('bass-chip').classList.toggle('is-hidden', !(renderer.sm.bass > 0.35));
    if (levels) {
      const mood = detectMood({ bpm: levels.bpm, bass: levels.bass, mid: levels.mid, high: levels.high });
      const chip = $('mood-chip');
      if (mood) { $('mood-value').textContent = mood.tag; chip.classList.remove('is-hidden'); }
      else chip.classList.add('is-hidden');
    }
    // Auto DJ crossfade near track end
    if (autoDj && !djFiring && engine.playing && engine.mode === 'file' && engine.queue.length > 1) {
      const rem = engine.getDuration() - engine.getTime();
      if (rem < 6) {
        djFiring = true;
        engine.crossfadeTo((engine.queueIndex + 1) % engine.queue.length, 4);
        toast('AUTO DJ — <b>crossfading</b>');
        setTimeout(() => { djFiring = false; }, 5200);
      }
    }
  }

  frameTimes.push(performance.now() - t0);
  if (frameTimes.length >= 90) {
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes.length = 0;
    const target = avg > 21 ? 'low' : avg < 13 ? 'high' : renderer.quality;
    renderer.setQuality(target);
  }

  requestAnimationFrame(frame);
}

loadSettings();
refreshStatus();
requestAnimationFrame(frame);

// Onboarding tour
function runTour() {
  const steps = [
    ['Drop <b>audio</b> or press <b>Space</b> to begin', 800],
    ['<b>M</b> cycles 18 modes · <b>T</b> cycles 16 themes', 3800],
    ['<b>C</b> Chop N Screwed · <b>L</b> Library · <b>F</b> Cinema', 6800],
    ['<b>R</b> random look · <b>P</b> snapshot · <b>Q</b> queue', 9800],
  ];
  steps.forEach(([msg, at]) => setTimeout(() => toast(msg, { duration: 3000 }), at));
  localStorage.setItem('audiovisor.tour', '1');
}
if (!localStorage.getItem('audiovisor.tour')) runTour();
document.getElementById('tour-replay')?.addEventListener('click', () => { toast('TOUR <b>restarted</b>'); runTour(); });
document.getElementById('settings-reset')?.addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem('audiovisor.tour');
  location.reload();
});

// Settings export/import
function currentSettings() {
  return {
    version: 6,
    mode: state.modeId, theme: state.themeId, autopilot: state.autopilot, fx: state.fx,
    sliders: Object.fromEntries(Object.entries(sliderEls).map(([k, el]) => [k, parseFloat(el.value)])),
    eq: EQ_FREQS.map((_, i) => engine.eqFilters?.[i]?.gain.value || 0),
    volume: engine.volume, loop: engine.loop, autoDj,
  };
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
      const s = JSON.parse(txt);
      if (s.mode) setMode(s.mode);
      if (s.theme) setTheme(s.theme);
      for (const [k, v] of Object.entries(s.sliders || {})) {
        const input = sliderEls[k];
        if (input) { input.value = v; input.dispatchEvent(new Event('input')); }
      }
      for (const [k, v] of Object.entries(s.fx || {})) {
        if (fxEls[k]) { fxEls[k].classList.toggle('is-active', !!v); engine.setFx(k, !!v); state.fx[k] = !!v; }
      }
      (s.eq || []).forEach((v, i) => {
        const rows = document.querySelectorAll('.eq-row');
        const input = rows[i]?.querySelector('input');
        if (input) { input.value = v; input.dispatchEvent(new Event('input')); }
      });
      if (typeof s.volume === 'number') setVolumeUI(s.volume);
      if (s.loop) { engine.loop = true; $('loop-btn').classList.add('is-on'); }
      if (s.autopilot) setAutopilot(true, { silent: true });
      if (s.autoDj) { autoDj = true; document.getElementById('autodj-chip')?.classList.add('is-active'); }
      toast('Settings <b>imported</b>');
    } catch { toast('<b>Import failed</b>'); }
  });
  e.target.value = '';
});

// PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
// WebGPU init
let webgpuState = null;
let webgl2State = null;
const webgpuCanvas = document.getElementById('webgpu-canvas');
if (webgpuCanvas) {
  initWebGPU(webgpuCanvas).then(s => {
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


/* debug/testing hook */
window.__av = { engine, renderer, connect };
