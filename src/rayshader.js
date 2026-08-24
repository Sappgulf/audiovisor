/**
 * GLSL ES 3.0 sources for the raytraced stage (v8.7).
 *
 * One uber ray-marcher: every stage mode is an SDF scene (or a volumetric
 * one) selected by uMode. Shading is Cook-Torrance GGX with soft shadows,
 * AO, one reflection bounce, dispersive refraction for the glass modes,
 * and a procedural theme-tinted environment used both as key light and as
 * the reflection probe. Output is linear HDR — bloom + ACES tonemap happen
 * in the composite pass.
 */

export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SCENE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform int   uMode;
uniform int   uSpp;        // samples per pixel (quality)
uniform int   uSteps;      // max march steps
uniform int   uRefl;       // reflection bounce on/off
uniform vec3  uPal[5];
uniform int   uPalN;
uniform float uBass, uMid, uHigh, uLevel, uBeat, uPhase;
uniform float uSens, uPop, uBassFocus;
uniform float uIdle;
uniform sampler2D uSpec;   // 256x1 log-mapped spectrum
uniform sampler2D uWave;   // 256x1 waveform
uniform sampler2D uHist;   // 256x128 rolling spectrum history
uniform float uHistRow;    // newest row (0..1)
uniform float uSeed;

#define PI 3.14159265359
#define TAU 6.28318530718

/* ---------------- audio taps ---------------- */

float spec(float x) { return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wav(float x)  { return texture(uWave, vec2(fract(x), 0.5)).r * 2.0 - 1.0; }
float hist(float x, float age) {
  // age 0 = newest row, 1 = oldest
  float row = fract(uHistRow - age);
  return texture(uHist, vec2(clamp(x, 0.0, 1.0), row)).r;
}
vec3 pal(int i) { return uPal[i % uPalN]; }
vec3 palf(float t) {
  float f = clamp(t, 0.0, 0.9999) * float(uPalN - 1);
  int i = int(floor(f));
  return mix(pal(i), pal(i + 1), fract(f));
}

/* ---------------- hash / noise ---------------- */

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float hash13(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 hash33(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                        dot(p, vec3(269.5, 183.3, 246.1)),
                        dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

/* ---------------- SDF primitives ---------------- */

float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r) { return sdBox(p, b - r) - r; }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCyl(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/* material id written by the scene fns, resolved at shade time */
float g_id;
float g_aux;

/* ---------------- scenes ---------------- */

/* 0 bars — spectrum slabs of brushed metal on a mirror floor */
float scBars(vec3 p) {
  float floorD = p.y;
  vec3 q = p;
  float slot = floor(q.x / 0.46 + 13.0);
  slot = clamp(slot, 0.0, 25.0);
  float cx = (slot + 0.5) * 0.46 - 5.98;
  float e = pow(spec(slot / 26.0), 1.35) * uSens;
  e = e / (1.0 + 0.6 * e);              // soft knee — a loud low end shouldn't wall off the stage
  float h = 0.1 + 2.6 * e * (1.0 + uBeat * 0.3);
  vec3 b = vec3(0.15, h, 0.15);
  float d = sdRBox(q - vec3(cx, h, 0.0), b, 0.045);
  d = max(d, abs(q.x) - 6.1);
  g_id = 1.0; g_aux = slot / 26.0;
  if (floorD < d) { d = floorD; g_id = 0.0; }
  return d;
}

/* 1 waves — layered silk ribbons displaced by the waveform */
float scWaves(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float z = -fi * 1.35;
    float w = wav(p.x * 0.055 + fi * 0.21 + uTime * 0.06) * (1.0 + uLevel * 1.6);
    float y = w * (1.1 - fi * 0.22) + sin(p.x * 0.7 + uTime * 1.1 + fi) * 0.12;
    float s = abs(p.y - y) - 0.055 - uBeat * 0.02;
    s = max(s, abs(p.z - z) - 0.055);
    s = max(s, abs(p.x) - 6.2);
    if (s < d) { d = s; g_id = 2.0; g_aux = fi / 3.0; }
  }
  float fl = p.y + 2.6;
  if (fl < d) { d = fl; g_id = 0.0; }
  return d;
}

/* 2 scope — glass Lissajous tube traced from the waveform */
float scScope(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 40; i++) {
    float u = float(i) / 40.0;
    float a = u * TAU;
    float r = 1.5 + wav(u * 0.5 + uTime * 0.02) * (0.55 + uLevel * 0.9);
    float r2 = 1.5 + wav(u * 0.5 + 1.0 / 40.0 * 0.5 + uTime * 0.02) * (0.55 + uLevel * 0.9);
    float a2 = a + TAU / 40.0;
    vec3 A = vec3(cos(a) * r, sin(a) * r, sin(a * 3.0) * 0.28);
    vec3 B = vec3(cos(a2) * r2, sin(a2) * r2, sin(a2 * 3.0) * 0.28);
    float s = sdCapsule(p, A, B, 0.075 + uBeat * 0.02);
    if (s < d) { d = s; g_id = 3.0; g_aux = u; }
  }
  float ring = abs(sdTorus(p.xzy, vec2(2.35, 0.02))) - 0.004;
  if (ring < d) { d = ring; g_id = 1.0; g_aux = 0.6; }
  return d;
}

/* 3 particles — emissive sphere field with per-cell audio lift */
float scParticles(vec3 p) {
  vec3 c = vec3(1.9);
  vec3 cell = floor((p + 0.5 * c) / c);
  float d = 1e9;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 id = cell + vec3(x, y, z);
    vec3 h = hash33(id);
    float band = spec(h.x);
    vec3 off = (h - 0.5) * 0.75;
    off.y += sin(uTime * (0.4 + h.y * 0.8) + h.z * TAU) * 0.35;
    vec3 q = p - (id * c + off);
    float r = 0.035 + 0.11 * band * uSens + uBeat * 0.03 * h.z;
    float s = sdSphere(q, r);
    if (s < d) { d = s; g_id = 4.0; g_aux = h.x; }
  }
  return d;
}

