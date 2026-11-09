import { MODES } from './themes.js';
import { resonanceGLSL } from './resonance.js';

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
/* scope: the 41 trace points, built once per frame on the CPU (xyz) with
   segment i's stereo shear in w — see RayStage._scopePoints */
uniform vec4  uScope[41];
uniform int   uSpp;        // samples per pixel (quality)
uniform int   uSteps;      // max march steps
uniform int   uRefl;       // reflection bounce on/off
uniform vec3  uPal[5];
uniform int   uPalN;
uniform float uBass, uMid, uHigh, uLevel, uBeat;
uniform float uSens, uPop, uBassFocus;
uniform float uIdle;
uniform float uDrop;       // 0..1 drop envelope (breakdown → slam)
uniform sampler2D uSpec;   // 256x1 log-mapped spectrum
uniform sampler2D uWave;   // 256x3 waveform: mono / L / R
uniform sampler2D uHist;   // 256x128 rolling spectrum history
uniform sampler2D uNoise;  // 256x256 tiling value-noise field (heightfields)
uniform float uHistRow;    // newest row (0..1)
uniform float uSeed;

#define PI 3.14159265359
#define TAU 6.28318530718

/* ---------------- audio taps ---------------- */

float spec(float x) {
  float v = texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
  v = pow(clamp(v, 0.0, 1.0), 0.62);
  /* Bass-Focus slider tilts the spectrum toward the low end. Centred so the
     0.5 default is exactly neutral and no existing look moves until the
     user touches the slider; the tilt factor stays in [0.5, 1.5]. */
  float tilt = (uBassFocus - 0.5) * 2.0;
  float hit = pow(clamp(uBeat, 0.0, 1.0), 0.5);
  return v * (1.0 + tilt * (0.5 - x)) * (0.8 + hit * 0.65 + uLevel * 0.35);
}
/* uWave carries three rows — mono, L, R — so every mode keeps reading the
   same mono trace while the scope can separate the channels. Row centres of
   a 3-row texture sit at 1/6, 3/6, 5/6. */
float wav(float x)  { return texture(uWave, vec2(fract(x), 0.16667)).r * 2.0 - 1.0; }
float wavL(float x) { return texture(uWave, vec2(fract(x), 0.5)).r * 2.0 - 1.0; }
float wavR(float x) { return texture(uWave, vec2(fract(x), 0.83333)).r * 2.0 - 1.0; }
float hist(float x, float age) {
  // age 0 = newest row, 1 = oldest
  float row = fract(uHistRow - age);
  return texture(uHist, vec2(clamp(x, 0.0, 1.0), row)).r;
}
vec3 pal(int i) { return uPal[i % uPalN]; }
/* Colour flow happens on the CPU: the five uPal entries are re-sampled
   from the theme's ramp every frame at drifting positions (see
   RayStage._flowPal), so this lookup costs what it always did. */
vec3 palf(float t) {
  float f = clamp(t, 0.0, 0.9999) * float(uPalN - 1);
  int i = int(floor(f));
  return mix(pal(i), pal(i + 1), fract(f));
}

/* ---------------- hash / noise ---------------- */

/* atan(y, x) is undefined at the origin and returns NaN on ANGLE. A flat
   upward normal (mirror floor, radar plate, spectrogram terrace, rooftop)
   hits that case exactly, and the NaN then poisons the whole pixel. */
float atan2s(float y, float x) {
  return (abs(x) < 1e-8 && abs(y) < 1e-8) ? 0.0 : atan(y, x);
}

${resonanceGLSL(MODES)}

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
/* 3D value noise from two taps of the baked 2D noise texture (each z slice
   is the plane offset by (37, 17) texels; the sampler does the xy blend)
   instead of vnoise()'s eight sin hashes. Defined next to vnoise2() below;
   declared here so fbm3() can call it. */
float vnoiseT(vec3 p);
/* Three octaves for the volumes, which sample it on every step of a
   72-step march; the top two octaves are finer than the step length and
   only added cost. Rescaled to fbm()'s range so densities are unchanged. */
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoiseT(p); p *= 2.03; a *= 0.5; }
  return s * 1.107;
}

/* 2D value noise, for heightfields.
   This interpolated four hashed corners by hand. The terrain SDF sums five
   octaves of it, and the SDF is called on every march step and again on
   every normal, shadow and AO tap — twenty hash evaluations a call. One
   bilinear fetch from the baked noise texture (raystage _noiseTex) does the
   same job: sampling at (floor(p) + smoothstep(fract(p)) + 0.5)/N blends
   exactly the same four texels with exactly the same weights, in
   fixed-function hardware instead of ALU. */
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f + 0.5) * (1.0 / 256.0)).r;
}
float vnoiseT(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 17.0) * i.z + f.xy;
  float a = texture(uNoise, (uv + 0.5) * (1.0 / 256.0)).r;
  float b = texture(uNoise, (uv + vec2(37.0, 17.0) + 0.5) * (1.0 / 256.0)).r;
  return mix(a, b, f.z);
}
/* Two fixed octave counts rather than one parameterised function: the base
   shape needs more detail than the fine layer, and every octave is paid on
   each of the ~128 march steps. Written as plain constant-bound loops, the
   same shape as fbm() above. */
float fbm2a(vec2 p) {
  float a = 0.5, s = 0.0;
  /* three octaves, not four: this layer is the terrain's large-scale drift,
     and the amp-packed fbm2b layer carries the detail. One octave here is
     a quarter of the terrain SDF's noise cost for a shape change nobody
     sees at 1080p. */
  for (int i = 0; i < 3; i++) { s += a * vnoise2(p); p *= 2.03; a *= 0.5; }
  return s;
}
float fbm2b(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 2; i++) { s += a * vnoise2(p); p *= 2.03; a *= 0.5; }
  return s;
}

/* ---------------- SDF primitives ---------------- */

float sdSphere(vec3 p, float r) { return length(p) - r; }
/* Signed distance to an ellipsoid (the exact gradient form keeps marching
   stable where a simple scaled sphere would overstep near a petal tip). */
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
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

/* Shared set dressing for the sculptural scenes: a floor and an open
   cylindrical room. Camera rigs for these modes sit inside the radius, so
   the wall becomes a real backdrop instead of a void. */
float roomD(vec3 p, float radius, float halfHeight, float floorY, out float rid) {
  float floorD = p.y - floorY;
  float wallD = max(abs(length(p.xz) - radius) - 0.06,
                    abs(p.y - (floorY + halfHeight)) - halfHeight);
  if (floorD < wallD) { rid = 27.0; return floorD; }
  rid = 26.0; return wallD;
}

float addRoom(vec3 p, float d, float radius, float halfHeight, float floorY) {
  float rid;
  float r = roomD(p, radius, halfHeight, floorY, rid);
  if (r < d) {
    d = r;
    g_id = rid;
    g_aux = rid < 26.5
      ? fract(atan2s(p.z, p.x) / TAU + 0.5)
      : clamp(length(p.xz) / radius, 0.0, 1.0);
  }
  return d;
}

/* ---------------- scenes ---------------- */

/* 0 bars — spectrum slabs of brushed metal on a mirror floor */
float scBars(vec3 p) {
  float floorD = p.y;
  vec3 q = p;
  float slot = floor(q.x / 0.46 + 13.0);
  slot = clamp(slot, 0.0, 25.0);
  float cx = (slot + 0.5) * 0.46 - 5.98;
  float u = pow(clamp(slot / 26.0, 0.0, 1.0), 0.62);
  /* Lift the top octaves a little so the right half of the spectrum stays
     in the composition instead of collapsing into the stage. */
  float e = pow(spec(u), 1.2) * uSens * (1.0 + u * 0.75);
  e = e / (1.0 + 0.55 * e);
  /* A small mid-driven floor keeps the top octaves visible instead of
     letting the right half of the spectrum disappear into the stage. */
  float h = 0.22 + uMid * 0.18 + 2.6 * e * (1.0 + uBeat * 0.3 + uDrop * 0.45);
  float depth = 0.1 + hash11(slot + 4.0) * 0.18;
  vec3 b = vec3(0.12, h, depth);
  float d = sdRBox(q - vec3(cx, h, 0.0), b, 0.04);
  float sparkle = uHigh * (0.035 + 0.035 * sin(uTime * 6.0 + slot));
  float cap = sdRBox(q - vec3(cx, h * 2.0 + 0.03 + sparkle, 0.0), vec3(b.x * 1.05, 0.02 + sparkle * 0.5, b.z * 1.05), 0.01);
  if (cap < d) { d = cap; g_id = 4.0; g_aux = u; }
  else { g_id = 1.0; g_aux = u; }
  d = max(d, abs(q.x) - 6.1);
  /* Full-frame spectrum field: the slabs stand on their own reflection,
     with no back wall or portal boxing the composition in. */
  if (floorD < d) { d = floorD; g_id = 0.0; }
  return d;
}

/* 1 waves — layered silk ribbons displaced by the waveform */
float scWaves(vec3 p) {
  /* Portrait stages turn the river upright. Keeping a six-unit horizontal
     scene on a 390px phone only shows a flat crop through its middle. */
  float aspect = uRes.x / max(uRes.y, 1.0);
  float portrait = 1.0 - smoothstep(0.50, 0.85, aspect);
  vec3 q = p;
  q.xy *= rot(portrait * PI * 0.5);
  float d = 1e9;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float z = -fi * 1.15;
    float w = wav(q.x * 0.055 + fi * 0.21 + uTime * 0.06) * (1.0 + uLevel * 1.6);
    float y = w * (1.1 - fi * 0.14) * (1.0 + uBeat * 0.24)
            + sin(q.x * 0.7 + uTime * 1.1 + fi) * (0.12 + uMid * 0.14);
    float s = abs(q.y - y) - (0.065 + uHigh * 0.015) - uBeat * 0.02;
    s = max(s, abs(q.z - z) - 0.12);
    s = max(s, abs(q.x) - 6.2);
    if (s < d) { d = s; g_id = 2.0; g_aux = fi / 5.0; }
  }
  /* A shallow water plane under the ribbons catches the low sun and gives
     the mode a horizon/foreground instead of a mirror floor at infinity. */
  float sea = p.y + 0.78
            + 0.030 * sin(p.x * 1.8 + uTime * 1.4)
            + 0.018 * sin(p.z * 2.7 - uTime * 0.9);
  if (sea < d) { d = sea; g_id = 0.0; }
  float fl = p.y + 2.6 + portrait * 20.0;
  if (fl < d) { d = fl; g_id = 0.0; }
  return d;
}

/* 2 scope — a full-frame phosphor trace field. The live Lissajous figure
   hangs in the dark with a wide halo; no housing, panel or bezel. */
float scScope(vec3 p) {
  float d = p.z + 0.10;
  g_id = 27.0; g_aux = 0.0;
  float rad = 0.020 + uLevel * 0.012 + uBeat * 0.008;
  for (int i = 0; i < 40; i++) {
    vec4 A = uScope[i];
    vec4 B = uScope[i + 1];
    vec3 a = vec3(A.xy + vec2(A.w, 0.0), 0.0);
    vec3 b = vec3(B.xy + vec2(B.w, 0.0), 0.0);
    float s = sdCapsule(p, a, b, rad);
    if (s < d) { d = s; g_id = 20.0; g_aux = fract(float(i) / 40.0 + uTime * 0.04); }
    float halo = sdCapsule(p, a, b, rad * 3.6);
    if (halo < d) { d = halo; g_id = 4.0; g_aux = fract(float(i) / 40.0); }
  }
  return d;
}

/* 3 particles — a full-frame ember vortex. The dust sits in a flattened
   disc and twists with radius; a hot seed anchors the spin. */
float scParticles(vec3 p) {
  float bound = length(p) - 7.0;
  if (bound > 0.3) { g_id = 4.0; g_aux = 0.0; return bound; }
  vec3 c = vec3(1.9);
  vec3 rp = p;
  rp.y *= 2.1;                                   // flatten the cloud into a disc
  float twist = uTime * 0.08 + length(rp.xz) * 0.07;
  rp.xz *= rot(twist);
  vec3 cell = floor((rp + 0.5 * c) / c);
  vec3 side = sign(rp - cell * c);
  side = mix(vec3(1.0), side, abs(side));
  float b0 = spec(0.10);
  float b1 = spec(0.34);
  float b2 = spec(0.58);
  float b3 = spec(0.82);
  float d = 0.75;
  for (int x = 0; x <= 1; x++)
  for (int y = 0; y <= 1; y++)
  for (int z = 0; z <= 1; z++) {
    vec3 id = cell + vec3(float(x), float(y), float(z)) * side;
    vec3 h = hash33(id);
    float band = h.x < 0.25 ? b0 : h.x < 0.5 ? b1 : h.x < 0.75 ? b2 : b3;
    vec3 off = (h - 0.5) * 0.75;
    off.y += sin(uTime * (0.4 + h.y * 0.8) + h.z * TAU) * 0.25;
    vec3 q = rp - (id * c + off);
    float fade = 1.0 - smoothstep(1.2, 5.8, length(id * c));
    float r = (0.040 + 0.13 * band * uSens + uBeat * 0.035 * h.z) * fade;
    float s = sdSphere(q, max(r, 0.001));
    if (s < d) { d = s; g_id = 4.0; g_aux = fract(h.z * 3.7); }
  }
  /* a hot seed and a bright nearby ring read as the vortex's core */
  float core = sdSphere(p, 0.16 + uBass * 0.10 + uBeat * 0.06);
  if (core < d) { d = core; g_id = 18.0; g_aux = 0.92; }
  float ring = abs(sdTorus(p.xzy, vec2(1.15 + uBass * 0.22, 0.014))) - 0.004;
  if (ring < d) { d = ring; g_id = 4.0; g_aux = 0.5; }
  return d;
}

