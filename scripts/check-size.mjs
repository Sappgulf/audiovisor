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
  entry: 53 * 1024,    // initial JS chunk, gzipped
  css: 12 * 1024,
  /* v8.10: true-stereo tap, drop detection, the Auto palette reader and the
     share card all ship in the lazy chunks behind the entry. The entry is
     unchanged; only the total went up with the features. That is the point
     of splitting — the boot payload is the number that matters. */
  total: 92 * 1024,    // all JS chunks, gzipped
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