/* 4 kaleido — mirrored crystal cluster */
float scKaleido(vec3 p) {
  float a = atan(p.y, p.x);
  float r = length(p.xy);
  float seg = TAU / 8.0;
  a = mod(a + seg * 0.5, seg) - seg * 0.5;
  vec3 q = vec3(cos(a) * r, abs(sin(a) * r), p.z);
  float d = 1e9;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float e = spec(fi / 4.0 + 0.05) * uSens;
    vec3 c = vec3(0.85 + fi * 0.62 + e * 0.5, 0.12 + fi * 0.1, 0.0);
    vec3 pp = q - c;
    pp.xz *= rot(uTime * (0.2 + fi * 0.13));
    pp.xy *= rot(uTime * 0.17);
    float s = sdRBox(pp, vec3(0.16 + e * 0.3, 0.16, 0.16), 0.03);
    if (s < d) { d = s; g_id = 3.0; g_aux = fi / 4.0; }
  }
  float core = sdSphere(p, 0.32 + uBeat * 0.1);
  if (core < d) { d = core; g_id = 4.0; g_aux = 0.9; }
  return d;
}

/* 5 spectro — extruded waterfall terrace from the history buffer */
float scSpectro(vec3 p) {
  float u = clamp((p.x + 5.0) / 10.0, 0.0, 1.0);
  float age = clamp((p.z + 5.0) / 10.0, 0.0, 1.0);
  float e = hist(u, age);
  float e2 = pow(e, 1.5) * uSens;
  float h = 2.2 * e2 / (1.0 + 0.7 * e2);
  float d = (p.y - h) * 0.38;
  d = max(d, abs(p.x) - 5.0);
  d = max(d, abs(p.z) - 5.0);
  g_id = 5.0; g_aux = e;
  return d;
}

/* 6 tunnel — ribbed hyperspace bore */
float scTunnel(vec3 p) {
  float z = p.z + uTime * 3.2;
  float cell = floor(z / 1.1);
  float lz = mod(z, 1.1) - 0.55;
  float band = spec(fract(cell * 0.083));
  float r = 2.3 - band * 0.7 * uSens - uBeat * 0.12;
  float wob = sin(atan(p.y, p.x) * 6.0 + cell * 0.7 + uTime) * 0.09 * (0.3 + uMid);
  float ring = length(vec2(length(p.xy) - r + wob, lz)) - (0.045 + band * 0.09);
  float d = ring;
  g_id = 4.0; g_aux = fract(cell * 0.083);
  float wall = -(length(p.xy) - (r + 0.85));
  if (wall < d) { d = wall; g_id = 6.0; g_aux = 0.2; }
  return d;
}

/* 7 plasma — nested torii */
float scPlasma(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float e = spec(0.06 + fi * 0.2) * uSens;
    vec3 q = p;
    q.xz *= rot(uTime * (0.15 + fi * 0.09) + fi);
    q.yz *= rot(uTime * (0.11 - fi * 0.04));
    float s = sdTorus(q, vec2(0.75 + fi * 0.52 + e * 0.22, 0.035 + e * 0.09 + uBeat * 0.02));
    if (s < d) { d = s; g_id = 4.0; g_aux = fi / 4.0; }
  }
  float core = sdSphere(p, 0.24 + uBass * 0.14 + uBeat * 0.08);
  if (core < d) { d = core; g_id = 4.0; g_aux = 0.95; }
  return d;
}

/* 8 terrain — scrolling ridge heightfield */
float scTerrain(vec3 p) {
  float u = clamp((p.x + 9.0) / 18.0, 0.0, 1.0);
  float age = clamp((p.z + 2.0) / 16.0, 0.0, 1.0);
  float e = hist(u, age);
  float e2 = pow(e, 1.4) * uSens;
  float ridge = 2.0 * e2 / (1.0 + 0.8 * e2);       // knee: peaks flatten, never wall off
  ridge += fbm(vec3(p.x * 0.32, 0.0, p.z * 0.32 + uTime * 0.05)) * 0.5;
  float d = (p.y + 1.2 - ridge) * 0.34;            // conservative slope for the heightfield march
  g_id = 7.0; g_aux = clamp(ridge * 0.4, 0.0, 1.0);
  return d;
}

/* 9 city — neon block grid on wet asphalt */
float scCity(vec3 p) {
  float fl = p.y;
  vec2 cell = floor(p.xz / 2.2);
  vec2 lp = mod(p.xz, 2.2) - 1.1;
  float h = hash11(dot(cell, vec2(17.3, 41.7)));
  float e = spec(fract(h * 3.7));
  float bh = 0.5 + h * 3.4 + e * 2.4 * uSens + uBeat * 0.2 * h;
  float d = sdBox(vec3(lp.x, p.y - bh * 0.5, lp.y), vec3(0.62, bh * 0.5, 0.62));
  g_id = 8.0; g_aux = e;
  if (fl < d) { d = fl; g_id = 9.0; }
  return d;
}

