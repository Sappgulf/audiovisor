import { setIcon } from './icons.js';
import { fmtTime } from './utils.js';
import { SpotifyClient, storedClientId, redirectUri } from './spotify.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * Drawer "Connect" panel: Spotify account link (PKCE OAuth + Web Playback
 * SDK), system/tab-audio capture toggle and direct URL streaming.
 */
export class ConnectPanel {
  /**
   * @param {HTMLElement} root       container for the panel
   * @param {object} deps
   * @param {import('./audio.js').AudioEngine} deps.engine
   * @param {(msg:string, opts?:object)=>void} deps.toast
   * @param {(info:object|null)=>void} [deps.onSpotifyTrack]
   */
  constructor(root, { engine, toast, onSpotifyTrack }) {
    this.root = root;
    this.engine = engine;
    this.toast = toast;
    this.onSpotifyTrack = onSpotifyTrack || (() => {});

    this.client = new SpotifyClient();
    this.client.onError = (msg) => toast(`<b>Spotify</b> — ${esc(msg)}`, { duration: 3600 });
    this.client.onAuthChange = () => this.render();
    this.client.onTrackChange = async (track) => {
      this.engine.setExternal(this.makeController());
      const artwork = await this.client.artworkFor(track);
      this.onSpotifyTrack({
        name: track.name,
        artists: track.artists,
        duration: track.durationMs / 1000,
        artwork,
        album: 'Spotify',
        kind: 'SPOTIFY',
      });
    };

    this.deviceReady = false;
    this.searchTimer = null;
    this.lastResults = [];

    this.render();
    this.wireEngineEvents();
  }

  /* ---------- boot ---------- */

  /** Call once at app start: completes OAuth redirect and restores session. */
  async boot() {
    await this.client.handleRedirect();
    if (!this.client.authed) return;
    try {
      await this.client.loadProfile();
      this.render();
      if (this.client.premium) {
        this.toast('Reconnecting <b>Spotify</b> player…', { duration: 1800 });
        await this.client.connectPlayer();
        this.deviceReady = true;
        this.toast('Spotify player <b>ready</b>', { duration: 1600 });
      }
      this.render();
    } catch (err) {
      console.error(err);
    }
  }

  makeController() {
    const c = this.client;
    return {
      seed: c.track?.id || 'spotify',
      title: c.track?.name || '',
      isPlaying: () => !!c.track && !c.paused,
      getTime: () => c.getPositionMs() / 1000,
      getDuration: () => (c.track?.durationMs || 0) / 1000,
      play: () => c.resume(),
      pause: () => c.pause(),
      seek: (sec) => c.seek(Math.max(0, sec * 1000)),
      next: () => c.next(),
      prev: () => c.prev(),
      setVolume: (v) => c.setVolume(v),
    };
  }

  wireEngineEvents() {
    this.engine.on('source', (mode) => {
      if (mode === 'capture-ended') {
        this.toast('Tab capture <b>stopped</b>', { duration: 2000 });
      }
      this.syncChips();
    });
    this.engine.on('state', () => this.syncChips());
    this.engine.on('error', (msg) => this.toast(`<b>Capture</b> — ${esc(msg)}`, { duration: 3600 }));
  }

  /* ---------- rendering ---------- */

