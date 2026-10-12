/**
 * The home-screen shortcuts. Each one opens the installed app straight into a
 * mode; these check the manifest shape they depend on, against the source file
 * so no build is needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

describe('manifest shortcuts', () => {
  it('ships the one working entry: Play demo', () => {
    expect(Array.isArray(manifest.shortcuts)).toBe(true);
    expect(manifest.shortcuts.map((s) => s.name)).toEqual(['Play demo']);
  });

  it('points each entry at a URL inside the app scope', () => {
    for (const s of manifest.shortcuts) {
      expect(s.url.startsWith('/'), `${s.name} url is not app-relative`).toBe(true);
      expect(new URL(s.url, 'https://app.test/').pathname.startsWith(manifest.scope)).toBe(true);
    }
  });

  it('launches the demo with ?demo=1', () => {
    const byName = Object.fromEntries(manifest.shortcuts.map((s) => [s.name, s.url]));
    expect(byName['Play demo']).toBe('/?demo=1');
  });

  it('gives each entry an icon that is actually published', () => {
    for (const s of manifest.shortcuts) {
      expect(Array.isArray(s.icons) && s.icons.length > 0, `${s.name} has no icon`).toBe(true);
      for (const icon of s.icons) {
        expect(icon.type).toBe('image/png');
        expect(existsSync(`public${icon.src}`), `missing ${icon.src}`).toBe(true);
      }
    }
  });

  it('keeps the existing manifest members intact', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
