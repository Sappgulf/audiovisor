// Genre/Mood detector — tempo + spectral balance heuristics
export function detectMood({ bpm = 0, bass = 0, mid = 0, high = 0 }) {
  void mid;
  if (!bpm || bpm <= 0) return null;
  const centroid = high - bass; // >0 treble-heavy, <0 bassy
  if (bpm < 65) return { tag: 'Ambient', icon: 'cloud' };
  if (bpm < 88) return centroid < -0.05 ? { tag: 'Lo-Fi', icon: 'link' } : { tag: 'Downtempo', icon: 'target' };
  if (bpm < 112) return centroid < -0.1 ? { tag: 'Screwed', icon: 'snowflake' } : { tag: 'House', icon: 'zap' };
  if (bpm < 128) return centroid > 0.05 ? { tag: 'EDM', icon: 'sparkles' } : { tag: 'Hip-Hop', icon: 'mic' };
  if (bpm < 145) return centroid > 0.02 ? { tag: 'Tech House', icon: 'circle-dot' } : { tag: 'Trap', icon: 'bars' };
  if (bpm < 165) return { tag: 'Drill', icon: 'orbit' };
  if (bpm < 185) return { tag: 'DnB', icon: 'activity' };
  return { tag: 'Hardcore', icon: 'record' };
}
