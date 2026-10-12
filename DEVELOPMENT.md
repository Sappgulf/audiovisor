# AUDIOVISOR interaction and development guide

[Back to the overview](README.md) · [Provider setup](PROVIDER_SETUP.md) · [Feature reference](FEATURE_GUIDE.md)

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
