import { describe, it, expect } from 'vitest';
import { AI_PRESETS, suggestPreset } from '../src/ai.js';

describe('mood-aware AI suggestions', () => {
  it('follows the live mood when it has a matching preset', () => {
    expect(suggestPreset({ mood: 'Trap', seed: 1 }).name).toMatch(/Neon Drill|Hyper Pop/);
    expect(suggestPreset({ mood: 'Screwed', seed: 2 }).name).toBe('Chopped Soul');
    expect(suggestPreset({ mood: 'House', seed: 3 }).name).toMatch(/Vapor Haze|Hyper Pop/);
  });

  it('uses tempo and energy when there is no mood yet', () => {
    expect(suggestPreset({ bpm: 60, seed: 0 }).name).toBe('Chopped Soul');
    expect(suggestPreset({ bpm: 150, seed: 0 }).name).toBe('Hyper Pop');
    expect(suggestPreset({ high: 0.7, seed: 0 }).name).toBe('Hyper Pop');
    expect(suggestPreset({ bass: 0.8, seed: 0 }).name).toBe('Neon Drill');
  });

  it('still returns a preset for an empty or legacy numeric seed', () => {
    expect(AI_PRESETS).toContain(suggestPreset());
    expect(AI_PRESETS).toContain(suggestPreset(3));
  });
});