/* 4 kaleido — layered mirrored shards folded into a twelve-sided mandala */
float scKaleido(vec3 p) {
  float a = atan2s(p.y, p.x) + uTime * 0.12 + uBeat * 0.035;
  float r = length(p.xy);
  float seg = TAU / 8.0;
  a = mod(a + seg * 0.5, seg) - seg * 0.5;
  vec3 q = vec3(cos(a) * r, sin(a) * r, p.z);
  float d = 1e9;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float e = min(spec(0.08 + fi * 0.21) * uSens, 1.6);
    float center = 0.58 + fi * 0.61 + e * 0.12 + uBeat * 0.04;
    float span = 0.43 + fi * 0.025;
    float along = abs(q.x - center);
    float taper = clamp(1.0 - along / span, 0.0, 1.0);
    float width = 0.014 + taper * (0.30 + e * 0.08);
    float depth = 0.12 + fi * 0.012;
    float shard = max(along - span, max(abs(q.y) - width, abs(q.z) - depth));
    if (shard < d) { d = shard; g_id = 11.0; g_aux = fract(fi * 0.23 + taper * 0.22 + 0.08); }

    /* A pair of bright facet seams catches the key light and makes the
       folded triangular geometry read as cut mirror, not a smooth flower. */
    float seam = abs(abs(q.y) - width * 0.56) - (0.008 + e * 0.004);
    seam = max(seam, max(along - span * 0.94, abs(q.z) - depth * 0.94));
    if (seam < d) { d = seam; g_id = 4.0; g_aux = fract(fi * 0.23 + 0.42 + uTime * 0.025); }
  }
  float innerRing = abs(sdTorus(p.xzy, vec2(0.52 + uBass * 0.08, 0.018))) - 0.005;
  if (innerRing < d) { d = innerRing; g_id = 4.0; g_aux = 0.86; }
  float outerRing = abs(sdTorus(p.xzy, vec2(2.08 + uBeat * 0.06, 0.026))) - 0.008;
  if (outerRing < d) { d = outerRing; g_id = 1.0; g_aux = 0.34; }
  float core = sdEllipsoid(p, vec3(0.34 + uBeat * 0.08, 0.34 + uBass * 0.06, 0.20));
  if (core < d) { d = core; g_id = 11.0; g_aux = 0.94; }
  float iris = sdSphere(p, 0.095 + uHigh * 0.025 + uBeat * 0.018);
  if (iris < d) { d = iris; g_id = 4.0; g_aux = 0.92; }
  return d;
}

/* 5 spectro — the time/frequency waterfall as a full-frame ridge field.
   Each frequency bin is a terrace in the landscape; rows scroll toward the
   camera, so the data reads as terrain and depth instead of a block wall. */
float scSpectro(vec3 p) {
  float u = clamp((p.x + 5.0) / 10.0, 0.0, 1.0);
  float age = clamp((p.z + 4.8) / 9.6, 0.0, 1.0);
  float e = hist(u, age);
  float e2 = pow(e, 1.2) * uSens;
  float h = 0.14 + 3.2 * e2 / (1.0 + 0.55 * e2);
  h = floor(h * 24.0) / 24.0;
  float d = (p.y - h) * 0.34;
  g_id = 5.0; g_aux = clamp(e, 0.0, 1.0);
  return d;
}

/* 6 tunnel — ribbed hyperspace bore */
float scTunnel(vec3 p) {
  float z = p.z + uTime * 3.2;
  float cell = floor(z / 1.1);
  float lz = mod(z, 1.1) - 0.55;
  float band = spec(fract(cell * 0.083));
  float r = max(2.3 - band * 0.7 * uSens - uBeat * 0.12 - uDrop * 0.2, 0.9);
  float ang = atan2s(p.y, p.x);
  float wob = sin(ang * 6.0 + cell * 0.7 + uTime) * 0.09 * (0.3 + uMid);
  float ring = length(vec2(length(p.xy) - r + wob, lz)) - (0.03 + band * 0.05);
  float d = ring;
  g_id = 4.0; g_aux = fract(cell * 0.083);
  float wall = -(length(p.xy) - (r + 0.85));
  if (wall < d) { d = wall; g_id = 6.0; g_aux = 0.2; }
  float sector = floor(ang / (TAU / 4.0) + 0.5) * (TAU / 4.0);
  vec2 railC = vec2(cos(sector), sin(sector)) * (r - 0.45);
  float rail = length(p.xy - railC) - 0.010;
  if (rail < d) { d = rail; g_id = 4.0; g_aux = 0.46; }
  return d;
}

/* 7 plasma — a full-frame magnetic storm. Domain-warped bands and cell
   filaments fill the screen; there is no bottle or stage prop. */
float scPlasma(vec3 p) {
  float d = p.z + 0.10;
  g_id = 30.0; g_aux = 0.0;
  return d;
}

/* 8 terrain — scrolling ridge heightfield */
float scTerrain(vec3 p) {
  float u = clamp((p.x + 9.0) / 18.0, 0.0, 1.0);
  float age = clamp((p.z + 9.0) / 18.0, 0.0, 1.0);
  float e = hist(u, age);
  float e2 = pow(e, 1.4) * uSens;
  float ridge = 3.0 * e2 / (1.0 + 0.7 * e2);       // knee: peaks flatten, never wall off
  /* Both layers were 5-octave 3D fbm, i.e. 80 hash+sin evaluations per SDF
     call, paid on every one of the ~128 march steps plus normals, shadows,
     AO and the reflection bounce. The field is a heightfield, so 2D noise
     gives the same shape, and the fine layer at 0.28 amplitude does not need
     five octaves to read. The remaining octaves are one texture fetch each
     rather than four hashes (see vnoise2), which took the mode from 46ms a
     frame to 29ms — measured with the GPU actually synced; the far worse
     numbers this comment used to quote came from a sweep that timed only
     the submission. */
  ridge += fbm2a(vec2(p.x * 0.55, p.z * 0.55 + uTime * 0.05)) * 0.9;
  ridge += fbm2b(vec2(p.x * 1.7, p.z * 1.7)) * 0.28;      // crest detail
  float d = (p.y + 1.2 - ridge) * 0.34;            // conservative slope for the heightfield march
  g_id = 7.0; g_aux = clamp(ridge * 0.4, 0.0, 1.0);
  return d;
}

/* 9 city — neon block grid on wet asphalt */
float scCity(vec3 p) {
  float fl = p.y;
  vec2 cell = floor(p.xz / 2.75);
  vec2 lp = mod(p.xz, 2.75) - 1.375;
  float h = hash11(dot(cell, vec2(17.3, 41.7)));
  float e = clamp(spec(fract(h * 3.7)), 0.0, 1.2);
  float bh = 0.4 + h * 3.2 + e * 2.2 * uSens + uBeat * 0.2 * h;
  float bw = 0.40 + h * 0.30;
  float d = sdBox(vec3(lp.x, p.y - bh * 0.5, lp.y), vec3(bw, bh * 0.5, bw));
  g_id = 8.0; g_aux = e;
  float crown = sdBox(vec3(lp.x, p.y - bh - 0.12, lp.y), vec3(bw * 0.45, 0.14, bw * 0.45));
  if (crown < d) { d = crown; g_id = h > 0.56 ? 4.0 : 6.0; g_aux = e; }
  if (fl < d) { d = fl; g_id = 9.0; }
  return d;
}

/* 12 orb — a macro containment sphere. The glass shell and molten core fill
   the frame; no plinth or orbital rings. */
float scOrb(vec3 p) {
  float r = length(p);
  vec3 n = p / max(r, 1e-4);
  float band = spec(fract(atan2s(n.z, n.x) / TAU + 0.5) * 0.7 + 0.05);
  float disp = band * 0.30 * uSens
    + 0.07 * sin(n.y * 3.0 + uTime * 1.6)
    + uHigh * 0.07 * sin(n.x * 6.0 + uTime * 1.2);
  float shell = abs(r - (1.55 + disp + uBeat * 0.18)) - 0.045;
  float core = r - (0.72 + uBass * 0.22 + uBeat * 0.10);
  float d = shell;
  g_id = 3.0; g_aux = band;
  if (core < d) { d = core; g_id = 18.0; g_aux = clamp(band, 0.0, 1.0); }
  return d;
}

/* 13 fluid — a mercury ocean. The chrome surface fills the lower frame and
   rolls with the low bands; no ribbon, ring or plinth. */
float scFluid(vec3 p) {
  float t = uTime;
  float h = 0.26 * sin(p.x * 1.15 + t * 0.75)
          + 0.18 * sin(p.z * 1.65 - t * 0.55 + uMid * 2.2)
          + 0.10 * sin((p.x + p.z) * 2.3 + t * 0.9)
          + fbm2a(vec2(p.x * 0.42, p.z * 0.42 + t * 0.07)) * 0.50;
  h += uBass * 0.16 * sin(length(p.xz) * 1.4 - t * 1.1);
  float d = (p.y - h) * 0.42;
  g_id = 10.0; g_aux = clamp(h * 0.7 + 0.48, 0.0, 1.0);
  return d;
}

/* 14 tensor — strut lattice with lit nodes */
float scTensor(vec3 p) {
  vec3 cell = floor(p / 1.25);
  vec3 lp = mod(p, 1.25) - 0.625;
  float e = spec(fract(hash13(cell) * 2.3));
  /* each axis family carries one band of the mix — bass thickens one set of
     rods, mids another, highs the third — so the lattice visibly leans
     toward whatever the song is doing instead of staying uniform. The
     radii are position-independent, so the SDF gradient stays Lipschitz-1. */
  float lean = uBass * uBass * 0.020 + uMid * uMid * 0.016 + uHigh * uHigh * 0.012;
  float rx = length(lp.yz) - (0.012 + uBass * 0.026 + lean * 0.5);
  float ry = length(lp.xz) - (0.012 + uMid * 0.022 + lean * 0.4);
  float rz = length(lp.xy) - (0.012 + uHigh * 0.018 + lean * 0.3);
  float d = min(rx, min(ry, rz));
  g_id = 6.0; g_aux = 0.3;
  float node = sdSphere(lp, 0.03 + e * 0.06 * uSens + uBeat * 0.018);
  if (node < d) { d = node; g_id = 4.0; g_aux = e; }
  /* Let the lattice run to every edge instead of caging it in a dais. */
  return d;
}

/* 15 prism — a bright input aperture, cut-glass core, and broad spectral fan */
float sdTriPrism(vec3 p, vec2 h) {
  vec3 q = abs(p);
  return max(q.z - h.y, max(q.x * 0.866025 + p.y * 0.5, -p.y) - h.x * 0.5);
}

float scPrism(vec3 p) {
  /* Compress the beam path only on narrow viewports so the full dispersion
     still fits the stage without changing its vertical scale. */
  float fit = clamp((uRes.x / max(uRes.y, 1.0)) / 1.5, 0.38, 1.0);
  vec3 v = p;
  v.x /= fit;
  vec3 q = v;
  q.xz *= rot(uTime * 0.18);
  float d = sdTriPrism(q, vec2(1.65 + uBass * 0.20, 0.62));
  g_id = 11.0; g_aux = 0.5;

  float entry = abs(sdTorus(vec3(v.y, v.z, v.x + 1.72), vec2(0.78, 0.029))) - 0.006;
  if (entry < d) { d = entry; g_id = 4.0; g_aux = 0.08; }
  float exit = abs(sdTorus(vec3(v.y, v.z, v.x - 1.72), vec2(0.68 + uBeat * 0.12, 0.029))) - 0.006;
  if (exit < d) { d = exit; g_id = 4.0; g_aux = 0.92; }

  float beam = sdCapsule(v, vec3(-4.2, 0.0, 0.0), vec3(-1.58, 0.0, 0.0), 0.055 + uLevel * 0.025);
  if (beam < d) { d = beam; g_id = 17.0; g_aux = 0.15; }

  for (int i = 0; i < 8; i++) {
    float t = (float(i) - 3.5) / 3.5;
    float e = spec(abs(t));
    vec3 tip = vec3(4.2, t * (2.18 + uHigh * 0.72 + uBeat * 0.38), t * 0.58);
    vec3 start = vec3(1.58, t * 0.13, 0.0);
    float ray = sdCapsule(v, start, tip, 0.075 + e * 0.05);
    if (ray < d) { d = ray; g_id = 17.0; g_aux = t * 0.5 + 0.5; }
  }
  return d * fit;
}

