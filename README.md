# AUDIOVISOR — v8.24.0

A hifi, real-time music visualizer for the browser. Drop in a track or use a permitted live input to drive twenty-four stage modes and thirty-two themes. Direct URLs can drive the stage when the browser can analyze their audio. Spotify and Apple Music account connections provide in-app playback without beat-driven visuals.

## Features

### Stage and navigation polish (v8.24)
- **Living contour light** — travelling highlights carry treble along the resonant filaments; quieter shadows keep dark space cleaner across the WebGL stage.
- **Tools with context** — the More menu explains snapshot, recording and remix outputs, supports arrows and Home/End navigation, and returns focus on Escape. Recording and Autopilot show their current action/state.
- **Browse without losing your place** — mode and theme grids keep keyboard focus visible with a single tab stop; drawer tabs retain individual scroll positions and support Home/End. Rotating an open phone sheet releases the transport on wider screens. Reduced-motion browsing keeps still previews without loading animation strips.
- **Lighter Canvas contours** — backing stores and palette gradients are reused; non-radial families skip polar math. An interleaved Chromium benchmark of four modes measured 8–40% lower contour-refresh CPU time, with identical phase values. This measures the contour subsystem, not whole-app frame rate.

### Maintenance (v8.17.1–v8.17.5)
- **CI tests the real build** — the PWA and service-worker suites assert against `dist/`, but CI ran the tests before the build, so those checks never actually covered a fresh push. The workflow and `npm run ci` now build first.
- **Clean-checkout tests** — `npm test` skips the built-artifact assertions when `dist/` is absent instead of failing the whole file; CI still runs them against the build.
- **Dependency refresh** — dev tooling updated within range and `npm audit` now reports zero vulnerabilities.
- **Reliable E2E start** — the front-to-back runner gives first load its own budget for the font CDN and lazy stage chunk instead of inheriting the 3.5s per-step timeout.
- **Production caching** — Vercel was serving content-hashed `/assets/*` with `max-age=0, must-revalidate`, so repeat visits re-downloaded the entry chunk. `vercel.json` now marks hashed assets immutable for a year, gives thumbnails/icons bounded caching, and adds `nosniff`, a trimmed referrer policy and a permissions policy that still allows mic and display capture.
- **Mobile ARIA cleanup** — the wordmark wrapper carried an `aria-label` without a role, which axe reports as `aria-prohibited-attr` on phones; the `h1` already names the brand. A static test now keeps it that way.
- **MusicKit off the critical path** — index.html eagerly loaded Apple's ~140 KB MusicKit SDK on a 72-second cache for every visitor, Apple Music user or not. The existing on-demand loader now owns it, so Spotify, local-file and live-input sessions never fetch it.
- **Search and label polish** — a description, canonical URL and `og:url` give the page proper search/social metadata, and the three dropzone buttons now include their visible wording in the accessible name (WCAG 2.5.3).
- **First-run samples** — the four built-in tracks from `add-sample-tracks` (Night Voltage, Velvet Ash, Still Yours, Last Seen) load through the same decode path as dropped files. A contract test keeps every button backed by a real MP3, the E2E pass clicks one and waits for playback, and `/samples/*` gets bounded edge caching.

### Sources
- **Local files** — drag & drop, the **Add** control in the transport, or **Browse files** on the stage (MP3, WAV, FLAC, OGG, M4A…); multi-select builds a playlist queue
- **Sample tracks** — four built-in first-run tracks (Night Voltage, Velvet Ash, Still Yours, Last Seen) for trying the stage without a file on hand
- **Spotify Connect (approval-gated)** — PKCE OAuth and Web Playback SDK code is available for an approved deployment; this public deployment has no Spotify Client ID *(Premium required for playback)*
- **Apple Music** — authorize with MusicKit on the Web, browse personal playlists, and start playback in Apple Music's protected player *(Apple Music subscription required for playback)*
- **Tab / system capture** — visualize audio you have permission to use (Chrome/Edge; share a tab with "share tab audio" enabled)
- **Direct URLs** — play `http(s)` audio links (radio, podcasts, direct MP3s); streams that block browser audio analysis use a still player view
- **Live mic input** — party mode; analysis-only (never routed to speakers, no feedback)