/* 12 orb — displaced glass shell with a molten core */
float scOrb(vec3 p) {
  float r = length(p);
  vec3 n = p / max(r, 1e-4);
  float band = spec(abs(n.y) * 0.5 + 0.05);
  float disp = band * 0.32 * uSens + sin(n.x * 8.0 + uTime * 2.0) * 0.02;
  float shell = r - (1.15 + disp + uBeat * 0.09);
  float core = r - (0.62 + uBass * 0.2 + uBeat * 0.1);
  float d = shell;
  g_id = 3.0; g_aux = band;
  if (core < d) { d = core; g_id = 4.0; g_aux = 0.9; }
  float ring = abs(sdTorus(p, vec2(1.75 + uBeat * 0.45, 0.012))) - 0.004;
  if (ring < d) { d = ring; g_id = 4.0; g_aux = 0.5; }
  return d;
}

/* 13 fluid — chrome metaball membrane */
float scFluid(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float e = spec(fi / 6.0 * 0.7 + 0.05) * uSens;
    float a = uTime * (0.35 + fi * 0.12) + fi * 1.7;
    vec3 c = vec3(cos(a) * (0.7 + fi * 0.1), sin(a * 1.3) * 0.55, sin(a * 0.7) * 0.5);
    float s = sdSphere(p - c, 0.34 + e * 0.3 + uBeat * 0.05);
    d = (i == 0) ? s : smin(d, s, 0.55);
  }
  g_id = 10.0; g_aux = 0.5;
  float ring = abs(sdTorus(p, vec2(1.9, 0.02))) - 0.006;
  if (ring < d) { d = ring; g_id = 4.0; g_aux = 0.4; }
  return d;
}

/* 14 tensor — strut lattice with lit nodes */
float scTensor(vec3 p) {
  vec3 cell = floor(p / 1.25);
  vec3 lp = mod(p, 1.25) - 0.625;
  float e = spec(fract(hash13(cell) * 2.3));
  float rx = length(lp.yz) - 0.028;
  float ry = length(lp.xz) - 0.028;
  float rz = length(lp.xy) - 0.028;
  float d = min(rx, min(ry, rz));
  g_id = 6.0; g_aux = 0.3;
  float node = sdSphere(lp, 0.075 + e * 0.14 * uSens + uBeat * 0.03);
  if (node < d) { d = node; g_id = 4.0; g_aux = e; }
  return d;
}

/* 15 prism — dispersive glass slab */
float scPrism(vec3 p) {
  vec3 q = p;
  q.xz *= rot(uTime * 0.22 + uBeat * 0.1);
  q.yz *= rot(0.35);
  float d = sdRBox(q, vec3(0.42, 1.5, 0.42), 0.02);
  g_id = 11.0; g_aux = 0.5;
  // emissive slit behind the slab: the beam the prism splits
  vec3 lp = p - vec3(0.0, 0.0, -3.6);
  float slit = sdRBox(lp, vec3(3.4, 0.1 + uLevel * 0.16, 0.04), 0.03);
  if (slit < d) { d = slit; g_id = 17.0; g_aux = clamp((p.x + 3.4) / 6.8, 0.0, 1.0); }
  return d;
}

/* 16 void — event horizon shell + accretion ring */
float scVoid(vec3 p) {
  float d = sdSphere(p, 0.85 + uBass * 0.06);
  g_id = 12.0; g_aux = 0.0;
  vec3 q = p; q.y *= 3.4;
  float disc = max(sdTorus(q, vec2(1.9 + uBeat * 0.1, 0.55)), -sdSphere(p, 1.05));
  if (disc < d) { d = disc * 0.7; g_id = 4.0; g_aux = 0.75; }
  return d;
}

/* 17 bloomfield — bokeh sphere field (DOF does the work) */
float scBloom(vec3 p) {
  vec3 c = vec3(2.3, 2.3, 3.0);
  vec3 cell = floor((p + 0.5 * c) / c);
  float d = 1e9;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++) {
    vec3 id = cell + vec3(x, y, 0.0);
    vec3 h = hash33(id);
    float e = spec(h.x);
    vec3 off = (h - 0.5) * 1.0;
    off.y += sin(uTime * 0.4 + h.y * TAU) * 0.2;
    float s = sdSphere(p - (id * c + off), 0.07 + e * 0.2 * uSens + uBeat * 0.03);
    if (s < d) { d = s; g_id = 4.0; g_aux = h.x; }
  }
  return d;
}

/* 18 fractal — audio-driven mandelbulb */
float scFractal(vec3 p) {
  vec3 z = p;
  float dr = 1.0, r = 0.0;
  float power = 6.0 + uBass * 3.0 + sin(uTime * 0.2) * 1.2;
  for (int i = 0; i < 7; i++) {
    r = length(z);
    if (r > 2.2) break;
    float th = acos(clamp(z.z / r, -1.0, 1.0));
    float ph = atan(z.y, z.x);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    float zr = pow(r, power);
    th *= power; ph *= power;
    z = zr * vec3(sin(th) * cos(ph), sin(ph) * sin(th), cos(th)) + p;
  }
  g_id = 13.0; g_aux = clamp(r * 0.5, 0.0, 1.0);
  return 0.5 * log(max(r, 1e-4)) * r / dr;
}