/* 16 void — event horizon, bright photon rings, and a warped accretion disc */
float scVoid(vec3 p) {
  /* the horizon tightens as the drop lands — collapse, not just throb */
  float horizon = 1.12 + uBass * 0.05 - uDrop * 0.12;
  float d = sdSphere(p, horizon);
  g_id = 12.0; g_aux = 0.0;
  float photonRadius = horizon + 0.12 + uBeat * 0.025;
  float photon = length(vec2(p.y, length(p.xz) - photonRadius)) - (0.022 + uBeat * 0.006);
  if (photon < d) { d = photon; g_id = 4.0; g_aux = 0.96; }
  float secondary = length(vec2(p.y, length(p.xz) - (horizon + 0.24))) - 0.012;
  if (secondary < d) { d = secondary; g_id = 1.0; g_aux = 0.78; }
  float outerRing = length(vec2(p.y, length(p.xz) - (horizon + 0.52))) - 0.007;
  if (outerRing < d) { d = outerRing; g_id = 4.0; g_aux = 0.56; }
  vec3 q = p;
  q.xz *= rot(uTime * 0.35);
  float radius = length(q.xz);
  float az = atan2s(q.z, q.x);
  float inner = horizon + 0.16;
  float outer = 2.50 + uBeat * 0.12;
  float warp = 0.036 * sin(az * 2.0 - uTime * 0.55) + 0.014 * sin(az * 5.0 + uTime * 0.8);
  float disc = max(abs(q.y - warp) - (0.038 + uBass * 0.022), max(inner - radius, radius - outer));
  if (disc < d) { d = disc; g_id = 19.0; g_aux = clamp((radius - inner) / (outer - inner), 0.0, 1.0); }
  float jet = sdCapsule(p, vec3(0.0, 1.24, 0.0), vec3(0.0, 2.25 + uDrop * 0.18, 0.0), 0.025 + uBeat * 0.009);
  float lowerJet = sdCapsule(p, vec3(0.0, -1.24, 0.0), vec3(0.0, -2.25 - uDrop * 0.18, 0.0), 0.025 + uBeat * 0.009);
  if (min(jet, lowerJet) < d) { d = min(jet, lowerJet); g_id = 2.0; g_aux = 0.72; }
  return d;
}

/* 17 bloomfield — a macro bioluminescent bloom. Seven petals and a hot
   heart fill the frame, with pollen drifting through the dark. */
float scBloom(vec3 p) {
  float d = 1e9;
  float phase = uTime * 0.32 + uMid * 0.45;
  float bloom = spec(0.3) * uSens;
  for (int k = 0; k < 7; k++) {
    float fi = float(k);
    float angle = fi * TAU / 7.0 + phase;
    vec3 q = p;
    q.xy *= rot(-angle);
    q.x -= 0.88 + bloom * 0.12 + uBeat * 0.10;
    q.yz *= rot(0.20 + fi * 0.015);
    float petal = sdEllipsoid(q, vec3(0.82 + bloom * 0.12, 0.36, 0.16));
    if (petal < d) { d = petal; g_id = 4.0; g_aux = fract(fi / 7.0 + uTime * 0.025); }
  }
  float heart = sdSphere(p, 0.34 + uBass * 0.08 + uBeat * 0.05);
  if (heart < d) { d = heart; g_id = 18.0; g_aux = 0.9; }
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec3 c = vec3(sin(uTime * (0.28 + fi * 0.03) + fi * 2.1) * 2.3,
                  cos(uTime * (0.22 + fi * 0.02) + fi * 1.3) * 1.5,
                  -1.1 + sin(uTime * (0.18 + fi * 0.04) + fi) * 1.7);
    float s = sdSphere(p - c, 0.022 + uHigh * 0.014);
    if (s < d) { d = s; g_id = 4.0; g_aux = fract(fi * 0.17); }
  }
  return d;
}

/* 18 fractal — audio-driven mandelbulb */
float scFractal(vec3 p) {
  /* a modest camera-space scale makes its fine edges fill the frame without
     changing the iteration count or washing out the depth of the bulb */
  vec3 seed = p * 0.95;
  vec3 z = seed;
  float dr = 1.0, r = 0.0;
  float trap = 1e9;
  float power = 6.5 + uBass * 2.5 + uMid * 1.0 + uDrop * 1.5 + sin(uTime * 0.2) * 1.0;
  for (int i = 0; i < 8; i++) {
    r = length(z);
    trap = min(trap, r);
    if (r > 2.2) break;
    float th = acos(clamp(z.z / max(r, 1e-5), -1.0, 1.0));
    float ph = atan2s(z.y, z.x);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    float zr = pow(r, power);
    th *= power; ph *= power;
    z = zr * vec3(sin(th) * cos(ph), sin(ph) * sin(th), cos(th)) + seed;
  }
  g_id = 13.0; g_aux = clamp(trap * 1.4, 0.0, 1.0);
  float fractal = 0.5 * log(max(r, 1e-4)) * r / dr / 0.95;
  return fractal;
}

/* 19 radar — top-down phosphor scope with a swept beam and live contacts */
float scRadar(vec3 p) {
  /* spectrum taps live OUTSIDE the loops: every map() step would otherwise
     pay a texture fetch per contact, which measured 2.6x the whole scene's
     cost against hashing the same data. Four bands feed seven contacts
     round-robin. */
  float e0 = spec(0.18);
  float e1 = spec(0.41);
  float e2 = spec(0.64);
  float e3 = spec(0.87);
  float d = sdCyl(p, 0.075, 2.05);
  g_id = 15.0; g_aux = 0.0;
  /* no bezel or hub: let the phosphor scope run off every edge */
  /* Contacts sit just above the phosphor and flare when the beam crosses
     their azimuth, then fade into the scope's afterglow. */
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 3.1);
    float h2 = hash11(fi * 7.7);
    float band = hash11(fi * 5.3);
    float e = fi < 0.5 ? e0 : fi < 1.5 ? e1 : fi < 2.5 ? e2 : fi < 3.5 ? e3
            : fi < 4.5 ? e1 : fi < 5.5 ? e2 : e0;
    float a = h1 * TAU;
    float rr = 0.5 + h2 * 1.45;
    float swc = fract(a / TAU - uTime * 0.22);
    float sq = clamp(1.0 - swc * 7.0, 0.0, 1.0);
    float fresh = sq * sq;
    float ht = 0.03 + e * 0.09 + fresh * 0.06;
    float ax = cos(a) * rr;
    float az = sin(a) * rr;
    vec3 c = vec3(ax, 0.085 + ht * 0.5, az);
    float s = sdSphere(p - c, 0.035 + e * 0.025 + fresh * 0.028 + uBeat * 0.012);
    if (s < d) { d = s; g_id = 4.0; g_aux = band; }
  }
  return d;
}

/* 21 gpu — a full-frame compute board. Chips rise from an endless circuit
   substrate and carry the mix; traces between them pulse with the beat. */
float scGpu(vec3 p) {
  vec2 cell = floor(p.xz / 1.15);
  vec2 lp = mod(p.xz, 1.15) - 0.575;
  float h = hash11(dot(cell, vec2(13.1, 7.7)));
  float e = clamp(spec(fract(h * 2.3 + 0.1)), 0.0, 1.2);
  float chipH = 0.10 + h * 0.30 + e * 0.55 * uSens + uBeat * 0.08;
  float chip = sdRBox(vec3(lp.x, p.y - chipH * 0.5, lp.y),
                      vec3(0.30 + h * 0.08, chipH * 0.5, 0.30 + h * 0.08), 0.035);
  float board = p.y;
  float d = chip;
  g_id = 16.0; g_aux = fract(h + e + 0.1);
  if (board < d) { d = board; g_id = 29.0; g_aux = e; }
  return d;
}

/* 22 vinyl — a turntable record: glossy grooves burned by the spectrum, a
   theme-coloured label and a tonearm riding the beat */
float scVinyl(vec3 p) {
  vec3 q = p;
  q.xz *= rot(0.34);          // tilt the deck toward the camera
  float disc = sdCyl(q, 0.1, 3.4);
  disc = max(disc, -sdCyl(q - vec3(0.0, 0.12, 0.0), 0.35, 0.08));
  g_id = 23.0; g_aux = length(q.xz);
  float label = sdCyl(q - vec3(0.0, 0.1, 0.0), 0.14, 0.86);
  if (label < disc) { disc = label; g_id = 24.0; }
  float arm = sdCapsule(p, vec3(2.9, 0.5, 2.9), vec3(0.5, 0.18, 0.5), 0.05);
  if (arm < disc) { disc = arm; g_id = 25.0; }
  float pivot = sdSphere(p - vec3(2.9, 0.56, 2.9), 0.16);
  if (pivot < disc) { disc = pivot; g_id = 25.0; g_aux = 0.4; }
  return disc;
}

/* 20 lava — a macro wax field. Soft-metaball blobs drift through a warm
   glow; no glass vessel or table. */
float scLavaGlass(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float sp = spec(fract(fi / 7.0 + 0.11));
    vec3 c = vec3(sin(uTime * 0.17 + fi * 2.1) * 1.55,
                  sin(uTime * 0.13 + fi * 1.7) * 1.15,
                  sin(uTime * 0.11 + fi * 3.1) * 0.85);
    float r = 0.30 + sp * 0.18 * uSens + uBeat * 0.06 + 0.08 * sin(uTime * 0.5 + fi);
    float s = sdSphere(p - c, r);
    d = (i == 0) ? s : smin(d, s, 0.55);
  }
  g_id = 18.0;
  g_aux = clamp(0.5 + 0.5 * sin(p.y * 1.6 + uTime * 0.8 + uBass * 2.0), 0.0, 1.0);
  return d * 0.72;
}

/* 23 chladni — a resonant metal plate, nodal sand burning through the dark.
   The nodal set is the classic Chladni figure: the zero crossings of two
   crossed standing waves. The integer pair is chosen from the bass and
   treble bands, so the figure changes when the mix does. */
