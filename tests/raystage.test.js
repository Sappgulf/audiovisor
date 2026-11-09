import { describe, it, expect } from 'vitest';
import { RayStage } from '../src/raystage.js';
import { SCENE_FRAG, ACCUM_FRAG, BLUR_FRAG, POST_FRAG, VERT } from '../src/rayshader.js';
import { MODES } from '../src/themes.js';
import { parser } from '@shaderfrog/glsl-parser';
import { readFileSync } from 'node:fs';
import { minifyGlsl } from '../vite.config.js';

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
  }, 30_000);

  it('still parse after the build strips comments and indentation', () => {
    for (const [name, src] of Object.entries(sources)) {
      const min = minifyGlsl(src);
      expect(min.startsWith('#version 300 es\n'), name).toBe(true);
      expect(min.length, name).toBeLessThan(src.length);
      expect(() => parser.parse(min.replace('#version 300 es\n', '')), name).not.toThrow();
    }
  }, 30_000);

  it('parses with the mode baked in, the way each scene program is built', () => {
    const baked = minifyGlsl(SCENE_FRAG).replace(/uniform int\s+uMode;/, 'const int uMode = 2;');
    expect(baked.includes('const int uMode = 2;')).toBe(true);
    expect(() => parser.parse(baked.replace('#version 300 es\n', ''))).not.toThrow();
  }, 30_000);

  it('all declare GLSL ES 3.0', () => {
    for (const [name, src] of Object.entries(sources)) {
      expect(src.startsWith('#version 300 es'), name).toBe(true);
    }
  });

  it('keeps 3D scene branches for the signature modes', () => {
    /* scope, tunnel, terrain and chladni still use the ray marcher */
    for (const fn of ['scScope', 'scTunnel', 'scTerrain', 'scChladni']) {
      expect(SCENE_FRAG).toContain(`float ${fn}(vec3 p)`);
    }
    const map = SCENE_FRAG.slice(SCENE_FRAG.indexOf('float map('),
      SCENE_FRAG.indexOf('vec3 normalAt'));
    for (const fn of ['scScope', 'scTunnel', 'scTerrain', 'scChladni']) {
      expect(map, fn).toContain(`return ${fn}(p)`);
    }
  });

  it('routes every non-signature mode through the full-frame field path', () => {
    const signature = new Set(['scope', 'tunnel', 'terrain', 'chladni']);
    const fn = SCENE_FRAG.slice(SCENE_FRAG.indexOf('bool isFieldMode'),
      SCENE_FRAG.indexOf('bool isFieldMode') + 220);
    MODES.forEach((m, i) => {
      if (signature.has(m.id)) {
        expect(fn, `${m.id} should keep its 3D rig`).toContain(`m != ${i}`);
        return;
      }
      expect(SCENE_FRAG, `${m.id} has no field branch`).toContain(`uMode == ${i})`);
    });
  });

  it('compiles a new scene when parallel shader compile is unavailable', () => {
    /* Without KHR_parallel_shader_compile _sceneReady() is always false for
       an uncompiled mode, so the old "keep drawing the previous mode" branch
       could never hand off: the first mode stayed on screen for the whole
       session. Only defer while a parallel link is genuinely in flight. */
    const src = readFileSync(new URL('../src/raystage.js', import.meta.url), 'utf8');
    const at = src.indexOf('let drawMode = this.mode;');
    const block = src.slice(at, src.indexOf('const sp = this._scene(drawMode);', at));
    expect(at).toBeGreaterThan(-1);
    expect(block).toContain('this._parallel &&');
  });

  it('does not shadow the material struct inside matOf', () => {
    /* The GLSL parser used above checks syntax, not semantics: a local
       `float m` in a material branch compiled fine as text but the driver
       rejected every `m.alb` after it. Keep the struct's names reserved. */
    const body = SCENE_FRAG.slice(SCENE_FRAG.indexOf('Mat matOf('), SCENE_FRAG.indexOf('// per-mode emissive gain'));
    expect(body, 'a local m shadows the Mat struct').not.toMatch(
      /\b(?:float|int|vec[234]|mat[234])\s+m\s*=/,
    );
  });

  it('keeps the radar contacts phase-locked to the field sweep', () => {
    /* the beam wedge and the contact flare must read the same sweep phase */
    const radar = SCENE_FRAG.slice(SCENE_FRAG.indexOf('} else if (uMode == 19) {'),
      SCENE_FRAG.indexOf('} else if (uMode == 20) {'));
    expect(radar).toContain('fract(a / TAU - uTime * 0.25)');
    expect(radar).toContain('fract(ang / TAU - uTime * 0.25)');
  });

  it('keeps the tensor field a perspective lattice driven by the mix', () => {
    const tensor = SCENE_FRAG.slice(SCENE_FRAG.indexOf('} else if (uMode == 14) {'),
      SCENE_FRAG.indexOf('} else if (uMode == 15) {'));
    expect(tensor).toContain('1.0 / (0.35 + r)');
    expect(tensor).toContain('uLevel * 0.45');
    expect(tensor).toContain('spec(fract(h))');
  });

  it('keeps the lava field a soft-metaball wax field', () => {
    const lava = SCENE_FRAG.slice(SCENE_FRAG.indexOf('} else if (uMode == 20) {'),
      SCENE_FRAG.indexOf('} else if (uMode == 21) {'));
    expect(lava).toContain('smin(d, s, 0.18)');
    expect(lava).toContain('uBass');
  });

  it('gives every ray-marched mode a camera rig', () => {
    const cam = SCENE_FRAG.slice(SCENE_FRAG.indexOf('void camera('), SCENE_FRAG.indexOf('/* ---------------- main trace'));
    for (const id of ['scope', 'tunnel', 'terrain', 'chladni']) {
      const i = MODES.findIndex((m) => m.id === id);
      expect(cam.includes(`uMode == ${i})`), `camera for ${id}`).toBe(true);
    }
    expect(cam.includes('else')).toBe(true); // unknown modes fall through to the default rig
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
    expect(src.includes('sp.rev !== this._lookRev')).toBe(true);
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