/* 19 radar — glass dome over a swept disc */
float scRadar(vec3 p) {
  float dome = abs(sdSphere(p, 2.2)) - 0.012;
  dome = max(dome, -p.y);
  float d = dome;
  g_id = 14.0; g_aux = 0.2;
  float disc = max(sdCyl(p - vec3(0.0, -0.02, 0.0), 0.02, 2.2), 0.0) - 0.0;
  if (disc < d) { d = disc; g_id = 15.0; g_aux = 0.0; }
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = hash11(fi * 3.1) * TAU + uTime * 0.2;
    float rr = 0.5 + hash11(fi * 7.7) * 1.5;
    float e = spec(hash11(fi * 5.3));
    vec3 c = vec3(cos(a) * rr, 0.12 + e * 0.35, sin(a) * rr);
    float s = sdSphere(p - c, 0.045 + e * 0.07);
    if (s < d) { d = s; g_id = 4.0; g_aux = 0.85; }
  }
  return d;
}

/* 21 gpu — voxel compute stack */
float scGpu(vec3 p) {
  vec3 q = p;
  q.xz *= rot(uTime * 0.35);
  vec3 cell = clamp(floor(q / 0.62 + 2.0), vec3(0.0), vec3(3.0));
  vec3 lp = q - (cell - 2.0 + 0.5) * 0.62;
  float e = spec(fract(dot(cell, vec3(0.11, 0.29, 0.07))));
  float d = sdRBox(lp, vec3(0.24 + e * 0.05), 0.04);
  d = max(d, sdBox(q, vec3(1.3)));
  g_id = 16.0; g_aux = e;
  vec3 bq = q; bq.xz *= rot(uTime * 0.9);
  float bus = sdCapsule(bq, vec3(0.0, -1.9, 0.0), vec3(0.0, 1.9, 0.0), 0.02);
  if (bus < d) { d = bus; g_id = 4.0; g_aux = 0.8; }
  return d;
}

