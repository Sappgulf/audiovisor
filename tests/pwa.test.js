/**
 * The manifest and iOS meta tags are easy to break silently — a renamed
 * icon or a stale colour shows up only once someone installs the app to a
 * home screen. These assert the contract against the built output.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

let manifest, html;
beforeAll(() => {
  manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  html = readFileSync('dist/index.html', 'utf8');
});

describe('web app manifest', () => {
  it('ships every icon it references', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(existsSync(`dist${icon.src}`), `missing ${icon.src}`).toBe(true);
    }
  });

  it('uses PNG icons — Android and iOS both need raster here', () => {
    for (const icon of manifest.icons) expect(icon.type).toBe('image/png');
  });

  it('provides a maskable icon so Android does not letterbox the mark', () => {
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('provides the 192 and 512 sizes installers ask for', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('themes the browser chrome dark, to match the app', () => {
    // a light theme_color put a tan status bar around a near-black stage
    expect(manifest.theme_color).toBe('#0f0e0d');
    expect(manifest.background_color).toBe('#0f0e0d');
  });

  it('installs standalone from its own scope', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('describes what the build actually has', async () => {
    const { MODES, THEMES } = await import('../src/themes.js');
    expect(manifest.description).toContain(`${MODES.length} stage modes`);
    expect(manifest.description).toContain(`${THEMES.length} themes`);
  });
});

describe('iOS home-screen meta', () => {
  it('points at a PNG apple-touch-icon that exists', () => {
    const m = html.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
    expect(m, 'no apple-touch-icon link').toBeTruthy();
    expect(m[1]).toMatch(/\.png$/);
    expect(existsSync(`dist${m[1]}`)).toBe(true);
  });

  it('declares standalone capability, which iOS reads only from meta', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });

  it('keeps the theme-color meta in step with the manifest', () => {
    const m = html.match(/name="theme-color"\s+content="([^"]+)"/);
    expect(m[1]).toBe(manifest.theme_color);
  });
});

describe('viewport', () => {
  it('opts into the display cutout so safe-area insets resolve', () => {
    const m = html.match(/name="viewport"[\s\S]*?content="([^"]+)"/);
    expect(m[1]).toContain('viewport-fit=cover');
    expect(m[1]).toContain('width=device-width');
  });
});

describe('stylesheet', () => {
  it('actually consumes the safe-area insets it opted into', () => {
    const css = readFileSync('src/style.css', 'utf8');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`env(safe-area-inset-${side}`);
    }
  });

  it('keeps drag surfaces out of the browser scroll gesture', () => {
    const css = readFileSync('src/style.css', 'utf8');
    const seek = css.slice(css.indexOf('.seek-track {'), css.indexOf('.seek-track {') + 300);
    expect(seek).toContain('touch-action: none');
  });
});
