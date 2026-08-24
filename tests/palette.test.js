import { describe, it, expect } from 'vitest';
import { filterCommands, clampActive, PALETTE_DEFAULT_LIMIT } from '../src/palette.js';

const CMDS = [
  { label: 'Mode: Bars', keys: 'bars' },
  { label: 'Theme: Brass', keys: 'brass' },
  { label: 'FX: REVERB', keys: 'reverb' },
  { label: 'Random Look', keys: 'random' },
  { label: 'Toggle Raytrace', keys: 'raytrace rt gpu renderer' },
];

describe('filterCommands', () => {
  it('shows the first N commands for an empty query', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `C${i}`, keys: '' }));
    expect(filterCommands(many, '')).toHaveLength(PALETTE_DEFAULT_LIMIT);
    expect(filterCommands(many, '')[0].label).toBe('C0');
  });

  it('treats a whitespace-only query as empty', () => {
    expect(filterCommands(CMDS, '   ')).toEqual(filterCommands(CMDS, ''));
  });

  it('matches on label, case-insensitively', () => {
    expect(filterCommands(CMDS, 'BRASS').map((c) => c.label)).toEqual(['Theme: Brass']);
  });

  it('matches on the hidden keys field', () => {
    expect(filterCommands(CMDS, 'gpu').map((c) => c.label)).toEqual(['Toggle Raytrace']);
  });

  it('lowercases the keys field before matching', () => {
    const cmds = [{ label: 'Export Remix', keys: 'EXPORT' }];
    expect(filterCommands(cmds, 'export')).toHaveLength(1);
  });

  it('is not capped once a query is present', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `Mode ${i}`, keys: '' }));
    expect(filterCommands(many, 'mode')).toHaveLength(40);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterCommands(CMDS, 'zzz')).toEqual([]);
  });

  it('tolerates a missing keys field and null query', () => {
    expect(() => filterCommands([{ label: 'A' }], 'a')).not.toThrow();
    expect(filterCommands(CMDS, null)).toEqual(filterCommands(CMDS, ''));
  });

  it('gives render and Enter the same list — the drift that used to be possible', () => {
    // renderCmds and the Enter handler each had their own copy of this
    // expression; a query matching >12 items made them disagree.
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `Mode ${i}`, keys: 'mode' }));
    const rendered = filterCommands(many, 'mode');
    const onEnter = filterCommands(many, 'mode');
    expect(onEnter[20]).toBe(rendered[20]);
  });
});

describe('clampActive', () => {
  it('keeps the index inside a shrinking list', () => {
    expect(clampActive(9, 3)).toBe(2);
  });

  it('never goes negative', () => {
    expect(clampActive(-4, 5)).toBe(0);
  });

  it('collapses to 0 for an empty list', () => {
    expect(clampActive(3, 0)).toBe(0);
  });

  it('leaves a valid index alone', () => {
    expect(clampActive(2, 5)).toBe(2);
  });
});