/* dispatcher */
float map(vec3 p) {
  if (uMode == 0)  return scBars(p);
  if (uMode == 1)  return scWaves(p);
  if (uMode == 2)  return scScope(p);
  if (uMode == 3)  return scParticles(p);
  if (uMode == 4)  return scKaleido(p);
  if (uMode == 5)  return scSpectro(p);
  if (uMode == 6)  return scTunnel(p);
  if (uMode == 7)  return scPlasma(p);
  if (uMode == 8)  return scTerrain(p);
  if (uMode == 9)  return scCity(p);
  if (uMode == 12) return scOrb(p);
  if (uMode == 13) return scFluid(p);
  if (uMode == 14) return scTensor(p);
  if (uMode == 15) return scPrism(p);
  if (uMode == 16) return scVoid(p);
  if (uMode == 17) return scBloom(p);
  if (uMode == 18) return scFractal(p);
  if (uMode == 19) return scRadar(p);
  if (uMode == 21) return scGpu(p);
  return sdSphere(p, 1.0);
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

/* ---------------- materials ---------------- */

struct Mat { vec3 alb; float rough; float metal; vec3 emis; float trans; };

Mat matOf(float id, float aux, vec3 p) {
  Mat m;
  m.alb = vec3(0.5); m.rough = 0.4; m.metal = 0.0; m.emis = vec3(0.0); m.trans = 0.0;
  vec3 c = palf(aux);
  if (id < 0.5) {                       // mirror floor
    m.alb = vec3(0.035); m.rough = 0.08 + 0.12 * uIdle; m.metal = 1.0;
  } else if (id < 1.5) {                // lit metal slab
    m.alb = c * 0.55; m.rough = 0.18; m.metal = 1.0;
    m.emis = c * (0.14 + 1.0 * spec(aux) * uSens + uBeat * 0.3);
  } else if (id < 2.5) {                // silk ribbon
    m.alb = c * 0.3; m.rough = 0.25; m.metal = 0.6;
    m.emis = c * (0.5 + uLevel * 1.1 + uBeat * 0.45);
  } else if (id < 3.5) {                // glass
    m.alb = vec3(0.92); m.rough = 0.03; m.metal = 0.0; m.trans = 1.0;
    m.emis = c * (0.25 + uLevel * 0.7);
  } else if (id < 4.5) {                // pure emissive
    m.alb = c * 0.1; m.rough = 0.3; m.metal = 0.0;
    m.emis = c * (1.1 + 2.2 * spec(aux) + uBeat * 1.1);
  } else if (id < 5.5) {                // spectrogram terrace
    vec3 cc = palf(pow(aux, 0.7));
    m.alb = cc * 0.25; m.rough = 0.35; m.metal = 0.3;
    m.emis = cc * (0.12 + pow(aux, 2.2) * 3.2);
  } else if (id < 6.5) {                // dark structural
    m.alb = vec3(0.06); m.rough = 0.45; m.metal = 0.7;
    m.emis = palf(0.2) * 0.05;
  } else if (id < 7.5) {                // terrain rock
    m.alb = mix(vec3(0.03, 0.028, 0.026), palf(aux) * 0.22, aux);
    m.rough = 0.75; m.metal = 0.1;
    m.emis = palf(aux) * pow(aux, 3.2) * 0.9;
  } else if (id < 8.5) {                // city block + windows
    // anti-aliased window grid: hard step() speckles badly at distance
    vec3 wp = p * vec3(2.6, 3.4, 2.6);
    vec3 fw = fract(wp);
    float wy = smoothstep(0.42, 0.5, fw.y) * (1.0 - smoothstep(0.82, 0.9, fw.y));
    float wx = smoothstep(0.42, 0.5, fw.x) * (1.0 - smoothstep(0.82, 0.9, fw.x));
    float wz = smoothstep(0.42, 0.5, fw.z) * (1.0 - smoothstep(0.82, 0.9, fw.z));
    float lit = step(0.28, hash13(floor(wp)));   // some windows are dark
    float win = wy * max(wx, wz) * lit;
    m.alb = vec3(0.02); m.rough = 0.22; m.metal = 0.5;
    m.emis = palf(aux) * win * (0.7 + aux * 1.6 + uBeat * 0.5);
  } else if (id < 9.5) {                // wet asphalt
    m.alb = vec3(0.012); m.rough = 0.06; m.metal = 0.9;
  } else if (id < 10.5) {               // liquid chrome
    m.alb = palf(0.35) * 0.75 + 0.25; m.rough = 0.04; m.metal = 1.0;
    m.emis = palf(uLevel) * uBeat * 0.5;
  } else if (id < 11.5) {               // dispersive glass
    m.alb = vec3(0.98); m.rough = 0.0; m.metal = 0.0; m.trans = 1.0;
  } else if (id < 12.5) {               // event horizon
    m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0;
  } else if (id < 13.5) {               // fractal shell
    vec3 cc = palf(fract(aux * 1.7 + uTime * 0.03));
    m.alb = cc * 0.4; m.rough = 0.16; m.metal = 0.85;
    m.emis = cc * (0.3 + uBeat * 0.9);
  } else if (id < 14.5) {               // radar dome glass
    m.alb = vec3(0.9); m.rough = 0.06; m.metal = 0.0; m.trans = 1.0;
    m.emis = palf(0.3) * 0.08;
  } else if (id < 15.5) {               // radar disc
    float a = atan(p.z, p.x);
    float sweep = fract((a / TAU) - uTime * 0.22);
    float wedge = pow(1.0 - sweep, 8.0);
    float rings = smoothstep(0.02, 0.0, abs(fract(length(p.xz) * 1.4) - 0.5) - 0.46);
    m.alb = vec3(0.015); m.rough = 0.3; m.metal = 0.4;
    m.emis = palf(0.4) * (wedge * 2.4 + rings * 0.5 + 0.03);
  } else if (id < 17.5) {               // soft backlight bar (prism beam)
    m.alb = vec3(0.0); m.rough = 1.0;
    m.emis = palf(aux) * (0.9 + spec(aux) * 1.6 + uBeat * 0.4);
  } else {                              // gpu voxel
    m.alb = vec3(0.03); m.rough = 0.25; m.metal = 0.6;
    m.emis = palf(aux) * (0.18 + aux * 3.0 + uBeat * 0.6);
  }
  // per-mode emissive gain: dense scenes (particle/voxel fields) would
  // otherwise bloom into a flat white sheet
  float gain = 1.0;
  if (uMode == 3)  gain = 0.30;   // particles
  if (uMode == 5)  gain = 0.35;   // spectro terrace
  if (uMode == 6)  gain = 0.55;   // tunnel
  if (uMode == 14) gain = 0.30;   // tensor lattice
  if (uMode == 17) gain = 0.22;   // bloom field
  if (uMode == 9)  gain = 0.70;   // city
  if (uMode == 13) gain = 1.6;    // fluid
  if (uMode == 15) gain = 1.4;    // prism
  if (uMode == 2)  gain = 2.2;    // scope
  m.emis *= gain * mix(0.75, 1.35, uPop);
  return m;
}

/* ---------------- environment ---------------- */

/* sparse star field — only the space-facing scenes get it */
vec3 starField(vec3 rd) {
  vec3 d = rd * 220.0;
  vec3 id = floor(d);
  vec3 f = fract(d) - 0.5;
  float h = hash13(id);
  float s = smoothstep(0.16, 0.0, length(f)) * step(0.9885, h);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 6.0) + h * 40.0);
  return mix(vec3(1.0), palf(fract(h * 7.0)), 0.45) * s * tw * 1.6;
}

vec3 envColor(vec3 rd) {
  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.004, 0.0038, 0.0035), palf(0.15) * 0.035, pow(up, 2.0));
  sky += palf(0.75) * 0.012 * pow(clamp(-rd.y * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 key = normalize(vec3(0.55, 0.75, -0.4));
  sky += palf(0.5) * pow(clamp(dot(rd, key), 0.0, 1.0), 96.0) * (1.1 + uLevel * 0.9);
  vec3 rim = normalize(vec3(-0.7, 0.2, 0.5));
  sky += palf(0.9) * pow(clamp(dot(rd, rim), 0.0, 1.0), 48.0) * 0.25;
  if (uMode == 10 || uMode == 11 || uMode == 16 || uMode == 17 || uMode == 3) sky += starField(rd);
  return sky;
}

/* ---------------- march ---------------- */

float march(vec3 ro, vec3 rd, float tmax, out float id, out float aux) {
  float t = 0.02;
  id = -1.0; aux = 0.0;
  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012 * t + 0.0006) { id = g_id; aux = g_aux; return t; }
    t += d * 0.85;
    if (t > tmax) break;
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd, float tmax) {
  float res = 1.0, t = 0.05;
  for (int i = 0; i < 32; i++) {
    vec3 p = ro + rd * t;
    float h = map(p);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.035, 0.5);
    if (res < 0.005 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.025 + 0.14 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 1.4 * occ, 0.0, 1.0);
}