float scChladni(vec3 p) {
  /* An infinite resonant sheet. No rim, stem or floor: the nodal field runs
     to every edge of the frame instead of sitting inside a disc. */
  g_id = 28.0;
  g_aux = length(p.xz) / 8.0;
  return p.y;
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
  if (uMode == 20) return scLavaGlass(p);
  if (uMode == 21) return scGpu(p);
  if (uMode == 22) return scVinyl(p);
  if (uMode == 23) return scChladni(p);
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
    m.alb = vec3(0.035); m.rough = 0.16 + 0.12 * uIdle; m.metal = 1.0;
  } else if (id < 1.5) {                // lit metal slab
    m.alb = c * 0.55; m.rough = 0.22; m.metal = 1.0;
    m.emis = c * (0.14 + 1.0 * spec(aux) * uSens + uBeat * 0.3);
  } else if (id < 2.5 && uMode == 16) {  // restrained polar jet, tinted to the active theme
    m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0;
    m.emis = palf(0.74) * (0.34 + uBeat * 0.35 + uDrop * 0.45);
  } else if (id < 2.5) {                // silk ribbon
    m.alb = c * 0.5; m.rough = 0.22; m.metal = 0.6;
    float bead = max(0.0, sin(p.x * 9.0 + p.y * 2.8 + uTime * 2.1 + aux * 9.0));
    bead *= bead; bead *= bead; bead *= bead;
    m.emis = c * (0.72 + uLevel * 1.25 + uBeat * 0.4 + uHigh * 0.25)
           + c * bead * (0.20 + uHigh * 0.85);
  } else if (id < 3.5) {                // glass
    m.alb = vec3(0.92); m.rough = 0.06; m.metal = 0.0; m.trans = 1.0;
    m.emis = c * (0.06 + uLevel * 0.16);
  } else if (id < 4.5) {                // pure emissive
    m.alb = c * 0.1; m.rough = 0.3; m.metal = 0.0;
    m.emis = c * (1.1 + 2.2 * spec(aux) + uBeat * 1.1);
    if (uMode == 3) {
      float flicker = max(0.0, sin(uTime * 4.6 + aux * 22.0 + p.y * 5.0));
      flicker *= flicker; flicker *= flicker; flicker *= flicker;
      m.emis += palf(0.94) * flicker * (0.12 + uHigh * 0.85);
    }
  } else if (id < 5.5) {                // spectrogram terrace
    vec3 cc = palf(pow(clamp(aux, 0.0, 1.0), 0.55) * 0.34 + 0.56);
    m.alb = cc * 0.5; m.rough = 0.5; m.metal = 0.15;
    /* the newest edge answers treble: a hat lands and the waterfall's front
       lip lights up even where that bin's column isn't tall yet */
    float age = clamp((p.z + 4.8) / 9.6, 0.0, 1.0);
    /* the terrace answers the kick and the drop, not just the waterfall:
       beat lifts the whole relief, the drop surges it harder */
    m.emis = cc * (0.12 + pow(aux, 2.1) * 0.90) * (1.0 + uBeat * 0.35 + uDrop * 0.5)
           + palf(0.50) * pow(1.0 - age, 5.0) * uHigh * 0.40;
    float strata = 1.0 - smoothstep(0.03, 0.13, abs(sin(p.y * 18.0)));
    m.emis += cc * strata * aux * 0.25;
    /* luminous bin and time grid: this is what makes the field read as a
       spectrogram rather than a smooth pink hill */
    float binLine = 1.0 - smoothstep(0.018, 0.044, abs(fract(p.x * 9.5) - 0.5));
    float rowLine = 1.0 - smoothstep(0.012, 0.032, abs(fract(p.z * 2.6) - 0.5));
    vec3 gridCol = palf(fract(aux * 0.55 + 0.42));
    m.emis += gridCol * (binLine * 0.30 + rowLine * 0.16)
            * (0.35 + aux * 0.75 + uLevel * 0.25);
  } else if (id < 6.5) {                // structural strut / bezel
    m.alb = palf(0.3) * 0.25; m.rough = 0.3; m.metal = 0.8;
    m.emis = palf(0.25) * (0.12 + uLevel * 0.25);
  } else if (id < 7.5) {                // terrain rock
    float crest = pow(clamp(aux, 0.0, 1.0), 3.0);
    m.alb = mix(vec3(0.025, 0.023, 0.021), palf(aux * 0.42 + 0.02) * 0.30, aux * 0.86);
    m.rough = 0.62; m.metal = 0.18;
    /* snow-line glow on the crests plus a cool wash in the troughs. The ridge
       used to freeze on hits — every other mode pulsed while the mountains
       sat still — so the crest line now lifts with the beat and shimmers
       with treble. */
    m.emis = (palf(aux * 0.40 + 0.02) * crest * 0.24
              + palf(0.40) * pow(1.0 - aux, 4.0) * 0.022)
           * (1.0 + uBeat * 0.30 + uHigh * crest * 0.22);
    /* atmospheric perspective: far ridges sink into the theme's deep end */
    float haze = smoothstep(2.0, 14.0, -p.z) * 0.65;
    m.alb = mix(m.alb, palf(0.12) * 0.08, haze);
    m.emis *= 1.0 - haze * 0.55;
    // Fine topographic isobars echo the standing-wave field over the ridges.
    float contour = 1.0 - smoothstep(0.025, 0.11, abs(sin(p.y * 19.0)));
    m.emis += palf(0.20 + aux * 0.52) * contour * (0.16 + uMid * 0.18) * (1.0 - haze);
  } else if (id < 8.5) {                // city block + windows
    // anti-aliased window grid: hard step() speckles badly at distance
    vec3 wp = p * vec3(2.6, 3.4, 2.6);
    vec3 fw = fract(wp);
    float wy = smoothstep(0.42, 0.5, fw.y) * (1.0 - smoothstep(0.82, 0.9, fw.y));
    float wx = smoothstep(0.42, 0.5, fw.x) * (1.0 - smoothstep(0.82, 0.9, fw.x));
    float wz = smoothstep(0.42, 0.5, fw.z) * (1.0 - smoothstep(0.82, 0.9, fw.z));
    float address = hash13(floor(wp));
    float lit = step(0.28, address) * (0.82 + 0.18 * sin(uTime * 0.4 + address * TAU));
    float win = wy * max(wx, wz) * lit;
    m.alb = vec3(0.02); m.rough = 0.22; m.metal = 0.5;
    /* Each tower draws its windows from a different point on the palette,
       so a skyline is a street of signs rather than one white grid. */
    vec3 wc = palf(fract(aux * 0.55 + address * 0.31 + 0.04));
    m.emis = (wc * win * (0.5 + aux * 0.9 + uBeat * 0.35 + uDrop * 0.4))
           + palf(0.85) * win * uHigh * 0.22;
  } else if (id < 9.5) {                // wet asphalt
    m.alb = vec3(0.012); m.rough = 0.14; m.metal = 0.9;
  } else if (id < 10.5) {               // liquid chrome
    m.alb = palf(0.35) * 0.6 + 0.45; m.rough = 0.09; m.metal = 1.0;
    /* chrome reflects the scene, which is often a dark room — a bare metal
       surface with nothing to mirror reads as a black blob. A faint theme
       wash keeps the membrane visible between the highlights. */
    m.emis = palf(0.45) * (0.14 + uLevel * 0.10) + palf(uLevel) * uBeat * 0.5;
  } else if (id < 11.5 && uMode == 4) { // kaleido facets — iridescent mirror, not clear glass
    float angle = atan2s(p.y, p.x);
    float radius = length(p.xy);
    vec3 cc = palf(fract(aux * 1.7 + angle / TAU * 0.25 + uTime * 0.025));
    float luminance = dot(cc, vec3(0.2126, 0.7152, 0.0722));
    cc = mix(vec3(luminance), cc, 1.65);
    float cut = pow(max(0.0, 0.5 + 0.5 * sin(p.x * 17.0 + p.y * 23.0 + uTime * 0.36)), 12.0);
    float radialCut = pow(max(0.0, sin(angle * 8.0 + radius * 5.0 - uTime * 0.3)), 8.0);
    m.alb = cc * 0.20; m.rough = 0.18; m.metal = 0.52;
    m.emis = max(cc, vec3(0.0)) * (0.24 + aux * 0.38 + cut * 0.60 + radialCut * 0.36 + uBeat * 0.5);
  } else if (id < 11.5) {               // dispersive glass
    m.alb = vec3(0.98); m.rough = 0.0; m.metal = 0.0; m.trans = 1.0;
  } else if (id < 12.5) {               // event horizon — swallows everything
    m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0; m.emis = vec3(0.0);
  } else if (id < 13.5) {               // fractal shell
    vec3 cc = palf(fract(aux * 2.4 + 0.22 * sin(p.y * 2.0 + p.x * 1.4) + uTime * 0.03));
    m.alb = cc * (0.35 + 0.5 * (1.0 - aux));
    m.rough = 0.22 + aux * 0.2; m.metal = 0.8;
    float vein = max(0.0, sin(aux * 30.0 + p.y * 3.0 + uTime * 0.9));
    vein *= vein; vein *= vein; vein *= vein;
    m.emis = cc * (0.15 + pow(1.0 - aux, 2.0) * 0.9 + uBeat * 0.35 + uDrop * 0.4)
           + palf(0.88) * vein * (0.22 + uHigh * 0.65);
  } else if (id < 14.5) {               // spare glass material
    m.alb = vec3(0.9); m.rough = 0.06; m.metal = 0.0; m.trans = 1.0;
    m.emis = palf(0.3) * 0.08;
  } else if (id < 15.5) {               // radar disc
    float a = atan2s(p.z, p.x);
    float sweep = fract((a / TAU) - uTime * 0.22);
    float wedge = pow(1.0 - sweep, 4.0);
    float radius = length(p.xz);
    float rings = 1.0 - smoothstep(0.008, 0.026, abs(fract(radius * 1.55) - 0.5));
    float spokePhase = abs(fract(a / TAU * 8.0 + 0.5) - 0.5);
    float spokes = 1.0 - smoothstep(0.012, 0.035, spokePhase);
    float sweepLine = 1.0 - smoothstep(0.0, 0.035, min(sweep, 1.0 - sweep));
    float crosshair = max(1.0 - smoothstep(0.008, 0.026, abs(p.x)),
                          1.0 - smoothstep(0.008, 0.026, abs(p.z)));
    vec3 phosphor = palf(0.42);
    m.alb = vec3(0.012); m.rough = 0.86; m.metal = 0.04;
    m.emis = phosphor * (0.025 + wedge * 0.72 + rings * 0.15 + spokes * 0.055
                         + sweepLine * 1.0 + crosshair * 0.035)
           + palf(0.88) * sweepLine * 0.65;
  } else if (id < 16.5) {               // gpu voxel
    m.alb = vec3(0.03); m.rough = 0.25; m.metal = 0.6;
    m.emis = palf(aux) * (0.06 + aux * 1.15 + uBeat * 0.28);
  } else if (id < 17.5) {               // prism beam / dispersion fan
    m.alb = vec3(0.0); m.rough = 1.0;
    // saturate the palette walk so the fan reads as a spectrum, not a white wedge
    vec3 cc = palf(aux);
    float l = dot(cc, vec3(0.2126, 0.7152, 0.0722));
    cc = mix(vec3(l), cc, 1.6);
    m.emis = max(cc, vec3(0.0)) * (0.5 + spec(aux) * 0.9 + uBeat * 0.25);
  } else if (id < 18.5) {               // orb core — warm, never clipped
    vec3 cc = palf(0.16 + aux * 0.42);
    m.alb = cc * 0.2; m.rough = 0.4;
    m.emis = cc * (0.55 + 1.1 * aux + uBeat * 0.5);
  } else if (id < 20.5 && uMode == 16) { // void accretion disc — dark metal with hot stream bands
    float az = atan2s(p.z, p.x) - uTime * 0.35;
    float stream = pow(max(0.0, sin(az * 3.0 - uTime * 1.2 + aux * 4.0)), 4.0);
    vec3 cc = palf(mix(0.08, 0.88, pow(1.0 - aux, 0.72)));
    m.alb = cc * 0.018; m.rough = 0.96; m.metal = 0.0;
    m.emis = cc * (0.055 + 0.18 * (1.0 - aux) + stream * 1.0 + uBeat * 0.28);
  } else if (id < 20.5) {               // scope trace — emissive glass tube
    vec3 cc = palf(aux);
    m.alb = cc * 0.2; m.rough = 0.12; m.metal = 0.3;
    m.emis = cc * (1.4 + uLevel * 1.6 + uBeat * 0.8);
  } else if (id < 23.5) {               // vinyl grooves — glossy black + spectrum burn
    float r = aux;
    float rr = clamp(r / 3.4, 0.0, 1.0);
    float gf = mix(64.0, 20.0, clamp(r / 3.4, 0.0, 1.0));
    float grooves = 0.5 + 0.5 * sin(r * gf);
    float band = spec(pow(rr, 0.92));
    float ang = atan2s(p.z, p.x);
    float sweep = smoothstep(-0.55, 0.55, sin(ang - uTime * 1.6 + uBeat * 0.12));
    m.alb = vec3(0.010); m.rough = 0.16; m.metal = 0.88;
    m.emis = palf(pow(rr, 1.15))
      * (grooves * (0.05 + band * 0.10)
         + sweep * grooves * band * (1.3 + uBeat * 0.9)
         + grooves * uHigh * 0.22
         + uBeat * 0.10);
  } else if (id < 24.5) {               // record label
    vec3 cc = palf(0.5);
    m.alb = cc * 0.6; m.rough = 0.6; m.metal = 0.0;
    m.emis = palf(0.5) * (0.05 + uBeat * 0.22);
  } else if (id < 25.5) {               // tonearm — brushed metal
    m.alb = vec3(0.55); m.rough = 0.18; m.metal = 0.95;
  } else if (id < 26.5) {               // matte enclosure wall
    /* set dressing for chambers/panels. Deliberately NOT mirror-grade: walls
       are huge on screen and a reflective wall made nearly every primary ray
       spawn a full second trace (measured 2x the scene cost). Roughness
       above the bounce gate keeps them cheap; they still light up under
       accents, fog and bloom. */
    m.alb = palf(0.28) * 0.055; m.rough = 0.55; m.metal = 0.12;
    m.emis = palf(0.30) * 0.012 * (0.4 + uLevel);
    /* Rooms share practical strip lights and a faint horizontal datum so
       their walls read as built space rather than a painted backdrop. */
    bool roomMode = uMode == 0 || uMode == 2 || uMode == 4 || uMode == 5 ||
                    uMode == 7 || uMode == 12 || uMode == 13 || uMode == 14 ||
                    uMode == 15 || uMode == 18 || uMode == 19 || uMode == 20 ||
                    uMode == 21 || uMode == 22;
    if (roomMode && length(p.xz) > 2.0) {
      float strip = smoothstep(0.955, 0.99, sin(atan2s(p.z, p.x) * 6.0))
                  * clamp(p.y * 0.22 + 0.55, 0.0, 1.0);
      float datum = 1.0 - smoothstep(0.015, 0.05, abs(fract(p.y * 0.55) - 0.5));
      m.emis += palf(0.62) * strip * (0.30 + uBeat * 0.55)
             + palf(0.45) * datum * 0.025 * (0.4 + uLevel);
      if (uMode == 2) {
        vec2 gr = abs(fract(p.xy * 1.55) - 0.5);
        float grid = (1.0 - smoothstep(0.02, 0.055, gr.x))
                   + (1.0 - smoothstep(0.02, 0.055, gr.y));
        m.emis += palf(0.38) * grid * 0.055 * (0.6 + uLevel);
      }
    }
  } else if (id < 27.5) {               // wet gloss floor
    /* water under kaleido / prism fan. Same trade as above: the look is the
       smear of bloom reflecting off a dark sheen, which shading alone gives,
       not a traced mirror — a true mirror floor doubled every scene that
       grew one (kaleido went ~2.5x with a full-id mirror). */
    m.alb = vec3(0.010); m.rough = 0.37; m.metal = 0.90;
    m.emis = palf(0.60) * 0.010 * (0.35 + uLevel);
  } else if (id < 28.5) {               // chladni plate — nodal sand on metal
    float rr = clamp(length(p.xz) / 8.0, 0.0, 1.0);
    /* the pair is read from the bands: bass thickens one axis, highs the
       other. When they land on the same integer, step one so the figure
       never collapses to the degenerate n == m case. */
    float nn = 2.0 + clamp(uBass, 0.0, 1.0) * 3.2;
    float mm = 2.0 + clamp(uHigh, 0.0, 1.0) * 3.2;
    if (abs(nn - mm) < 0.35) mm += 0.7;
    vec2 sp = p.xz * rot(0.08);
    vec2 q = sp * 0.52;
    float ph = uTime * 0.16;
    float nodes = cos(nn * PI * q.x + ph) * cos(mm * PI * q.y - ph)
                - cos(mm * PI * q.x - ph) * cos(nn * PI * q.y + ph);
    float line = 1.0 - smoothstep(0.0, 0.060, abs(nodes));
    float sand = step(0.985, hash13(floor(sp * 170.0).xyy));
    vec3 cc = palf(fract(rr * 0.85 + 0.05));
    m.alb = vec3(0.008) + cc * 0.03;
    m.rough = 0.26; m.metal = 0.86;
    m.emis = cc * (0.014 + pow(line, 1.6) * (2.0 + uBeat * 1.8) + sand * line * 2.6)
           + palf(0.75) * pow(line, 4.0) * (0.35 + uHigh * 0.5);
  } else if (id < 29.5) {               // compute board substrate
    vec2 gp = abs(fract(p.xz * 2.2) - 0.5);
    float traceX = 1.0 - smoothstep(0.018, 0.055, gp.x);
    float traceZ = 1.0 - smoothstep(0.018, 0.055, gp.y);
    float trace = max(traceX, traceZ);
    float pulse = 0.55 + 0.45 * sin(p.x * 3.1 + p.z * 2.3 - uTime * 1.8);
    vec3 cc = palf(fract(0.18 + p.x * 0.025 + p.z * 0.03));
    m.alb = vec3(0.010); m.rough = 0.62; m.metal = 0.18;
    m.emis = cc * trace * (0.10 + uLevel * 0.28) * pulse
           + palf(0.82) * trace * uHigh * 0.12
           + cc * 0.012;
  } else if (id < 30.5) {               // plasma field
    vec2 q = p.xy * 0.78;
    float w = fbm2a(q * 1.35 + vec2(uTime * 0.10, -uTime * 0.07));
    float w2 = fbm2b(q * 2.35 - vec2(uTime * 0.06, uTime * 0.04));
    float bands = sin(q.x * 2.15 + q.y * 1.65 + w * 6.2 - uTime * 1.1);
    float fil = pow(clamp(1.0 - abs(bands), 0.0, 1.0), 5.0);
    float cells = pow(clamp(1.0 - abs(w2 * 2.0 - 1.0), 0.0, 1.0), 3.0);
    vec3 cc = palf(fract(0.5 + q.x * 0.07 + q.y * 0.045 + w * 0.45 + uTime * 0.025));
    float energy = fil * 1.25 + cells * 0.32;
    m.alb = vec3(0.010); m.rough = 0.66; m.metal = 0.08;
    m.emis = cc * energy * (0.34 + uLevel * 0.85 + uBeat * 0.42)
           + palf(0.90) * fil * uHigh * 0.24;
  } else {                              // accretion disc
    vec3 cc = mix(vec3(1.0, 0.93, 0.85), palf(0.85), clamp(aux * 1.4, 0.0, 1.0));
    m.alb = vec3(0.0); m.rough = 1.0;
    m.emis = cc * (3.2 * pow(1.0 - aux, 2.6) + 0.2 + uBeat * 0.5);
  }
  // per-mode emissive gain: dense scenes (particle/voxel fields) would
  // otherwise bloom into a flat white sheet
  float gain = 1.0;
  if (uMode == 3)  gain = 0.65;   // smaller, brighter particles
  if (uMode == 5)  gain = 0.42;   // spectro terrace
  if (uMode == 6)  gain = 0.55;   // tunnel
   if (uMode == 14) gain = 0.62;   // tensor — band-coupled rods earn more light
  if (uMode == 17) gain = 0.85;   // bloom field
  if (uMode == 9)  gain = 0.70;   // city
  if (uMode == 15) gain = 1.4;    // prism
  if (uMode == 2)  gain = 2.6;    // scope
  if (uMode == 12) gain = 1.2;    // orb
  if (uMode == 16) gain = 1.3;    // void
  if (uMode == 21) gain = 0.8;    // gpu
  if (uMode == 22) gain = 2.4;    // vinyl — dark deck, the groove burn carries it
  if (uMode == 13) gain = 2.1;    // fluid — chrome in a dark room needs the lift
  if (uMode == 23) gain = 0.95;   // chladni — thin emissive nodes, not a plate of light
  m.emis *= 0.42 * gain * mix(0.75, 1.35, uPop);
  return m;
}

