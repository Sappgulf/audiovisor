#!/usr/bin/env node
/**
 * One version bump for every place the release number is baked in.
 *
 *   npm run version:bump 8.25.0
 *
 * package.json, package-lock.json, the service-worker cache name, the mode
 * artwork revision and the README heading all have to agree or returning
 * visitors keep stale assets and the release tests fail for the wrong reason.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2] || process.env.npm_package_version;
if (!/^\d+\.\d+\.\d+$/.test(next || '')) {
  console.error('usage: npm run version:bump <major.minor.patch>');
  process.exit(1);
}
const short = next.split('.').slice(0, 2).join('.');

function edit(file, replace) {
  const before = readFileSync(file, 'utf8');
  const after = replace(before);
  if (after === before) {
    console.warn(`! no version marker changed in ${file}`);
    return;
  }
  writeFileSync(file, after);
  console.log(`✓ ${file}`);
}

for (const file of ['package.json', 'package-lock.json']) {
  edit(file, (s) => {
    const pkg = JSON.parse(s);
    pkg.version = next;
    if (pkg.packages?.['']) pkg.packages[''].version = next;
    return JSON.stringify(pkg, null, 2) + '\n';
  });
}
edit('public/sw.js', (s) => s.replace(/const CACHE = 'audiovisor-v[^']+';/, `const CACHE = 'audiovisor-v${next}';`));
edit('src/mode-picker.js', (s) => s.replace(/\.webp\?v=\d+\.\d+/g, `.webp?v=${short}`));
edit('tests/mode-picker-assets.test.js', (s) => s.replace(/toBe\('\d+\.\d+'\)/g, `toBe('${short}')`));
edit('README.md', (s) => s.replace(/^# AUDIOVISOR — v[\d.]+/m, `# AUDIOVISOR — v${next}`));
