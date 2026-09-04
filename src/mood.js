// Genre/Mood detector — tempo + spectral balance heuristics
export function detectMood({ bpm = 0, bass = 0, mid = 0, high = 0, width } = {}) {
  void mid;
  if (!bpm || bpm <= 0) return null;
  /* Stereo width only ever subdivides an existing call: without it every
     branch below reads exactly as before, so unmeasured sources keep their
     tags. Where it is known, a narrow image separates bedroom mono (Lo-Fi,
     House) from spacious stage-wide mixes (Downtempo, EDM) at the same
     tempo and spectral balance. */
  const narrow = width !== undefined && width < 0.2;
  const spacious = width !== undefined && width >= 0.35;
  const centroid = high - bass; // >0 treble-heavy, <0 bassy
  if (bpm < 65) return { tag: 'Ambient', icon: 'cloud' };
  if (bpm < 88) {
    if (centroid < -0.05) return spacious
      ? { tag: 'Downtempo', icon: 'target' }
      : { tag: 'Lo-Fi', icon: 'link' };
    return { tag: 'Downtempo', icon: 'target' };
  }
  if (bpm < 112) return centroid < -0.1 ? { tag: 'Screwed', icon: 'snowflake' } : { tag: 'House', icon: 'zap' };
  if (bpm < 128) {
    if (centroid > 0.05) return narrow
      ? { tag: 'House', icon: 'zap' }
      : { tag: 'EDM', icon: 'sparkles' };
    return { tag: 'Hip-Hop', icon: 'mic' };
  }
  if (bpm < 145) return centroid > 0.02 ? { tag: 'Tech House', icon: 'circle-dot' } : { tag: 'Trap', icon: 'bars' };
  if (bpm < 165) return { tag: 'Drill', icon: 'orbit' };
  if (bpm < 185) return { tag: 'DnB', icon: 'activity' };
  return { tag: 'Hardcore', icon: 'record' };
}
