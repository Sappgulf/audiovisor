# AUDIOVISOR for iOS

A native iPhone and iPad shell around the AUDIOVISOR stage.

## How it works

- **Live site first.** The app loads `https://audiovisor-one.vercel.app/` in
  an edge-to-edge WebKit view, so every feature works and each Vercel deploy
  updates the app without an App Store release. Spotify sign-in returns to its
  registered web address, and the Apple Music token comes from the site's
  `/api/apple-music-token` function, so both need the live origin.
- **Offline fallback.** A copy of the web build ships inside the app
  (`AudioVisor/Web`) and is served from `audiovisor-local://app/` when the
  network is unavailable. Local files, samples, every mode and the live mic
  work offline; streaming connections need a network.
- **Native touches.** Background audio (playback continues with the screen
  locked), the iOS microphone prompt for live input, no screen dimming while
  the app is open, hidden status bar and home indicator, sign-in popups
  (MusicKit, OAuth) as sheets, other links in Safari, a branded launch cover
  that lifts once the stage has booted, and the Blender-rendered app icon.

## Build

```bash
npm run ios:web        # vite build, copy dist/ into ios/AudioVisor/Web
npm run ios:project    # generate AudioVisor.xcodeproj with xcodegen
open ios/AudioVisor.xcodeproj
```

or `npm run ios` for all three. `AudioVisor/Web` and the `.xcodeproj` are
generated and git-ignored; `project.yml` is the source of truth.

To run on a device or ship to TestFlight, set your team under Signing &
Capabilities (the bundle id is `app.audiovisor.ios`).

## Debugging

Debug builds make the web view inspectable in Safari (Develop menu) and
forward page console output to the unified log:

```bash
xcrun simctl spawn booted log stream --predicate 'subsystem == "app.audiovisor.web"'
```

Launch with `-offline` (Scheme > Arguments) to test the bundled fallback
without cutting the network.
