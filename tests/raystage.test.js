import { describe, it, expect } from 'vitest';
import { RayStage } from '../src/raystage.js';
import { SCENE_FRAG, ACCUM_FRAG, BLUR_FRAG, POST_FRAG, VERT } from '../src/rayshader.js';
import { MODES } from '../src/themes.js';
import { parser } from '@shaderfrog/glsl-parser';

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
  });

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

  it('composites the lava volume against its glass vessel', () => {
    const lava = MODES.findIndex((m) => m.id === 'lava');
    expect(SCENE_FRAG.includes(`if (uMode == ${lava}) col += marchVolume(ro, rd, t);`)).toBe(true);
  });

  it('gives every mode a camera rig', () => {
    const cam = SCENE_FRAG.slice(SCENE_FRAG.indexOf('void camera('), SCENE_FRAG.indexOf('/* ---------------- main trace'));
    for (let i = 0; i < MODES.length - 1; i++) {
      expect(cam.includes(`uMode == ${i})`), `camera for ${MODES[i].id}`).toBe(true);
    }
    expect(cam.includes('else')).toBe(true); // last mode falls through to the default rig
  });
});
