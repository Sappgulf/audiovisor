/* A quiet, full-stage counterpart to each scene. Both renderers use these
   same standing-wave families; the scene remains the brightest layer. */
export const RESONANCE = Object.freeze({
  bars:       [0, 8, 2.2, 0.35, 0.10],
  waves:      [0, 9, 2.8, 0.85, 0.18],
  scope:      [2, 5, 3, 0.65, 0.16],
  particles:  [4, 4, 3, 0.70, 0.16],
  kaleido:    [5, 10, 8, 0.95, 0.22],
  spectro:    [0, 12, 4, 0.45, 0.10],
  tunnel:     [3, 11, 3, 0.45, 0.14],
  plasma:     [1, 12, 5, 0.80, 0.24],
  terrain:    [0, 10, 1.6, 0.90, 0.13],
  city:       [2, 8, 2, 0.30, 0.10],
  nebula:     [4, 3, 2.5, 1.10, 0.16],
  spiral:     [3, 10, 2, 0.60, 0.14],
  orb:        [1, 14, 3, 0.35, 0.20],
  fluid:      [4, 5, 3, 0.85, 0.22],
  tensor:     [2, 7, 5, 0.45, 0.18],
  prism:      [0, 13, 0.8, 1.20, 0.16],
  void:       [3, 12, 1, 0.30, 0.20],
  bloomfield: [5, 8, 5, 1.10, 0.18],
  fractal:    [4, 7, 5, 1.00, 0.20],
  radar:      [1, 16, 4, 0.20, 0.12],
  lava:       [0, 7, 2, 1.40, 0.22],
  gpu:        [2, 9, 6, 0.35, 0.16],
  vinyl:      [1, 22, 2, 0.20, 0.14],
  chladni:    [2, 6, 4, 0.70, 0.06],
});
Object.values(RESONANCE).forEach(Object.freeze);

/** Shared phase function, also expressed in GLSL below. */
export function resonancePhase(profile, x, y, time, bass = 0, mid = 0, high = 0) {
  const [family, density, lobes, bend] = profile;
  const t = time * 0.14;
  const warp = bend * (0.7 + bass * 0.3);
  // Only radial families need polar coordinates; the other grids avoid
  // thousands of hypot/atan2 calls on each cached geometry update.
  const radial = family === 1 || family === 3 || family === 5;
  const r = radial ? Math.hypot(x, y) : 0;
  const a = radial && r >= 1e-8 ? Math.atan2(y, x) : 0;
  switch (family) {
    case 0: return Math.sin(y * density + Math.sin(x * lobes + t) * warp + t + mid * 0.3);
    case 1: return Math.sin(r * density - t + Math.sin(a * lobes + t) * warp + bass * 0.4);
    case 2: return Math.cos(x * density + t) * Math.cos(y * lobes - t)
      - Math.cos(x * lobes - t) * Math.cos(y * density + t + high * 0.25);
    case 3: return Math.sin(r * density - a * lobes - t + Math.sin(r * 3 - t) * warp);
    case 4: return Math.sin(x * density + Math.sin(y * lobes + t) * warp)
      + Math.sin(y * density + Math.sin(x * lobes - t) * warp + mid * 0.4);
    case 5: return Math.sin(r * density - Math.cos(a * lobes + t) * warp * 2 - t);
    default: return 1;
  }
}

/* Constants are baked into each mode's already-specialised scene program.
   No spectrum textures or extra ray-march steps are needed for the field. */
export function resonanceGLSL(modes) {
  const branches = modes.map(({ id }, i) => {
    const p = RESONANCE[id];
    return `if (uMode == ${i}) return vec4(${p.slice(0, 4).map((n) => n.toFixed(3)).join(', ')});`;
  }).join('\n  ');
  const gains = modes.map(({ id }, i) => `if (uMode == ${i}) return ${RESONANCE[id][4].toFixed(3)};`).join('\n  ');
  return `
vec4 fieldProfile() {
  ${branches}
  return vec4(0.0, 8.0, 3.0, 0.5);
}
float fieldGain() {
  ${gains}
  return 0.1;
}
float resonancePhase(vec2 p) {
  vec4 cfg = fieldProfile();
  float t = uTime * 0.14;
  float warp = cfg.w * (0.7 + uBass * 0.3);
  float r = length(p), a = atan2s(p.y, p.x);
  if (cfg.x < 0.5) return sin(p.y * cfg.y + sin(p.x * cfg.z + t) * warp + t + uMid * 0.3);
  if (cfg.x < 1.5) return sin(r * cfg.y - t + sin(a * cfg.z + t) * warp + uBass * 0.4);
  if (cfg.x < 2.5) return cos(p.x * cfg.y + t) * cos(p.y * cfg.z - t)
    - cos(p.x * cfg.z - t) * cos(p.y * cfg.y + t + uHigh * 0.25);
  if (cfg.x < 3.5) return sin(r * cfg.y - a * cfg.z - t + sin(r * 3.0 - t) * warp);
  if (cfg.x < 4.5) return sin(p.x * cfg.y + sin(p.y * cfg.z + t) * warp)
    + sin(p.y * cfg.y + sin(p.x * cfg.z - t) * warp + uMid * 0.4);
  return sin(r * cfg.y - cos(a * cfg.z + t) * warp * 2.0 - t);
}
vec3 resonanceField(vec2 p) {
  float phase = resonancePhase(p);
  // Derivatives keep the filaments one pixel wide at every quality tier.
  float width = max(fwidth(phase), 0.002);
  float line = 1.0 - smoothstep(width * 0.4, width * 1.6, abs(phase));
  float halo = exp(-abs(phase) * 7.0) * 0.12;
  float radius = length(p);
  float color = 0.12 + 0.70 * (0.5 + 0.5 * sin(radius * 1.8 - uTime * 0.08 + p.x * 0.5));
  // Light travels along the field instead of illuminating every filament
  // equally. Treble adds a crest without changing the geometry or its phase.
  float crest = pow(max(0.0, sin(p.x * 2.7 + p.y * 1.9 - uTime * 0.5)), 8.0);
  // The centre stays quiet so fine geometry remains legible.
  float edge = 0.28 + 0.72 * smoothstep(0.15, 1.3, radius);
  return palf(color + crest * 0.12) * (line * (0.58 + crest * (0.65 + uHigh * 0.35)) + halo) * edge * fieldGain()
    * (0.55 + uLevel * 0.45 + uBeat * 0.18) * mix(0.7, 1.2, uPop);
}
`;
}

