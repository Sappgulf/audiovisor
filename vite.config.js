import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

/* The GLSL sources are JS template literals, so the minifier leaves them
   alone and every design note inside them shipped to the browser — about a
   third of the raystage chunk. Strip comments and indentation from the
   shader strings at build time; dev and tests keep the annotated source.
   Newlines stay, since preprocessor lines (#version, #define) end at them. */
export function minifyGlsl(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}


/* The service worker can only cache what it knows about. Emit a build-time
   manifest of every JS/CSS chunk (including lazy ones) plus the static fonts,
   icons and mode stills, so a first install can render offline instead of
   waiting for a second online visit to populate the cache. */
const precacheManifest = {
  name: 'precache-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    const assets = new Set(['/precache-manifest.json', '/manifest.json']);
    for (const file of Object.keys(bundle)) {
      if (/\.(js|css)$/.test(file)) assets.add('/' + file);
    }
    for (const file of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      assets.add('/icons/' + file);
    }
    for (const file of [
      'space-grotesk-400.woff2', 'space-grotesk-500.woff2',
      'space-grotesk-600.woff2', 'space-grotesk-700.woff2',
      'jetbrains-mono-400.woff2', 'jetbrains-mono-500.woff2',
    ]) assets.add('/fonts/' + file);
    try {
      for (const file of readdirSync('public/modes')) {
        if (file.endsWith('.webp') && !file.includes('-anim')) assets.add('/modes/' + file);
      }
    } catch { /* styles/art may not exist in a minimal checkout */ }
    this.emitFile({
      type: 'asset',
      fileName: 'precache-manifest.json',
      source: JSON.stringify({ assets: [...assets].sort() }, null, 2),
    });
  },
};

const glslMinify = {
  name: 'glsl-minify',
  apply: 'build',
  transform(code, id) {
    if (!id.endsWith('/src/rayshader.js')) return null;
    return { code: code.replace(/`(#version[\s\S]*?)`/g, (_, body) => `\`${minifyGlsl(body)}\``), map: null };
  },
};

export default defineConfig({
  plugins: [glslMinify, precacheManifest],
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
    // own warning above the known-large entry chunk (currently ~183 kB raw)
    // so local builds only flag unexpected growth, not the intentional
    // splits.
    chunkSizeWarningLimit: 200,
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
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      /* Coverage is a report, not yet a gate — the render/shader suites do a
         lot of real work that is hard to attribute to a single module, so a
         threshold here would fail on noise. Raise a floor once the numbers
         have settled. */
      include: ['src/**/*.js'],
      exclude: ['src/dom-shim.d.ts'],
      /* A floor below today's measured baseline (roughly 60/47/49/63) so a
         drop is visible in CI without pretending the UI orchestration suites
         are fully unit-tested. Raise these as coverage improves. */
      thresholds: {
        statements: 55,
        branches: 42,
        functions: 44,
        lines: 57,
      },
    },
  },
});
