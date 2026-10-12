import { setIcon } from './icons.js';
import { fmtTime, esc } from './utils.js';
import { AppleMusicClient } from './applemusic.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/* Developer setup for the Apple Music credentials. Rendered only on a
   developer site (see isDeveloperSite); a visitor to the live site never
   sees env var names, Vercel or the Apple Developer steps. */
const APPLE_SETUP_HTML = `<details class="sp-help">
          <summary class="mono">SETUP</summary>
          <ol>
            <li>Create a MusicKit key in your Apple Developer account</li>
            <li>Set <code>APPLE_MUSIC_TEAM_ID</code>, <code>APPLE_MUSIC_KEY_ID</code> and <code>APPLE_MUSIC_PRIVATE_KEY</code> in Vercel</li>
            <li>Redeploy, then connect here</li>
          </ol>
        </details>`;

/**
 * True on the Vite dev server or a local host. Read at render time, so the
 * answer follows the page actually being shown.
 * @param {{dev?: boolean, hostname?: string}} [env]
 */
export function isDeveloperSite({
  dev = !!import.meta.env?.DEV,
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
} = {}) {
  return dev || LOCAL_HOSTS.includes(hostname);
}


/**
 * Drawer "Connect" panel: the Apple Music (MusicKit) account link, system and
 * tab-audio capture, and direct audio URLs.
 */
export class ConnectPanel {
  /**
   * @param {HTMLElement} root       container for the panel
   * @param {object} deps
   * @param {import('./audio.js').AudioEngine} deps.engine
   * @param {(msg:string, opts?:object)=>void} deps.toast
   * @param {(info:object|null)=>void} [deps.onExternalTrack]
   * @param {() => boolean} [deps.isDeveloper] whether setup copy may show; defaults to isDeveloperSite()
  */
  constructor(root, { engine, toast, onExternalTrack, isDeveloper }) {
    this.root = root;
    this.engine = engine;
    this.toast = toast;
    this.onExternalTrack = onExternalTrack || (() => {});
    this.isDeveloper = isDeveloper || (() => isDeveloperSite());

    this.apple = new AppleMusicClient();
    this.currentTrack = null;

    this.apple.onAuthChange = () => this.render();
    this.apple.onTrackChange = (track) => {
      // a direct URL owns the output now; a late MusicKit event must not re-attach the Apple controller
      if (this.engine.mode === 'stream') return;
      if (!track) {
        if (this.currentTrack?.provider === 'apple') this.setCurrentTrack(null);
        return;
      }
      this.engine.setExternal(this.makeAppleController());
      this.setCurrentTrack({
        provider: 'apple',
        name: track.name,
        artists: track.artists,
        duration: track.durationMs / 1000,
        artwork: track.artwork,
        album: 'Apple Music',
        kind: 'APPLE MUSIC',
      });
    };

    this.render();
    this.wireEngineEvents();
  }

  setCurrentTrack(info) {
    this.currentTrack = info ? { ...info } : null;
    this.onExternalTrack(this.currentTrack);
  }

  /* ---------- boot ---------- */

  /** Call once at app start: restores the Apple Music session. */
  async boot() {
    try {
      await this.apple.boot();
    } catch (err) {
      /* Apple Music is optional. Keep the provider card visible with setup
         guidance instead of failing the rest of Connect boot. */
      if (this.apple.configured) console.warn('Apple Music unavailable:', err.message || err);
    }
    this.render();
  }