  render() {
    const authed = this.client.authed;
    this.root.innerHTML = '';

    /* --- source chips --- */
    const sources = document.createElement('div');
    sources.className = 'connect-sources';
    sources.innerHTML = `
      <button class="fx-chip" id="chip-capture" title="Visualize any app or tab">
        <span class="ic ic-sm" data-icon="monitor"></span><span class="chip-txt">Capture</span>
      </button>
      <button class="fx-chip" id="chip-url" title="Stream a direct audio URL">
        <span class="ic ic-sm" data-icon="link"></span><span class="chip-txt">URL</span>
      </button>`;
    this.root.appendChild(sources);
    sources.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

    /* --- url row --- */
    const urlRow = document.createElement('div');
    urlRow.className = 'url-row is-hidden';
    urlRow.id = 'url-row';
    urlRow.innerHTML = `
      <input type="text" class="connect-input mono" id="url-input"
             placeholder="https://… .mp3 / radio / podcast" spellcheck="false" />
      <button class="mini-btn lime-btn-sm" id="url-play" title="Stream"><span class="ic ic-sm" data-icon="play"></span></button>`;
    this.root.appendChild(urlRow);
    setIcon(urlRow.querySelector('#url-play .ic'), 'play');

    /* --- spotify block --- */
    const sp = document.createElement('div');
    sp.className = 'spotify-block';
    if (!authed) {
      const cid = storedClientId();
      sp.innerHTML = `
        <div class="sp-head">
          <span class="ic ic-lime" data-icon="spotify"></span>
          <span class="sp-title">Spotify Connect</span>
        </div>
        <p class="sp-note">Stream your library through AUDIOVISOR. Requires a
        <b>Premium</b> plan and your own app Client&nbsp;ID.</p>
        <details class="sp-help">
          <summary class="mono">SETUP</summary>
          <ol>
            <li>Create an app at <i>developer.spotify.com/dashboard</i></li>
            <li>Add this redirect URI:<br><code>${esc(redirectUri())}</code></li>
            <li>Web API + Web Playback SDK scopes enabled</li>
          </ol>
        </details>
        <div class="sp-login">
          <input type="text" class="connect-input mono" id="sp-client-id"
                 placeholder="Client ID" value="${esc(cid)}" spellcheck="false" />
          <button class="lime-btn-sm sp-connect" id="sp-connect">Connect</button>
        </div>`;
    } else {
      const p = this.client.profile;
      sp.innerHTML = `
        <div class="sp-head">
          <span class="ic ic-lime" data-icon="spotify"></span>
          <span class="sp-title">Spotify</span>
          <span class="sp-badge mono">${this.client.premium ? 'PREMIUM' : 'FREE'}</span>
          <button class="icon-x" id="sp-disconnect" title="Disconnect"><span class="ic ic-sm" data-icon="close"></span></button>
        </div>
        <div class="sp-profile mono">
          <span class="sp-avatar">${esc((p?.display_name || '?')[0].toUpperCase())}</span>
          <span class="sp-name">${esc(p?.display_name || 'Connected')}</span>
          <span class="sp-dev dot-ok" id="sp-dev">${this.deviceReady ? 'DEVICE LIVE' : 'DEVICE …'}</span>
        </div>
        ${this.client.premium ? `
        <div class="sp-search">
          <span class="ic ic-dim" data-icon="search"></span>
          <input type="text" class="connect-input bare mono" id="sp-search-input"
                 placeholder="Search tracks…" spellcheck="false" />
        </div>
        <div class="sp-actions">
          <button class="mini-btn" id="sp-top">My Top Tracks</button>
          <select class="mini-select mono" id="sp-playlists"><option value="">Playlists…</option></select>
        </div>
        <div class="sp-results" id="sp-results"></div>`
        : `<p class="sp-note"><b>Free plan:</b> playback control needs Premium.
           You can still visualize Spotify with <b>Capture</b>.</p>`}`;
    }
    this.root.appendChild(sp);
    sp.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

    this.bind(sources, urlRow, sp);
    this.syncChips();
  }

