import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS } from '../src/icons.js';

/* Every icon name written as a literal in index.html or passed to setIcon
   has to exist in ICONS, or the glyph silently renders empty. Names built at
   runtime (mode and plugin icons) are not checked here. */
function literalIconNames() {
  const names = new Set();
  const add = (re, text) => { for (const m of text.matchAll(re)) names.add(m[1]); };

  const html = readFileSync('index.html', 'utf8');
  add(/data-icon="([a-z][a-z0-9-]*)"/g, html);

  const srcDir = 'src';
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith('.js') && x !== 'icons.js')) {
    const text = readFileSync(join(srcDir, f), 'utf8');
    // setIcon(el, 'name') and setIcon(el, cond ? 'a' : 'b') and setIcon(el, x || 'name')
    add(/setIcon\([^,\n]+,\s*'([a-z][a-z0-9-]*)'\s*\)/g, text);
    add(/setIcon\([^\n]*\?\s*'([a-z][a-z0-9-]*)'/g, text);
    add(/setIcon\([^\n]*:\s*'([a-z][a-z0-9-]*)'\s*\)/g, text);
    add(/setIcon\([^\n]*\|\|\s*'([a-z][a-z0-9-]*)'/g, text);
    add(/data-icon="([a-z][a-z0-9-]*)"/g, text);
  }
  return [...names].sort();
}

describe('icon references', () => {
  const names = literalIconNames();

  it('finds the literal references it is meant to check', () => {
    expect(names).toEqual(expect.arrayContaining(['play', 'music2', 'link', 'layers']));
  });

  for (const name of names) {
    it(`"${name}" exists in ICONS`, () => {
      expect(ICONS[name], `missing icon "${name}"`).toBeTypeOf('string');
    });
  }
});
