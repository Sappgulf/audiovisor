import { describe, it, expect } from 'vitest';
import { pkceVerifier, pkceChallenge, parseRedirect } from '../src/spotify.js';

describe('Spotify PKCE helpers', () => {
  it('generates url-safe verifiers of the requested length', async () => {
    const v = await pkceVerifier(64);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(64);
  });

  it('generates unique verifiers', async () => {
    const [a, b] = await Promise.all([pkceVerifier(), pkceVerifier()]);
    expect(a).not.toBe(b);
  });

  it('derives an S256 challenge from the verifier', async () => {
    const v = await pkceVerifier();
    const c = await pkceChallenge(v);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.endsWith('=')).toBe(false);
    expect(c.includes('+')).toBe(false);
    expect(c.includes('/')).toBe(false);
  });

  it('derives identical challenges for identical verifiers', async () => {
    const v = await pkceVerifier();
    const [c1, c2] = await Promise.all([pkceChallenge(v), pkceChallenge(v)]);
    expect(c1).toBe(c2);
  });

  it('challenge matches RFC 7636 test vector shape (base64url sha256)', async () => {
    // deterministic check: same input must hash via SHA-256 to stable output
    const c = await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    // known S256 vector from RFC 7636 appendix B
    expect(c).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('parseRedirect', () => {
  it('extracts code and state', () => {
    const r = parseRedirect('?code=abc&state=xyz');
    expect(r).toEqual({ code: 'abc', state: 'xyz', error: null });
  });

  it('extracts error responses', () => {
    const r = parseRedirect('?error=access_denied');
    expect(r.code).toBeNull();
    expect(r.error).toBe('access_denied');
  });

  it('returns null when no oauth params present', () => {
    expect(parseRedirect('?foo=bar')).toBeNull();
    expect(parseRedirect('')).toBeNull();
  });
});
