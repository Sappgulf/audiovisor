import { afterEach, describe, expect, it } from 'vitest';
import handler from '../api/apple-music-token.js';

function response() {
  const out = { headers: {}, statusCode: 200, body: null };
  return {
    out,
    setHeader(name, value) { out.headers[name] = value; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; },
  };
}

const savedOrigin = process.env.APPLE_MUSIC_ORIGIN;
const savedTeam = process.env.APPLE_MUSIC_TEAM_ID;
const savedKey = process.env.APPLE_MUSIC_KEY_ID;
const savedPrivateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;

afterEach(() => {
  for (const [key, value] of Object.entries({
    APPLE_MUSIC_ORIGIN: savedOrigin,
    APPLE_MUSIC_TEAM_ID: savedTeam,
    APPLE_MUSIC_KEY_ID: savedKey,
    APPLE_MUSIC_PRIVATE_KEY: savedPrivateKey,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Apple Music token endpoint', () => {
  it('allows only GET requests', () => {
    const res = response();
    handler({ method: 'POST', headers: {} }, res);
    expect(res.out.statusCode).toBe(405);
    expect(res.out.body).toEqual({ error: 'Method not allowed' });
  });

  it('rejects origins outside the configured app origin', () => {
    process.env.APPLE_MUSIC_ORIGIN = 'https://audiovisor.example';
    const res = response();
    handler({ method: 'GET', headers: { origin: 'https://untrusted.example' } }, res);
    expect(res.out.statusCode).toBe(403);
    expect(res.out.body).toEqual({ error: 'Origin not allowed' });
  });

  it('answers 501 when credentials are missing, not 503', () => {
    /* Missing configuration is permanent until someone sets the env vars.
       503 invites a retry, and the client called through here on every
       Source-tab visit, sign-in and playlist action — a wasted round trip
       each time, over cellular on a phone. */
    delete process.env.APPLE_MUSIC_ORIGIN;
    delete process.env.APPLE_MUSIC_TEAM_ID;
    delete process.env.APPLE_MUSIC_KEY_ID;
    delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    const res = response();
    handler({ method: 'GET', headers: { host: 'audiovisor.example' } }, res);
    expect(res.out.statusCode).toBe(501);
    expect(res.out.body.configured).toBe(false);
  });

  it('does not reveal configuration details when credentials are missing', () => {
    delete process.env.APPLE_MUSIC_ORIGIN;
    delete process.env.APPLE_MUSIC_TEAM_ID;
    delete process.env.APPLE_MUSIC_KEY_ID;
    delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    const res = response();
    handler({ method: 'GET', headers: { host: 'audiovisor.example' } }, res);
    // the message names no key, id or path
    expect(res.out.body.error).toBe('Apple Music server credentials are not configured');
    expect(JSON.stringify(res.out.body)).not.toMatch(/BEGIN|PRIVATE|[A-Z0-9]{10}/);
  });

  it('keeps 503 for a signing failure, which may pass', () => {
    process.env.APPLE_MUSIC_TEAM_ID = 'TEAM123';
    process.env.APPLE_MUSIC_KEY_ID = 'KEY123';
    process.env.APPLE_MUSIC_PRIVATE_KEY = 'not a valid key';
    delete process.env.APPLE_MUSIC_ORIGIN;
    const res = response();
    handler({ method: 'GET', headers: { host: 'audiovisor.example' } }, res);
    expect(res.out.statusCode).toBe(503);
    expect(res.out.body.configured).toBe(true);
  });
});
