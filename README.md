# AUDIOVISOR

A hifi, real-time music visualizer for the browser. Drop in a track (or go live with your mic) and the engine renders the frequency spectrum live — six stage modes, five theme moods, a full FX chain, beat tracking, and autopilot.

## Features

- **6 stage modes** — Spectrum Bars, Linear Wave, Particle Field, Kaleidoscope, Radial Tunnel, Plasma Rings
- **5 themes** — Lime, Neon Cyber, Psychedelic, Hi-Fi Amber, Candy
- **Audio engine** — Web Audio API: playlist queue, seek, loop, volume, speed
- **FX chain** — Reverb (generated impulse), Limiter, Lowpass, Speed x1.5
- **Live mic input** — party mode, reacts to whatever is playing in the room
- **Reactivity** — sensitivity, bass focus, smoothing controls
- **Beat tracking** — live BPM chip + bass-active indicator
- **Autopilot** — cycles modes and themes every 12s
- **MediaSession** — OS media controls and lock-screen metadata
- **Settings persistence** — localStorage
- **Adaptive quality** — auto-scales rendering to keep 60fps

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `←` `→` | Seek ±10s |
| `M` | Cycle stage mode |
| `T` | Cycle theme |
| `F` | Fullscreen |

## Dev

```bash
npm install
npm run dev
```

## Tests & lint

```bash
npm test
npm run lint
```

## Build

```bash
npm run build   # output in dist/
```
