# AUDIOVISOR

A hi-fi, real-time music visualizer for the browser. Turn a local track or permitted live input into a stage of color, light, and motion.

**[Open AUDIOVISOR](https://audiovisor-one.vercel.app)** · [Report an issue](https://github.com/Sappgulf/audiovisor/issues)

## Start a session

Open the app, add a local audio file, choose a stage mode, and press play. You can also use an analyzable direct audio URL or a live input you have permission to capture.

- 23 stage modes and 32 themes.
- WebGL2 ray-marched scenes with a Canvas2D fallback.
- Queue management, playback controls, EQ, and audio effects.
- Look presets, share cards, and session recording.
- Touch controls, keyboard shortcuts, and cinema mode.
- A custom Canvas2D mode API and optional MIDI controls.

## Deployment note

The hosted demo and default source branch can differ. As of October 12, 2026, the demo runs `claude/audit-improve-0187dWQy`; default `main` also contains approval-gated Spotify code that the demo does not advertise. See [provider setup](PROVIDER_SETUP.md) for the distinction.

## Audio sources and limits

- **Local files:** add supported audio files to the playback queue.
- **Direct URLs:** browser-compatible audio links; sources that block analysis use a still player view.
- **Tab/system capture:** supported browser capture with permission to use the audio.
- **Microphone:** analysis-only input, without routing microphone sound to the speakers.
- **Apple Music:** account-based playback through MusicKit, requiring an eligible subscription and configured deployment.

Apple Music's protected player does not expose decoded song audio to this app. Account playback therefore uses a still view rather than beat-driven visuals. Local files, analyzable URLs, and permitted live inputs drive the visualizer.

Browser support, source permissions, and graphics hardware affect available capture, recording, and rendering features.

## Controls

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / right | Seek |
| Up / down | Adjust volume |
| M | Cycle stage mode |
| T | Cycle theme |
| R | Random look |
| Q | Queue |
| P | Share card |
| L | Library |
| F | Fullscreen / cinema |
| ? | Shortcut help |

On touch screens, drag the seek and volume controls and double-tap the stage for cinema mode.

## Run locally

Use Node 24, or another version supported by `package.json`.

```sh
git clone https://github.com/Sappgulf/audiovisor.git
cd audiovisor
npm install
npm run dev
```

Open the URL printed by Vite. Local-file playback does not require a streaming account.

## Checks and build

```sh
npm run ci
npm run coverage
npm run e2e
npm run e2e -- --mobile
```

`ci` runs lint, type checking, unit tests, a production build, and bundle budgets. Browser checks and graphics benchmarks remain separate.

```sh
npm run build
npm run preview
npm run bench
```

Results vary by revision, hardware, browser, and selected rendering quality. No universal frame-rate guarantee is implied.

## Architecture

JavaScript ES modules, Vite, Web Audio, WebGL2, and Canvas2D. Provider code and the ray-traced stage are loaded separately.

- `src/`: audio processing, stage rendering, controls, and source integrations.
- `api/`: server-side provider support.
- `tests/`: automated behavior and rendering checks.
- `scripts/`: browser checks, benchmarks, artwork generation, and bundle budgets.
- `public/`: static assets and stage thumbnails.

Custom Canvas2D modes register through `AUDIOVISOR.registerMode(...)`. MIDI input is opt-in through the Look tab; mappings live in `src/midi.js`.

## Provider configuration

Apple Music requires server-side MusicKit credentials and an allowed application origin. See [provider setup](PROVIDER_SETUP.md), `.env.example`, and the provider implementation before configuring a deployment. Keep signing private keys server-side and out of Git.

Disconnect a provider account before giving a shared device to someone else.

## Contributing

For a playback or rendering issue, include your browser, device, audio-source type, selected mode, and quality setting. Do not attach credentials or audio you do not have permission to share.

## Detailed reference

- [Feature and engine reference](FEATURE_GUIDE.md)
- [Provider setup and deployment differences](PROVIDER_SETUP.md)
- [Mobile, keyboard, plugin, MIDI, and development guide](DEVELOPMENT.md)
