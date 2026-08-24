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

describe('responsive layout rules', () => {
  let css;
  beforeAll(() => { css = readFileSync('src/style.css', 'utf8'); });

  /** Grab the body of the first @media block whose query contains `needle`. */
  const mediaBlock = (needle) => {
    const at = css.indexOf(`@media ${needle}`);
    if (at < 0) return '';
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
    }
    return '';
  };

  it('wraps the transport in the band where one row does not fit', () => {
    // the single-row transport needs ~1133px; below that the scrubber has
    // to take its own row or it collapses to 0px and controls get clipped
    const band = mediaBlock('(min-width: 641px) and (max-width: 1179px)');
    expect(band, 'mid-width transport block missing').not.toBe('');
    expect(band).toContain('flex-wrap: wrap');
    expect(band).toContain('.seek-console');
  });

  it('raises the transport cap where it does lay out in one row', () => {
    const wide = mediaBlock('(min-width: 1180px)');
    expect(wide).toContain('1180px');
  });

  it('has a short-viewport layout for phone landscape', () => {
    const land = mediaBlock('(max-height: 500px) and (orientation: landscape)');
    expect(land, 'landscape block missing').not.toBe('');
    expect(land).toContain('.seek-console');
  });

  it('keeps the narrow-phone tier that stops the topbar clipping', () => {
    const narrow = mediaBlock('(max-width: 360px)');
    expect(narrow).toContain('.wordmark');
  });

  it('sizes floating panels against the viewport, not a fixed width', () => {
    /* The library panel was a fixed 380px pinned to `right: 20px`, so on a
       390px phone it began at left: -26px and its search field and the left
       of every track name sat permanently off-screen. The queue panel had
       been given a responsive width in a media query and this one was
       missed, which is exactly the drift a rule here catches.

       Every rule for the panel is checked, not just the first: an earlier
       media-query override would otherwise satisfy this while the base rule
       stayed fixed — which is exactly what happened when I first wrote it. */
    const rules = (selector) => {
      const out = [];
      const re = new RegExp(`(^|[,{}])\\s*([^{}]*\\${selector}[^{}]*)\\{([^{}]*)\\}`, 'g');
      let m;
      while ((m = re.exec(css))) out.push({ sel: m[2].trim(), body: m[3] });
      return out;
    };

    for (const panel of ['.queue-panel', '.library-panel']) {
      const found = rules(panel);
      expect(found.length, `no rules found for ${panel}`).toBeGreaterThan(0);
      let sawResponsiveWidth = false;
      for (const { sel, body } of found) {
        const fixed = body.match(/width:\s*(\d+)px\s*;/);
        expect(fixed, `${panel} has a fixed width in "${sel}"`).toBeNull();
        if (/width:\s*min\(/.test(body)) sawResponsiveWidth = true;
      }
      expect(sawResponsiveWidth, `${panel} never sets a viewport-relative width`).toBe(true);
    }
  });

  it('leaves no gap between the phone and mid-width transport rules', () => {
    // 640 is the phone ceiling and 641 the mid-width floor; a gap here is
    // how 768 ended up with the wide desktop transport in the first place
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (min-width: 641px) and (max-width: 1179px)');
  });
});