> **Streaming accounts:** MusicKit and Spotify do not expose decoded song audio to this app. Their published terms also restrict synchronizing their recordings with other visual content. The account player therefore shows a still playback view. Local files, analyzable direct URLs, and permitted live inputs provide real audio analysis for the visualizer.

### Raytraced stage (v8.8)
Every one of the 24 stage modes is now a **live raytraced scene** rendered on a WebGL2 ray-marcher — the Canvas2D engine remains as a fallback and can be toggled back on at any time (Look tab → **Raytrace**).

- **v8.23 resonant worlds** — every mode gets a distinct full-stage contour profile inspired by Chladni: flowing ribbons, orbital rings, interference lattices, spirals, warped cells and petal fields. WebGL uses antialiased filaments behind the scene; Canvas2D shares the profiles and caches bounded marching-squares geometry. Smaller sculptures have closer framing, emissive highlights retain more hue, terrain and spectrogram surfaces gain fine contours, particles are smaller and brighter, city windows breathe without reseeding, and the lava wax keeps more color. Orb and Fluid Metal lose their floor seams. The shared HTML horizon overlay—the horizontal line across every mode—is removed.
- **Shared controls and loading polish** — the stage context opens visual controls directly; mode previews show their names and filtered counts, themes show the selected mood, and each drawer tab has a contextual heading. Mobile uses a three-column mode picker and a reachable mute button that restores the last volume. Slider values reset their setting, EQ has a flat reset, transport labels follow the actual action, and focused controls keep native keyboard activation. File decoding and sample loading expose progress and restore retry controls after failure.
- **Continuous motion** — both renderers accumulate audio-driven speed instead of multiplying elapsed time by the current level. Cameras, kaleidoscope, plasma, nebula, spiral, fractal and vinyl motion stay continuous as energy changes, including long sessions. Canvas beat transforms now balance their saved state, the vinyl pivot avoids a zero-length capsule, and WebGL shader warmup binds real scene textures instead of sampling its own framebuffer.
- **Accurate mode previews and render checks** — all 24 picker thumbnails and animated strips now come from the default WebGL stage (`npm run thumbs:ray`; the existing `thumbs` command still captures Canvas2D), with revised URLs so returning users receive the new artwork. A pixel test caught the city camera passing through buildings; its orbit now clears the highest roof, including on beats and drops. `rayshots` explicitly resolves each shader program and fails on WebGL errors, wrong-mode captures, flat frames or excessive white clipping. The E2E mode sweep waits for each selected scene to render.
- **v8.22 full-screen Chladni** — the 24th mode is now an infinite resonant sheet: both renderers evaluate the nodal field across the whole stage instead of cropping it to a disc, so the pattern reaches every edge. The shared Canvas2D floor-reflection band (a stray full-width mirror seam in every non-bars mode) is gone, leaving the stage cleaner and cheaper; the reworked field also drops the plate rim, stem and horizon. The Canvas2D fallback uses a thinner mask, deeper palette tint and no per-mode bloom so its nodes stay coloured instead of clipping white.
- **v8.21 performance & provider pass** — audio band edges and their FFT bins are cached instead of recomputed every frame; the renderer refreshes DPR only when the display actually changes (monitor moves, zoom) without breaking an explicit override; GPU Core reuses its transformed-cell array instead of allocating 64 objects per frame and its stack is larger; the radar graticule/bezel/ticks are cached as a sprite instead of restroked each frame; the seek bar throttles style writes; and the service worker precaches the app shell so the first offline launch has a page. Spotify's player now clears stale device state on failure, times out instead of hanging, and OAuth mismatches clear the one-use PKCE state while preserving unrelated query/hash parameters.
- **v8.20 further visual & systems pass** — raytraced terrain gained atmospheric perspective, GPU Core spreads the palette across its voxel stack, the spectrogram terrace and nebula core sit below their old exposure lines, and Chladni's highlights carry more hue. Canvas2D's city windows stopped boiling, the spiral now maps radius to the real spectrum instead of a repeating sparse pattern, particle constellation edges no longer allocate a colour string per line, the spectrogram reuses its column buffer, and the SSR reflection now rides the beat-punch transform instead of tearing away from the scene. The library keeps metadata in its own IndexedDB store (search no longer loads every audio buffer per keystroke), writes resolve on transaction commit, and loading a remix goes through the shared FX path so chips/state stay in sync. Covers are decoded after CORS/load handlers are attached, tempo analysis keeps one worker instead of piling up per selection, the VU canvas/favicon are cached, chrome reveal is throttled, and the recorder/audio-only E2E waits for the actual state transition.
- **v8.19.1 audio, UI & platform fixes** — the transport clock now follows playback rate (Speed/Chop no longer desyncs the seek bar, Auto-DJ countdown or beat tracker), loop toggles apply to the source already playing, crossfading into an evicted queue entry rehydrates instead of starting a null buffer, the beat clock no longer treats every loop wrap as a seek, and the drop detector resets on seeks/track changes. Mic and capture are mutually exclusive, tap sources report unknown stereo width, and Play Demo replaces the queue instead of appending behind a playing track. Toasts escape track names and browser error text; WAV export caches its channel views; the recorder stops its tracks, keeps per-recording chunks and reports state; panel Enter/Space no longer double-fires on header buttons; pointer-cancel completes at the last position; settings reset clears both schema versions, restores EQ, applies explicit `false` values, caps import size, and keeps the volume slider’s ARIA state in step. Platform: the service worker no longer caches the token API, Range/206 audio or OAuth callback URLs; first install no longer reloads mid-session; WebGPU/WebGL2 handle device/context loss and failed shader links, the fallback backing store is capped like the ray stage, and GPU Core snapshots capture its own canvas. The share card now says 24 modes / 32 themes with absolute + Twitter image metadata, the manifest has a stable id, and `/sw.js` + `/manifest.json` are served no-cache.
- **v8.19 all-mode visual & performance pass** — every one of the 24 scenes was reviewed and touched. Visuals: self-lit ember particles, brighter kaleidoscope facets with a non-mirror backing plate, rounded spectrogram tiles, terrain that keeps its hue at the crests and uses the full history range, shaded city crowns with slowly breathing windows, a less bleached nebula core, banded plasma, smoother orb/fluid shells, stronger tensor lean, fewer/thicker prism rays, a thicker accretion disc, a grounded bloom field, a cheaper fractalled core, taller radar contacts, warmer lava wax, softer GPU voxel noise, rim-faded vinyl grooves, and a continuously responsive Chladni figure. Performance: bars reuse their cached metal sprite instead of building 28-56 gradients a frame, fractal drops from 11 to 8 iterations, prism fan from 11 to 8 rays, GPU Core and lava stop tapping the spectrum texture inside their march/volume loops, and the Canvas2D path caches its tunnel vignette, Chladni plate gradient and nebula band scratch. Bugs fixed: temporal history is primed so look changes no longer flash dark, deferred scene hand-offs key stability on the mode actually drawn, Canvas2D trails/scope phosphor clear on theme/mode changes, bloom field no longer draws at a stale negative alpha, vinyl emphasises a groove without appending it to the previous path, the wave echo starts at silence-centre and resizes, terrain meteors clear on mode change, beat shockwaves/blips are rate-limited, three undefined reversed `smoothstep` calls were made monotonic, GPU Core's fallback no longer calls `setMode` every frame, the raytrace chips refresh their availability after the async stage lands, and `next2dQuality` can climb out of low under vsync. Render-loop GC was trimmed (allocation-free baseline percentile, cached canvas refs, capped grain tile).
- **v8.18.1 shader-compile fix** — on a WebGL2 context without `KHR_parallel_shader_compile`, the “keep the old scene while the new program links” fallback queued the selection forever: every mode switch after boot silently kept drawing the first scene. The deferral now applies only when a parallel link is actually in flight; otherwise the new scene compiles synchronously on the next frame. Caught by driving the new mode on production with a software GL context.
- **v8.18 Chladni Plate** — a 24th mode in both renderers. A resonant metal disc, viewed in perspective, carries the nodal set of two crossed standing waves; scattered sand burns along the zero crossings, the integer pair steps with bass and treble when a beat lands, and the plate gets a powered rim, centre pin and grounded stem in the raytraced scene. The Canvas2D fallback caches the nodal mask, tints it through the active palette and lets only the pattern's own state (pair, theme, quality) trigger a rebuild, so the mode stays cheap without losing its identity.
- **Path** — per-frame: SDF/volumetric ray march into a linear HDR buffer → temporal accumulation with neighbourhood clamping → bright-pass + separable gaussian bloom at quarter res → ACES tonemap with chromatic aberration, vignette and grain
- **Shading** — Cook-Torrance GGX with metallic/roughness materials, penumbra soft shadows, 4-tap AO, one reflection bounce for polished metals, and a theme-tinted procedural environment used as both key light and reflection probe
- **Glass** — true two-interface refraction (into the solid, march to the far wall, refract back out); Prism Ray splits R/G/B at 1.38/1.45/1.53 for real dispersion
- **Depth of field** — thin-lens camera with a per-sample golden-angle lens jitter; Bloom Field is built around it
- **Audio → geometry** — spectrum and waveform ride into the shader as textures, plus a 256×128 rolling spectrum history that drives the Spectrogram terrace and Aurora Terrain ridges
- **Frame budget** — audio scratch buffers are reused rather than reallocated per frame, the spectrum history scrolls on a fixed 45 rows/sec clock (so a 144Hz display doesn't run the waterfall at 2.4x speed), the temporal pass is skipped when there's nothing to blend, and an idle stage renders at half rate. Static uniforms (mode/tier/palette/sampler assignments) upload once per look change behind a revision counter instead of twenty dead calls every frame; the two quarter-res bloom passes are skipped entirely when Bloom is zeroed; and the spectrum/history textures fill from baked bin-index tables rather than recomputing `pow()` per texel per row
- **Treble wired in** — the spectrogram terrace's freshest row and the terrain crest line answer the high band (hats light the waterfall's front lip), and nebula/spiral volumes shape their density with mids and highs, so those scenes respond to the whole mix instead of only bass-and-level
- **Accumulation safety** — a width-only resize invalidates the temporal history exactly like a mode/tier change (a stale-height key let one frame resample an old-size buffer)
- **v8.16 front-to-back pass** — `npm run e2e` (and `-- --mobile`) drives every feature in a visible browser with real clicks, taps and keys; 56/56 desktop and 41/41 phone steps pass with zero errors. Fixed along the way: Escape could not close the library (its search box held focus) and every shortcut after that was swallowed; fullscreen did nothing where the browser refuses element fullscreen (iPhone Safari) — it now falls back to a window-filling cinema mode; fullscreen closes the settings drawer and moves the stage chips clear of the floating topbar; the phone layout could be scrolled off-screen by focus or scroll-into-view (`overflow: clip`); the desktop console's title no longer hides under the save button and the console widens to fit both title and seek bar.
- **v8.15 colourways** — seven new five-stop palettes (Iridescent, Aurora, Bioluminescence, Cosmic Bloom, Lagoon Dusk, Holographic, Molten Gold) and Iridescent as the new default. Colour now flows: every frame the stage re-samples the palette at slowly wandering positions (with a nudge on the beat), so hues travel across every scene at zero GPU cost. The post pass split-tones shadows toward the palette's deepest colour and highlights and bloom toward its most vivid, so each mode sits inside one colourway; nebula/spiral volumes sweep the whole ramp instead of washing out to white.
- **v8.14 speed pass** — every raytraced mode is 5–15× cheaper at the same tier (M1, Retina, medium: 18–197ms → 1.5–13ms a frame). Each mode now compiles its own scene program with the mode baked in, so the compiler drops the other 22 scenes; programs build and warm in the background (ANGLE/Metal builds the pipeline on first draw), so switching modes no longer stalls. Scope builds its trace once per frame on the CPU and only tests nearby segments; particles and bloom field search half the neighbour cells behind a safe step cap and a bounding sphere; nebula/spiral clip their march to the cloud and sample baked texture noise; sphere fields and bounce shading skip invisible shadows/AO. Fixed the v8.13 set pieces (scope housing, plasma cell, kaleido pool, prism floor) rendering with the vinyl-groove material because of an id clash. Adaptive quality starts desktops at medium, only climbs above it when a tier is picked by hand, treats 1-in-10 dropped frames as over budget, ignores the GPU-drain frame after a tier change, and remembers per mode what failed. The renderer waits until audio or a mode is chosen, WebGPU starts only when GPU Core needs it, and the build strips comments from the shaders (bundle 99.5 → 93.0 kB gz). `npm run bench` drives every mode with a synthesised track and reports fps/worst frame/tier.
- **v8.13 production-design pass** — the void modes stopped floating in nothing: Spectrogram Scope sits inside an instrument housing, Kaleidoscope reflects into a bounded dark pool, Plasma Rings plays inside a strip-lit charging cell, Pulse Orb commands a phosphor arena floor (the radar deck's wedge sweeps under it), Prism Ray's fan finally lands on a mirror-gloss disc, and Linear Wave got a low sun on a sea horizon with stars above it. The whole rig reads hotter when the music does: the key light warms and the fill takes the beat pulse through lights that already existed (two added GGX lights measured as compile-wide tax on all 23 scenes, so the lift rides the existing evaluations instead). Every camera gained a second slower drift orbit, drop-triggered push-in toward its target with a long-lens tighten — film compression as impact
- **v8.12 scene rebuilds** — Beat Radar is a listening post now: a ribbed lattice dome with latitude hoops, a bass-breathing centre mast, and spectrum-banded contacts that flare the instant the phosphor sweep crosses their azimuth (phase-locked to the deck's wedge — locked by test); GPU Core grew corner pylons, band-swollen voxels under a hard cap (uncapped swell funneled rays into cell gaps at 5× the march cost) and an orbiting data node tapped outside the marching loop; Tensor Grid couples each rod axis to a band — bass thickens one family, mids another, highs the third, so the lattice leans with the mix; Prism Ray gained a gently orbiting camera so beam/prism/fan parallax actually reads; nebula/spiral/lava volumes all answer the drop envelope
- **Tier baseline recovery** — one lucky frame used to pin the adaptive sampler's session-best interval below anything the display could achieve again, grinding tiers down against an unreachable floor; a per-window relaxation (`relaxBaseline`) drifts a stale estimate back toward present reality within seconds while genuinely-fast frames hold the floor down
- **Quality tiers** — Low / Medium / High / Ultra (resolution scale, march steps, samples per pixel, reflection bounce), cycled from the Look tab and auto-stepped down when frames run long
- **Themes** — all 25 palettes feed the shader in linear space, so every scene re-lights with the theme
- **Numerically safe** — `atan(0,0)`, negative `pow()` bases and unbounded specular all produce NaN or saturated plateaus on flat mirror-like surfaces; every site is guarded and each sample is NaN-scrubbed before accumulation
- **Resilient** — a lost GPU context (driver reset, sleep, another tab hogging the GPU) drops the stage to Canvas2D with a toast, and a watchdog rebuilds the renderer and resumes raytracing when the context comes back; the on/off preference records what you asked for, not what the GPU happened to support at boot

### Stage
- **24 stage modes** — Spectrum Bars, Linear Wave, Vectorscope, Particle Field, Kaleidoscope, Spectrogram, Radial Tunnel, Plasma Rings, Aurora Terrain, Neon City, Nebula Clouds, Spiral Galaxy, Pulse Orb, Fluid Metal, Tensor Grid, Prism Ray, Void Core, Bloom Field, Fractal Bloom, Beat Radar (beat-dropped contacts + spectrum blips), Lava Lamp (bass-heated metaball drift), GPU Core (rotating voxel compute stack), Vinyl Groove (spectrum-burned turntable), Chladni Field (full-screen nodal sand)
- **32 themes** — Iridescent, Aurora, Bioluminescence, Cosmic Bloom, Lagoon Dusk, Holographic, Molten Gold, Lime, Neon Cyber, Psychedelic, Hi-Fi Amber, Candy, Vaporwave, Ember, Arctic, Monolith, Sunset, Matrix, Ultraviolet, Warm Brass, AutoTune Pop, Laser Tag, Chop N Screwed, Jade, Crimson Silk, Desert Mirage, Ocean Depth, Fractal Dawn, Solar Flare, Toxic Sludge, Cotton Candy, Midnight Ink
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
- **Mode filter** — type to narrow the 24 stage modes, Enter selects the first match, Esc clears
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

## Spotify setup (approved use only)

Spotify's [Developer Policy](https://developer.spotify.com/policy) restricts synchronizing recordings with visual media and integrating streams or content from another service. AUDIOVISOR's production deployment leaves the Spotify Client ID unset while permission for this multi-service product is unresolved. The steps below are for a deployment with the required provider rights.

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

Guest mode supports local files, URLs, microphone, and permitted capture without an account. Spotify and Apple Music playlist access requires the user's own provider account. Playlist playback stays inside the provider player and does not drive the visual modes. Disconnect before handing a shared device to another person.

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

## Plugins

Register a custom Canvas2D stage mode at runtime. The mode is added to the
picker, keyboard cycling and command palette; plugin modes are Canvas2D-only,
so the raytraced stage steps aside while one is active.

```js
AUDIOVISOR.registerMode({
  id: 'my-mode',
  name: 'My Mode',
  icon: 'sparkles',                 // any icon in src/icons.js
  draw(renderer, freq, wave, dt, dt60) {
    // renderer.ctx / renderer.w / renderer.h / renderer.theme / renderer.quality
    // freq: Uint8Array spectrum (0..255), wave: Uint8Array waveform (0..255)
    // dt: real delta seconds, dt60: 60Hz-normalized delta
  },
});
```

`AUDIOVISOR.modes()` lists what has been registered. A duplicate or built-in
id throws.

## MIDI

Click the **MIDI** chip in the Look tab (or run *Toggle MIDI input* from the
command palette) to opt in. Continuous controllers 1/71/74/76/77 drive
sensitivity, smoothing, bass focus, bloom and colour pop; the ten pads from
note 36 toggle the FX chain; the twelve from note 48 select modes. The
mapping lives in `src/midi.js` (`CC_MAP`, `FX_NOTE_BASE`, `MODE_NOTE_BASE`).

## Dev

```bash
npm install
npm run dev
```

Requires Node 22.12+ in the 22.x line, 24.x, or 26+ for the full build and test workflow (Vitest 5); Node 24 is recommended (see `.nvmrc`, CI runs 24).

## Tests & lint

```bash
npm test        # vitest — engine, beat tracker, PKCE, utils,
                #          settings schema, palette, per-mode stage render,
                #          pointer drags, sheet gestures, PWA/responsive contract,
                #          plugin registry, MIDI mapping, offline tempo analysis
npm run coverage # the same suite with a v8 coverage report
npm run lint    # eslint
npm run typecheck # tsc --noEmit (opt-in JSDoc checking on the newer modules)
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
here belongs to the theme, so a thumbnail baked in one of the thirty-two
would be wrong in the other thirty-one, and form is what tells the modes
apart anyway.

They are committed artifacts, so **re-run it after changing how a mode
looks** — nothing detects a stale thumbnail automatically, since that would
mean re-rendering all 24 on every test run. `tests/mode-thumbs.test.js`
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
than by squinting at 24 screenshots. Clipped pixels throw away colour and
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
