/**
 * The manifest and iOS meta tags are easy to break silently — a renamed
 * icon or a stale colour shows up only once someone installs the app to a
 * home screen. These assert the contract against the built output.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

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

describe('accessibility contract', () => {
  let html, main;
  beforeAll(() => {
    html = readFileSync('index.html', 'utf8');
    main = readFileSync('src/main.js', 'utf8');
  });

  it('hides the decorative canvases from assistive tech', () => {
    /* Three unlabelled canvases were announced as "canvas" with no name.
       The stage is a rendering of audio that is already playing and the
       seek waveform sits behind a slider that reports its own position, so
       there is nothing for a screen reader to gain by reaching them. */
    for (const id of ['ray-canvas', 'viz-canvas', 'webgpu-canvas', 'seek-wave']) {
      const tag = html.match(new RegExp(`<canvas[^>]*id="${id}"[^>]*>`));
      expect(tag, `canvas#${id} not found`).toBeTruthy();
      expect(tag[0], `canvas#${id} should be aria-hidden`).toMatch(/aria-hidden="true"/);
    }
  });

  it('keeps the VU meter labelled, since it does carry information', () => {
    const tag = html.match(/<canvas[^>]*id="vu-meter"[^>]*>/);
    expect(tag[0]).toMatch(/aria-label=/);
  });

  it('flips class and reported state together', () => {
    /* Every toggle used to set a class and nothing else, so a screen reader
       announced "Reverb, button" whether it was on or off. One helper does
       both, and nothing should be setting the class on its own any more. */
    expect(main).toMatch(/function setToggle\(el, on, cls/);
    const helper = main.slice(main.indexOf('function setToggle'), main.indexOf('function setToggle') + 260);
    expect(helper).toMatch(/classList\.toggle/);
    expect(helper).toMatch(/aria-pressed/);
  });

  it('seeds every toggle at boot, so none starts out silent', () => {
    expect(main).toMatch(/TOGGLE_SELECTOR/);
    expect(main).toMatch(/querySelectorAll\(TOGGLE_SELECTOR\)/);
    // the seeding pass has to run after preferences are restored
    expect(main.indexOf('querySelectorAll(TOGGLE_SELECTOR)'))
      .toBeGreaterThan(main.indexOf('\nloadSettings();'));
  });

  it('routes the on/off controls through the helper rather than the class', () => {
    for (const id of ['loop-btn', 'queue-btn', 'library-btn', 'mic-btn', 'capture-btn']) {
      const direct = new RegExp(`\\$\\('${id}'\\)\\.classList\\.(toggle|add|remove)\\('is-on'`);
      expect(main, `#${id} still sets is-on directly`).not.toMatch(direct);
    }
  });
});

describe('touch-device compositing', () => {
  let css;
  beforeAll(() => { css = readFileSync('src/style.css', 'utf8'); });

  /* A backdrop-filter has to resample and re-blur whatever sits behind it.
     All of this app's chrome sits over a canvas that repaints every frame,
     so the blur is recomputed every frame — on the compositor, where it
     never appears in a JS profile. On an iPhone 16 Pro that made the UI
     feel unresponsive while the visualiser itself looked fine. */
  /* Selectors are indented inside media queries, so a scanner that only
     matches them at line start silently attributes declarations to whatever
     top-level rule came last. That mistake reported a false failure here
     before this was tightened. */
  const rules = () => {
    // comments can contain braces and commas; drop them before parsing
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    // a selector list may span several lines, so newlines are allowed in it
    const re = /([.#][^{}]*?)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean))) {
      const sel = m[1].trim();
      if (!sel.startsWith('.') && !sel.startsWith('#')) continue;
      out.push({ sel, body: m[2] });
    }
    return out;
  };

  const activeBlurSelectors = () => {
    const out = new Set();
    for (const { sel, body } of rules()) {
      if (!/backdrop-filter:\s*(?!none)\S/.test(body)) continue;
      for (const s of sel.split(',')) out.add(s.trim());
    }
    return [...out];
  };

  const blurDisabledSelectors = () => {
    const out = new Set();
    for (const { sel, body } of rules()) {
      if (!/backdrop-filter:\s*none/.test(body)) continue;
      for (const s of sel.split(',')) out.add(s.trim());
    }
    return [...out];
  };

  const coarseBlock = () => {
    const at = css.indexOf('@media (pointer: coarse)');
    expect(at, 'no coarse-pointer block').toBeGreaterThan(-1);
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
    }
    return '';
  };

  it('disables every live blur on touch devices', () => {
    const disabled = blurDisabledSelectors();
    const uncovered = activeBlurSelectors().filter((s) => !disabled.includes(s));
    expect(uncovered, `still blurring over the animating stage on touch: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('disables both the prefixed and unprefixed property in the built CSS', () => {
    /* The blur ships as both -webkit-backdrop-filter and backdrop-filter.
       Written standard-first, the minifier collapsed the override pair and
       kept only the -webkit- form — which would have left the blur running
       on Android Chrome while appearing fixed on iOS. */
    const built = readdirSync('dist/assets').find((f) => f.endsWith('.css'));
    expect(built, 'run `npm run build` first').toBeTruthy();
    const out = readFileSync(`dist/assets/${built}`, 'utf8');
    const block = out.slice(out.indexOf('pointer:coarse'));
    const rule = block.slice(0, block.indexOf('}') + 1);
    expect(rule).toContain('-webkit-backdrop-filter:none');
    expect(rule).toMatch(/[^-]backdrop-filter:none/);
  });

  it('keeps the blur on pointer-precise devices', () => {
    // a desktop has the headroom, and the frosted look is the design
    expect(activeBlurSelectors().length).toBeGreaterThan(5);
  });

  it('replaces the separation the blur was providing with opacity', () => {
    const block = coarseBlock();
    for (const sel of ['.topbar', '.transport', '.drawer']) {
      const at = block.indexOf(`${sel} { background:`);
      expect(at, `${sel} needs a more opaque background without its blur`).toBeGreaterThan(-1);
      const alpha = Number(block.slice(at).match(/rgba\([^)]*?([\d.]+)\)/)[1]);
      expect(alpha, `${sel} background too transparent without a blur`).toBeGreaterThan(0.9);
    }
  });
});