  makeAppleController() {
    const c = this.apple;
    return {
      kind: 'apple',
      seed: c.track?.id || 'apple-music',
      title: c.track?.name || '',
      isPlaying: () => c.isPlaying(),
      getTime: () => c.getPositionMs() / 1000,
      getDuration: () => c.getDurationMs() / 1000,
      play: () => c.play(),
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
    const appleAuthed = this.apple.authed;
    this.root.innerHTML = '';

    /* --- header: which accounts are live at a glance --- */
    const head = document.createElement('div');
    head.className = 'connect-head';
    head.innerHTML = `
      <span class="connect-head-title">Music accounts</span>
      <span class="connect-status mono">
        <span class="connect-dot ${appleAuthed ? 'is-on am' : ''}" title="Apple Music ${appleAuthed ? 'connected' : 'not connected'}"></span>
        ${appleAuthed ? 1 : 0}/1 LINKED
      </span>`;
    this.root.appendChild(head);

    /* --- apple music block --- */
    const am = document.createElement('div');
    am.className = `provider-block provider-card provider-apple${appleAuthed ? ' is-linked' : ''}`;
    const appleConfigured = this.apple.configured;
    if (!appleAuthed) {
      /* Not configured here means either the token endpoint refused this
         deployment (remembered for the page's life, so there is no Connect
         button that is guaranteed to fail) or this is a local build without
         credentials. The setup steps appear only on a developer site. */
      am.innerHTML = `
        <div class="sp-head">
          <span class="provider-logo" data-icon="music2"></span>
          <span class="sp-title">Apple Music</span>
          <span class="sp-badge mono">${appleConfigured ? 'NOT LINKED' : 'UNAVAILABLE'}</span>
        </div>
        ${appleConfigured
          ? `<p class="sp-note">Sign in with your Apple Music subscription. Playback stays in Apple's player.</p>
        <button class="provider-btn" id="am-connect">Connect Apple Music</button>`
          : `<p class="sp-note">Apple Music isn't available on this site yet.</p>
        <button class="provider-btn" id="am-connect" disabled>Connect Apple Music</button>
        ${this.isDeveloper() ? APPLE_SETUP_HTML : ''}`}`;
    } else {
      am.innerHTML = `
        <div class="sp-head">
          <span class="provider-logo" data-icon="music2"></span>
          <span class="sp-title">Apple Music</span>
          <span class="sp-badge mono is-on">LINKED</span>
          <button class="icon-x" id="am-disconnect" title="Disconnect Apple Music" aria-label="Disconnect Apple Music"><span class="ic ic-sm" data-icon="close"></span></button>
        </div>
        <div class="sp-search">
          <span class="ic ic-dim" data-icon="search"></span>
          <input type="search" class="connect-input bare mono" id="am-search-input"
                 placeholder="Search Apple Music…" spellcheck="false" aria-label="Search Apple Music" />
        </div>
        <div class="sp-actions">
          <select class="mini-select mono" id="am-playlists" aria-label="Apple Music playlists"><option value="">Playlists…</option></select>
        </div>
        <div class="sp-results" id="am-results"></div>
        <p class="sp-note">Apple Music plays here; visual modes do not analyze its protected stream.</p>`;
    }
    this.root.appendChild(am);
    am.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

    /* --- other sources --- */
    const label = document.createElement('div');
    label.className = 'connect-sub mono';
    label.textContent = 'OTHER SOURCES';
    this.root.appendChild(label);

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
             placeholder="https://… .mp3 / radio / podcast" spellcheck="false" aria-label="Audio URL" />
      <button class="mini-btn lime-btn-sm" id="url-play" title="Stream"><span class="ic ic-sm" data-icon="play"></span></button>`;
    this.root.appendChild(urlRow);
    setIcon(urlRow.querySelector('#url-play .ic'), 'play');

    this.bind(sources, urlRow);
    this.bindApple(am);
    this.syncChips();
  }

  bind(sources, urlRow) {
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
      this.releaseAppleTrack();
      this.engine.playUrl(url, { name }).then(() => {
        this.toast(`Streaming <b>${esc(name)}</b>`);
      }).catch((err) => {
        this.toast(`<b>Stream failed</b> — ${esc(err?.message || err)}`, { duration: 3400 });
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
  }

  bindApple(am) {
    const connect = am.querySelector('#am-connect');
    if (connect) {
      connect.addEventListener('click', async () => {
        connect.disabled = true;
        connect.textContent = 'Opening Apple Music…';
        try {
          await this.apple.login();
          this.toast('Apple Music <b>connected</b>', { duration: 1800 });
          this.render();
          this.loadApplePlaylists();
        } catch (err) {
          connect.disabled = false;
          connect.textContent = 'Connect Apple Music';
          this.appleToast(err, 3600);
          // a refusal from the token endpoint turns the card into its unavailable state
          if (!this.apple.configured) this.render();
        }
      });
      return;
    }

    am.querySelector('#am-disconnect')?.addEventListener('click', async () => {
      try { await this.apple.logout(); } catch (err) { console.warn(err); }
      if (this.engine.mode === 'apple') this.engine.setExternal(null);
      if (this.currentTrack?.provider === 'apple') this.setCurrentTrack(null);
      this.render();
      this.toast('Apple Music <b>disconnected</b>', { duration: 1600 });
    });

    const search = am.querySelector('#am-search-input');
    let appleTimer = null;
    search?.addEventListener('input', () => {
      clearTimeout(appleTimer);
      const q = search.value.trim();
      appleTimer = setTimeout(async () => {
        if (q.length < 2) return;
        try {
          const tracks = await this.apple.searchSongs(q, 8);
          this.showResults(tracks, `RESULTS — “${q}”`);
        } catch (err) {
          this.appleToast(err, 3000);
        }
      }, 380);
    });
    search?.addEventListener('keydown', (e) => e.stopPropagation());

    const playlists = am.querySelector('#am-playlists');
    if (!playlists) return;
    this.loadApplePlaylists(playlists);
    playlists.addEventListener('change', async () => {
      const id = playlists.value;
      if (!id) return;
      try {
        await this.apple.playPlaylist(id);
        this.engine.setExternal(this.makeAppleController());
        this.toast(`▶ Apple playlist <b>${esc(playlists.selectedOptions[0].textContent)}</b>`, { duration: 2200 });
      } catch (err) {
        this.appleToast(err, 3400);
      }
    });
  }

  showResults(tracks, label) {
    const box = this.root.querySelector('#am-results');
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
      btn.addEventListener('click', () => this.playAppleTracks(tracks, Number(btn.dataset.i))));
  }

  async playAppleTracks(tracks, startIdx) {
    const t = tracks[startIdx];
    try {
      await this.apple.playSongs(tracks.map((x) => x.id), startIdx);
      this.engine.setExternal(this.makeAppleController());
      this.toast(`▶ <b>${esc(t.name)}</b>`, { duration: 1800 });
    } catch (err) {
      this.appleToast(err, 3400);
    }
  }

  async loadApplePlaylists(select = this.root.querySelector('#am-playlists')) {
    if (!select) return;
    select.disabled = true;
    try {
      const playlists = await this.apple.playlists();
      select.innerHTML = '<option value="">Playlists…</option>';
      for (const playlist of playlists) {
        const option = document.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.trackCount
          ? `${playlist.name} · ${playlist.trackCount}`
          : playlist.name;
        select.appendChild(option);
      }
      if (!playlists.length) select.innerHTML = '<option value="">No playlists found</option>';
    } catch (err) {
      select.innerHTML = '<option value="">Could not load playlists</option>';
      if (this.apple.authed) this.appleToast(err, 3200);
    } finally {
      select.disabled = false;
    }
  }

  /**
   * Toast for a failed Apple Music action. Once the deployment has refused the
   * token, the server's wording is replaced with the card's own line.
   */
  appleToast(err, duration) {
    const msg = this.apple.unavailable
      ? "<b>Apple Music</b> isn't available on this site yet"
      : `<b>Apple Music</b> — ${esc(err?.message || err)}`;
    this.toast(msg, { duration });
  }

  /**
   * A direct URL is taking the output. Detach the Apple controller now (not
   * when the stream resolves) and pause MusicKit, so a stream that fails
   * leaves no Apple track shown as current.
   */
  releaseAppleTrack() {
    if (this.currentTrack?.provider === 'apple') {
      void Promise.resolve().then(() => this.apple.pause?.()).catch(() => {});
    }
    this.setCurrentTrack(null);
  }

  /* ---------- state sync ---------- */

  syncChips() {
    const cap = this.root.querySelector('#chip-capture');
    if (cap) cap.classList.toggle('is-active', this.engine.captureActive);
  }
}