/* ---------------- environment ---------------- */

/* sparse star field — only the space-facing scenes get it */
vec3 starField(vec3 rd) {
  vec3 d = rd * 220.0;
  vec3 id = floor(d);
  vec3 f = fract(d) - 0.5;
  float h = hash13(id);
  float s = (1.0 - smoothstep(0.0, 0.16, length(f))) * step(0.9885, h);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 6.0) + h * 40.0);
  return mix(vec3(1.0), palf(fract(h * 7.0)), 0.45) * s * tw * 1.6;
}

vec3 envBase(vec3 rd) {
  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.004, 0.0038, 0.0035), palf(0.15) * 0.035, pow(up, 2.0));
  sky += palf(0.75) * 0.012 * pow(clamp(-rd.y * 0.5 + 0.5, 0.0, 1.0), 3.0);
  if (uMode == 9 || uMode == 10 || uMode == 11 || uMode == 16 || uMode == 17 || uMode == 3 || uMode == 12) sky += starField(rd);
  if (uMode == 8) {
    // dusk wash + aurora ribbon over the ridges
    sky += palf(0.2) * 0.05 * pow(clamp(rd.y * 1.6 + 0.2, 0.0, 1.0), 1.5);
    float band = exp(-pow((rd.y - 0.26) * 6.0, 2.0));
    float ripple = 0.45 + 0.55 * sin(rd.x * 7.0 + uTime * 0.5) * sin(rd.x * 3.0 - uTime * 0.3);
    sky += palf(0.58) * band * ripple * (0.16 + uLevel * 0.34)
         + palf(0.28) * band * 0.035;
    sky += starField(rd) * 0.5;
    /* A small moon anchors the aurora sky and gives the ridges scale. */
    vec3 moonDir = normalize(vec3(-0.42, 0.34, -0.84));
    float md = dot(rd, moonDir);
    sky += palf(0.92) * smoothstep(0.9985, 0.9994, md) * 1.7;
    sky += palf(0.62) * pow(max(md, 0.0), 180.0) * 0.16;
  }
  if (uMode == 9) {
    /* dusk horizon behind the skyline: without it the towers ended in a
       featureless black band and the city read as a floating model. */
    float hz = exp(-pow((rd.y - 0.02) * 24.0, 2.0));
    sky += palf(0.38) * hz * (0.10 + uLevel * 0.10);
    sky += palf(0.62) * exp(-pow((rd.y - 0.24) * 4.2, 2.0)) * 0.025;
  }
  if (uMode == 13) {
    /* a low furnace glow under the mercury sea */
    float hz = exp(-pow((rd.y - 0.005) * 20.0, 2.0));
    sky += palf(0.72) * hz * (0.12 + uLevel * 0.20);
    sky += palf(0.32) * exp(-pow((rd.y - 0.26) * 4.0, 2.0)) * 0.035;
  }
  if (uMode == 20) {
    /* a warm haze behind the wax */
    float hz = exp(-pow((rd.y - 0.05) * 8.0, 2.0));
    sky += palf(0.30) * hz * (0.10 + uLevel * 0.22);
  }
  if (uMode == 1) {
    // low sun on a sea horizon: the ribbons used to play to an empty void
    vec3 sun = normalize(vec3(0.42, 0.10, -0.90));
    sky += palf(0.66) * pow(clamp(dot(rd, sun), 0.0, 1.0), 360.0) * (0.7 + uBeat * 0.35);
    float hz = exp(-pow((rd.y - 0.015) * 26.0, 2.0));
    sky += palf(0.72) * hz * (0.30 + uLevel * 0.5);
    sky += palf(0.30) * exp(-pow((rd.y - 0.24) * 3.4, 2.0)) * 0.05;
    sky += starField(rd) * smoothstep(0.06, 0.4, rd.y) * (0.7 + uLevel);
  }
  return sky;
}

/* Reflection/ambient probe: the base sky plus two soft strip lights. Chrome
   and glass need structured highlights to read as metal, but a camera ray
   that simply misses everything must NOT see the strips — that paints a bar
   across the sky. So primary misses use envBase, everything else envColor. */
vec3 envColor(vec3 rd) {
  vec3 sky = envBase(rd);
  // Lighting belongs in the reflection probe: primary sky rays otherwise
  // see a floating blue floodlight above every scene, even at silence.
  vec3 key = normalize(vec3(0.55, 0.75, -0.4));
  vec3 rim = normalize(vec3(-0.7, 0.2, 0.5));
  sky += palf(0.5) * pow(clamp(dot(rd, key), 0.0, 1.0), 96.0) * (1.1 + uLevel * 0.9);
  sky += palf(0.9) * pow(clamp(dot(rd, rim), 0.0, 1.0), 48.0) * 0.25;
  float az = atan2s(rd.z, rd.x);
  float b1 = exp(-pow((rd.y - 0.55) * 6.0, 2.0)) * (0.5 + 0.5 * cos(az));
  float b2 = exp(-pow((rd.y - 0.16) * 14.0, 2.0)) * (0.5 + 0.5 * cos(az * 2.0 + 2.2));
  return sky + palf(0.35) * b1 * 0.55 + palf(0.85) * b2 * 0.3;
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
    t += d * 0.72;
    if (t > tmax) break;
  }
  return -1.0;
}

/* Shadow steps scale with the tier, like the primary march already does.
   This was a flat 32 map() calls for every lit pixel whatever the quality:
   at the low tier, where the primary march is only 64 steps, the shadow ray
   was a third of the whole scene evaluation. Heavy modes settle on the low
   tier after the adaptive stepping, which is exactly where it is wanted.
   (No backticks in here — this file is one big JS template literal.)
   Budgeted at uSteps/8 (8..16): for terrain the primary path is texture-
   read-bound and every shadow sample re-runs the whole heightfield, so this
   is the last per-pixel eval that could be halved without touching the
   surface itself. Shadow penumbra reads a touch wider but the ridge shadow
   it is paying for survives. */
float softShadow(vec3 ro, vec3 rd, float tmax) {
  int maxSteps = clamp(uSteps / 8, 8, 16);
  float res = 1.0, t = 0.05;
  for (int i = 0; i < 16; i++) {
    if (i >= maxSteps) break;
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
  for (int i = 0; i < 3; i++) {
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
  // Punctual lights need a roughness floor: a mirror-smooth surface makes D
  // blow up. Clamping the *result* instead would flatten the narrow peak into
  // a broad saturated plateau, which is what washed whole scenes to white.
  float a = max(m.rough * m.rough, 0.012);
  float a2 = a * a;
  float dn = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dn * dn);
  float k = a * 0.5;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), m.alb, m.metal);
  vec3 F = F0 + (1.0 - F0) * pow(max(1.0 - vdh, 0.0), 5.0);   // base must never go negative
  vec3 spe = D * G * F / (4.0 * ndl * ndv + 1e-4);
  vec3 dif = (1.0 - F) * (1.0 - m.metal) * m.alb / PI;
  return (dif + spe) * lc * ndl;
}

