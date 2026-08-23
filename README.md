# AUDIOVISOR

A hifi, real-time music visualizer for the browser. Drop in a track, stream a URL, capture any app's audio, or connect your Spotify account — the engine renders the frequency spectrum live across thirteen stage modes, thirteen theme moods, a full FX chain, tempo-locked beat tracking, session recording, and autopilot.

## Features

### Sources
- **Local files** — drag & drop or browse (MP3, WAV, FLAC, OGG, M4A…) with a playlist queue
- **Spotify Connect** — log in with PKCE OAuth, search your library, play tracks/playlists through the built-in Web Playback SDK player *(Premium required for playback)*
- **Tab / system capture** — visualize audio from *any* app: Spotify desktop, Apple Music, YouTube, anything playing on your machine (Chrome/Edge; share a tab with "share tab audio" enabled)
- **Direct URLs** — stream any `http(s)` audio link (radio, podcasts, direct MP3s)
- **Live mic input** — party mode; analysis-only (never routed to speakers, no feedback)

> **Note on streaming services:** DRM-protected streams (Spotify/Apple Music in-app playback) can't be tapped by the Web Audio API directly. When Spotify plays through the built-in player without capture, AUDIOVISOR drives the visuals with a procedural synth feed seeded from the track — hit **Capture** and share the current tab for true spectrum-reactive visuals of the actual audio.

### Stage
- **13 stage modes** — Spectrum Bars, Linear Wave, Vectorscope, Particle Field, Kaleidoscope, Spectrogram, Radial Tunnel, Plasma Rings, Aurora Terrain, Neon City, Nebula Clouds, Spiral Galaxy, Pulse Orb
- **13 themes** — Lime, Neon Cyber, Psychedelic, Hi-Fi Amber, Candy, Vaporwave, Ember, Arctic, Monolith, Sunset, Matrix, Ultraviolet, Warm Brass
- **Interpolated log spectra** — smoother, more accurate frequency mapping across every mode (bars, terrain, city, kaleido, tunnel, orb) with gravity-fall peak caps
- **Phosphor scope & wobble tunnel** — vectorscope with true persistence afterglow, radial tunnel with spectral wobble per ring, beat-synced stage punch + bloom
- **Bloom compositing** — two-pass downscale glow replaces per-element shadow blur
- **Delta-time animation** — identical motion at 60 Hz, 120 Hz, 144 Hz+
- **Adaptive quality** — auto-scales rendering (DPR, particle caps, bloom) to hold 60fps

### Engine
- Web Audio API: queue, seek, loop, volume, speed
- **Queue manager** — jump between tracks, remove, shuffle (`Q`)
- **Snapshot** — save the current frame as PNG (`P` or camera button)
- **Session recorder** — record visuals + master audio mix to WebM (record button)
- FX chain — Reverb (generated impulse), Limiter, Lowpass, Speed ×1.5
- Reactivity — sensitivity, bass focus, smoothing controls
- Beat tracking — tempo-locked spectral-flux detector with octave folding, beat-phase prediction & confidence gating; live BPM chip + bass-active indicator; stage punch + bloom react on every predicted beat
- Autopilot — cycles modes and themes every 12s
- MediaSession — OS media keys, lock-screen metadata & album art, seek-to

## Spotify setup

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Add this app's exact URL as a **Redirect URI** (shown in Settings → Connect → SETUP), e.g. `http://localhost:5173/` for dev or your deployed URL
3. Enable the **Web API** + **Web Playback SDK**
4. Paste your Client ID into Settings → Connect → Spotify and hit **Connect**

Optionally bake in a default Client ID at build time:

```bash
VITE_SPOTIFY_CLIENT_ID=your_client_id npm run build
```

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `←` `→` | Seek ±10s |
| `↑` `↓` | Volume ±5% |
| `M` | Cycle stage mode |
| `T` | Cycle theme |
| `R` | Random look (mode + theme) |
| `Q` | Queue manager |
| `P` | Snapshot PNG |
| `F` | Fullscreen |

## Dev

```bash
npm install
npm run dev
```

Requires Node 20.19+ / 22.12+ (Vite 8).

## Tests & lint

```bash
npm test        # vitest — engine, beat tracker, synth feed, PKCE, utils
npm run lint    # eslint
```

## Build

```bash
npm run build   # output in dist/
```
