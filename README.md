# AUDIOVISOR — v8.12.1

A hifi, real-time music visualizer for the browser. Drop in a track, stream a URL, capture any app's audio, or connect Spotify / Apple Music — the engine renders the frequency spectrum live across twenty-three stage modes, twenty-five themes, a full FX chain (now with Chop N Screwed), tempo-locked beat tracking, a persistent Library with remix saves, true cinema fullscreen, session recording, and autopilot.

## Features

### Sources
- **Local files** — drag & drop, the **Add** control in the transport, or **Browse files** on the stage (MP3, WAV, FLAC, OGG, M4A…); multi-select builds a playlist queue
- **Spotify Connect** — log in with PKCE OAuth, search your library, play tracks/playlists through the built-in Web Playback SDK player *(Premium required for playback)*
- **Apple Music** — authorize with MusicKit on the Web, browse personal playlists, and start playback in Apple Music's protected player *(Apple Music subscription required for playback)*
- **Tab / system capture** — visualize audio from *any* app: Spotify desktop, Apple Music, YouTube, anything playing on your machine (Chrome/Edge; share a tab with "share tab audio" enabled)
- **Direct URLs** — stream any `http(s)` audio link (radio, podcasts, direct MP3s)
- **Live mic input** — party mode; analysis-only (never routed to speakers, no feedback)

> **Note on streaming services:** DRM-protected streams (Spotify/Apple Music in-app playback) can't be tapped by the Web Audio API directly. When Spotify plays through the built-in player without capture, AUDIOVISOR drives the visuals with a procedural synth feed seeded from the track — hit **Capture** and share the current tab for true spectrum-reactive visuals of the actual audio.

### Raytraced stage (v8.8)
Every one of the 23 stage modes is now a **live raytraced scene** rendered on a WebGL2 ray-marcher — the Canvas2D engine remains as a fallback and can be toggled back on at any time (Look tab → **Raytrace**).