vec3 shade(vec3 p, vec3 rd, vec3 n, Mat m, float shadows) {
  if (uMode == 16 && m.alb == vec3(0.0) && m.emis == vec3(0.0)) return vec3(0.0);
  vec3 v = -rd;
  vec3 key = normalize(vec3(0.55, 0.75, -0.4));
  /* Glow used to be the whole pixel, so a box was one flat colour. Wrapping
     it with the key gives every face a lit side and a dark side. */
  float wrap = (uMode == 3) ? 1.0 : clamp(dot(n, key) * 0.65 + 0.35, 0.18, 1.0);
  vec3 hot = mix(m.emis, vec3(dot(m.emis, vec3(0.2126, 0.7152, 0.0722))) * 1.15, 0.10);
  float hit = pow(clamp(uBeat, 0.0, 1.0), 0.55);
  vec3 col = hot * wrap * (1.0 + hit * 0.55);
  vec3 kc = mix(vec3(1.0, 0.97, 0.92), palf(0.55), 0.4) * (1.45 + uLevel * 0.7 + uBeat * 0.3);
  float sh = shadows > 0.5 ? softShadow(p + n * 0.01, key, 12.0) : 1.0;
  col += brdf(n, v, key, m, kc) * sh;
  vec3 fill = normalize(vec3(-0.6, 0.35, 0.55));
  col += brdf(n, v, fill, m, mix(vec3(0.75, 0.82, 0.95), palf(0.8), 0.35) * (0.55 + uBeat * 0.4));
  /* AO rides the same flag as the shadow: the calls that skip one (bounce
     shading inside reflections and glass, the self-lit sphere fields) are
     the ones where three more SDF taps per pixel buy nothing visible */
  float occ = shadows > 0.5 ? ao(p, n) : 1.0;
  col += m.alb * (1.0 - m.metal) * envColor(n) * 0.7 * occ;
  float fres = pow(max(1.0 - max(dot(n, v), 0.0), 0.0), 4.0);
  col += palf(0.7) * fres * 0.18 * occ * (0.4 + uLevel);
  /* Shared treble response: the palette rim brightens with the high band and
     the beat, so every scene answers hats and air instead of only the kick.
     (A per-pixel glint was removed: the sin/x^8 pass cost 10-20% on the heavy
     scenes for a detail that read mostly as noise in screenshots.) */
  col += palf(0.82) * fres * fres * (0.10 + uHigh * 0.30 + uBeat * 0.10) * occ;
  return col;
}

/* ---------------- volumetrics (nebula / spiral / lava) ---------------- */

float volDensity(vec3 p) {
  if (uMode == 10) {                        // nebula
    vec3 q = p;
    q.xz *= rot(uTime * 0.05);
    float disc = exp(-abs(q.y * 1.42) * 1.3);
    float f = fbm3(q * 0.9 + vec3(0.0, uTime * 0.03, uTime * 0.02));
    f = f * f * 1.8;                                    // more contrast between wisps
    /* Fine structure and lanes keep the cloud from reading as one soft
       magenta smear at phone resolution. */
    float fine = fbm3(q * 3.35 + vec3(0.0, uTime * 0.06, uTime * 0.035));
    f *= mix(0.56, 1.22, smoothstep(0.42, 0.82, fine));
    f += fine * fine * 0.22;
    float radius = length(q.xz);
    float angle = atan2s(q.z, q.x);
    float arms = 0.5 + 0.5 * cos(angle * 3.0 - radius * 1.55 + uTime * 0.16);
    float filaments = pow(max(0.0, cos(angle * 7.0 - radius * 2.7 + f * 3.2 + uTime * 0.12)), 9.0);
    float d = disc * f * (0.20 + arms * 0.58) + disc * filaments * (0.18 + f * 0.34);
    d += 0.32 * exp(-length(q) * 1.1) * (1.0 + uBass + uDrop * 0.55);   // hot core
    d *= 1.0 - smoothstep(1.4, 6.4, length(q));          // a wider cloud, not a ball
    d *= mix(0.58, 1.0, smoothstep(0.5, 1.8, radius));  // open a soft cavity around the starbirth core
    /* mids thicken the wisps, highs burn off the outer veil, so the cloud
       answers the whole mix instead of only the kick; the drop slams it all */
    return max(0.0, d - 0.07) * (2.4 + uLevel * 2.0 + uMid * 0.8 + uHigh * 0.25 + uDrop * 0.7);
  }
  if (uMode == 11) {                        // spiral galaxy
    vec3 q = p;
    q.xz *= rot(uTime * 0.07);
    float r = length(q.xz);
    float a = atan2s(q.z, q.x);
    float arm = cos(a * 2.0 - r * 2.3 + uTime * 0.2) * 0.5 + 0.5;
    /* the old density was so thin the disc vanished against the sky; this
       carries the arms as a real luminous sheet */
    float d = pow(arm, 3.2) * exp(-r * 0.34) * exp(-abs(q.y) * 4.5) * 3.4;
    d += exp(-r * 3.4 - abs(q.y) * 7.0) * (1.1 + uBass * 0.8 + uDrop * 0.5);   // bulge, not a floodlight
    d *= 0.55 + 0.9 * fbm3(q * 2.4 + uTime * 0.05);               // dust lanes inside the arms
    return d * (1.0 + uLevel + uMid * 0.25 + uHigh * 0.2);
  }
  // lava
  vec3 q = p;
  float d = 1e9;
  float le = spec(0.14);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ph = uTime * (0.25 + fi * 0.07) + fi * 2.1;
    vec3 c = vec3(sin(ph * 0.7) * 0.42, sin(ph) * 1.45, cos(ph * 0.6) * 0.42);
    float rr = 0.46 + le * (0.18 + fi * 0.035) * uSens + uBass * 0.14 + uDrop * 0.1;
    float s = length(q - c) - rr;
    d = (i == 0) ? s : smin(d, s, 0.3);
  }
  float cyl = sdCyl(q, 2.1, 1.15);
  float bubbles = pow(max(0.0, sin(q.y * 7.0 + uTime * 2.1 + q.x * 2.7) *
                                sin(q.z * 6.0 - uTime * 1.7)), 22.0);
  return max(0.0, -d * 2.4) * step(cyl, 0.0)
       * (1.18 + uBass * 0.72 + uDrop * 0.55 + bubbles * (0.25 + uHigh * 0.8));
}

vec3 volColor(float dens, vec3 p) {
  float r = length(p);
  float t = clamp(dens * 1.3, 0.0, 1.0);
  // cool at the rim, hot in the core, blowing out to white at peak density
  /* sweep the whole palette: hot mid-ramp hues in the core, the deep end at
     the rim, the bright end only in the densest filaments — two fixed stops
     (0.12 -> 0.8) washed five-colour palettes out to their pale end */
  float rr = clamp(r * 0.2, 0.0, 1.0);
  vec3 c = mix(palf(0.55 - rr * 0.4), palf(0.08 + rr * 0.15), smoothstep(0.2, 0.9, rr));
  if (uMode == 10 || uMode == 11) {
    float spark = pow(max(0.0, sin(p.x * 13.0 + p.y * 17.0 + p.z * 11.0 + uTime * 2.4)), 28.0);
    c += palf(0.95) * spark * (0.16 + uHigh * 1.15);
  }
  float paleMix = (uMode == 20) ? 0.10 : 0.38;
  c = mix(c, palf(0.78), smoothstep(0.35, 0.9, t) * paleMix);
  float whiteCore = (uMode == 20) ? 0.025 : 0.12;
  c = mix(c, vec3(1.0, 0.95, 0.9), pow(t, 4.0) * whiteCore);   // keep hue in the dense core
  /* the lamp wax sits behind glass and loses half its light to the wall
     march — it measured a third of the nebula's brightness. Base it hotter
     so the lamp actually glows between beats. */
  float base = (uMode == 20) ? 0.82 : 0.52;
  if (uMode == 20) {
    float heat = smoothstep(-1.8, 1.8, p.y + 0.35 * sin(uTime * 0.35 + p.x * 2.0));
    vec3 wax = mix(palf(0.10), palf(0.58), heat);
    c = mix(c, wax, 0.92);
  }
  return c * (base + uBeat * 0.5 + uDrop * 0.3);
}

/* Volume march with an optional far limit, so a surface can occlude it. */
vec3 marchVolume(vec3 ro, vec3 rd, float tmax, vec3 field) {
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float t = 0.4;
  /* Volumes were sampled at only uSteps/3, which left the nebula, galaxy and
     wax looking like soft blobs at low/medium tiers. Keep enough samples to
     resolve filaments, with a mode-specific cap for cost. */
  int steps = min(max(uSteps / 2, uMode == 20 ? 24 : 32), 96);
  float stepSize = 0.16;
  /* the wax is enclosed in glass and read as murk against the bright
     vessel highlights — the lamp gets a gain the open volumes don't need */
  float gain = (uMode == 20) ? 2.1 : 1.0;
  /* Clip the march to where the medium can be non-zero, so the step budget
     is spent inside the cloud rather than on empty sky: the nebula is faded
     to nothing past r 6.4, the galaxy disc is gone beyond |y| 1.2. */
  float tEnd = min(14.0, tmax);
  if (uMode == 10) {
    float b = dot(ro, rd), c = dot(ro, ro) - 6.5 * 6.5, h = b * b - c;
    if (h < 0.0) { tEnd = 0.0; }
    else { h = sqrt(h); t = max(t, -b - h); tEnd = min(tEnd, -b + h); }
  } else if (uMode == 20) {
    /* the lamp's wax lives inside the vessel (cylinder h 2.1, r 1.15 — a
       2.45 bounding sphere). Starting at the camera spent the low tier's
       21 steps on the 4 units of air in front of the glass and never
       reached the wax: the lamp rendered empty. */
    float b = dot(ro, rd), c = dot(ro, ro) - 2.45 * 2.45, h = b * b - c;
    if (h < 0.0) { tEnd = 0.0; }
    else { h = sqrt(h); t = max(t, -b - h); tEnd = min(tEnd, -b + h); }
  } else if (uMode == 11 && abs(rd.y) > 1e-4) {
    float ta = (1.2 - ro.y) / rd.y, tb = (-1.2 - ro.y) / rd.y;
    t = max(t, min(ta, tb));
    tEnd = min(tEnd, max(ta, tb));
  }
  for (int i = 0; i < 72; i++) {
    if (i >= steps || trans < 0.02 || t > tEnd) break;
    vec3 p = ro + rd * t;
    float d = volDensity(p) * (0.8 + uLevel * 0.45 + pow(clamp(uBeat, 0.0, 1.0), 0.55) * 0.7);
    if (d > 0.001) {
      float a = 1.0 - exp(-d * stepSize * 3.2);
      acc += trans * a * volColor(d, p) * (0.6 + uLevel * 0.5) * gain;
      trans *= 1.0 - a;
    }
    t += stepSize * (1.0 + t * 0.09);
  }
  if (tmax > 13.0 && uMode != 20) acc += (envBase(rd) + field) * trans;
  return acc;
}

bool isVolumetric(int m) { return m == 10 || m == 11; }

/* ---------------- camera ---------------- */

