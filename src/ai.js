// AI Remix Studio — stem split via filters + AI FX suggestions
export const STEMS = ['vocals', 'drums', 'bass', 'other'];
export const AI_PRESETS = [
  { name: 'Chopped Soul', fx: { chop: true, reverb: true, lowpass: true }, theme: 'screwed' },
  { name: 'Neon Drill', fx: { crush: true, echo: true, speed: true }, theme: 'cyber' },
  { name: 'Vapor Haze', fx: { chorus: true, reverb: true, autotune: true }, theme: 'vapor' },
  { name: 'Brass Tape', fx: { echo: true, lowpass: true }, theme: 'brass' },
  { name: 'Hyper Pop', fx: { autotune: true, chorus: true, crush: true }, theme: 'candy' },
];

export function suggestPreset(seed = Date.now()) {
  return AI_PRESETS[seed % AI_PRESETS.length];
}
