// Procedural album art — deterministic cover per track name + theme
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
  const rnd = mulberry(hashStr(name || 'audiovisor'));

  // bg gradient
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1] || colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // dark vignette
  const v = ctx.createRadialGradient(size/2, size/2, size*0.2, size/2, size/2, size*0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);

  // concentric arcs
  const rings = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < rings; i++) {
    const r = size * (0.12 + rnd() * 0.38);
    const sw = 2 + rnd() * 10;
    const start = rnd() * Math.PI * 2;
    const sweep = 0.4 + rnd() * Math.PI * 1.7;
    ctx.strokeStyle = colors[(i + 1) % colors.length];
    ctx.globalAlpha = 0.35 + rnd() * 0.55;
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.arc(size/2, size/2, r, start, start + sweep);
    ctx.stroke();
  }

  // center diamond
  const d = size * (0.18 + rnd() * 0.2);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#1a1816';
  ctx.save();
  ctx.translate(size/2, size/2);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-d/2, -d/2, d, d);
  ctx.restore();

  // grain
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 90; i++) {
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
  ctx.globalAlpha = 1;
  return c;
}
