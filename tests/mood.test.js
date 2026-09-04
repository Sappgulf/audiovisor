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
  it('keeps every tag without width (unmeasured sources are unaffected)', () => {
    expect(detectMood({ bpm: 75, bass: 0.8, mid: 0.3, high: 0.2, width: undefined }).tag).toBe('Lo-Fi');
    expect(detectMood({ bpm: 124, bass: 0.4, mid: 0.4, high: 0.6, width: undefined }).tag).toBe('EDM');
  });
  it('reads spacious bass under 88 as downtempo, not lo-fi', () => {
    expect(detectMood({ bpm: 75, bass: 0.8, mid: 0.3, high: 0.2, width: 0.6 }).tag).toBe('Downtempo');
    expect(detectMood({ bpm: 75, bass: 0.8, mid: 0.3, high: 0.2, width: 0.1 }).tag).toBe('Lo-Fi');
  });
  it('reads narrow bright 112-128 as house, wide as EDM', () => {
    expect(detectMood({ bpm: 124, bass: 0.4, mid: 0.4, high: 0.6, width: 0.1 }).tag).toBe('House');
    expect(detectMood({ bpm: 124, bass: 0.4, mid: 0.4, high: 0.6, width: 0.7 }).tag).toBe('EDM');
  });
});
