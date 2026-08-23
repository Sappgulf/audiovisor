// Procedural album art v2 — deterministic cover per track name + theme
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateAlbumArt(name, colors = ['#d9b089', '#c49a6e', '#f5e6d3'], size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const seed = hashStr(name || 'audiovisor');
  const rnd = mulberry(seed);
  const cx = size / 2;

  // bg mood gradient
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1] || colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // radial glow behind center
  const glow = ctx.createRadialGradient(cx, cx, size * 0.02, cx, cx, size * 0.55);
  glow.addColorStop(0, 'rgba(255,255,255,0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // star field
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const stars = 26 + Math.floor(rnd() * 18);
  for (let i = 0; i < stars; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * size * 0.62;
    const px = cx + Math.cos(a) * r;
    const py = cx + Math.sin(a) * r;
    ctx.globalAlpha = 0.10 + rnd() * 0.4;
    ctx.fillRect(px, py, 1 + rnd() * 1.4, 1 + rnd() * 1.4);
  }
  ctx.globalAlpha = 1;

  // vinyl grooves (concentric rings)
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 4; i++) {
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    ctx.beginPath();
    ctx.arc(cx, cx, size * (0.1 + rnd() * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  }

  // waveform silhouette (deterministic from seed)
  const bands = 26 + Math.floor(rnd() * 8);
  const amp = size * 0.1;
  const midline = cx;
  ctx.strokeStyle = 'rgba(26,24,22,0.85)';
  ctx.lineWidth = Math.max(1.2, size * 0.008);
  ctx.beginPath();
  for (let b = 0; b < bands; b++) {
    const x = (b / bands) * size;
    const v = rnd();
    const h = v * v * amp;
    ctx.moveTo(x, midline - h);
    ctx.lineTo(x, midline - h - 1);
    ctx.moveTo(x, midline + h);
    ctx.lineTo(x, midline + h + 1);
  }
  ctx.stroke();

  // center diamond
  const d = size * (0.14 + rnd() * 0.12);
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = '#1a1816';
  ctx.save();
  ctx.translate(cx, cx);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-d / 2, -d / 2, d, d);
  ctx.restore();

  // ring around diamond
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = colors[2] || colors[0];
  ctx.lineWidth = Math.max(1, size * 0.006);
  ctx.beginPath();
  ctx.arc(cx, cx, d * 0.85, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // grain
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 110; i++) {
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
  }

  // dark vignette
  const v = ctx.createRadialGradient(cx, cx, size * 0.34, cx, cx, size * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);

  return c;
}
