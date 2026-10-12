#!/usr/bin/env node
/**
 * Bundle budget. Fails the build when dist/ grows past the limits below.
 *
 * Budgets are on gzip size, since that is what a visitor actually pulls.
 * `entry` covers the JS a cold visit must parse before the first frame —
 * lazily-imported chunks (raytrace stage, music providers) are counted in
 * `total` but not against `entry`, which is the point of splitting them.
 *
 * Raise a budget deliberately, in the same commit as the code that needs
 * the room, with a note saying why.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGETS = {
  /* v8.13: the main.js split into ~40 focused modules adds factory-wrapper
     overhead, and the plugin API + MIDI input add a little more. All in the
     entry because the modules are statically imported. Worth it: the entry
     is still a small payload and the codebase is navigable. */
  /* v8.15: seven five-stop palettes, colour flow, and the cinema fallback
     for browsers without element fullscreen took the entry and CSS to their
     lines. +1kB / +0.5kB here is paid for by v8.14's shader minify, which
     took 6.5kB out of the total — the total stays at 101. */
  /* This polish pass adds the first-run audio card and source-accurate tempo
     display; each component grew by about 0.1kB gzip. Reserve 0.25kB for
     these user-facing additions without changing the 101kB total ceiling. */
  /* v8.17: the responsive auto-hiding transport and honest audio-only player
     add ~0.2kB gzip of CSS. Keep the JS ceilings fixed. */
  /* Raised for the upgrade round: the entry was 58.25 kB with about 0.3 kB
     of room, which left no space for the phone, beat, visual and platform
     work. The new ceiling keeps about 2.5 kB of room for them. The boot
     payload still has to stay near 60 kB, so anything large goes behind a
     dynamic import and the measured entry is reported on every build. */
  entry: 61 * 1024, // initial JS chunk, gzipped
  /* CSS raised by 0.4 kB for the phone target sizes, the loop region on the
     seek track and the tablet layout. Dead rules are still removed first. */
  css: 13.5 * 1024,
  /* v8.10: true-stereo tap, drop detection, the Auto palette reader and the
     share card all ship in the lazy chunks behind the entry. The entry is
     unchanged; only the total went up with the features. That is the point
     of splitting — the boot payload is the number that matters.

     v8.13: the main.js split into focused modules adds a small amount of
     module-wrapper overhead to the entry, and the offline tempo analysis
     worker adds a lazy dsp-worker chunk. Worth it: the boot payload is
     still small and main.js went from 3096 to under 900 lines. */

  /* Feature round: MIDI, About, the share card, the album and palette art,
     and the Source and Studio drawer sections moved out of the entry, which
     took the boot payload from 61.8kB to 57.9kB. Each moved chunk is gzipped
     on its own, so the total rose by about 8kB. That is the cost of splitting,
     and the boot payload is the number this file exists to protect. Raised
     deliberately, with the entry ceiling unchanged. */
  total: 114 * 1024,   // all JS chunks, gzipped (raised with the entry, see above)
};

const DIST = 'dist/assets';

let files;
try {
  files = readdirSync(DIST);
} catch {
  console.error(`✗ ${DIST} not found — run \`npm run build\` first`);
  process.exit(1);
}

const gz = (f) => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (!js.length) {
  console.error('✗ no JS emitted — the build produced nothing to measure');
  process.exit(1);
}

/* The entry chunk is the one index.html loads directly. */
const html = readFileSync('dist/index.html', 'utf8');
const entryFile = js.find((f) => html.includes(f));
if (!entryFile) {
  console.error('✗ could not identify the entry chunk from dist/index.html');
  process.exit(1);
}

const sizes = {
  entry: gz(entryFile),
  css: css.reduce((n, f) => n + gz(f), 0),
  total: js.reduce((n, f) => n + gz(f), 0),
};

const lazy = js.filter((f) => f !== entryFile);
console.log(`entry  ${entryFile}  ${kb(sizes.entry)} gz  (raw ${kb(statSync(join(DIST, entryFile)).size)})`);
for (const f of lazy) console.log(`lazy   ${f}  ${kb(gz(f))} gz`);
for (const f of css) console.log(`css    ${f}  ${kb(gz(f))} gz`);
console.log('');

let failed = false;
for (const [name, limit] of Object.entries(BUDGETS)) {
  const used = sizes[name];
  const pct = Math.round((used / limit) * 100);
  const ok = used <= limit;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(6)} ${kb(used).padStart(9)} / ${kb(limit).padStart(9)} gz  (${pct}%)`);
}

if (failed) {
  console.error('\n✗ bundle budget exceeded — trim it, split it, or raise the budget on purpose');
  process.exit(1);
}
console.log('\n✓ bundle within budget');
