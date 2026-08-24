const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

export const SCOPES = [
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-top-read',
].join(' ');

const SESSION_KEY = 'audiovisor.spotify.session.v2';
const CLIENT_KEY = 'audiovisor.spotify.client.v1';
const LEGACY_KEY = 'audiovisor.spotify.v1';

/* ---------- PKCE helpers ---------- */

function b64url(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceVerifier(len = 96) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function redirectUri() {
  return window.location.origin + window.location.pathname;
}

export function parseRedirect(search) {
  const q = new URLSearchParams(search);
  const out = {
    code: q.get('code'),
    state: q.get('state'),
    error: q.get('error'),
  };
  if (!out.code && !out.error) return null;
  return out;
}

/* ---------- storage ---------- */

function localStore() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function sessionStore() {
  return typeof window !== 'undefined' ? window.sessionStorage : null;
}

function parseStore(storage, key) {
  try {
    return storage ? JSON.parse(storage.getItem(key)) || {} : {};
  } catch {
    return {};
  }
}

function loadStore() {
  return parseStore(sessionStore(), SESSION_KEY);
}

function saveStore(patch) {
  const storage = sessionStore();
  try { storage?.setItem(SESSION_KEY, JSON.stringify({ ...loadStore(), ...patch })); } catch {}
}

function clearStore() {
  try { sessionStore()?.removeItem(SESSION_KEY); } catch {}
}

function saveClientId(clientId) {
  try { localStore()?.setItem(CLIENT_KEY, clientId); } catch {}
}

function migrateLegacyStore() {
  const storage = localStore();
  if (!storage) return;
  try {
    const legacy = parseStore(storage, LEGACY_KEY);
    if (legacy.clientId) saveClientId(legacy.clientId);
    /* Remove access/refresh tokens written by versions before v2. */
    storage.removeItem(LEGACY_KEY);
  } catch {}
}

export function storedClientId() {
  try {
    return localStore()?.getItem(CLIENT_KEY)
      || (import.meta.env && import.meta.env.VITE_SPOTIFY_CLIENT_ID)
      || '';
  } catch {
    return (import.meta.env && import.meta.env.VITE_SPOTIFY_CLIENT_ID) || '';
  }
}

migrateLegacyStore();

/* ---------- client ---------- */

export class SpotifyClient {
  constructor() {
    this.player = null;
    this.deviceId = null;
    this.profile = null;
    this.premium = false;
    this.track = null;
    this.paused = true;
    this._pos = { at: 0, ms: 0 };
    this._artwork = new Map();
    this._auth = { accessToken: null, refreshToken: null, expiresAt: 0, clientId: storedClientId() };
    this.onAuthChange = null;
    this.onError = null;
    this.onTrackChange = null;
  }

  get authed() {
    return !!(this._auth.accessToken && this._auth.expiresAt > Date.now());
  }

  _emitAuth() {
    if (this.onAuthChange) this.onAuthChange(this.authed);
  }

  /* --- OAuth flow --- */

  async login(clientId) {
    if (!clientId) throw new Error('Missing Spotify Client ID');
    saveClientId(clientId);
    this._auth = { accessToken: null, refreshToken: null, expiresAt: 0, clientId };
    saveStore({ clientId });
    const verifier = await pkceVerifier();
    const challenge = await pkceChallenge(verifier);
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    saveStore({ verifier, state });
    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();
    window.location.assign(url.toString());
  }

  async handleRedirect() {
    const r = parseRedirect(window.location.search);
    if (!r) return false;
    history.replaceState(null, '', window.location.pathname);
    const s = loadStore();
    if (r.error) {
      if (this.onError) this.onError(r.error === 'access_denied' ? 'Spotify authorization denied' : `Spotify error: ${r.error}`);
      return true;
    }
    if (!r.code || !s.verifier || r.state !== s.state) return true;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: r.code,
      redirect_uri: redirectUri(),
      client_id: s.clientId,
      code_verifier: s.verifier,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      if (this.onError) this.onError('Spotify token exchange failed');
      return true;
    }
    const tok = await res.json();
    this._auth = {
      clientId: s.clientId || storedClientId(),
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || null,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    /* Keep only one-use PKCE state in session storage; auth tokens stay memory-only. */
    saveStore({ clientId: this._auth.clientId, verifier: null, state: null });
    this._emitAuth();
    return true;
  }

  logout() {
    try {
      const clientId = this._auth.clientId || loadStore().clientId || storedClientId();
      clearStore();
      if (clientId) saveClientId(clientId);
    } catch {}
    this._auth = { accessToken: null, refreshToken: null, expiresAt: 0, clientId: storedClientId() };
    if (this.player) {
      this.player.disconnect();
      this.player = null;
      this.deviceId = null;
    }
    this.profile = null;
    this.track = null;
    this._emitAuth();
  }

  async _refreshToken() {
    if (!this._auth.refreshToken) {
      this.logout();
      return null;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this._auth.refreshToken,
      client_id: this._auth.clientId || storedClientId(),
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      this.logout();
      return null;
    }
    const tok = await res.json();
    this._auth = {
      ...this._auth,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || this._auth.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    return tok.access_token;
  }

  async ensureToken() {
    if (this._auth.accessToken && this._auth.expiresAt - Date.now() > 30000) return this._auth.accessToken;
    return this._refreshToken();
  }

  async api(path, opts = {}) {
    let token = await this.ensureToken();
    if (!token) throw new Error('Not authenticated');
    const call = () =>
      fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {}),
        },
      });
    let res = await call();
    if (res.status === 401) {
      token = await this._refreshToken();
      if (!token) throw new Error('Session expired');
      res = await call();
    }
    if (res.status === 204) return null;
    if (!res.ok) {
      let msg = `Spotify API ${res.status}`;
      try {
        const j = await res.json();
        if (j.error?.message) msg = j.error.message;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  /* --- Web Playback SDK --- */

  _loadSdk() {
    if (window.Spotify) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Spotify SDK timed out')), 15000);
      window.onSpotifyWebPlaybackSDKReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Failed to load Spotify SDK'));
      };
      document.head.appendChild(s);
    });
  }

  async connectPlayer() {
    if (this.player) return this.deviceId;
    await this._loadSdk();

    return new Promise((resolve, reject) => {
      const player = new window.Spotify.Player({
        name: 'AUDIOVISOR',
        volume: 0.75,
        getOAuthToken: (cb) => this.ensureToken().then((t) => t && cb(t)),
      });

      player.addListener('ready', ({ device_id }) => {
        this.deviceId = device_id;
        resolve(device_id);
      });
      player.addListener('player_state_changed', (state) => {
        if (!state) return;
        this.paused = state.paused;
        this._pos = { at: Date.now(), ms: state.position };
        const tw = state.track_window?.current_track;
        if (tw) {
          const track = {
            id: tw.id,
            uri: tw.uri,
            name: tw.name,
            artists: tw.artists.map((a) => a.name).join(', '),
            durationMs: state.duration,
          };
          const changed = !this.track || this.track.uri !== track.uri;
          this.track = track;
          if (changed && this.onTrackChange) this.onTrackChange(track);
        }
      });
      const fail = (label) => ({ message }) => {
        const friendly =
          /authentication|premium/i.test(message)
            ? 'Spotify Premium is required for in-app playback'
            : `${label}: ${message}`;
        if (this.onError) this.onError(friendly);
        reject(new Error(friendly));
      };
      player.addListener('initialization_error', fail('Init failed'));
      player.addListener('authentication_error', fail('Auth failed'));
      player.addListener('account_error', fail('Account error'));
      player.addListener('playback_error', ({ message }) => {
        if (this.onError) this.onError(`Playback: ${message}`);
      });

      this.player = player;
      player.connect().catch(reject);
    });
  }

  getPositionMs() {
    if (this.paused) return this._pos.ms;
    return this._pos.ms + (Date.now() - this._pos.at);
  }

  async artworkFor(track) {
    if (!track?.id) return null;
    if (this._artwork.has(track.id)) return this._artwork.get(track.id);
    try {
      const t = await this.api(`/tracks/${track.id}`);
      const url = t.album?.images?.[0]?.url || null;
      this._artwork.set(track.id, url);
      return url;
    } catch {
      return null;
    }
  }

  /* --- profile & library --- */

  async loadProfile() {
    this.profile = await this.api('/me');
    this.premium = this.profile.product === 'premium';
    return this.profile;
  }

  searchTracks(q, limit = 8) {
    return this.api(`/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`).then(
      (r) => r.tracks?.items ?? []
    );
  }

  topTracks(limit = 10) {
    return this.api(`/me/top/tracks?limit=${limit}`).then((r) => r.items ?? []);
  }

  playlists(limit = 20) {
    return this.api(`/me/playlists?limit=${limit}`).then((r) => r.items ?? []);
  }

  mapTrack(t) {
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists || []).map((a) => a.name).join(', '),
      durationMs: t.duration_ms,
      artwork: t.album?.images?.[0]?.url || null,
    };
  }

  /* --- playback control --- */

  async transferHere(activate = true) {
    if (!this.deviceId) return;
    await this.api('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [this.deviceId], play: activate }),
    });
  }

  async play(urisOrContext, opts = {}) {
    if (!this.deviceId) throw new Error('Player not ready');
    const body = {};
    if (typeof urisOrContext === 'string') body.context_uri = urisOrContext;
    else body.uris = urisOrContext;
    if (opts.offset !== undefined) body.offset = opts.offset;
    await this.api(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async resume() {
    if (!this.deviceId) return;
    await this.api(`/me/player/play?device_id=${this.deviceId}`, { method: 'PUT' });
  }

  async pause() {
    if (!this.deviceId) return;
    await this.api(`/me/player/pause?device_id=${this.deviceId}`, { method: 'PUT' }).catch(() => {});
  }

  async next() {
    if (!this.deviceId) return;
    await this.api(`/me/player/next?device_id=${this.deviceId}`, { method: 'POST' });
  }

  async prev() {
    if (!this.deviceId) return;
    await this.api(`/me/player/previous?device_id=${this.deviceId}`, { method: 'POST' });
  }

  async seek(ms) {
    if (!this.deviceId) return;
    await this.api(`/me/player/seek?position_ms=${Math.round(ms)}&device_id=${this.deviceId}`, {
      method: 'PUT',
    });
    this._pos = { at: Date.now(), ms };
  }

  setVolume(v) {
    if (this.player) this.player.setVolume(Math.max(0, Math.min(1, v)));
  }
}