void camera(float t, vec2 uv, vec2 dofJitter, out vec3 ro, out vec3 rd) {
  t *= 1.75;
  vec3 ta = vec3(0.0);
  float fov = 1.5;
  float ap = 0.012;
  float sway = sin(t * 0.21) * 0.22;
  if (uMode == 0)       { float por = 1.0 - smoothstep(0.5, 0.85, uRes.x / max(uRes.y, 1.0)); ro = vec3(sway * 2.0, 2.4 + uBeat * 0.1 + por * 0.6, 8.4 + por * 10.0); ta = vec3(0.0, 1.3, 0.0); ap = 0.035; }
  else if (uMode == 1)  { float por = 1.0 - smoothstep(0.5, 0.85, uRes.x / max(uRes.y, 1.0)); ro = vec3(sway * 1.4, 1.1, 6.6 + por * 1.8); ta = vec3(0.0, 0.0, -1.2); ap = 0.03; }
  else if (uMode == 2)  { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.11) * 0.06, cos(t * 0.09) * 0.05, 4.3); ta = vec3(0.0, 0.0, 0.0); ap = 0.006; fov = 1.55 * min(1.0, aspect); }
  else if (uMode == 3)  { ro = vec3(sin(t * 0.13) * 4.2, 0.85 + cos(t * 0.11) * 0.5, cos(t * 0.13) * 4.2); ta = vec3(0.0, 0.0, 0.0); ap = 0.022; fov = 1.34; }
  else if (uMode == 4)  { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(0.0, 0.0, 3.9); ap = 0.008; fov = 1.35 * min(1.0, aspect); }
  else if (uMode == 5)  { float por = 1.0 - smoothstep(0.5, 0.85, uRes.x / max(uRes.y, 1.0)); ro = vec3(sway * 1.4, 2.7, 7.2 + por * 1.4); ta = vec3(0.0, 0.55, -3.0); ap = 0.012; fov = 1.30; }
  else if (uMode == 6)  { ro = vec3(sin(t * 0.4) * 0.3, cos(t * 0.33) * 0.3, 4.0); ta = ro + vec3(0.0, 0.0, -1.0); ap = 0.02; }
  else if (uMode == 7)  { ro = vec3(sin(t * 0.07) * 0.10, cos(t * 0.09) * 0.08, 4.35); ta = vec3(0.0); ap = 0.006; fov = 1.56; }
  else if (uMode == 8)  { ro = vec3(sway * 1.6, 3.2, 9.0); ta = vec3(0.0, 0.35, -3.5); ap = 0.008; }
  else if (uMode == 9)  {
    // An orbit at street height passed through the repeated buildings,
    // turning whole views into a dark wall. Clear the tallest audio-driven
    // roof (including its crown), even at the maximum sensitivity.
    float roof = 4.4 + 2.64 * clamp(uSens, 0.0, 2.4);
    ro = vec3(sin(t * 0.09) * 8.8, roof + sin(t * 0.14) * 0.25, cos(t * 0.09) * 8.8);
    ta = vec3(0.0, 2.8, 0.0); ap = 0.018;
  }
  else if (uMode == 10) { ro = vec3(sin(t * 0.08) * 5.4, 1.6, cos(t * 0.08) * 5.4); ap = 0.0; }
  else if (uMode == 11) { ro = vec3(sin(t * 0.06) * 2.8, 4.4 + sin(t * 0.1) * 0.7, cos(t * 0.06) * 2.8); ta = vec3(0.0); ap = 0.0; }
  else if (uMode == 12) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.13) * 0.35, 0.16, 2.95 + cos(t * 0.11) * 0.10); ta = vec3(0.0, 0.0, 0.0); ap = 0.008; fov = 1.18 * min(1.0, aspect); }
  else if (uMode == 13) { float por = 1.0 - smoothstep(0.5, 0.85, uRes.x / max(uRes.y, 1.0)); ro = vec3(sway * 1.5, 1.05, 5.2 + por * 1.2); ta = vec3(0.0, 0.10, -2.8); ap = 0.012; fov = 1.32; }
  else if (uMode == 14) { ro = vec3(sway * 0.6, 0.20, 3.2); ta = vec3(0.0, 0.05, -4.0); ap = 0.012; fov = 1.48; }
  /* a gentle orbit rather than the locked frontal shot: the slab itself
     rotates, so any camera drift now produces real parallax between beam,
     prism and fan instead of one flat diagram */
  else if (uMode == 15) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.12) * 0.16, 0.10, 3.55 + cos(t * 0.12) * 0.08); ta = vec3(0.0); ap = 0.004; fov = min(1.5, 1.62 * max(aspect, 0.3)); }
  else if (uMode == 16) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.08) * 3.7, 0.48, cos(t * 0.08) * 3.7); ap = 0.004; fov = 1.35 * min(1.0, aspect); }
  else if (uMode == 17) { ro = vec3(sin(t * 0.07) * 0.10, 0.06, 3.15); ta = vec3(0.0, 0.0, 0.0); ap = 0.012; fov = 1.30; }
  else if (uMode == 18) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.11) * 1.65, 0.55 + sin(t * 0.08) * 0.16, cos(t * 0.11) * 1.65); ta = vec3(0.0, 0.0, 0.0); ap = 0.010; fov = 1.34 * min(1.0, aspect); }
  else if (uMode == 19) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.045) * 0.08, 3.65, 0.62 + cos(t * 0.045) * 0.06); ta = vec3(0.0, 0.0, 0.0); ap = 0.0; fov = 1.22 * min(1.0, aspect); }
  else if (uMode == 20) { ro = vec3(sin(t * 0.09) * 0.10, cos(t * 0.07) * 0.08, 4.15); ta = vec3(0.0); ap = 0.004; fov = 1.42; }
  else if (uMode == 21) { ro = vec3(sway * 0.9, 0.72, 4.6); ta = vec3(0.0, 0.30, -3.0); ap = 0.014; fov = 1.34; }
  else if (uMode == 22) { ro = vec3(sin(t * 0.09) * 0.10, 4.55, 1.65); ta = vec3(0.0, 0.0, 0.0); ap = 0.018; fov = 1.46; }
  else if (uMode == 23) {
    /* look steeply down at the sheet so its pattern covers every pixel;
       a small drift gives parallax without ever revealing a horizon */
    ro = vec3(sin(t * 0.06) * 0.7, 3.8 + sin(t * 0.09) * 0.08, 1.9 + cos(t * 0.06) * 0.4);
    ta = vec3(0.0, 0.0, -0.8); ap = 0.006; fov = 1.42;
  }
  else                  { ro = vec3(sin(t * 0.12) * 4.0, 2.0, cos(t * 0.12) * 4.0); ap = 0.03; }
  /* Give small, isolated sculptures the same stage presence as the latest
     full-frame field. The aspect-aware rigs above still own phone framing. */
  if (uMode == 4) fov *= 1.20;
  if (uMode == 16 || uMode == 19) fov *= 1.08;
  /* cinematic pass layered over every rig, applied BEFORE the basis is
     built from ro→ta: a second, slower drift breaks the lone-sinusoid sway
     every camera used to share; a drop pushes the whole camera toward its
     target and tightens the lens (impact reads as compression); and the
     aperture breathes with the pulse so depth of field feels alive */
  {
    float drift = sin(t * 0.058) * 0.12 + sin(t * 0.041 + 1.9) * 0.08;
    ro.xz *= rot(drift);
    float k = min(uDrop, 1.0);
    ro = mix(ro, ta, k * 0.20);
    fov *= 1.0 - k * 0.085;
    float hit = pow(clamp(uBeat, 0.0, 1.0), 0.5);
    ro = mix(ro, ta, hit * 0.07);
    fov *= 1.0 - hit * 0.055;
    ap *= 1.0 + hit * 0.65;
  }
  /* The tunnel target is camera-relative. Shared drift moves the camera,
     so move its forward target with it or the bore exits the phone frame. */
  if (uMode == 6) ta = ro + vec3(0.0, 0.0, -1.0);
  // Beat/drop dolly moves may tighten the view, but cannot enter a roof.
  if (uMode == 9) ro.y = max(ro.y, 4.4 + 2.64 * clamp(uSens, 0.0, 2.4));
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

/* ---------------- direct field modes ---------------- */

/* A few modes are stronger as full-frame graphic fields than as objects on
   a stage. They bypass the ray marcher and are composited through the same
   bloom/tonemap path as everything else. */
bool isFieldMode(int m) {
  return m == 3 || m == 4 || m == 7 || m == 12 || m == 14 || m == 15 || m == 17 || m == 18 || m == 20 || m == 21;
}

