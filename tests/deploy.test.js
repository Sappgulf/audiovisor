/**
 * Production caching and security-header contract.
 *
 * Vercel serves a static build with `max-age=0, must-revalidate` by default,
 * which throws away the benefit of Vite's content-hashed filenames: repeat
 * visits re-download the entry chunk. These rules are easy to lose in a
 * config edit, so assert the ones the deploy depends on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

let config;
beforeAll(() => {
  config = JSON.parse(readFileSync('vercel.json', 'utf8'));
});

const rule = (source) => config.headers.find((h) => h.source === source);
const header = (source, key) =>
  rule(source)?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe('deployment caching', () => {
  it('caches content-hashed build assets for a year as immutable', () => {
    const value = header('/assets/(.*)', 'Cache-Control');
    expect(value).toContain('max-age=31536000');
    expect(value).toContain('immutable');
  });

  it('does not long-cache anything whose name can stay the same across deploys', () => {
    for (const { source, headers } of config.headers) {
      const cache = headers.find((h) => h.key.toLowerCase() === 'cache-control');
      if (!cache) continue;
      expect(source, `${source} must not sweep unhashed files into a long cache`).not.toBe('/(.*)');
    }
  });

  it('caches first-run samples for a day, but not as immutable', () => {
    const value = header('/samples/(.*)', 'Cache-Control');
    expect(value).toContain('max-age=86400');
    expect(value).not.toContain('immutable');
  });

  it('allows microphone and display capture, which the visualizer needs', () => {
    const policy = header('/(.*)', 'Permissions-Policy');
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('display-capture=(self)');
  });

  it('keeps content-type sniffing off and referrers trimmed', () => {
    expect(header('/(.*)', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('/(.*)', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('security policy', () => {
  it('ships a CSP that blocks object/base injection and unknown scripts', () => {
    const csp = header('/(.*)', 'Content-Security-Policy');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('https://sdk.scdn.co');
    expect(csp).toContain('https://js-cdn.music.apple.com');
  });

  it('does not allow inline scripts, which the built shell never needs', () => {
    const csp = header('/(.*)', 'Content-Security-Policy');
    const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src '));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("script-src-attr 'none'");
  });

  it('allows local audio streams and album art without allowing arbitrary frames', () => {
    const csp = header('/(.*)', 'Content-Security-Policy');
    expect(csp).toContain('media-src');
    expect(csp).toContain('blob:');
    expect(csp).toContain('img-src');
    expect(csp).toContain('frame-src');
  });

  it('caches self-hosted fonts but not as immutable', () => {
    const value = header('/fonts/(.*)', 'Cache-Control');
    expect(value).toContain('max-age=86400');
    expect(value).not.toContain('immutable');
  });
});