/* Cook-Torrance GGX */
vec3 brdf(vec3 n, vec3 v, vec3 l, Mat m, vec3 lc) {
  vec3 h = normalize(v + l);
  float ndl = max(dot(n, l), 0.0);
  float ndv = max(dot(n, v), 1e-4);
  float ndh = max(dot(n, h), 0.0);
  float vdh = max(dot(v, h), 0.0);
  float a = max(m.rough * m.rough, 0.002);
  float a2 = a * a;
  float dn = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dn * dn);
  float k = a * 0.5;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), m.alb, m.metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  vec3 spe = D * G * F / (4.0 * ndl * ndv + 1e-4);
  vec3 dif = (1.0 - F) * (1.0 - m.metal) * m.alb / PI;
  return (dif + spe) * lc * ndl;
}

vec3 shade(vec3 p, vec3 rd, vec3 n, Mat m, float shadows) {
  vec3 v = -rd;
  vec3 col = m.emis;
  vec3 key = normalize(vec3(0.55, 0.75, -0.4));
  vec3 kc = palf(0.45) * (1.5 + uLevel * 0.9);
  float sh = shadows > 0.5 ? softShadow(p + n * 0.01, key, 12.0) : 1.0;
  col += brdf(n, v, key, m, kc) * sh;
  vec3 fill = normalize(vec3(-0.6, 0.35, 0.55));
  col += brdf(n, v, fill, m, palf(0.85) * 0.45);
  float occ = ao(p, n);
  col += m.alb * (1.0 - m.metal) * envColor(n) * 0.7 * occ;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  col += palf(0.7) * fres * 0.18 * occ * (0.4 + uLevel);
  return col;
}

/* ---------------- volumetrics (nebula / spiral / lava) ---------------- */

float volDensity(vec3 p) {
  if (uMode == 10) {                        // nebula
    vec3 q = p;
    q.xz *= rot(uTime * 0.05);
    float disc = exp(-abs(q.y * 1.9) * 1.6);
    float f = fbm(q * 0.55 + vec3(0.0, uTime * 0.03, uTime * 0.02));
    float arms = 0.55 + 0.45 * sin(atan(q.z, q.x) * 2.0 + length(q.xz) * 1.4);
    float d = disc * f * arms;
    d *= smoothstep(4.2, 1.2, length(q));
    return max(0.0, d - 0.06) * (3.4 + uLevel * 3.0);
  }
  if (uMode == 11) {                        // spiral galaxy
    vec3 q = p;
    q.xz *= rot(uTime * 0.07);
    float r = length(q.xz);
    float a = atan(q.z, q.x);
    float arm = cos(a * 2.0 - r * 2.3 + uTime * 0.2) * 0.5 + 0.5;
    float d = pow(arm, 2.6) * exp(-r * 0.55) * exp(-abs(q.y) * 5.0);
    d += exp(-r * 3.2 - abs(q.y) * 6.0) * (1.2 + uBass);
    d *= 0.6 + 0.6 * fbm(q * 1.6 + uTime * 0.05);
    return d * (1.0 + uLevel);
  }
  // lava
  vec3 q = p;
  float d = 1e9;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ph = uTime * (0.25 + fi * 0.07) + fi * 2.1;
    vec3 c = vec3(sin(ph * 0.7) * 0.5, sin(ph) * 1.25, cos(ph * 0.6) * 0.5);
    float rr = 0.42 + spec(fi / 5.0) * 0.3 * uSens + uBass * 0.12;
    float s = length(q - c) - rr;
    d = (i == 0) ? s : smin(d, s, 0.5);
  }
  float cyl = sdCyl(q, 1.9, 1.0);
  return max(0.0, -d * 2.4) * step(cyl, 0.0) * (2.6 + uBass * 1.8);
}

vec3 volColor(float dens, vec3 p) {
  float r = length(p);
  float t = clamp(dens * 1.3, 0.0, 1.0);
  // cool at the rim, hot in the core, blowing out to white at peak density
  vec3 c = mix(palf(0.12), palf(0.8), clamp(r * 0.24, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.94, 0.88), pow(t, 2.6) * 0.75);
  return c * (0.85 + uBeat * 0.7);
}

vec3 marchVolume(vec3 ro, vec3 rd) {
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float t = 0.4;
  int steps = min(uSteps / 3, 72);
  float stepSize = 0.16;
  for (int i = 0; i < 72; i++) {
    if (i >= steps || trans < 0.02 || t > 14.0) break;
    vec3 p = ro + rd * t;
    float d = volDensity(p);
    if (d > 0.001) {
      float a = 1.0 - exp(-d * stepSize * 3.2);
      acc += trans * a * volColor(d, p) * (1.6 + uLevel * 1.4);
      trans *= 1.0 - a;
    }
    t += stepSize * (1.0 + t * 0.09);
  }
  acc += envColor(rd) * trans;
  return acc;
}

bool isVolumetric(int m) { return m == 10 || m == 11 || m == 20; }

/* ---------------- camera ---------------- */

