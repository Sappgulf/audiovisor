/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import axe from 'axe-core';

/**
 * Static accessibility audit of the shipped shell.
 *
 * This loads index.html as-is (no scripts) and runs axe against the initial
 * DOM. It catches the structural problems that are cheapest to fix and
 * easiest to regress — unnamed controls, missing labels, duplicate ids,
 * missing landmarks and language — without needing a browser. Behavioural
 * accessibility (focus order, live regions firing) stays with the boot
 * smoke test and the Playwright screenshots.
 */
describe('static accessibility audit', () => {
  let results;

  beforeAll(async () => {
    const html = readFileSync('index.html', 'utf8');
    document.open();
    document.write(html);
    document.close();
    results = await axe.run(document, {
      // layout-dependent rules cannot run in jsdom
      rules: {
        'color-contrast': { enabled: false },
        region: { enabled: false },
      },
    });
  }, 30000);

  it('has no serious or critical violations', () => {
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    const summary = serious.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`).join('\n');
    expect(serious, summary).toEqual([]);
  });

  it('labels every button and link', () => {
    const named = [...results.violations, ...results.incomplete]
      .filter((v) => v.id === 'button-name' || v.id === 'link-name');
    const nodes = named.flatMap((v) => v.nodes.map((n) => n.html));
    expect(nodes, nodes.join('\n')).toEqual([]);
  });
});
