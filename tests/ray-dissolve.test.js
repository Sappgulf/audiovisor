/**
 * The raytrace mode dissolve. A mode change restarts the sample history, so
 * the canvas fades in over the restart rather than cutting. These read the
 * wiring in main.js and the keyframes in style.css, the way
 * tests/pwa-register.test.js checks main.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.js', 'utf8');
const css = readFileSync('src/style.css', 'utf8');
const dip = main.slice(main.indexOf('function dipRayStage()'), main.indexOf('function setMode('));

describe('raytrace mode dissolve', () => {
  it('dissolves only on a real mode change, never on the boot restore', () => {
    expect(main).toMatch(/const changed = state\.modeId !== id;/);
    expect(main).toMatch(/if \(changed && !restore\) dipRayStage\(\);/);
  });

  it('is skipped under reduce-flashing and reduced motion', () => {
    expect(dip).toMatch(/state\.reduceFlashing/);
    expect(dip).toMatch(/prefersReducedMotion\(\)/);
  });

  it('restarts the fade with a reflow between removing and adding the class', () => {
    expect(dip).toMatch(/classList\.remove\('is-dip'\);\s*void c\.offsetWidth;\s*c\.classList\.add\('is-dip'\);/);
  });

  it('has the canvas class and its keyframes in the stylesheet', () => {
    expect(css).toMatch(/\.stage-canvas\.is-dip \{ animation: ray-fade-in/);
    expect(css).toMatch(/@keyframes ray-fade-in/);
  });
});