vec3 fieldScene(vec2 uv, vec3 field) {
  float r = length(uv);
  float a = atan2s(uv.y, uv.x);
  vec3 col = vec3(0.0);

  if (uMode == 3) {
    /* ember vortex */
    float twist = a + log(r + 0.25) * 2.6 - uTime * 0.35;
    float arm = pow(0.5 + 0.5 * sin(twist * 2.0), 5.0);
    vec2 g = vec2(a / TAU * 28.0 + r * 2.0, r * 9.0 - uTime * 0.4);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash11(id.x * 13.7 + id.y * 71.3);
    float star = (1.0 - smoothstep(0.0, 0.18, length(f))) * step(0.62, h);
    float band = spec(fract(h * 3.1));
    vec3 cc = palf(fract(h * 4.0 + r * 0.18 + uTime * 0.02));
    col += cc * star * (0.35 + band * 1.4 + uBeat * 0.4);
    col += cc * arm * (0.08 + uLevel * 0.20) * exp(-r * 0.35);
    col += palf(0.90) * exp(-r * 7.0) * (0.6 + uBass * 1.5 + uBeat * 0.8);
    col += palf(0.55) * exp(-abs(r - (0.55 + uBass * 0.10)) * 90.0) * (0.4 + uBeat * 0.8);
  } else if (uMode == 4) {
    /* twelve-fold mandala */
    float seg = TAU / 12.0;
    float fa = mod(a + seg * 0.5, seg) - seg * 0.5;
    vec2 q = vec2(cos(fa) * r, sin(fa) * r);
    float rings = abs(fract(r * 6.0 + 0.04 * sin(fa * 12.0 + uTime) - uTime * 0.08) - 0.5);
    float lines = 1.0 - smoothstep(0.035, 0.075, rings);
    float spokes = 1.0 - smoothstep(0.03, 0.06, abs(fract(fa / seg) - 0.5));
    float cells = pow(0.5 + 0.5 * sin(q.x * 11.0 + uTime * 0.3)
                    * sin(q.y * 11.0 - uTime * 0.2), 6.0);
    float pattern = max(lines, max(spokes * 0.55, cells * 0.5));
    vec3 cc = palf(fract(r * 0.85 + uTime * 0.02));
    col = cc * pattern * (0.45 + uLevel * 0.9 + uBeat * 0.4)
        + palf(0.92) * pow(pattern, 4.0) * 0.55;
  } else if (uMode == 7) {
    /* plasma storm */
    vec2 p = uv * 1.4;
    p += 0.35 * vec2(sin(p.y * 2.1 + uTime * 0.6), cos(p.x * 1.7 - uTime * 0.5));
    float n = fbm2a(p * 1.1 + uTime * 0.06);
    float bands = sin(p.x * 3.2 + p.y * 2.4 + n * 7.0 - uTime * 1.4);
    float fil = pow(0.5 + 0.5 * bands, 7.0);
    float cells = pow(0.5 + 0.5 * sin(n * 22.0 + uTime * 0.4), 6.0);
    vec3 cc = palf(fract(0.1 + n * 1.3 + uTime * 0.02));
    col = cc * fil * (0.8 + uLevel * 1.5 + uBeat * 0.6)
        + palf(0.90) * cells * (0.15 + uHigh * 0.5)
        + palf(0.30) * exp(-r * 0.8) * 0.05;
  } else if (uMode == 12) {
    /* gas-giant orb */
    float r = length(uv);
    float sphere = 1.0 - smoothstep(0.86, 0.90, r);
    vec3 n = vec3(uv, sqrt(max(0.0, 1.0 - r * r)));
    float bands = sin(n.y * 11.0 + sin(n.x * 4.0 + uTime * 0.7) * 2.0 - uTime * 0.9);
    float fil = pow(0.5 + 0.5 * bands, 3.0);
    float noise = fbm2a(vec2(atan2s(n.z, n.x) * 1.8 + uTime * 0.08, n.y * 3.0));
    vec3 cc = palf(fract(0.12 + n.y * 0.35 + noise * 0.45 + uTime * 0.02));
    float rim = exp(-abs(r - 0.88) * 55.0);
    col = cc * sphere * (0.20 + fil * (0.85 + uLevel * 1.2) + uBeat * 0.35)
        + palf(0.90) * rim * (0.5 + uBeat * 0.7)
        + palf(0.55) * exp(-r * 5.0) * (0.10 + uBass * 0.30);
  } else if (uMode == 5) {
    /* scrolling spectrogram matrix */
    vec2 q = uv;
    q.x += q.y * 0.18;                       // waterfall slant
    vec2 g = vec2((q.x * 0.5 + 0.5) * 52.0,
                  (q.y * 0.5 + 0.5) * 26.0 + uTime * 6.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float u = clamp((id.x + 0.5) / 52.0, 0.0, 1.0);
    float age = fract(id.y / 26.0 - uTime * 0.05);
    float e = pow(hist(u, age), 1.55);
    float cell = (1.0 - smoothstep(0.26, 0.46, length(f * vec2(1.0, 0.82))))
               * smoothstep(0.16, 0.46, e);
    float hot = pow(cell, 4.0);
    float recency = 1.0 - age;
    vec3 cc = palf(clamp(u * 0.78 + 0.10 + age * 0.18 + uTime * 0.02, 0.0, 1.0));
    col = cc * cell * (0.16 + e * 1.5 + uBeat * 0.22) * (0.55 + recency * 0.85)
        + palf(0.92) * hot * (0.15 + e * 0.9)
        + palf(0.20) * e * 0.02;
    /* a slow read-head line keeps the matrix moving */
    float scan = 1.0 - smoothstep(0.0, 0.018,
      abs(fract(q.y * 0.5 + 0.5 - uTime * 0.18) - 0.5));
    col += palf(0.85) * scan * (0.08 + uLevel * 0.18);
  } else if (uMode == 21) {
    /* circuit substrate and data pulses */
    vec2 p = uv * 1.25;
    vec2 g = p * 3.0;
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash11(id.x * 17.0 + id.y * 31.0);
    float traceH = (1.0 - smoothstep(0.025, 0.06, abs(f.y))) * step(0.55, h);
    float traceV = (1.0 - smoothstep(0.025, 0.06, abs(f.x)))
                 * step(0.55, hash11(id.y * 13.0 + id.x * 7.0));
    float traces = max(traceH, traceV);
    vec2 id2 = floor(p * 2.2);
    vec2 f2 = fract(p * 2.2) - 0.5;
    float h2 = hash11(id2.x * 19.0 + id2.y * 23.0);
    float chip = (1.0 - smoothstep(0.16, 0.21, max(abs(f2.x), abs(f2.y)))) * step(0.55, h2);
    float pulse = pow(0.5 + 0.5 * sin(p.x * 7.0 + p.y * 5.0 - uTime * 2.4), 12.0);
    vec3 cc = palf(fract(h2 * 2.0 + uTime * 0.02));
    float dieR = max(abs(uv.x), abs(uv.y));
    float dieInner = 1.0 - smoothstep(0.27, 0.30, dieR);
    float dieEdge = 1.0 - smoothstep(0.0, 0.012, abs(dieR - 0.305));
    vec2 dg = abs(fract(uv * 11.0) - 0.5);
    float dieGrid = max(1.0 - smoothstep(0.02, 0.05, dg.x),
                        1.0 - smoothstep(0.02, 0.05, dg.y)) * dieInner;
    col = cc * (traces * 0.14 + chip * (0.45 + spec(fract(h2)) * 1.2 + uBeat * 0.30))
        + palf(0.90) * pulse * traces * (0.08 + uLevel * 0.20)
        + palf(0.60) * (dieInner * 0.10 + dieEdge * (0.70 + uBass * 1.0))
        + palf(0.75) * dieGrid * (0.04 + uLevel * 0.10);
  } else if (uMode == 14) {
    /* tensor lattice in perspective */
    float z = 1.0 / (0.35 + r);
    vec2 g = uv * (6.0 + z * 8.0);
    vec2 gr = abs(fract(g) - 0.5);
    float lines = max(1.0 - smoothstep(0.02, 0.06, gr.x),
                      1.0 - smoothstep(0.02, 0.06, gr.y));
    vec2 id = floor(g);
    float h = hash11(id.x * 31.0 + id.y * 17.0);
    float node = (1.0 - smoothstep(0.0, 0.18, length(fract(g) - 0.5))) * step(0.78, h);
    vec3 cc = palf(fract(h * 1.7 + uTime * 0.02));
    col = cc * (lines * (0.16 + uLevel * 0.45) + node * (0.6 + spec(fract(h)) * 1.2))
        + palf(0.90) * exp(-r * 3.0) * 0.22;
  } else if (uMode == 15) {
    /* prism and spectral fan */
    vec2 p = uv;
    vec2 q = p - vec2(-0.45, 0.0);
    vec2 t = abs(q);
    float tri = max(t.x * 0.866 + q.y * 0.5, -q.y) - 0.42;
    float inside = 1.0 - smoothstep(0.0, 0.012, tri);
    float outline = 1.0 - smoothstep(0.0, 0.014, abs(tri));
    float beamIn = (1.0 - smoothstep(0.02, 0.05, abs(p.y)))
                 * (1.0 - smoothstep(0.0, 0.06, abs(p.x + 0.95)))
                 * step(p.x, -0.50);
    vec2 d = p - vec2(-0.02, 0.0);
    float dist = length(d);
    float ang = atan2s(d.y, d.x);
    vec3 fan = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float ba = -0.52 + fi * 0.145;
      float bw = abs(sin(ang - ba));
      float beam = (1.0 - smoothstep(0.0, 0.035, bw))
                 * smoothstep(0.0, 0.15, dist)
                 * (1.0 - smoothstep(1.25, 2.35, dist))
                 * smoothstep(-0.05, 0.10, d.x);
      fan += palf(fi / 6.0) * beam * (0.6 + spec(fi / 6.0) * 1.2 + uBeat * 0.3);
    }
    col = fan + palf(0.90) * beamIn * (0.8 + uLevel * 0.6)
        + palf(0.85) * inside * 0.10
        + palf(0.75) * outline * (0.7 + uLevel * 0.8);
  } else if (uMode == 17) {
    /* soft bioluminescent bloom field */
    float r = length(uv);
    float phase = uTime * 0.20 + uMid * 0.5;
    vec3 petals = vec3(0.0);
    for (int k = 0; k < 10; k++) {
      float fi = float(k);
      float ang = fi * TAU / 10.0 + phase + 0.15 * sin(r * 3.0 + fi);
      float da = abs(mod(a - ang + PI, TAU) - PI);
      float petal = pow(exp(-pow(da * 2.6, 2.0)), 2.0)
                  * smoothstep(0.05, 0.14, r)
                  * (1.0 - smoothstep(0.58, 1.48, r));
      vec3 pc = palf(fract(fi / 10.0 + 0.10 + uTime * 0.015));
      petals += pc * petal;
    }
    float heart = exp(-r * 6.0) * (0.8 + uBass * 1.2 + uBeat * 0.8);
    vec2 g = floor(uv * 8.0), f = fract(uv * 8.0) - 0.5;
    float h = hash11(g.x * 19.0 + g.y * 23.0);
    float bokeh = (1.0 - smoothstep(0.05, 0.35, length(f))) * step(0.85, h) * (0.4 + uHigh);
    col = petals * (0.30 + uLevel * 0.9)
        + palf(0.90) * heart
        + palf(0.60) * bokeh * 0.4;
  } else if (uMode == 18) {
    /* Julia set bloom */
    vec2 z = uv * 1.02;
    vec2 c = vec2(-0.42 + 0.18 * sin(uTime * 0.08),
                   0.58 + 0.14 * cos(uTime * 0.06));
    float trap = 1e9;
    float it = 0.0;
    for (int i = 0; i < 56; i++) {
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      trap = min(trap, length(z));
      if (dot(z, z) > 16.0) break;
      it += 1.0;
    }
    float glow = pow(clamp(it / 56.0, 0.0, 1.0), 0.72);
    float vein = exp(-trap * 3.5);
    vec3 cc = palf(fract(glow * 1.6 + uTime * 0.015));
    col = cc * (glow * glow * (0.5 + uLevel * 1.2) + vein * (0.3 + uHigh * 0.8))
        + palf(0.90) * pow(vein, 3.0) * 0.5;
  } else if (uMode == 20) {
    /* macro wax field */
    float d = 1e9;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 c = vec2(sin(uTime * 0.21 + fi * 2.1) * 0.65,
                    cos(uTime * 0.17 + fi * 1.7) * 0.55);
      float rr = 0.18 + 0.12 * spec(fract(fi / 7.0 + 0.1)) * uSens
               + 0.04 * sin(uTime * 0.5 + fi);
      float s = length(uv - c) - rr;
      d = (i == 0) ? s : smin(d, s, 0.18);
    }
    float inside = 1.0 - smoothstep(-0.02, 0.01, d);
    float rim = exp(-abs(d) * 18.0);
    float wax = 0.65 + 0.35 * sin(fbm2a(uv * 3.0 + uTime * 0.1) * 10.0);
    vec3 cc = palf(fract(0.12 + r * 0.3 + uTime * 0.02));
    col = cc * inside * wax * (0.7 + uBass * 1.2 + uBeat * 0.5)
        + palf(0.95) * rim * (0.5 + uHigh * 0.8)
        + palf(0.25) * exp(-r * 1.2) * 0.08;
  }

  return col + field * 0.35;
}

/* ---------------- main trace ---------------- */

vec3 trace(vec3 ro, vec3 rd, vec3 field) {
  vec3 noField = vec3(0.0);
  if (isVolumetric(uMode)) return marchVolume(ro, rd, 1e9, field);

  float id, aux;
  float t = march(ro, rd, 40.0, id, aux);
  if (t < 0.0) {
    vec3 bg = envBase(rd) + field;
    if (uMode == 16) {
      // photon ring: glow for rays that pass just outside the horizon
      float b = length(ro - dot(ro, rd) * rd);          // closest approach to the singularity
      float photonGlow = exp(-pow((b - 1.28) * 11.0, 2.0));
      bg += palf(0.75) * photonGlow * (1.35 + uBeat * 0.6);
    }
    return bg;
  }

  vec3 p = ro + rd * t;
  vec3 n = normalAt(p);
  Mat m = matOf(id, aux, p);
  /* the sphere fields are self-lit points: a shadow ray through dozens of
     cells costs more than the rest of their shading and is invisible under
     the emission, so they skip it */
  vec3 col = shade(p, rd, n, m, (uMode == 3 || uMode == 17) ? 0.0 : 1.0);

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
    float fres = 0.04 + 0.96 * pow(max(1.0 - max(dot(n, -rd), 0.0), 0.0), 5.0);
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
    float fres = 0.06 + 0.94 * pow(max(1.0 - max(dot(n, -rd), 0.0), 0.0), 5.0);
    col += rc * mix(m.alb, vec3(1.0), 0.5) * mix(0.35, 1.0, fres) * (1.0 - m.rough * 2.0);
  }

  // distance haze
  col = mix(col, envBase(rd) * 0.9, pow(clamp(t / 42.0, 0.0, 1.0), 1.4) * 0.7);
  // lava lamp: the wax is a volume inside the glass vessel, so it has to be
  // marched separately and composited in front of whatever the SDF hit
  // the wax sits *behind* the near glass wall, so the march limit has to
  // clear the vessel interior — capping at the first hit marched nothing but air
  if (uMode == 20) col += marchVolume(ro, rd, t + 4.8, noField);
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  // Once per pixel, outside the sample loop and all secondary transports.
  vec2 fieldUV = (frag * 2.0 - uRes) / max(uRes.y, 1.0);
  vec3 field = resonanceField(fieldUV);
  vec3 acc = vec3(0.0);
  float seed = hash13(vec3(frag, uSeed));
  for (int s = 0; s < 8; s++) {
    if (s >= uSpp) break;
    float fs = float(s) + seed;
    // stratified AA jitter + lens sample (golden-angle disc)
    vec2 j = vec2(hash11(fs * 12.9), hash11(fs * 78.2 + 3.1)) - 0.5;
    vec2 uv = ((frag + j) * 2.0 - uRes) / uRes.y;
    // drop punch-in: the camera flinches toward the action as the slam lands
    uv *= 1.0 - uDrop * uDrop * 0.07;
    float ga = fs * 2.39996;
    float gr = sqrt(fract(fs * 0.618 + seed));
    vec2 lens = vec2(cos(ga), sin(ga)) * gr;
    vec3 c;
    if (isFieldMode(uMode)) {
      c = fieldScene(uv, field);
    } else {
      vec3 ro, rd;
      camera(uTime, uv, lens, ro, rd);
      c = trace(ro, rd, field);
    }
    // NaN scrub: comparisons against NaN are false, so this catches both NaN
    // and negatives. min(NaN, x) returns x on some drivers, which would paint
    // the clamp ceiling across the frame.
    if (!(c.r >= 0.0)) c.r = 0.0;
    if (!(c.g >= 0.0)) c.g = 0.0;
    if (!(c.b >= 0.0)) c.b = 0.0;
    acc += min(c, vec3(40.0));   // firefly clamp, high enough to keep real glints
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
  // strict neighbourhood clamp — any headroom here compounds through the
  // feedback loop and blows the whole frame out to white within a second
  his = clamp(his, lo, hi);
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
uniform float uDrop;
uniform vec3  uTintLo;   // palette's deepest colour (shadow split-tone)
uniform vec3  uTintHi;   // palette's most vivid bright colour (highlights, bloom)

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
  /* bloom takes on the palette's highlight hue, so glow reads as the
     colourway rather than white haze */
  bl *= mix(vec3(1.0), uTintHi, 0.12);
  col += bl * uBloomAmt * 1.6 * (1.0 + uDrop * 0.9);

  col *= uExposure * (1.0 + pow(clamp(uBeat, 0.0, 1.0), 0.6) * 0.62 + uDrop * 0.4);
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // saturation from the Color Pop control
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 0.85 + uPop * 0.5);
  /* palette split-tone: shadows sink toward the deepest palette colour,
     highlights lean to the brightest, so every mode sits inside one
     cohesive colourway */
  float lg = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 tone = mix(uTintLo * 1.8, uTintHi, smoothstep(0.05, 0.85, lg));
  col = mix(col, col * (0.7 + tone * 0.55) + uTintLo * 0.02 * (1.0 - lg), 0.08);
  col *= 1.0 - dot(d, d) * 0.38;
  // Keep the dark space clean; texture belongs in the lit surfaces.
  float grain = mix(0.004, 0.014, smoothstep(0.02, 0.45, lg));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * grain;
  fragColor = vec4(col, 1.0);
}`;
