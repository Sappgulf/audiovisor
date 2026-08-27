const MUSIC_KIT_SCRIPT = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const MUSIC_KIT_TIMEOUT = 15000;

function buildDeveloperToken() {
  return String(import.meta.env?.VITE_APPLE_MUSIC_DEVELOPER_TOKEN || '').trim();
}

/* A deployment without Apple Music credentials answers 501, and no amount of
   retrying will change that. Remembered so the request is not repeated on
   every Source-tab visit, sign-in attempt and playlist action — each of
   which called through here, and on a phone each is a wasted round trip
   over cellular. A 503 or a network error stays retryable. */
let tokenUnavailable = null;

export async function developerToken() {
  const builtToken = buildDeveloperToken();
  if (builtToken) return builtToken;
  if (typeof window === 'undefined') return '';
  if (tokenUnavailable) throw new Error(tokenUnavailable);

  const response = await fetch('/api/apple-music-token', {
    headers: { Accept: 'application/json' },
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok || !body.token) {
    const message = body.error || 'Apple Music token service is not configured';
    // 501 and 4xx describe this deployment, not a passing failure
    if (response.status === 501 || (response.status >= 400 && response.status < 500)) {
      tokenUnavailable = message;
    }
    throw new Error(message);
  }
  return String(body.token);
}

/** Test seam: forget a remembered failure. */
export function _resetTokenCache() {
  tokenUnavailable = null;
}

function loadMusicKit() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Apple Music requires a browser'));
  if (window.MusicKit) return Promise.resolve(window.MusicKit);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Apple MusicKit timed out')), MUSIC_KIT_TIMEOUT);
    const ready = () => {
      clearTimeout(timer);
      window.removeEventListener('musickitloaded', ready);
      if (window.MusicKit) resolve(window.MusicKit);
      else reject(new Error('Apple MusicKit did not load'));
    };
    window.addEventListener('musickitloaded', ready, { once: true });

    /* The script is also present in index.html for the normal app boot. This
       fallback keeps the client usable when the module is loaded in isolation
       or a host page omitted the script tag. */
    if (!document.querySelector(`script[src="${MUSIC_KIT_SCRIPT}"]`)) {
      const script = document.createElement('script');
      script.src = MUSIC_KIT_SCRIPT;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Failed to load Apple MusicKit'));
      };
      document.head.appendChild(script);
    }
  });
}

function responseItems(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

export function appleArtworkUrl(artwork, size = 240) {
  const url = artwork?.url;
  if (!url) return null;
  return url.replace('{w}', String(size)).replace('{h}', String(size));
}

export function mapAppleTrack(item) {
  const attrs = item?.attributes || {};
  return {
    id: item?.id || attrs.playParams?.id || '',
    uri: attrs.playParams?.id || item?.id || '',
    name: attrs.name || 'Untitled',
    artists: attrs.artistName || 'Unknown artist',
    durationMs: Number(attrs.durationInMillis) || 0,
    artwork: appleArtworkUrl(attrs.artwork),
  };
}

export function mapApplePlaylist(item) {
  const attrs = item?.attributes || {};
  return {
    id: item?.id || '',
    name: attrs.name || 'Untitled playlist',
    description: attrs.description?.standard || '',
    trackCount: Number(attrs.trackCount) || 0,
  };
}

/**
 * Apple Music account and library bridge.
 *
 * MusicKit owns the user authorization and music user token. AUDIOVISOR only
 * keeps the configured developer token in the build and asks MusicKit for
 * playlist data/playback at runtime.
 */
export class AppleMusicClient {
  constructor() {
    this.music = null;
    this.track = null;
    this.onAuthChange = null;
    this.onTrackChange = null;
    this._eventsBound = false;
    this._configurePromise = null;
  }

  get configured() {
    if (buildDeveloperToken()) return true;
    if (typeof window === 'undefined') return false;
    return !['localhost', '127.0.0.1'].includes(window.location.hostname);
  }

  get authed() {
    return !!this.music?.isAuthorized;
  }

  async configure() {
    if (!this.configured) {
      throw new Error('Apple Music is not configured for this local app');
    }
    if (this.music) return this.music;
    if (!this._configurePromise) {
      this._configurePromise = developerToken().then((token) => loadMusicKit().then(async (MusicKit) => {
        await MusicKit.configure({
          developerToken: token,
          app: { name: 'AUDIOVISOR', build: '8.12.1' },
        });
        this.music = MusicKit.getInstance();
        this._bindEvents();
        return this.music;
      })).catch((err) => {
        this._configurePromise = null;
        throw err;
      });
    }
    return this._configurePromise;
  }

  async boot() {
    if (!this.configured) return false;
    try {
      await this.configure();
      /* MusicKit can retain its user token outside this page. Require a fresh
         provider sign-in each new app load so shared devices do not inherit an
         earlier user's Apple Music account. */
      if (this.authed && this.music?.unauthorize) await this.music.unauthorize();
    } catch {
      /* The card remains usable; login surfaces the actionable config error. */
    }
    this.track = null;
    return false;
  }

  _bindEvents() {
    if (this._eventsBound || !this.music?.addEventListener) return;
    this._eventsBound = true;
    for (const event of ['nowPlayingItemDidChange', 'playbackStateDidChange']) {
      this.music.addEventListener(event, () => this.syncTrack());
    }
  }

  syncTrack() {
    const next = this.music?.nowPlayingItem ? mapAppleTrack(this.music.nowPlayingItem) : null;
    const changed = next?.id !== this.track?.id;
    this.track = next;
    if (changed && this.onTrackChange) this.onTrackChange(next);
  }

  async login() {
    await this.configure();
    if (this.authed && this.music?.unauthorize) await this.music.unauthorize();
    await this.music.authorize();
    this.syncTrack();
    if (this.onAuthChange) this.onAuthChange(true);
    return this.authed;
  }

  async logout() {
    if (this.music?.unauthorize) await this.music.unauthorize();
    this.track = null;
    if (this.onTrackChange) this.onTrackChange(null);
    if (this.onAuthChange) this.onAuthChange(false);
  }

  async playlists(limit = 100) {
    await this.configure();
    const response = await this.music.api.library.playlists({ limit, offset: 0 });
    return responseItems(response).map(mapApplePlaylist);
  }

  async playPlaylist(id) {
    if (!id) throw new Error('Choose an Apple Music playlist');
    await this.configure();
    if (!this.authed) throw new Error('Apple Music is not connected');
    await this.music.setQueue({ playlist: id });
    await this.music.play();
    this.syncTrack();
  }

  isPlaying() {
    if (!this.music) return false;
    if (typeof this.music.isPlaying === 'boolean') return this.music.isPlaying;
    return this.music.playbackState === 'playing' || this.music.playbackState === 2;
  }

  getPositionMs() {
    return (Number(this.music?.currentPlaybackTime) || 0) * 1000;
  }

  getDurationMs() {
    return (Number(this.music?.currentPlaybackDuration) || this.track?.durationMs / 1000 || 0) * 1000;
  }

  play() { return this.music?.play(); }
  pause() { return this.music?.pause(); }
  seek(ms) { return this.music?.seekToTime(Math.max(0, ms / 1000)); }
  next() { return this.music?.skipToNextItem(); }
  prev() { return this.music?.skipToPreviousItem(); }
  setVolume(value) {
    if (this.music) this.music.volume = Math.max(0, Math.min(1, value));
  }
}
