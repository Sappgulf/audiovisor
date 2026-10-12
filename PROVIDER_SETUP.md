# AUDIOVISOR provider setup

[Back to the overview](README.md) · [Feature reference](FEATURE_GUIDE.md)

## Source and deployment distinction

As of October 12, 2026, default `main` includes approval-gated Spotify integration code. The public demo was reviewed on `claude/audit-improve-0187dWQy`, initially at snapshot `fe02a915567137fa9bd115fde72a8092d4f70ee1`; that branch's README had removed Spotify from its source list and setup instructions. Production deployments can advance independently of this documentation snapshot. Do not assume default-branch integrations are enabled on the hosted demo.

The Spotify instructions below apply only to a separate appropriately approved deployment of the main-branch implementation. Both branches describe Apple Music playback as a still player view, without beat-driven visuals. Local files, analyzable direct URLs, and permitted live inputs are the supported route for audio-reactive scenes.

## Spotify setup (approved use only)

Spotify's [Developer Policy](https://developer.spotify.com/policy) restricts synchronizing recordings with visual media and integrating streams or content from another service. The main-branch implementation documents leaving the Spotify Client ID unset while permission for this multi-service product is unresolved; the current hosted branch does not advertise Spotify. The steps below are for a deployment with the required provider rights.

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