void camera(float t, vec2 uv, vec2 dofJitter, out vec3 ro, out vec3 rd) {
  vec3 ta = vec3(0.0);
  float fov = 1.5;
  float ap = 0.012;
  float sway = sin(t * 0.21) * 0.22;
  if (uMode == 0)       { ro = vec3(sway * 2.0, 2.4 + uBeat * 0.1, 8.4); ta = vec3(0.0, 1.3, 0.0); ap = 0.035; }
  else if (uMode == 1)  { ro = vec3(sway * 1.4, 1.1, 6.6); ta = vec3(0.0, 0.0, -1.2); ap = 0.03; }
  else if (uMode == 2)  { ro = vec3(0.0, 0.0, 5.6 + sin(t * 0.3) * 0.3); ta = vec3(0.0); ap = 0.02; }
  else if (uMode == 3)  { ro = vec3(sin(t * 0.13) * 2.0, cos(t * 0.11) * 1.2, 5.0); ap = 0.05; }
  else if (uMode == 4)  { ro = vec3(0.0, 0.0, 4.6); ap = 0.02; }
  else if (uMode == 5)  { ro = vec3(0.0, 3.6, 7.4); ta = vec3(0.0, 0.4, -0.6); ap = 0.03; }
  else if (uMode == 6)  { ro = vec3(sin(t * 0.4) * 0.3, cos(t * 0.33) * 0.3, 4.0); ta = ro + vec3(0.0, 0.0, -1.0); ap = 0.02; }
  else if (uMode == 7)  { ro = vec3(sway, 0.9, 4.6); ap = 0.02; }
  else if (uMode == 8)  { ro = vec3(sway * 1.6, 3.4, 9.6); ta = vec3(0.0, 0.1, -3.0); ap = 0.03; }
  else if (uMode == 9)  { ro = vec3(sin(t * 0.09) * 7.0, 3.0 + sin(t * 0.14), cos(t * 0.09) * 7.0); ta = vec3(0.0, 1.8, 0.0); ap = 0.04; }
  else if (uMode == 10) { ro = vec3(sin(t * 0.08) * 5.4, 1.6, cos(t * 0.08) * 5.4); ap = 0.0; }
  else if (uMode == 11) { ro = vec3(sin(t * 0.06) * 4.2, 2.4 + sin(t * 0.1) * 0.5, cos(t * 0.06) * 4.2); ap = 0.0; }
  else if (uMode == 12) { ro = vec3(sin(t * 0.17) * 3.6, 0.8, cos(t * 0.17) * 3.6); ap = 0.03; }
  else if (uMode == 13) { ro = vec3(sin(t * 0.15) * 4.2, 1.3, cos(t * 0.15) * 4.2); ap = 0.035; }
  else if (uMode == 14) { ro = vec3(sin(t * 0.1) * 3.2, 1.6 + sin(t * 0.07), cos(t * 0.1) * 3.2); ap = 0.04; }
  else if (uMode == 15) { ro = vec3(0.0, 0.2, 4.2); ap = 0.02; }
  else if (uMode == 16) { ro = vec3(sin(t * 0.08) * 5.0, 1.1, cos(t * 0.08) * 5.0); ap = 0.03; }
  else if (uMode == 17) { ro = vec3(sin(t * 0.07) * 1.4, cos(t * 0.06) * 0.8, 4.4); ta = vec3(0.0, 0.0, -2.0); ap = 0.11; }
  else if (uMode == 18) { ro = vec3(sin(t * 0.12) * 2.6, sin(t * 0.09) * 0.9, cos(t * 0.12) * 2.6); ap = 0.02; }
  else if (uMode == 19) { ro = vec3(sin(t * 0.1) * 3.4, 2.6, cos(t * 0.1) * 3.4); ta = vec3(0.0, -0.2, 0.0); ap = 0.03; }
  else if (uMode == 20) { ro = vec3(0.0, 0.0, 5.2); ap = 0.0; }
  else                  { ro = vec3(sin(t * 0.12) * 4.0, 2.0, cos(t * 0.12) * 4.0); ap = 0.03; }

  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 dir = normalize(uv.x * rt + uv.y * up + fov * fw);
  // thin-lens depth of field
  float focal = length(ta - ro);
  vec3 fp = ro + dir * focal;
  vec3 off = (dofJitter.x * rt + dofJitter.y * up) * ap;
  ro += off;
  rd = normalize(fp - ro);
}

/* Refract into the solid, march to the far interface, refract back out and
   sample whatever is behind it. Called once per wavelength for dispersion. */
vec3 glassPath(vec3 p, vec3 rd, vec3 n, float ior) {
  vec3 r1 = refract(rd, n, 1.0 / ior);
  if (dot(r1, r1) < 1e-4) r1 = reflect(rd, n);
  vec3 q = p - n * 0.012;
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    float d = -map(q + r1 * t);      // inside the solid the field is negative
    if (d < 0.002) break;
    t += max(d, 0.01);
    if (t > 8.0) break;
  }
  vec3 ex = q + r1 * t;
  vec3 n2 = -normalAt(ex);
  vec3 r2 = refract(r1, n2, ior);
  if (dot(r2, r2) < 1e-4) r2 = reflect(r1, n2);
  float id2, aux2;
  float t2 = march(ex + r2 * 0.02, r2, 24.0, id2, aux2);
  if (t2 < 0.0) return envColor(r2);
  vec3 p2 = ex + r2 * (0.02 + t2);
  Mat m2 = matOf(id2, aux2, p2);
  return shade(p2, r2, normalAt(p2), m2, 0.0);
}

/* ---------------- main trace ---------------- */

