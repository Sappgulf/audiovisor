import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    /* The provider panel and the raytraced stage are dynamic imports, split
       out so a cold visit does not pay for them. Vite's default would emit
       modulepreload hints that fetch those chunks eagerly anyway, which
       undoes the split — so the hints are off and the chunks load when the
       code actually asks for them. */
    modulePreload: false,
    // Baseline-widely-available keeps the output runnable on the last few
    // years of browsers without shipping legacy transpilation for the
    // stage's WebGL2/WebGPU path, which needs modern runtimes anyway.
    target: 'baseline-widely-available',
    sourcemap: false,
    cssMinify: true,
    // scripts/check-size.mjs enforces the real gzip budgets; keep Vite's
    // own warning above the known-large entry chunk so local builds only
    // flag unexpected growth, not the intentional splits.
    chunkSizeWarningLimit: 160,
  },
  test: {
    /* Several suites do real work rather than mocking it — parsing every
       GLSL shader, rasterizing all 22 stage modes, simulating 26s of audio
       per tempo. The slowest sit around 3s idle, which clears the 5s default
       on a quiet machine and misses it when the CPU is busy; that showed up
       as a single test failing under load and passing on every rerun. These
       are slow computations, not hangs, so give them room. */
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
