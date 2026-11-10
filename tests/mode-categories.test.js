/**
 * Mode categories. The grouping must cover every mode in themes.js exactly
 * once, or the picker filter silently hides modes.
 */
import { describe, it, expect } from 'vitest';
import { MODES } from '../src/themes.js';
import { MODE_CATEGORIES, categoryOf, modesInCategory } from '../src/mode-categories.js';

const EXPECTED = {
  spectral: ['bars', 'waves', 'scope', 'spectro'],
  geometric: ['kaleido', 'tunnel', 'tensor', 'prism', 'chladni'],
  organic: ['particles', 'fluid', 'bloomfield', 'fractal', 'lava'],
  cosmic: ['terrain', 'city', 'nebula', 'spiral', 'orb', 'void', 'radar'],
  instrument: ['gpu', 'vinyl', 'plasma'],
};

describe('catalog', () => {
  it('offers the five categories in display order', () => {
    expect(MODE_CATEGORIES.map((c) => c.id))
      .toEqual(['spectral', 'geometric', 'organic', 'cosmic', 'instrument']);
  });

  it('gives every category a label and a unique id', () => {
    for (const category of MODE_CATEGORIES) {
      expect(typeof category.label).toBe('string');
      expect(category.label.length).toBeGreaterThan(0);
    }
    expect(new Set(MODE_CATEGORIES.map((c) => c.id)).size).toBe(MODE_CATEGORIES.length);
  });
});

describe('categoryOf', () => {
  it('maps every current mode to its expected category', () => {
    for (const [category, ids] of Object.entries(EXPECTED)) {
      for (const id of ids) expect(categoryOf(id), id).toBe(category);
    }
  });

  it('covers the live MODES list exactly once', () => {
    const ids = Object.values(EXPECTED).flat();
    expect(ids.slice().sort()).toEqual(MODES.map((m) => m.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back safely for unknown or non-string ids', () => {
    expect(categoryOf('holodeck')).toBe('spectral');
    expect(categoryOf('')).toBe('spectral');
    expect(categoryOf(null)).toBe('spectral');
    expect(categoryOf(42)).toBe('spectral');
    expect(() => categoryOf(undefined)).not.toThrow();
  });
});

describe('modesInCategory', () => {
  it('filters a list of ids and preserves order', () => {
    expect(modesInCategory('geometric', ['bars', 'tunnel', 'kaleido', 'gpu']))
      .toEqual(['tunnel', 'kaleido']);
  });

  it('filters MODES entries without changing their shape', () => {
    const result = modesInCategory('cosmic', MODES);
    expect(result.map((m) => m.id)).toEqual(EXPECTED.cosmic);
    expect(result[0]).toBe(MODES.find((m) => m.id === 'terrain'));
  });

  it('returns an empty list for an unknown category', () => {
    expect(modesInCategory('holodeck', ['bars', 'waves'])).toEqual([]);
  });

  it('returns an empty list for a non-list', () => {
    expect(modesInCategory('spectral', null)).toEqual([]);
    expect(modesInCategory('spectral', undefined)).toEqual([]);
    expect(modesInCategory('spectral', 'bars')).toEqual([]);
  });

  it('skips entries without a usable id', () => {
    expect(modesInCategory('spectral', [null, {}, { id: 42 }, 'bars'])).toEqual(['bars']);
  });

  it('routes an unknown id into the fallback category', () => {
    expect(modesInCategory('spectral', ['bars', 'holodeck'])).toEqual(['bars', 'holodeck']);
  });
});
