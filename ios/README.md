# Audiovisor for iOS 9.0

A native SwiftUI studio for iPhone and iPad, backed by the bundled WebKit audio and visual engine. Minimum iOS 17; Swift 6; XcodeGen owns the project configuration.

## Experience

- Discover offers a visual preview, an immediately available synthesized demo, an audio import action and featured visuals.
- My music keeps private, persistent copies of tracks selected through the native Files picker. Imports support common unprotected audio formats, up to 100 MB per file and 30 files per selection. Decoding support depends on the codec. Originals are never removed.
- All 24 visual worlds have native, searchable previews rendered from the actual stage programs. The selected visual persists.
- The stage keeps its visual, palette, EQ and effects controls. Studio returns to the native home without interrupting playback. The native mini player reflects the same engine state.
- The shipped engine is self-contained. No network, account or website deployment is needed for core playback and visuals. Streaming account integrations and browser-only capture/export tools remain in the separate web app.
- Slow startup exposes progress and retry. Fatal load errors are explicit; a terminated WebKit process recovers to the studio while preserving the library. Reduced Motion, Dynamic Type, native accessibility labels and safe areas are supported.

## Architecture

`StageViewController` owns the WebKit stage and a SwiftUI `StudioView` overlay. `StudioModel` coordinates the native UI and typed command names. `MusicLibrary` serializes file operations and atomically commits its manifest. A failed import batch rolls back copied files.

`LocalWebScheme` serves bundled assets and UUID-named imported audio from the app container. WebKit tasks stay on the main actor; only file URLs and data cross to the IO task. `src/native.js` installs only at the trusted bundled origin and exposes a narrow bridge. Imports never leave the device. Covered rendering pauses while the native studio is visible.

The native logo source is in `Brand/`; generated store and launch assets live in the asset catalog. `VisualPreviews/` contains native-resolution scene captures. Regenerate them with `node scripts/make-ios-previews.mjs` when the renderer changes.

## Build and check

```sh
npm run ios:web
npm run ios:project
open ios/AudioVisor.xcodeproj
npm run ci
xcodebuild -project ios/AudioVisor.xcodeproj -scheme AudioVisor \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test
```

The web copy, Xcode project and `build/` are generated and ignored. `project.yml` is the source of truth. Marketing and build versions are embedded through `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`.

## Release

Bundle ID: `app.audiovisor.ios`; team: `FW6FWBCF5U`; App Store Connect app: `6835754116`.

```sh
xcodebuild -project ios/AudioVisor.xcodeproj -scheme AudioVisor -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ios/build/AudioVisor.xcarchive \
  -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath ios/build/AudioVisor.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/export \
  -allowProvisioningUpdates
```

`ExportOptions.plist` uploads to App Store Connect. Check runtime behavior, embedded version, privacy manifest and final artwork before exporting. The listing uses manual release after review, free pricing, and no collected app data. The owner confirmed distribution rights to the four bundled sample tracks on November 17, 2026.

Support: https://audiovisor-one.vercel.app/support.html
Privacy: https://audiovisor-one.vercel.app/privacy.html