- **Path** — per-frame: SDF/volumetric ray march into a linear HDR buffer → temporal accumulation with neighbourhood clamping → bright-pass + separable gaussian bloom at quarter res → ACES tonemap with chromatic aberration, vignette and grain
- **Shading** — Cook-Torrance GGX with metallic/roughness materials, penumbra soft shadows, 4-tap AO, one reflection bounce for polished metals, and a theme-tinted procedural environment used as both key light and reflection probe
- **Glass** — true two-interface refraction (into the solid, march to the far wall, refract back out); Prism Ray splits R/G/B at 1.38/1.45/1.53 for real dispersion
- **Depth of field** — thin-lens camera with a per-sample golden-angle lens jitter; Bloom Field is built around it
- **Audio → geometry** — spectrum and waveform ride into the shader as textures, plus a 256×128 rolling spectrum history that drives the Spectrogram terrace and Aurora Terrain ridges
- **Frame budget** — audio scratch buffers are reused rather than reallocated per frame, the spectrum history scrolls on a fixed 45 rows/sec clock (so a 144Hz display doesn't run the waterfall at 2.4x speed), the temporal pass is skipped when there's nothing to blend, and an idle stage renders at half rate. Static uniforms (mode/tier/palette/sampler assignments) upload once per look change behind a revision counter instead of twenty dead calls every frame; the two quarter-res bloom passes are skipped entirely when Bloom is zeroed; and the spectrum/history textures fill from baked bin-index tables rather than recomputing `pow()` per texel per row
- **Treble wired in** — the spectrogram terrace's freshest row and the terrain crest line answer the high band (hats light the waterfall's front lip), and nebula/spiral volumes shape their density with mids and highs, so those scenes respond to the whole mix instead of only bass-and-level
- **Accumulation safety** — a width-only resize invalidates the temporal history exactly like a mode/tier change (a stale-height key let one frame resample an old-size buffer)
- **v8.12 scene rebuilds** — Beat Radar is a listening post now: a ribbed lattice dome with latitude hoops, a bass-breathing centre mast, and spectrum-banded contacts that flare the instant the phosphor sweep crosses their azimuth (phase-locked to the deck's wedge — locked by test); GPU Core grew corner pylons, band-swollen voxels under a hard cap (uncapped swell funneled rays into cell gaps at 5× the march cost) and an orbiting data node tapped outside the marching loop; Tensor Grid couples each rod axis to a band — bass thickens one family, mids another, highs the third, so the lattice leans with the mix; Prism Ray gained a gently orbiting camera so beam/prism/fan parallax actually reads; nebula/spiral/lava volumes all answer the drop envelope
- **Tier baseline recovery** — one lucky frame used to pin the adaptive sampler's session-best interval below anything the display could achieve again, grinding tiers down against an unreachable floor; a per-window relaxation (`relaxBaseline`) drifts a stale estimate back toward present reality within seconds while genuinely-fast frames hold the floor down
- **Quality tiers** — Low / Medium / High / Ultra (resolution scale, march steps, samples per pixel, reflection bounce), cycled from the Look tab and auto-stepped down when frames run long
- **Themes** — all 25 palettes feed the shader in linear space, so every scene re-lights with the theme
- **Numerically safe** — `atan(0,0)`, negative `pow()` bases and unbounded specular all produce NaN or saturated plateaus on flat mirror-like surfaces; every site is guarded and each sample is NaN-scrubbed before accumulation
- **Resilient** — a lost GPU context (driver reset, sleep, another tab hogging the GPU) drops the stage to Canvas2D with a toast, and a watchdog rebuilds the renderer and resumes raytracing when the context comes back; the on/off preference records what you asked for, not what the GPU happened to support at boot

### Stage
- **23 stage modes** — Spectrum Bars, Linear Wave, Vectorscope, Particle Field, Kaleidoscope, Spectrogram, Radial Tunnel, Plasma Rings, Aurora Terrain, Neon City, Nebula Clouds, Spiral Galaxy, Pulse Orb, Fluid Metal, Tensor Grid, Prism Ray, Void Core, Bloom Field, Fractal Bloom, Beat Radar (beat-dropped contacts + spectrum blips), Lava Lamp (bass-heated metaball drift), GPU Core (rotating voxel compute stack), Vinyl Groove (spectrum-burned turntable)
- **25 themes** — Lime, Neon Cyber, Psychedelic, Hi-Fi Amber, Candy, Vaporwave, Ember, Arctic, Monolith, Sunset, Matrix, Ultraviolet, Warm Brass, AutoTune Pop, Laser Tag, Chop N Screwed, Jade, Crimson Silk, Desert Mirage, Ocean Depth, Fractal Dawn, Solar Flare, Toxic Sludge, Cotton Candy, Midnight Ink
- **Look presets** — right-click P1–P3 to save mode+theme+FX, click to recall (also in Cmd+K palette)
- **Memory-bounded queue** — decoded audio is uncompressed (~100MB per 5-minute stereo track), so buffers beyond ~1500s are released while the queue entry keeps its name, position and File handle; the track decodes again the moment you select it
- **Sleep timer** — 15/30/60 min countdown with volume fade-out and pause
- **Interpolated log spectra** — smoother, more accurate frequency mapping across every mode (bars, terrain, city, kaleido, tunnel, orb) with gravity-fall peak caps
- **Honest loudness** — the level read averages only the content window (up to ~16kHz): the bins above carry nothing musical and were diluting measured loudness by up to a third, while the high band now reaches past 8kHz so cymbal air drives `uHigh` instead of vanishing
- **Latency that degrades gracefully** — Bluetooth chains reporting over 0.5s of output latency get their estimate clamped to the ceiling; the old behavior silently dropped compensation entirely and fired the beat grid half a second early on every beat
- **Phosphor scope & wobble tunnel** — vectorscope with true persistence afterglow, radial tunnel with spectral wobble per ring, beat-synced stage punch + bloom
- **Bloom compositing** — two-pass downscale glow replaces per-element shadow blur
- **Post-FX stack** — atmosphere backdrop (drifting theme glows), cinematic vignette, tiled film grain, longer phosphor trails, layered silk depth in waves
- **Mode rebuilds** — Tensor Grid perspective wireframe (always-on node lattice + beat shockwaves), Prism dispersion (interior glow, gradient fan, beat glints), Fluid Metal metaball membrane + precessing orbit ring
- **Beat-reactive chrome** — logo and BPM chip pulse with the live beat via a `--beat` CSS variable
- **Look-change transitions** — zoom + saturate pulse and light flash whenever mode or theme switches
- **Live VU meter** — bass/mid/high bars with peak-hold caps in the transport, colored by theme
- **Theme-reactive favicon** — browser tab icon regenerates from the active theme palette
- **v8.5 upgrades** — GPU Core fully live (missing dispatch fixed): rotating 4×4×4 voxel compute stack, depth-slice energy colors + hot top faces, orbiting data nodes with bus lines; Nebula rebuilt (tilted galactic disc, line-swept filaments, hot star cores, 34-drifter starfield); Bloom Field rebuilt (soft bokeh pools + crisp cores, poppers on loud cells); Prism rebuilt (glass-slab volume, echo face, glint on entry, arced spectrum fan); spectro contrast pass (steep 2.8γ LUT — quiet audio stays black, peaks burn white)
- **v8.6 quality sweep** — beat-crash fixes: bloom/trail/kickflare retuned (no more white fallout when the kick hits), fluid/tensor/kaleido/gpu per-mode alpha caps so every mode keeps structure at max beat; Beat Radar rebuilt (fading sweep wedge, tick-gratted bezel, rotating crosshair); Terrain (parallax drift ridge, beat-lit front ridgeline + peak glints, 3-stop sky wash, brighter aurora band)
- **v8.10 polish** — every mode icon is unique (Fractal Bloom, GPU Core got their own marks); the lava lamp's wax carries its own gain so the lamp reads as lit; the render loop is allocation-free (signature strings and per-frame level objects replaced with field compares and per-renderer scratch); mode thumbnails animate on hover (10-frame sprite strips, fetched only on first hover); the brand mark is an equalizer cut into the diamond across icons, favicon and the og card, which is now a real raytraced frame rendered by `npm run og`
- **Delta-time animation** — identical motion at 60 Hz, 120 Hz, 144 Hz+
- **Adaptive quality** — auto-scales rendering (DPR, particle caps, bloom) to hold 60fps

### Engine & AI
- **Quick keys** — `1-9` jump instantly to stage modes; `M`/`T`/`R` all still cycle/randomize
- **Phosphor trails** — faded accumulation buffer under every mode (destination-out 0.28, 0.36 lighter blend) = milkdrop look
- **Kick flare** — soft lens-flare core + horizontal streak replaces full-screen flash
- **Bars bounce** — beat stretches bar heights 34% (weighted low-end), default theme now Warm Brass to match UI
- **v7.3 rehaul** — every mode rebuilt distinct: Spectrum Glass bars (gradient slabs + halo + hue flow), Silk Horizon waves (silk band + crest beads), Azure Vectorscope (ticked ring frame + colored segments + glow pass), Ember Field particles, Crystal Mirror kaleidoscope (burst + bass spines), Matrix Waterfall spectrogram (scanline sweep), Hyperspace tunnel (3D tilt rings + vortex rays), Aurora plasma, Sunset terrain (meteors), Neon City dusk (beacon shafts), Nebula deep field, Spiral galaxy (dust motes), Pulse Orb (shockwaves), Liquid Metal fluid, Tensor grid (beat nodes), Prism Ray (glitter), Black Hole void, Bloom Field mesh
- **Per-mode upgrades** — waves underfill glow shadow; plasma beat star-cross + center halo; terrain shooting-star meteors on kick; kaleido petal burst; orb beat shockwave rings; tensor beat-lit nodes; fluid beat ripples; city beacon light shafts; spiral dust motes; bloomfield mesh lines
- **Mode polish** — bars backdrop glow, terrain stars + dual aurora washes, nebula stardust (22 drifters), city aurora ribbons, beat punch 1.8%
- **Beat-grid visuals** — 4 phase dots + pulse ring bottom-center on every non-bars mode; vertical beat lines sliding across bars when BPM locks
- **Theme-reactive art** — procedural cover regenerates on theme change, breathes while playing (3.2s)
- **Waveform seek preview** — peak-rendered waveform under the seek bar (240 buckets), translucent played fill + bright playhead
- **Decode resilience** — per-file decode with callback fallback, corrupt files skipped not fatal
- **Fine controls** — Shift+←/→ seeks ±3s, mouse wheel on stage adjusts volume
- **Auto DJ** — beat-matched crossfade (aligns BPM phase, 4s gain swoop) 6s before track end
- **5-band Parametric EQ** — 60/250/1K/4K/12K ±10dB with live curve
- **Genre/Mood detector** — tempo + spectral centroid → Ambient/Lo-Fi/House/EDM/Trap/Drill/DnB tag chip
- **Procedural album art** — deterministic cover per track (arcs + diamond + grain)
- **Tabbed settings drawer** — Source / Look / Audio / Studio tabs (animated ink underline, arrow-key navigation, remembered between sessions) replace the single endless-scroll panel; every section now fits on one screen
- **Mode filter** — type to narrow the 23 stage modes, Enter selects the first match, Esc clears
- **Keyboard shortcuts overlay** — press `?` (or the topbar key icon) for the full grouped shortcut sheet; also in the Cmd+K palette along with direct tab jumps
- **Focus rings + live-region toasts** — visible keyboard focus across all controls, toasts announced to screen readers
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
- **Share card** — `P` (or the camera button) composites the live stage into a 1200×675 branded card: cover-fit frame behind scrims, the equalizer mark, wordmark, track title, and mode + theme chips
- **Session recorder** — record visuals + master audio mix to WebM (record button)
- FX chain — Reverb (generated impulse), Limiter, Lowpass, Speed ×1.5, AutoTune (peaking 1.1kHz), Chorus (28ms + feedback), Echo (340ms), Crush (wave-shaper), **Chop N Screwed** (0.66× + 900Hz lowpass + 420ms stutter gate)
- Reactivity & Color — sensitivity, bass focus, smoothing, Color Pop, Bloom — plus Chop visual stutter (VHS slice) synced to 420ms gate
- Beat tracking — tempo-locked spectral-flux detector with octave folding, beat-phase prediction & confidence gating; live BPM chip + bass-active indicator; stage punch + bloom react on every predicted beat
- **Drop choreography** — a breakdown→slam detector (`src/drop.js`) running on the audio clock: sustained quiet arms it, the energy's return fires it. The envelope drives up to 45% slow-mo, a camera punch-in and a bloom/exposure surge on both renderers (scaled by `prefers-reduced-motion`)
- **True-stereo scope** — a channel splitter taps L/R into their own analysers: the Canvas2D vectorscope plots a real goniometer (mono collapses to a vertical line, width reads as spread) and the raytraced scope's glass tube shears with the L−R difference
- **Auto theme** — the Auto swatch leads the theme row: `src/artpalette.js` extracts a palette from the track's cover art (Spotify/Apple Music artwork; artless local files hash the track name onto a stable built-in palette). The transport card also echoes the cover's two lead colours
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

## Apple Music setup

1. Create a MusicKit on the Web key in [Apple Developer](https://developer.apple.com/account/resources/authkeys/list)
2. Add these values to Vercel Project Settings → Environment Variables:

```bash
APPLE_MUSIC_TEAM_ID=your_team_id
APPLE_MUSIC_KEY_ID=your_key_id
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----"
APPLE_MUSIC_ORIGIN=https://your-domain.example
```

The signing private key stays server-side in the Vercel function. The browser receives only a short-lived signed developer token from `/api/apple-music-token`.

For local-only testing, you can instead copy `.env.example` to `.env.local` and set:

```bash
VITE_APPLE_MUSIC_DEVELOPER_TOKEN=your_signed_developer_token
```

3. Redeploy, then open Settings → Source → Apple Music → **Connect Apple Music**

Guest mode supports local files, URLs, microphone, and capture without an account. Spotify and Apple Music playlist access requires the user's own provider account. Playlist playback stays inside the provider player; use **Capture** and share the current tab when you want the actual protected audio spectrum instead of AUDIOVISOR's synth fallback. Disconnect before handing a shared device to another person.

## Mobile

Touch is a first-class input, not a fallback:

- **Scrub and set volume by dragging** — both tracks run on Pointer Events
  with pointer capture, so a drag survives the finger sliding off a 16px
  bar. They are real sliders, so arrow keys, Home and End work too.
- **Drag the settings sheet down to dismiss it**, or tap the scrim. A flick
  or real travel closes it; a small slow drag snaps back.
- **Double-tap the stage** for cinema mode.
- **Safe areas** are respected in both orientations, including a landscape
  notch on the left or right edge.
- **Installs to a home screen** with proper PNG icons, a maskable variant
  for Android, and the iOS meta tags that the manifest alone does not cover.

Layout tiers: <=360px (narrow phones), <=640px (phones), phone landscape
keyed on viewport height, 641-1179px (tablet through narrow desktop), and
1180px+ where the transport fits on one row.

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
| `P` | Share card (PNG) |
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
npm test        # vitest — engine, beat tracker, synth feed, PKCE, utils,
                #          settings schema, palette, per-mode stage render,
                #          pointer drags, sheet gestures, PWA/responsive contract
npm run lint    # eslint
npm run size    # bundle budget (needs a build first)
npm run shots    # render every stage mode (Canvas2D) to /tmp/audiovisor-shots
npm run analyze  # exposure report per mode: mean luminance, clipping, saturation
npm run rayshots # the same pass for the raytraced stage — real GPU headless
                 #   Chromium via window.__av.pump(); writes one PNG per mode
                 #   plus a labelled contact sheet to /tmp/audiovisor-ray
npm run icons   # regenerate the PWA / home-screen icons
npm run thumbs  # regenerate the stage-mode thumbnails in public/modes/
```

`npm run thumbs` renders each mode to `public/modes/<id>.webp` for the stage
picker, which used to be 22 near-identical tiles distinguished only by a
small line icon — two of which were reused across different modes — for a
choice that is entirely visual. They are deliberately monochrome: colour
here belongs to the theme, so a thumbnail baked in one of the twenty-five
would be wrong in the other twenty-four, and form is what tells the modes
apart anyway.

They are committed artifacts, so **re-run it after changing how a mode
looks** — nothing detects a stale thumbnail automatically, since that would
mean re-rendering all 23 on every test run. `tests/mode-thumbs.test.js`
covers the failures that can be caught cheaply: a mode with no thumbnail, a
thumbnail left behind by a removed mode, and files that are empty or large
enough to hurt the mobile sheet's first paint.

`tests/stage-render.test.js` rasterizes every mode to a real canvas and
asserts per-mode invariants — finite pixels, a frame that is neither flat
nor washed white, and stability under digital silence. These are invariants,
not golden images: an intentional visual tweak stays green, but the class of
bug that shipped as v8.8.3 (`atan(0,0)` → NaN whiting out flat surfaces)
turns it red.

`npm run analyze` answers "does this look blown out?" with numbers rather
than by squinting at 23 screenshots. Clipped pixels throw away colour and
detail exactly where the signal is loudest, so it is worth watching: the
suite currently averages ~4.3% clipped on the Canvas2D renderer and ~0% on
the raytraced stage, which tonemaps properly.

Analysis frames are sanitised at a single boundary (`src/levels.js`) before
any mode sees them. A non-finite value used to be fatal *and permanent* —
smoothed bands are exponential, so one NaN frame latched forever and took
the stage down until reload.

CI runs lint, tests, build, and the bundle budget on every push and PR.

## Build

```bash
npm run build   # output in dist/
npm run size    # fail if the bundle grew past budget
```

The music providers (`connect.js` → Spotify + Apple Music) and the raytraced
stage (`raystage.js` + `rayshader.js`) are split into their own chunks and
loaded on demand — the provider panel when the Source tab is opened or an
OAuth redirect comes back, the stage right after first paint. A guest
playing a local file never downloads the provider SDK clients. Budgets live
in `scripts/check-size.mjs`; raise one deliberately, in the commit that
needs the room.