vec3 trace(vec3 ro, vec3 rd) {
  if (isVolumetric(uMode)) return marchVolume(ro, rd);

  float id, aux;
  float t = march(ro, rd, 40.0, id, aux);
  if (t < 0.0) return envColor(rd);

  vec3 p = ro + rd * t;
  vec3 n = normalAt(p);
  Mat m = matOf(id, aux, p);
  vec3 col = shade(p, rd, n, m, 1.0);

  if (m.trans > 0.5) {
    // dispersive glass: split into three wavelengths, each refracted through
    // both interfaces of the solid
    vec3 sum;
    if (uMode == 15 || uSpp > 2) {
      // full dispersion is three transports — reserve it for the prism and
      // for the ultra tier
      sum.r = glassPath(p, rd, n, 1.38).r;
      sum.g = glassPath(p, rd, n, 1.45).g;
      sum.b = glassPath(p, rd, n, 1.53).b;
    } else {
      sum = glassPath(p, rd, n, 1.45);
    }
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    vec3 refl = envColor(reflect(rd, n));
    col = mix(sum, refl, clamp(fres, 0.0, 1.0)) + m.emis;
  } else if (uRefl == 1 && m.metal > 0.35 && m.rough < 0.34) {
    vec3 rr = reflect(rd, n);
    float id2, aux2;
    float t2 = march(p + n * 0.02, rr, 26.0, id2, aux2);
    vec3 rc;
    if (t2 < 0.0) rc = envColor(rr);
    else {
      vec3 p2 = p + n * 0.02 + rr * t2;
      vec3 n2 = normalAt(p2);
      Mat m2 = matOf(id2, aux2, p2);
      rc = shade(p2, rr, n2, m2, 0.0);
    }
    float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    col += rc * mix(m.alb, vec3(1.0), 0.5) * mix(0.35, 1.0, fres) * (1.0 - m.rough * 2.0);
  }

  // black-hole halo
  if (uMode == 16) col += palf(0.6) * pow(clamp(1.0 - abs(length(p) - 1.0), 0.0, 1.0), 6.0) * 1.4;

  // distance haze
  col = mix(col, envColor(rd) * 0.5, pow(clamp(t / 42.0, 0.0, 1.0), 1.4) * 0.7);
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 acc = vec3(0.0);
  float seed = hash13(vec3(frag, uSeed));
  for (int s = 0; s < 8; s++) {
    if (s >= uSpp) break;
    float fs = float(s) + seed;
    // stratified AA jitter + lens sample (golden-angle disc)
    vec2 j = vec2(hash11(fs * 12.9), hash11(fs * 78.2 + 3.1)) - 0.5;
    vec2 uv = ((frag + j) * 2.0 - uRes) / uRes.y;
    float ga = fs * 2.39996;
    float gr = sqrt(fract(fs * 0.618 + seed));
    vec2 lens = vec2(cos(ga), sin(ga)) * gr;
    vec3 ro, rd;
    camera(uTime, uv, lens, ro, rd);
    acc += trace(ro, rd);
  }
  acc /= float(max(uSpp, 1));
  fragColor = vec4(max(acc, 0.0), 1.0);
}`;

/* bright-pass + separable gaussian, run at quarter res */
export const BLUR_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uThreshold;
uniform int uPrefilter;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 sum = vec3(0.0);
  float w[5] = float[5](0.227, 0.194, 0.121, 0.054, 0.016);
  for (int i = -4; i <= 4; i++) {
    vec3 c = texture(uTex, uv + uDir * uTexel * float(i) * 1.5).rgb;
    if (uPrefilter == 1) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= smoothstep(uThreshold, uThreshold * 2.0, l);
    }
    sum += c * w[abs(i)];
  }
  fragColor = vec4(sum, 1.0);
}`;

/* temporal accumulation — blends this frame against the previous one in
   linear HDR, before bloom and tonemapping see it */
export const ACCUM_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uHistory;
uniform vec2 uRes;
uniform float uBlend;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 cur = texture(uScene, uv).rgb;
  vec3 his = texture(uHistory, uv).rgb;
  // clamp history to a neighbourhood of the current sample so motion does
  // not smear (a cheap stand-in for full TAA reprojection)
  vec2 tx = 1.0 / uRes;
  vec3 lo = cur, hi = cur;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : 0.0, i == 2 ? 1.0 : i == 3 ? -1.0 : 0.0);
    vec3 c = texture(uScene, uv + o * tx).rgb;
    lo = min(lo, c); hi = max(hi, c);
  }
  his = clamp(his, lo * 0.85, hi * 1.15 + 0.02);
  fragColor = vec4(mix(cur, his, uBlend), 1.0);
}`;

/* bloom composite + ACES + grain */
export const POST_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
uniform float uBeat;
uniform float uPop;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = texture(uScene, uv).rgb;

  // chromatic aberration grows with the beat
  vec2 d = (uv - 0.5);
  float ca = (0.0012 + uBeat * 0.0032) * dot(d, d) * 4.0;
  vec3 bl = vec3(
    texture(uBloom, uv + d * ca).r,
    texture(uBloom, uv).g,
    texture(uBloom, uv - d * ca).b);
  col += bl * uBloomAmt * 1.6;

  col *= uExposure * (1.0 + uBeat * 0.18);
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // saturation from the Color Pop control
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 0.85 + uPop * 0.5);
  // vignette + film grain
  col *= 1.0 - dot(d, d) * 0.65;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.018;
  fragColor = vec4(col, 1.0);
}`;
