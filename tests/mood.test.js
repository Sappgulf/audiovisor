import { describe, it, expect } from 'vitest';
import { detectMood } from '../src/mood.js';

describe('detectMood', () => {
  it('returns null without bpm', () => {
    expect(detectMood({ bpm: 0, bass: 0.5, mid: 0.3, high: 0.2 })).toBeNull();
  });
  it('detects ambient under 65', () => {
    expect(detectMood({ bpm: 50, bass: 0.5, mid: 0.3, high: 0.2 }).tag).toBe('Ambient');
  });
  it('detects lofi bassy 65-88', () => {
    expect(detectMood({ bpm: 75, bass: 0.8, mid: 0.3, high: 0.2 }).tag).toBe('Lo-Fi');
  });
  it('detects house 88-112', () => {
    expect(detectMood({ bpm: 100, bass: 0.5, mid: 0.4, high: 0.4 }).tag).toBe('House');
  });
  it('detects screwed when bassy under 112', () => {
    expect(detectMood({ bpm: 95, bass: 0.9, mid: 0.3, high: 0.2 }).tag).toBe('Screwed');
  });
  it('detects EDM 112-128 treble', () => {
    expect(detectMood({ bpm: 124, bass: 0.4, mid: 0.4, high: 0.6 }).tag).toBe('EDM');
  });
  it('detects drill 145-165', () => {
    expect(detectMood({ bpm: 150, bass: 0.5, mid: 0.3, high: 0.4 }).tag).toBe('Drill');
  });
  it('detects DnB 165-185', () => {
    expect(detectMood({ bpm: 174, bass: 0.5, mid: 0.3, high: 0.4 }).tag).toBe('DnB');
  });
  it('detects hardcore 185+', () => {
    expect(detectMood({ bpm: 190, bass: 0.5, mid: 0.3, high: 0.4 }).tag).toBe('Hardcore');
  });
});
