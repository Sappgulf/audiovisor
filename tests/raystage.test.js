import { describe, it, expect } from 'vitest';
import { RayStage } from '../src/raystage.js';
import { SCENE_FRAG, ACCUM_FRAG, BLUR_FRAG, POST_FRAG, VERT } from '../src/rayshader.js';
import { MODES } from '../src/themes.js';
import { parser } from '@shaderfrog/glsl-parser';
import { readFileSync } from 'node:fs';

function fakeCanvas(ctx = null) {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 800, height: 400 }),
  };
}

describe('RayStage', () => {
  it('degrades gracefully when WebGL2 is unavailable', () => {
    const s = new RayStage(fakeCanvas(null));
    expect(s.ok).toBe(false);
    expect(s.error).toBe('webgl2 unavailable');
    // every setter must stay callable so callers never need to branch
    expect(() => {
      s.setMode('bars');
      s.setTheme({ colors: ['#ffffff'] });
      s.setQuality('low');
      s.setSensitivity(1);
      s.setBloom(0.5);
      s.resize(800, 400);
      s.render(true, null, null, null, 16.7);
    }).not.toThrow();
  });
});

describe('ray shaders', () => {
  const sources = { VERT, SCENE_FRAG, ACCUM_FRAG, BLUR_FRAG, POST_FRAG };

  it('all parse as valid GLSL', () => {
    // a syntax slip here compiles to nothing at runtime and silently drops
    // the whole stage to the Canvas2D fallback, so catch it in CI instead
    for (const [name, src] of Object.entries(sources)) {
      expect(() => parser.parse(src.replace('#version 300 es\n', '')), name).not.toThrow();
    }
  }, 15_000);

  it('all declare GLSL ES 3.0', () => {
    for (const [name, src] of Object.entries(sources)) {
      expect(src.startsWith('#version 300 es'), name).toBe(true);
    }
  });

  it('has a scene branch for every stage mode', () => {
    // map() dispatches on the MODES index; the pure-volumetric modes are
    // handled by isVolumetric() instead of a map() branch (lava is a hybrid:
    // an SDF glass vessel with the wax composited in as a volume)
    const volumetric = ['nebula', 'spiral'];
    MODES.forEach((m, i) => {
      if (volumetric.includes(m.id)) return;
      expect(SCENE_FRAG.includes(`uMode == ${i})`), `${m.id} (index ${i})`).toBe(true);
    });
  });

  it('routes the pure-volumetric modes through isVolumetric', () => {
    const idx = ['nebula', 'spiral'].map((id) => MODES.findIndex((m) => m.id === id));
    const fn = SCENE_FRAG.slice(SCENE_FRAG.indexOf('bool isVolumetric'), SCENE_FRAG.indexOf('bool isVolumetric') + 120);
    for (const i of idx) expect(fn.includes(`m == ${i}`)).toBe(true);
  });

  it('keeps the radar contacts phase-locked to the deck sweep', () => {
    /* The contact flare in scRadar must read the same sweep fraction the
       deck material draws its phosphor wedge from — fract(a / TAU - uTime *
       0.22). Change one side without the other and the contacts blink out
       of sync with the beam that is supposed to be illuminating them. */
    const radar = SCENE_FRAG.slice(SCENE_FRAG.indexOf('float scRadar'), SCENE_FRAG.indexOf('/* 21 gpu'));
    expect(radar).toContain('fract(a / TAU - uTime * 0.22)');
    const mat = SCENE_FRAG.slice(SCENE_FRAG.indexOf('id < 15.5'));
    expect(mat).toContain('- uTime * 0.22');
  });

  it('couples each tensor axis family to a band and the drop to the volumes', () => {
    /* bass/mids/highs own one rod direction each; the three volumetric
       densities answer the drop envelope so breakdowns land there too */
    expect(SCENE_FRAG).toContain('uBass * 0.026');
    expect(SCENE_FRAG).toContain('uMid * 0.022');
    expect(SCENE_FRAG).toContain('uHigh * 0.018');
    const vol = SCENE_FRAG.slice(SCENE_FRAG.indexOf('float volDensity'));
    expect(vol.match(/uDrop/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('marches the lava volume past the near glass wall, not up to it', () => {
    /* The vessel's near wall is the first surface the ray hits, so limiting
       the volume march to that hit distance marched nothing but the air in
       front of the lamp and the wax never rendered — an empty glass tube.
       The limit has to clear the vessel interior. */
    const lava = MODES.findIndex((m) => m.id === 'lava');
    const call = SCENE_FRAG.match(
      new RegExp(`if \\(uMode == ${lava}\\) col \\+= marchVolume\\(ro, rd, t([^)]*)\\);`),
    );
    expect(call).not.toBe(null);
    expect(parseFloat(call[1].replace('+', ''))).toBeGreaterThan(2.3);
  });

  it('gives every mode a camera rig', () => {
    const cam = SCENE_FRAG.slice(SCENE_FRAG.indexOf('void camera('), SCENE_FRAG.indexOf('/* ---------------- main trace'));
    for (let i = 0; i < MODES.length - 1; i++) {
      expect(cam.includes(`uMode == ${i})`), `camera for ${MODES[i].id}`).toBe(true);
    }
    expect(cam.includes('else')).toBe(true); // last mode falls through to the default rig
  });
});

describe('RayStage runtime behaviour', () => {
  it('reuses its audio scratch buffers instead of allocating per frame', () => {
    const src = readFileSync(new URL('../src/raystage.js', import.meta.url), 'utf8');
    // these run 60-144x a second; a fresh Uint8Array each time is pure GC churn
    expect(src.includes('this._specScratch')).toBe(true);
    expect(src.includes('this._waveScratch')).toBe(true);
    expect(/_uploadAudio\([^)]*\)\s*\{[\s\S]{0,400}new Uint8Array\(256\)\s*;/.test(src)).toBe(false);
  });

  it('scrolls the spectrum history on a clock, not per frame', () => {
    const src = readFileSync(new URL('../src/raystage.js', import.meta.url), 'utf8');
    // per-frame pushes make the waterfall run at double speed on a 120Hz panel
    expect(src.includes('this._histAcc >= 1 / 45')).toBe(true);
  });

  it('maps uploads through cached index tables, not per-texel pow()', () => {
    /* the log-ish bin maps are constants of the input length; recomputing
       ~768 pows+floors every frame showed up as CPU burn on weak machines */
    const src = readFileSync(new URL('../src/raystage.js', import.meta.url), 'utf8');
    const push = src.slice(src.indexOf('pushHistory(freq)'), src.indexOf('_specIdxFor(n)'));
    expect(push.includes('Math.pow')).toBe(false);
    expect(src.includes('this._histIdxFor(freq.length)')).toBe(true);
    expect(src.includes("this._specIdxFor(freq.length)")).toBe(true);
  });

  it('gates static uniforms behind a look revision and skips dead bloom', () => {
    const src = readFileSync(new URL('../src/raystage.js', import.meta.url), 'utf8');
    // mode/tier/palette/samplers only change with a look edit
    expect(src.includes('this._lookRev !== this._staticRev')).toBe(true);
    // a width-only resize must invalidate accumulation too, or history
    // resamples the stale buffer for a frame
    expect(src.includes('this._lastKeyH === this.rh')).toBe(true);
    // at bloom 0 the two quarter-res passes contribute nothing and are skipped
    expect((src.match(/bloomAmount > 0\.001/g) || []).length).toBe(2);
  });
});

describe('shader source integrity', () => {
  /* Every shader lives in a JS template literal. One stray backtick is
     caught loudly — the file stops parsing and lint and the build both
     fail, which is how I found it after quoting a tier name in a shader
     comment. A balanced pair is the dangerous case: it parses fine and
     quietly cuts a hole in the shader source, and the stage then drops to
     Canvas2D at runtime with nothing to point at. Same for ${...}, which
     would be interpolated as JS. */
  const raw = readFileSync('src/rayshader.js', 'utf8');

  for (const [name, src] of Object.entries({ VERT, SCENE_FRAG, ACCUM_FRAG, BLUR_FRAG, POST_FRAG })) {
    it(`${name} contains no template-literal delimiters`, () => {
      expect(src.includes('`'), 'backtick would close the template literal').toBe(false);
      expect(src.includes('${'), 'interpolation would be evaluated as JS').toBe(false);
    });

    it(`${name} declares a GLSL ES 3.00 version on its first line`, () => {
      expect(src.trimStart().startsWith('#version 300 es')).toBe(true);
    });
  }

  it('has balanced template delimiters in the source file', () => {
    expect(raw).toContain('export const SCENE_FRAG');
    expect(raw.split('`').length % 2, 'unbalanced backticks in rayshader.js').toBe(1);
  });
});
