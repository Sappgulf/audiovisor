// AI Remix Studio — stem filters + mood-aware FX suggestions
export const STEMS = ['vocals', 'drums', 'bass', 'other'];

export const AI_PRESETS = [
  { name: 'Chopped Soul', fx: { chop: true, reverb: true, lowpass: true }, theme: 'screwed', fits: ['Ambient', 'Lo-Fi', 'Screwed'] },
  { name: 'Neon Drill', fx: { crush: true, echo: true, speed: true }, theme: 'cyber', fits: ['Trap', 'Drill', 'DnB', 'EDM'] },
  { name: 'Vapor Haze', fx: { chorus: true, reverb: true, autotune: true }, theme: 'vapor', fits: ['House', 'Ambient', 'Lo-Fi'] },
  { name: 'Brass Tape', fx: { echo: true, lowpass: true }, theme: 'brass', fits: ['Lo-Fi', 'Ambient', 'Screwed'] },
  { name: 'Hyper Pop', fx: { autotune: true, chorus: true, crush: true }, theme: 'candy', fits: ['EDM', 'Trap', 'Drill', 'DnB', 'House'] },
];

/**
 * Pick a preset from the track's live mood, tempo and spectral balance.
 *
 * The old "AI Suggest" was `AI_PRESETS[Math.random()]`; it looked random
 * because it was. This still has a deterministic seed fallback, but when the
 * analyser is running the suggestion follows what is actually playing.
 *
 * @param {{ mood?: string, bpm?: number, bass?: number, mid?: number, high?: number, level?: number, seed?: number } | number} [input]
 */
export function suggestPreset(input = {}) {
  const ctx = typeof input === 'number' ? { seed: input } : (input || {});
  const seed = Number.isFinite(ctx.seed) ? ctx.seed : Math.floor(Math.random() * 9999);
  const mood = String(ctx.mood || '').trim();
  const fits = AI_PRESETS.filter((p) => p.fits?.includes(mood));
  if (fits.length) return fits[seed % fits.length];

  const bpm = Number(ctx.bpm) || 0;
  const high = Number(ctx.high) || 0;
  const bass = Number(ctx.bass) || 0;
  const level = Number(ctx.level) || 0;
  if (bpm >= 140 || high >= 0.55 || level >= 0.72) return AI_PRESETS[4];
  if (bpm > 0 && bpm < 88) return AI_PRESETS[0];
  if (bass > 0.65) return AI_PRESETS[1];
  return AI_PRESETS[seed % AI_PRESETS.length];
}