/** Marching squares produces crisp vector contours without a full-size
 * pixel loop. Geometry is sampled at a bounded grid, on a 12 Hz clock;
 * the cached layer is composited every frame with smooth beat response. */
export class ResonanceLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mode = null;
    this.theme = null;
    this.tick = -1;
  }

  draw(renderer) {
    const { ctx, w, h, mode, theme, t, sm, beat, quality } = renderer;
    const profile = RESONANCE[mode];
    // Chladni already has a full-frame nodal field. Plugins own their stage.
    if (!profile || mode === 'chladni' || !this.ctx) return;
    const scale = Math.min(0.7, 640 / Math.max(w, h, 1));
    const cw = Math.max(2, Math.round(w * scale));
    const ch = Math.max(2, Math.round(h * scale));
    const tick = Math.floor(t * 12);
    if (this.canvas.width !== cw || this.canvas.height !== ch || this.mode !== mode
      || this.theme !== theme || this.tick !== tick || this.quality !== quality) {
      const resized = this.canvas.width !== cw || this.canvas.height !== ch;
      if (resized) { this.canvas.width = cw; this.canvas.height = ch; }
      else this.ctx.clearRect(0, 0, cw, ch);
      if (resized || this.theme !== theme || !this.gradient) {
        this.gradient = this.ctx.createLinearGradient(0, ch, cw, 0);
        theme.colors.forEach((color, i) => this.gradient.addColorStop(i / Math.max(1, theme.colors.length - 1), color));
      }
      this.mode = mode; this.theme = theme; this.tick = tick; this.quality = quality;
      const c = this.ctx;
      const cols = quality === 'low' ? 44 : 72;
      const rows = Math.max(20, Math.min(120, Math.round(cols * ch / cw)));
      const size = (cols + 1) * (rows + 1);
      if (this.values?.length !== size) this.values = new Float32Array(size);
      const values = this.values;
      const aspect = cw / ch;
      for (let y = 0; y <= rows; y++) {
        for (let x = 0; x <= cols; x++) {
          values[y * (cols + 1) + x] = resonancePhase(profile,
            (x / cols * 2 - 1) * aspect, y / rows * 2 - 1, t, sm.bass, sm.mid, sm.high);
        }
      }
      c.strokeStyle = this.gradient;
      c.lineWidth = 0.8;
      c.beginPath();
      let pending = false;
      const crossing = (a, b, ax, ay, bx, by) => {
        if ((a < 0) === (b < 0)) return;
        const f = a / (a - b);
        const px = (ax + (bx - ax) * f) * cw / cols;
        const py = (ay + (by - ay) * f) * ch / rows;
        if (pending) c.lineTo(px, py); else c.moveTo(px, py);
        pending = !pending;
      };
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * (cols + 1) + x;
          // Clockwise corners. Pair crossings; ambiguous saddles remain two
          // disjoint segments rather than a bright diagonal across the cell.
          const v0 = values[i], v1 = values[i + 1];
          const v2 = values[i + cols + 2], v3 = values[i + cols + 1];
          pending = false;
          crossing(v0, v1, x, y, x + 1, y);
          crossing(v1, v2, x + 1, y, x + 1, y + 1);
          crossing(v2, v3, x + 1, y + 1, x, y + 1);
          crossing(v3, v0, x, y + 1, x, y);
        }
      }
      c.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = profile[4] * (0.5 + sm.level * 0.35 + beat * 0.15);
    ctx.drawImage(this.canvas, 0, 0, w, h);
    ctx.restore();
  }
}