  bind(sources, urlRow, sp) {
    /* capture */
    sources.querySelector('#chip-capture').addEventListener('click', async () => {
      try {
        const on = await this.engine.toggleCapture();
        this.toast(on
          ? 'CAPTURE <b>LIVE</b> — visualizing shared audio'
          : 'Capture <b>OFF</b>', { duration: 2000 });
        this.syncChips();
      } catch (err) {
        this.toast(`<b>Capture blocked</b> — ${esc(err.message || err)}`, { duration: 3600 });
      }
    });

    /* url streaming */
    const urlInput = urlRow.querySelector('#url-input');
    const streamUrl = () => {
      const url = urlInput.value.trim();
      if (!/^https?:\/\//i.test(url)) {
        this.toast('<b>Invalid URL</b>', { duration: 1600 });
        return;
      }
      let name = 'Stream';
      try {
        const u = new URL(url);
        name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
      } catch {}
      this.engine.playUrl(url, { name }).then(() => {
        this.toast(`Streaming <b>${esc(name)}</b>`);
        this.onSpotifyTrack(null);
      });
    };
    sources.querySelector('#chip-url').addEventListener('click', () => {
      urlRow.classList.toggle('is-hidden');
      if (!urlRow.classList.contains('is-hidden')) urlInput.focus();
    });
    urlRow.querySelector('#url-play').addEventListener('click', streamUrl);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') streamUrl();
      e.stopPropagation();
    });

    if (!this.client.authed) {
      sp.querySelector('#sp-connect').addEventListener('click', () => {
        const cid = sp.querySelector('#sp-client-id').value.trim();
        if (!cid) {
          this.toast('<b>Client ID required</b> — see SETUP above', { duration: 2600 });
          return;
        }
        this.client.login(cid).catch((e) =>
          this.toast(`<b>Login failed</b> — ${esc(e.message)}`, { duration: 3200 }));
      });
      sp.querySelector('#sp-client-id').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sp.querySelector('#sp-connect').click();
        e.stopPropagation();
      });
      return;
    }

    sp.querySelector('#sp-disconnect').addEventListener('click', () => {
      this.client.logout();
      this.deviceReady = false;
      this.engine.setExternal(null);
      this.onSpotifyTrack(null);
      this.render();
      this.toast('Spotify <b>disconnected</b>', { duration: 1600 });
    });

    if (!this.client.premium) return;

    /* search */
    const input = sp.querySelector('#sp-search-input');
    input.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      const q = input.value.trim();
      this.searchTimer = setTimeout(() => {
        if (q.length < 2) return;
        this.runSearch(q);
      }, 380);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());

    sp.querySelector('#sp-top').addEventListener('click', async () => {
      try {
        const items = await this.client.topTracks(10);
        this.showResults(items.map((t) => this.client.mapTrack(t)), 'MY TOP TRACKS');
      } catch (err) {
        this.toast(`<b>Spotify</b> — ${esc(err.message)}`, { duration: 3000 });
      }
    });

    const plSel = sp.querySelector('#sp-playlists');
    this.client.playlists().then((pls) => {
      for (const p of pls) {
        const opt = document.createElement('option');
        opt.value = p.uri;
        opt.textContent = p.name;
        plSel.appendChild(opt);
      }
    }).catch(() => {});
    plSel.addEventListener('change', async () => {
      const uri = plSel.value;
      if (!uri) return;
      await this.playContext(uri, plSel.selectedOptions[0].textContent);
    });
  }

  async runSearch(q) {
    const box = this.root.querySelector('#sp-results');
    if (!box) return;
    try {
      const items = await this.client.searchTracks(q, 8);
      this.showResults(items.map((t) => this.client.mapTrack(t)), `RESULTS — “${q}”`);
    } catch (err) {
      this.toast(`<b>Spotify</b> — ${esc(err.message)}`, { duration: 3000 });
    }
  }

  showResults(tracks, label) {
    this.lastResults = tracks;
    const box = this.root.querySelector('#sp-results');
    if (!box) return;
    box.innerHTML =
      `<div class="sp-results-label mono">${esc(label)}</div>` +
      (tracks.length
        ? tracks.map((t, i) => `
          <button class="track-row" data-i="${i}">
            ${t.artwork
              ? `<img class="track-art-thumb" src="${esc(t.artwork)}" alt="" loading="lazy"/>`
              : '<span class="track-art-thumb ph"></span>'}
            <span class="track-row-meta">
              <span class="track-row-name">${esc(t.name)}</span>
              <span class="track-row-artist mono">${esc(t.artists)}</span>
            </span>
            <span class="track-row-time mono">${fmtTime(t.durationMs / 1000)}</span>
          </button>`).join('')
        : '<div class="sp-empty mono">NO RESULTS</div>');
    box.querySelectorAll('.track-row').forEach((btn) =>
      btn.addEventListener('click', () => this.playTracks(this.lastResults, Number(btn.dataset.i))));
  }

  async playTracks(tracks, startIdx) {
    if (!this.deviceReady) {
      this.toast('<b>Player starting…</b> try again in a moment', { duration: 2200 });
      return;
    }
    const uris = tracks.slice(0, 50).map((t) => t.uri);
    const t = tracks[startIdx];
    try {
      await this.client.play(uris, { offset: { position: startIdx } });
    } catch (err) {
      try {
        await this.client.transferHere(false);
        await this.client.play(uris, { offset: { position: startIdx } });
      } catch (err2) {
        this.toast(`<b>Playback failed</b> — ${esc(err2.message || err.message)}`, { duration: 3400 });
        return;
      }
    }
    this.toast(`▶ <b>${esc(t.name)}</b>`, { duration: 1800 });
  }

  async playContext(uri, label) {
    if (!this.deviceReady) {
      this.toast('<b>Player starting…</b> try again in a moment', { duration: 2200 });
      return;
    }
    try {
      await this.client.play(uri);
      this.toast(`▶ Playlist <b>${esc(label)}</b>`, { duration: 2000 });
    } catch (err) {
      this.toast(`<b>Playback failed</b> — ${esc(err.message)}`, { duration: 3400 });
    }
  }

  /* ---------- state sync ---------- */

  syncChips() {
    const cap = this.root.querySelector('#chip-capture');
    if (cap) cap.classList.toggle('is-active', this.engine.captureActive);

    const dev = this.root.querySelector('#sp-dev');
    if (dev) {
      dev.textContent = this.deviceReady ? 'DEVICE LIVE' : 'DEVICE …';
      dev.classList.toggle('dot-ok', this.deviceReady);
    }
  }
}
