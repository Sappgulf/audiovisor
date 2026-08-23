# AUDIOVISOR — v4 Pro Pack

A hifi, real-time music visualizer for the browser. Drop in a track, stream a URL, capture any app's audio, or connect your Spotify account — the engine renders the frequency spectrum live across eighteen stage modes, sixteen themes, a full FX chain (now with Chop N Screwed), tempo-locked beat tracking, a persistent Library with remix saves, true cinema fullscreen, session recording, and autopilot.

## Features

### Sources
- **Local files** — drag & drop or browse (MP3, WAV, FLAC, OGG, M4A…) with a playlist queue
- **Spotify Connect** — log in with PKCE OAuth, search your library, play tracks/playlists through the built-in Web Playback SDK player *(Premium required for playback)*
- **Tab / system capture** — visualize audio from *any* app: Spotify desktop, Apple Music, YouTube, anything playing on your machine (Chrome/Edge; share a tab with "share tab audio" enabled)
- **Direct URLs** — stream any `http(s)` audio link (radio, podcasts, direct MP3s)
- **Live mic input** — party mode; analysis-only (never routed to speakers, no feedback)

> **Note on streaming services:** DRM-protected streams (Spotify/Apple Music in-app playback) can't be tapped by the Web Audio API directly. When Spotify plays through the built-in player without capture, AUDIOVISOR drives the visuals with a procedural synth feed seeded from the track — hit **Capture** and share the current tab for true spectrum-reactive visuals of the actual audio.

### Stage
- **18 stage modes** — Spectrum Bars, Linear Wave, Vectorscope, Particle Field, Kaleidoscope, Spectrogram, Radial Tunnel, Plasma Rings, Aurora Terrain, Neon City, Nebula Clouds, Spiral Galaxy, Pulse Orb, Fluid Metal, Tensor Grid, Prism Ray, Void Core, Bloom Field
- **16 themes** — Lime, Neon Cyber, Psychedelic, Hi-Fi Amber, Candy, Vaporwave, Ember, Arctic, Monolith, Sunset, Matrix, Ultraviolet, Warm Brass, AutoTune Pop, Laser Tag, Chop N Screwed
- **Interpolated log spectra** — smoother, more accurate frequency mapping across every mode (bars, terrain, city, kaleido, tunnel, orb) with gravity-fall peak caps
- **Phosphor scope & wobble tunnel** — vectorscope with true persistence afterglow, radial tunnel with spectral wobble per ring, beat-synced stage punch + bloom
- **Bloom compositing** — two-pass downscale glow replaces per-element shadow blur
- **Delta-time animation** — identical motion at 60 Hz, 120 Hz, 144 Hz+
- **Adaptive quality** — auto-scales rendering (DPR, particle caps, bloom) to hold 60fps

### Engine & AI
- **Auto DJ** — beat-matched crossfade (aligns BPM phase, 4s gain swoop) 6s before track end
- **5-band Parametric EQ** — 60/250/1K/4K/12K ±10dB with live curve
- **Genre/Mood detector** — tempo + spectral centroid → Ambient/Lo-Fi/House/EDM/Trap/Drill/DnB tag chip
- **Procedural album art** — deterministic cover per track (arcs + diamond + grain)
- **Onboarding tour** — first-run hint chain, replayable
- **Wake lock** — screen stays on during playback
- **Settings export/import** — full JSON share (mode/theme/FX/EQ/vol/loop/DJ)
- **WebGL2 fallback** — ray-marched void core when WebGPU unavailable

### AI & Social
- **Voice AI** — hum or sing into the mic, pitch-detected via autocorrelation → MIDI → saw synth
- **WebGPU 3D** — ray-marched void core (torus + glow) when WebGPU available, fallback to canvas
- **Social Feed** — local discover feed, post mixes, like, share via `#share` hash
- **Live Party** — QR + BroadcastChannel sync as light grid

### Engine
- Web Audio API: queue, seek, loop, volume, speed
- **Library** — save any track *with* its edits as a remix (IndexedDB), re-load, or export as WAV via OfflineAudioContext (`L`)
- **AI Remix Studio** — stem split (vocals/drums/bass) + 5 AI presets with one-click FX/theme, plus AI Suggest
- **Collab & Share** — copy share link (mode/theme/FX in hash), comments + likes (local + BroadcastChannel)
- **Live Party** — QR to join, crowd phones sync via BroadcastChannel as light grid
- **Queue manager** — jump between tracks, remove, shuffle (`Q`)
- **Snapshot** — save the current frame as PNG (`P` or camera button)
- **Session recorder** — record visuals + master audio mix to WebM (record button)
- FX chain — Reverb (generated impulse), Limiter, Lowpass, Speed ×1.5, AutoTune (peaking 1.1kHz), Chorus (28ms + feedback), Echo (340ms), Crush (wave-shaper), **Chop N Screwed** (0.66× + 900Hz lowpass + 420ms stutter gate)
- Reactivity & Color — sensitivity, bass focus, smoothing, Color Pop, Bloom — plus Chop visual stutter (VHS slice) synced to 420ms gate
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
| `L` | Library |
| `F` | True fullscreen (cinema — chrome auto-hides) |
| `C` | Chop N Screwed |

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
