import { setIcon } from './icons.js';
import { MODES, THEMES } from './themes.js';
import { AudioEngine } from './audio.js';
import { Renderer } from './visualizers.js';
import { ConnectPanel } from './connect.js';
import { fmtTime, pickRandom, fmtStamp } from './utils.js';

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
    trackArtEl.innerHTML = '<span class="ic" data-icon="music2"></span>';
    setIcon(trackArtEl.querySelector('.ic'), 'music2');
  }
  updateMediaSession();
}

/* ---------- play state sync ---------- */

function refreshStatus() {
  const playing = engine.playing;
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
    await engine.addToQueue(audioFiles);
    dropzone.classList.add('is-hidden');
    updateTrackUI();
    engine.play();
    toast(audioFiles.length > 1
      ? `Loaded <b>${audioFiles.length} tracks</b> — queue playing`
      : `Loaded <b>${engine.track.name}</b>`);
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

$('fullscreen-btn').addEventListener('click', () => {
  const shell = $('shell');
  if (document.fullscreenElement) document.exitFullscreen();
  else shell.requestFullscreen?.();
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
      engine.skip(-10);
      break;
    case 'ArrowRight':
      engine.skip(10);
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
    case 'KeyC': {
      const btn = fxEls['chop'];
      if (btn) btn.click();
      else { const on = !engine.fx.chop; engine.setFx('chop', on); toast(`FX <b>CHOP</b> ${on ? 'engaged — screwed' : 'bypassed'}`, { duration: 1400 }); }
      break;
    }
    case 'Escape': {
      if (!queuePanel.classList.contains('is-hidden')) toggleQueue(false);
      if (aboutPanel.classList.contains('is-open')) aboutPanel.classList.remove('is-open');
      break;
    }
  }
});

/* ---------- resize + adaptive quality ---------- */

new ResizeObserver(() => renderer.resize()).observe($('viz-canvas'));

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

  renderer.render(idle, freq, wave, levels, dtMs);

  if (!idle) {
    const t = engine.getTime();
    const dur = engine.getDuration();
    $('seek-fill').style.width = `${dur ? (t / dur) * 100 : 0}%`;
    $('time-current').textContent = fmtTime(t);
    const bi = engine.beatInfo;
    $('bpm-value').textContent = bi.bpm && bi.confidence > 0.25 ? bi.bpm.toFixed(2) : '--.--';
    $('bass-chip').classList.toggle('is-hidden', !(renderer.sm.bass > 0.35));
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

/* debug/testing hook */
window.__av = { engine, renderer, connect };
