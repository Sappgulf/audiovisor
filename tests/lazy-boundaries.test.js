/**
 * The feature modules below are fetched by their loaders the first time the
 * feature is used. This builds the real module graph and checks that none of
 * them is part of the entry chunk, which is what a cold visit parses before
 * the first frame, and that each one lands in a separate lazy chunk.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'vite';

const LAZY = [
  'midi.js',
  'about.js',
  'share-card.js',
  'albumart.js',
  'artpalette.js',
  'social-ui.js',
  'social.js',
  'ai-studio.js',
  'ai.js',
];

describe('feature modules stay out of the entry chunk', () => {
  let output;

  beforeAll(async () => {
    const [{ output: out }] = [await build({
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        rollupOptions: { input: 'src/main.js' },
      },
    })].flat();
    output = out;
  });

  const entry = () => output.find((c) => c.type === 'chunk' && c.isEntry);
  const inChunk = (chunk, file) => Object.keys(chunk.modules || {}).some((id) => id.endsWith(`/src/${file}`));

  it('builds a single entry chunk', () => {
    expect(entry()).toBeTruthy();
  });

  for (const file of LAZY) {
    it(`${file} is not in the entry chunk`, () => {
      expect(inChunk(entry(), file)).toBe(false);
    });

    it(`${file} is in a separate lazy chunk`, () => {
      const lazy = output.filter((c) => c.type === 'chunk' && !c.isEntry);
      expect(lazy.some((c) => inChunk(c, file))).toBe(true);
    });
  }
});
