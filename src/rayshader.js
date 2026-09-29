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

/* ---------------- scenes ---------------- */

/* 0 bars — spectrum slabs of brushed metal on a mirror floor */
float scBars(vec3 p) {
  float floorD = p.y;
  vec3 q = p;
  float slot = floor(q.x / 0.46 + 13.0);
  slot = clamp(slot, 0.0, 25.0);
  float cx = (slot + 0.5) * 0.46 - 5.98;
  float u = pow(clamp(slot / 26.0, 0.0, 1.0), 0.62);
  float e = pow(spec(u), 1.2) * uSens;
  e = e / (1.0 + 0.55 * e);
  float h = 0.1 + 2.6 * e * (1.0 + uBeat * 0.3 + uDrop * 0.45);
  float depth = 0.1 + hash11(slot + 4.0) * 0.18;
  vec3 b = vec3(0.12, h, depth);
  float d = sdRBox(q - vec3(cx, h, 0.0), b, 0.04);
  float cap = sdRBox(q - vec3(cx, h * 2.0 + 0.03, 0.0), vec3(b.x * 1.05, 0.02, b.z * 1.05), 0.01);
  if (cap < d) { d = cap; g_id = 4.0; g_aux = u; }
  else { g_id = 1.0; g_aux = u; }
  d = max(d, abs(q.x) - 6.1);
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
    float s = abs(q.y - y) - 0.045 - uBeat * 0.02;
    s = max(s, abs(q.z - z) - 0.12);
    s = max(s, abs(q.x) - 6.2);
    if (s < d) { d = s; g_id = 2.0; g_aux = fi / 5.0; }
  }
  float fl = p.y + 2.6 + portrait * 20.0;
  if (fl < d) { d = fl; g_id = 0.0; }
  return d;
}

/* 2 scope — glass Lissajous tube traced from the waveform.
   The tube shears sideways by the instantaneous L−R difference, so stereo
   content visibly tears the ring open along its width while a mono source
   leaves it untouched — the raytraced sibling of the Canvas2D goniometer. */
float scScope(vec3 p) {
  /* trace radius tops out near 3.7 with shear, the housing corner at 3.6 */
  float bound = length(p) - 4.3;
  if (bound > 0.3) { g_id = 26.0; g_aux = 0.22; return bound; }
  float d = 1e9;
  float ring = abs(sdTorus(p.xzy, vec2(2.55 + uBass * 0.07, 0.026))) - 0.004;
  if (ring < d) { d = ring; g_id = 1.0; g_aux = 0.6; }
  float tick = abs(sdTorus(p.xzy, vec2(1.55 + uHigh * 0.06, 0.014))) - 0.003;
  if (tick < d) { d = tick; g_id = 1.0; g_aux = 0.35; }
  /* The trace lives in a thin slab (|z| <= 0.28 + tube radius) inside r 3.8.
     Most march steps are rays heading for the housing; only walk the 40
     segments when the slab could be nearer than what is already found. */
  float slab = max(length(p.xy) - 3.8, abs(p.z) - 0.45);
  if (slab >= d) return d;
  float rad = 0.046 + uBeat * 0.022 + uLevel * 0.016;
  /* The trace is radial — point k sits at angle k/40 of a turn — so only the
     segments around p's own angle can be nearest. Walk a window of 5 rather
     than all 40, and cap the result so a far segment skipped by the window
     can never be stepped through. */
  float ang = atan2s(p.y, p.x);
  int i0 = int(floor(ang / TAU * 40.0 + 40.0)) - 2;
  float cap = d;
  d = min(d, 0.3);
  for (int k = 0; k < 5; k++) {
    int i = i0 + k;
    i = i - (i / 40) * 40;
    vec4 A = uScope[i];
    vec3 sh = vec3(A.w, 0.0, 0.0);
    float s = sdCapsule(p, A.xyz + sh, uScope[i + 1].xyz + sh, rad);
    if (s < d) { d = s; g_id = 20.0; g_aux = fract(float(i) / 40.0 + uTime * 0.05); }
  }
  if (d >= cap) { d = cap; }
  return d;
}

/* 3 particles — emissive sphere field with per-cell audio lift */
float scParticles(vec3 p) {
  /* every sphere is faded to nothing past |id*c| 5.4 and sits within ~1.1 of
     its cell centre: outside that shell, skip the 27-cell search */
  float bound = length(p) - 6.6;
  if (bound > 0.3) { g_id = 4.0; g_aux = 0.0; return bound; }
  vec3 c = vec3(1.9);
  vec3 cell = floor((p + 0.5 * c) / c);
  /* Search the 2x2x2 block on the side p leans toward instead of all 27
     neighbours. A sphere sits within 0.73 of its cell centre with radius at
     most 0.39 (sensitivity maxes at 2.4), so one in a skipped cell is at
     least ~0.78 away; capping the result at 0.75 keeps it a safe bound. */
  vec3 side = sign(p - cell * c);
  side = mix(vec3(1.0), side, abs(side));
  float d = 0.75;
  for (int x = 0; x <= 1; x++)
  for (int y = 0; y <= 1; y++)
  for (int z = 0; z <= 1; z++) {
    vec3 id = cell + vec3(float(x), float(y), float(z)) * side;
    vec3 h = hash33(id);
    float band = spec(h.x);
    vec3 off = (h - 0.5) * 0.75;
    off.y += sin(uTime * (0.4 + h.y * 0.8) + h.z * TAU) * 0.35;
    vec3 q = p - (id * c + off);
    // shrink toward the edge of the cloud: an unbounded field fills the
    // frame with speckle and reads as noise
    float fade = smoothstep(5.4, 1.6, length(id * c));
    /* Broader, brighter particles read as intentional drifting embers instead
       of sensor noise. The outer falloff still protects the starfield edge. */
    float r = (0.075 + 0.20 * band * uSens + uBeat * 0.055 * h.z) * fade;
    float s = sdSphere(q, max(r, 0.001));
    if (s < d) { d = s; g_id = 4.0; g_aux = fract(h.z * 3.7); }
  }
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
    float e = spec(0.08 + fi * 0.21) * uSens;
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
  /* Tie the separate optical shards into one complete mirrored instrument.
     The shallow face stays behind each raised facet, so it reads as a
     continuous kaleidoscope tile instead of floating mechanical pieces. */
  float plate = sdCyl(p.xzy, 0.055, 1.94);
  if (plate < d) { d = plate; g_id = 11.0; g_aux = 0.52; }
  float core = sdEllipsoid(p, vec3(0.34 + uBeat * 0.08, 0.34 + uBass * 0.06, 0.20));
  if (core < d) { d = core; g_id = 11.0; g_aux = 0.94; }
  return d;
}

/* 5 spectro — a true time/frequency waterfall made from discrete luminous bins */
float scSpectro(vec3 p) {
  vec2 grid = p.xz + vec2(5.0, 4.8);
  vec2 cell = floor(grid / vec2(0.205, 0.4));
  vec2 local = mod(grid, vec2(0.205, 0.4)) - vec2(0.1025, 0.2);
  float u = pow(clamp((cell.x + 0.5) / 48.0, 0.0, 1.0), 0.62);
  float age = clamp((cell.y + 0.5) / 24.0, 0.0, 1.0);
  float e = hist(u, age);
  float e2 = pow(e, 1.2) * uSens;
  float h = 0.12 + 2.8 * e2 / (1.0 + 0.5 * e2);
  h = floor(h * 22.0) / 22.0;
  float bin = sdBox(vec3(local.x, p.y - h * 0.5, local.y), vec3(0.074, h * 0.5, 0.15));
  float bounds = max(abs(p.x) - 5.0, abs(p.z) - 4.8);
  float d = max(bin, bounds);
  g_id = 5.0; g_aux = e;
  return d;
}

/* 6 tunnel — ribbed hyperspace bore */
float scTunnel(vec3 p) {
  float z = p.z + uTime * 3.2;
  float cell = floor(z / 1.1);
  float lz = mod(z, 1.1) - 0.55;
  float band = spec(fract(cell * 0.083));
  float r = 2.3 - band * 0.7 * uSens - uBeat * 0.12 - uDrop * 0.2;
  float wob = sin(atan2s(p.y, p.x) * 6.0 + cell * 0.7 + uTime) * 0.09 * (0.3 + uMid);
  float ring = length(vec2(length(p.xy) - r + wob, lz)) - (0.03 + band * 0.05);
  float d = ring;
  g_id = 4.0; g_aux = fract(cell * 0.083);
  float wall = -(length(p.xy) - (r + 0.85));
  if (wall < d) { d = wall; g_id = 6.0; g_aux = 0.2; }
  float sector = floor(atan2s(p.y, p.x) / (TAU / 4.0) + 0.5) * (TAU / 4.0);
  vec2 railC = vec2(cos(sector), sin(sector)) * (r - 0.45);
  float rail = length(p.xy - railC) - 0.018;
  if (rail < d) { d = rail; g_id = 4.0; g_aux = 0.85; }
  return d;
}

/* 7 plasma — a magnetic bottle holding a bright, bass-driven plasma torus */
float scPlasma(vec3 p) {
  float d = 1e9;
  float energy = spec(0.14) * uSens;
  /* Face the plasma ring toward the camera; a horizontal torus read as a
     featureless pink saucer from the previous rig. */
  float torus = sdTorus(p.xzy, vec2(1.18 + uBass * 0.10, 0.34 + energy * 0.10 + uBeat * 0.04));
  if (torus < d) { d = torus; g_id = 4.0; g_aux = 0.35 + uMid * 0.3; }
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float e = spec(0.08 + fi * 0.18) * uSens;
    vec3 q = p;
    q.xy *= rot(uTime * (0.16 + fi * 0.035) + fi * 1.26);
    q.yz *= rot(0.62 + sin(uTime * 0.22 + fi) * 0.08);
    float coil = abs(sdTorus(q, vec2(1.2 + e * 0.08, 0.026 + e * 0.025 + uBeat * 0.01))) - 0.006;
    if (coil < d) { d = coil; g_id = 1.0; g_aux = (fi + 0.5) / 5.0; }
  }
  float cage = abs(sdTorus(p - vec3(0.0, 0.0, 0.0), vec2(2.55, 0.018))) - 0.004;
  if (cage < d) { d = cage; g_id = 6.0; g_aux = 0.2; }
  float core = sdSphere(p, 0.22 + uBass * 0.18 + uBeat * 0.09);
  if (core < d) { d = core; g_id = 4.0; g_aux = 0.94; }
  return d;
}

/* 8 terrain — scrolling ridge heightfield */
float scTerrain(vec3 p) {
  float u = clamp((p.x + 9.0) / 18.0, 0.0, 1.0);
  float age = clamp((p.z + 2.0) / 16.0, 0.0, 1.0);
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
  vec2 cell = floor(p.xz / 2.2);
  vec2 lp = mod(p.xz, 2.2) - 1.1;
  float h = hash11(dot(cell, vec2(17.3, 41.7)));
  float e = spec(fract(h * 3.7));
  float bh = 0.4 + h * 3.2 + e * 2.2 * uSens + uBeat * 0.2 * h;
  float bw = 0.32 + h * 0.28;
  float d = sdBox(vec3(lp.x, p.y - bh * 0.5, lp.y), vec3(bw, bh * 0.5, bw));
  g_id = 8.0; g_aux = e;
  float crown = sdBox(vec3(lp.x, p.y - bh - 0.12, lp.y), vec3(bw * 0.45, 0.14, bw * 0.45));
  if (crown < d) { d = crown; g_id = 4.0; g_aux = e; }
  if (fl < d) { d = fl; g_id = 9.0; }
  return d;
}

/* 12 orb — displaced glass shell with a molten core */
float scOrb(vec3 p) {
  float r = length(p);
  vec3 n = p / max(r, 1e-4);
  float band = spec(fract(atan2s(n.z, n.x) / TAU + 0.5) * 0.7 + 0.05);
  float disp = band * 0.22 * uSens
    + 0.06 * sin(n.y * 7.0 + uTime * 1.6) * sin(atan2s(n.z, n.x) * 5.0)
    + uHigh * 0.07 * sin(n.x * 13.0 + uTime * 2.0);
  float shell = abs(r - (1.15 + disp + uBeat * 0.09)) - 0.035;   // hollow glass
  float core = r - (0.5 + uBass * 0.16 + uBeat * 0.08);
  float d = shell;
  g_id = 3.0; g_aux = band;
  if (core < d) { d = core; g_id = 18.0; g_aux = clamp(band, 0.0, 1.0); }
  float ring = abs(sdTorus(p, vec2(1.75 + uBeat * 0.45, 0.012))) - 0.004;
  if (ring < d) { d = ring; g_id = 4.0; g_aux = 0.5; }
  /* phosphor arena floor below the orb — reusing the radar deck material
     means the wedge sweep now plays underneath the pulse, tying the room
     together; the accent light sells the orb's glow onto it */
  float arena = sdCyl(p - vec3(0.0, -1.88, 0.0), 0.06, 4.0);
  if (arena < d) { d = arena; g_id = 15.0; g_aux = 0.0; }
  return d;
}

/* 13 fluid — a continuous, audio-warped mercury ribbon */
float scFluid(vec3 p) {
  float a = atan2s(p.z, p.x);
  float r = length(p.xz);
  float band = spec(fract(a / TAU + 0.5));
  float pulse = 0.16 * sin(a * 3.0 - uTime * 0.7 + uMid * 2.0)
              + 0.08 * sin(a * 5.0 + uTime * 0.45 + uHigh * 2.5);
  float major = 1.42 + pulse + band * 0.15 * uSens;
  float centreY = 0.28 * sin(a * 2.0 + uTime * 0.42) + 0.12 * sin(a * 4.0 - uTime * 0.3);
  float minor = 0.17 + band * 0.10 * uSens + uBeat * 0.045 + uBass * 0.035;
  float ribbon = length(vec2(r - major, p.y - centreY)) - minor;
  g_id = 10.0; g_aux = band;
  float innerLoop = abs(sdTorus(p.yxz, vec2(0.92 + uMid * 0.08, 0.024 + uHigh * 0.018))) - 0.008;
  if (innerLoop < ribbon) { ribbon = innerLoop; g_id = 4.0; g_aux = fract(a / TAU + 0.72); }
  float d = ribbon;
  float fl = p.y + 1.5;                                // chrome needs something to mirror
  if (fl < d) { d = fl; g_id = 0.0; }
  float ring = abs(sdTorus(p, vec2(2.05, 0.014))) - 0.004;
  if (ring < d) { d = ring; g_id = 4.0; g_aux = 0.4; }
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
  float rx = length(lp.yz) - (0.012 + uBass * 0.026);
  float ry = length(lp.xz) - (0.012 + uMid * 0.022);
  float rz = length(lp.xy) - (0.012 + uHigh * 0.018);
  float d = min(rx, min(ry, rz));
  g_id = 6.0; g_aux = 0.3;
  float node = sdSphere(lp, 0.03 + e * 0.06 * uSens + uBeat * 0.018);
  if (node < d) { d = node; g_id = 4.0; g_aux = e; }
  d = max(d, length(p) - 3.4);          // lattice reads as a core, not a wall
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

  for (int i = 0; i < 11; i++) {
    float t = (float(i) - 5.0) / 5.0;
    float e = spec(abs(t));
    vec3 tip = vec3(4.2, t * (2.18 + uHigh * 0.72 + uBeat * 0.38), t * 0.58);
    vec3 start = vec3(1.58, t * 0.13, 0.0);
    float ray = sdCapsule(v, start, tip, 0.055 + e * 0.035);
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
  vec3 q = p;
  q.xz *= rot(uTime * 0.35);
  float radius = length(q.xz);
  float az = atan2s(q.z, q.x);
  float inner = horizon + 0.16;
  float outer = 2.50 + uBeat * 0.12;
  float warp = 0.036 * sin(az * 2.0 - uTime * 0.55) + 0.014 * sin(az * 5.0 + uTime * 0.8);
  float disc = max(abs(q.y - warp) - (0.036 + uBass * 0.02), max(inner - radius, radius - outer));
  if (disc < d) { d = disc; g_id = 19.0; g_aux = clamp((radius - inner) / (outer - inner), 0.0, 1.0); }
  float jet = sdCapsule(p, vec3(0.0, 1.24, 0.0), vec3(0.0, 2.25 + uDrop * 0.18, 0.0), 0.025 + uBeat * 0.009);
  float lowerJet = sdCapsule(p, vec3(0.0, -1.24, 0.0), vec3(0.0, -2.25 - uDrop * 0.18, 0.0), 0.025 + uBeat * 0.009);
  if (min(jet, lowerJet) < d) { d = min(jet, lowerJet); g_id = 2.0; g_aux = 0.72; }
  return d;
}

/* 17 bloomfield — a small garden of audio-lit flowers and metal stems */
float scBloom(vec3 p) {
  float bound = length(p - vec3(0.0, 0.0, -2.4)) - 5.5;
  if (bound > 0.3) { g_id = 4.0; g_aux = 0.0; return bound; }
  float d = 1e9;
  float spread = clamp((uRes.x / max(uRes.y, 1.0)) / 1.5, 0.48, 1.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float size = i == 1 ? 1.38 : 0.96;
    vec3 head = vec3((fi - 1.0) * 1.72 * spread, 0.48 + 0.14 * sin(fi * 2.1), -1.4 - fi * 0.52);
    float stem = sdCapsule(p, head - vec3(0.0, 0.06, 0.0), vec3(head.x, -1.8, head.z), 0.024 * size);
    if (stem < d) { d = stem; g_id = 6.0; g_aux = 0.62 + fi * 0.1; }
    for (int side = 0; side < 2; side++) {
      float signSide = side == 0 ? -1.0 : 1.0;
      vec3 leaf = vec3(head.x, -0.8 - float(side) * 0.42, head.z);
      vec3 tip = leaf + vec3(signSide * 0.34 * size, 0.14, 0.0);
      float leafD = sdCapsule(p, leaf, tip, 0.045 * size);
      if (leafD < d) { d = leafD; g_id = 6.0; g_aux = 0.38 + float(side) * 0.2; }
    }
    float localBound = length(p - head) - 1.55 * size;
    if (localBound < d) {
      vec3 flower = p - head;
      float phase = uTime * (0.38 + fi * 0.08 + uMid * 0.12) + fi * 2.0;
      float bloom = spec(0.2 + fi * 0.25) * uSens;
      for (int k = 0; k < 5; k++) {
        float angle = float(k) * TAU / 5.0 + phase;
        vec3 petal = flower;
        petal.xy *= rot(-angle);
        petal -= vec3(0.39 * size + bloom * 0.12 + uBeat * 0.05, 0.0, 0.0);
        petal.yz *= rot(0.18 + uHigh * 0.24);
        float petalD = sdEllipsoid(petal, vec3(0.40 * size + bloom * 0.11, 0.25 * size, 0.13 * size));
        if (petalD < d) { d = petalD; g_id = 4.0; g_aux = fract(float(k) / 5.0 + fi * 0.28 + 0.1); }
      }
      float heart = sdSphere(flower, 0.17 * size + uBeat * 0.04 + bloom * 0.04);
      if (heart < d) { d = heart; g_id = 4.0; g_aux = 0.94; }
    }
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
  float power = 7.3 + uBass * 3.5 + uMid * 1.2 + uDrop * 2.0 + sin(uTime * 0.2) * 1.5;
  for (int i = 0; i < 11; i++) {
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
  return 0.5 * log(max(r, 1e-4)) * r / dr / 0.95;
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
  float bezel = abs(sdTorus(p - vec3(0.0, 0.045, 0.0), vec2(2.13, 0.055))) - 0.012;
  if (bezel < d) { d = bezel; g_id = 6.0; g_aux = 0.18; }
  float innerBezel = abs(sdTorus(p - vec3(0.0, 0.081, 0.0), vec2(1.99, 0.018))) - 0.006;
  if (innerBezel < d) { d = innerBezel; g_id = 4.0; g_aux = 0.9; }
  /* Keep the origin landmark low so the radar remains a readable flat
     instrument rather than growing back into a mast or antenna. */
  float hub = sdCyl(p - vec3(0.0, 0.11 + uBass * 0.05, 0.0), 0.09, 0.12 + uBeat * 0.025);
  if (hub < d) { d = hub; g_id = 6.0; g_aux = 0.68; }
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
    float ht = 0.025 + e * 0.035 + fresh * 0.025;
    float ax = cos(a) * rr;
    float az = sin(a) * rr;
    vec3 c = vec3(ax, 0.085 + ht * 0.5, az);
    float s = sdSphere(p - c, 0.035 + e * 0.025 + fresh * 0.028 + uBeat * 0.012);
    if (s < d) { d = s; g_id = 4.0; g_aux = band; }
  }
  return d;
}

/* 21 gpu — voxel compute stack with a corner-pylon chassis and a lone
   orbiting data node; voxels swell with their own band under a hard cap.
   The band tap lives outside the field so the march loop never pays for it
   (see scRadar). */
float scGpu(vec3 p) {
  float ne = spec(0.43);
  vec3 q = p;
  q.xz *= rot(uTime * 0.35);
  vec3 cell = clamp(floor(q / 0.62 + 2.0), vec3(0.0), vec3(3.0));
  vec3 lp = q - (cell - 2.0 + 0.5) * 0.62;
  float e = spec(fract(dot(cell, vec3(0.11, 0.29, 0.07))));
  /* quiet cells stay small so the stack reads as a lattice, not one red mass */
  float halfExtent = 0.07 + e * 0.11 + min(uBeat, 0.5) * 0.02;
  float d = sdRBox(lp, vec3(halfExtent), 0.03);
  d = max(d, sdBox(q, vec3(1.68)));
  g_id = 16.0; g_aux = e;
  /* four corner pylons anchor the slab so it reads as hardware. These are
     explicit capsules rather than a modulo trick: the wrapped-corner field
     had gradient seams that made sphere tracing crawl (measured 29ms vs
     8ms for this scene). A 4-iteration constant loop keeps it honest. */
  float py = 1e9;
  for (int i = 0; i < 4; i++) {
    float sx = i < 2 ? -0.95 : 0.95;
    float sz = i == 0 || i == 3 ? -0.95 : 0.95;
    py = min(py, sdCapsule(q, vec3(sx, -1.05, sz), vec3(sx, 1.05, sz), 0.02));
  }
  if (py < d) { d = py; g_id = 6.0; g_aux = 0.55; }
  /* the bus rides inside the spinning frame now, reading as rigid wiring to
     the core instead of a separate object intersecting it */
  float wire = sdCapsule(q, vec3(0.0, -1.95, 0.0), vec3(0.0, 1.95, 0.0), 0.02);
  if (wire < d) { d = wire; g_id = 4.0; g_aux = 0.78; }
  /* Eight explicit struts make an open compute chassis. A thin box shell
     looked like a solid plate from the moving camera. */
  float frame = 1e9;
  for (int i = 0; i < 4; i++) {
    float xSide = i < 2 ? -1.56 : 1.56;
    float ySide = (i == 0 || i == 2) ? -1.56 : 1.56;
    float zSide = (i == 0 || i == 1) ? -1.56 : 1.56;
    float xRail = sdBox(q - vec3(0.0, ySide, zSide), vec3(1.56, 0.024, 0.024));
    float zRail = sdBox(q - vec3(xSide, ySide, 0.0), vec3(0.024, 0.024, 1.56));
    frame = min(frame, min(xRail, zRail));
  }
  if (frame < d) { d = frame; g_id = 6.0; g_aux = 0.72; }
  float halo = abs(sdTorus(q.xzy, vec2(0.82 + uBass * 0.12, 0.025))) - 0.006;
  if (halo < d) { d = halo; g_id = 4.0; g_aux = 0.95; }
  float core = sdSphere(q, 0.32 + uBass * 0.18 + uBeat * 0.08);
  if (core < d) { d = core; g_id = 18.0; g_aux = 0.5 + uLevel * 0.3; }
  /* one data node orbits in WORLD space (raw p, not the spinning frame)
     so it sweeps past the stack edges instead of riding along with it */
  float na = uTime * 0.55;
  float nd = sdSphere(p - vec3(cos(na) * 1.82, sin(na * 0.73) * 0.55, sin(na) * 1.82),
                      0.045 + ne * 0.05 * uSens);
  if (nd < d) { d = nd; g_id = 4.0; g_aux = 0.66; }
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
  float pivot = sdCapsule(p, vec3(2.9, 0.56, 2.9), vec3(2.9, 0.56, 2.9), 0.16);
  if (pivot < disc) { disc = pivot; g_id = 25.0; g_aux = 0.4; }
  return disc;
}

/* 20 lava — the vessel; the wax itself is volumetric */
float scLavaGlass(vec3 p) {
  float wall = abs(sdCyl(p, 2.1, 1.16)) - 0.03;
  g_id = 3.0; g_aux = 0.3;
  float cap = sdCyl(p - vec3(0.0, 2.15, 0.0), 0.12, 0.75);
  float base = sdCyl(p + vec3(0.0, 2.2, 0.0), 0.16, 0.9);
  float metal = min(cap, base);
  float d = wall;
  if (metal < d) { d = metal; g_id = 6.0; g_aux = 0.25; }
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
  if (uMode == 20) return scLavaGlass(p);
  if (uMode == 21) return scGpu(p);
  if (uMode == 22) return scVinyl(p);
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
    m.emis = c * (1.0 + uLevel * 1.7 + uBeat * 0.5);
  } else if (id < 3.5) {                // glass
    m.alb = vec3(0.92); m.rough = 0.06; m.metal = 0.0; m.trans = 1.0;
    m.emis = c * (0.06 + uLevel * 0.16);
  } else if (id < 4.5) {                // pure emissive
    m.alb = c * 0.1; m.rough = 0.3; m.metal = 0.0;
    m.emis = c * (1.1 + 2.2 * spec(aux) + uBeat * 1.1);
  } else if (id < 5.5) {                // spectrogram terrace
    vec3 cc = palf(pow(clamp(aux, 0.0, 1.0), 0.55));
    m.alb = cc * 0.5; m.rough = 0.5; m.metal = 0.15;
    /* the newest edge answers treble: a hat lands and the waterfall's front
       lip lights up even where that bin's column isn't tall yet */
    float age = clamp((p.z + 5.0) / 10.0, 0.0, 1.0);
    /* the terrace answers the kick and the drop, not just the waterfall:
       beat lifts the whole relief, the drop surges it harder */
    m.emis = cc * (0.18 + pow(aux, 2.1) * 1.15) * (1.0 + uBeat * 0.35 + uDrop * 0.5)
           + palf(0.82) * pow(1.0 - age, 5.0) * uHigh * 0.55;
  } else if (id < 6.5) {                // structural strut / bezel
    m.alb = palf(0.3) * 0.25; m.rough = 0.3; m.metal = 0.8;
    m.emis = palf(0.25) * (0.12 + uLevel * 0.25);
  } else if (id < 7.5) {                // terrain rock
    float crest = pow(clamp(aux, 0.0, 1.0), 3.0);
    m.alb = mix(vec3(0.025, 0.023, 0.021), palf(aux) * 0.3, aux);
    m.rough = 0.62; m.metal = 0.18;
    /* snow-line glow on the crests plus a cool wash in the troughs. The ridge
       used to freeze on hits — every other mode pulsed while the mountains
       sat still — so the crest line now lifts with the beat and shimmers
       with treble. */
    m.emis = (palf(aux) * crest * 1.15 + palf(0.9) * pow(1.0 - aux, 4.0) * 0.06)
           * (1.0 + uBeat * 0.45 + uHigh * crest * 0.35);
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
    m.emis = palf(aux) * win * (0.5 + aux * 0.9 + uBeat * 0.35 + uDrop * 0.4);
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
    vec3 cc = palf(fract(aux * 3.2 + 0.15 * sin(p.y * 2.0) + uTime * 0.03));
    m.alb = cc * (0.35 + 0.5 * (1.0 - aux));
    m.rough = 0.22 + aux * 0.2; m.metal = 0.8;
    m.emis = cc * (0.15 + pow(1.0 - aux, 2.0) * 0.9 + uBeat * 0.35 + uDrop * 0.4);
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
    vec3 cc = palf(0.25 + aux * 0.5);
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
    float grooves = 0.5 + 0.5 * sin(r * 64.0);
    float band = spec(pow(rr, 0.92));
    float ang = atan2s(p.z, p.x);
    float sweep = smoothstep(-0.55, 0.55, sin(ang - uTime * (1.2 + uLevel * 1.6) + uBeat * 0.3));
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
    /* plasma's cell carries vertical strip lights so the enclosure reads as
       a room with practicals rather than a painted backdrop */
    if (uMode == 7 && length(p.xz) > 3.2) {
      float strip = smoothstep(0.955, 0.99, sin(atan2s(p.z, p.x) * 6.0))
                  * clamp(p.y * 0.22 + 0.55, 0.0, 1.0);
      m.emis += palf(0.62) * strip * (0.30 + uBeat * 0.55);
    }
  } else if (id < 27.5) {               // wet gloss floor
    /* water under kaleido / prism fan. Same trade as above: the look is the
       smear of bloom reflecting off a dark sheen, which shading alone gives,
       not a traced mirror — a true mirror floor doubled every scene that
       grew one (kaleido went ~2.5x with a full-id mirror). */
    m.alb = vec3(0.010); m.rough = 0.37; m.metal = 0.90;
    m.emis = palf(0.60) * 0.010 * (0.35 + uLevel);
  } else {                              // accretion disc
    vec3 cc = mix(vec3(1.0, 0.93, 0.85), palf(0.85), clamp(aux * 1.4, 0.0, 1.0));
    m.alb = vec3(0.0); m.rough = 1.0;
    m.emis = cc * (3.2 * pow(1.0 - aux, 2.6) + 0.2 + uBeat * 0.5);
  }
  // per-mode emissive gain: dense scenes (particle/voxel fields) would
  // otherwise bloom into a flat white sheet
  float gain = 1.0;
  if (uMode == 3)  gain = 0.45;   // particles
  if (uMode == 5)  gain = 0.55;   // spectro terrace
  if (uMode == 6)  gain = 0.55;   // tunnel
   if (uMode == 14) gain = 0.62;   // tensor — band-coupled rods earn more light
  if (uMode == 17) gain = 0.35;   // bloom field
  if (uMode == 9)  gain = 0.70;   // city
  if (uMode == 15) gain = 1.4;    // prism
  if (uMode == 2)  gain = 2.6;    // scope
  if (uMode == 12) gain = 1.2;    // orb
  if (uMode == 16) gain = 1.3;    // void
  if (uMode == 21) gain = 0.8;    // gpu
  if (uMode == 22) gain = 2.4;    // vinyl — dark deck, the groove burn carries it
  if (uMode == 13) gain = 2.1;    // fluid — chrome in a dark room needs the lift
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
  float s = smoothstep(0.16, 0.0, length(f)) * step(0.9885, h);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 6.0) + h * 40.0);
  return mix(vec3(1.0), palf(fract(h * 7.0)), 0.45) * s * tw * 1.6;
}

vec3 envBase(vec3 rd) {
  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.004, 0.0038, 0.0035), palf(0.15) * 0.035, pow(up, 2.0));
  sky += palf(0.75) * 0.012 * pow(clamp(-rd.y * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 key = normalize(vec3(0.55, 0.75, -0.4));
  sky += palf(0.5) * pow(clamp(dot(rd, key), 0.0, 1.0), 96.0) * (1.1 + uLevel * 0.9);
  vec3 rim = normalize(vec3(-0.7, 0.2, 0.5));
  sky += palf(0.9) * pow(clamp(dot(rd, rim), 0.0, 1.0), 48.0) * 0.25;
  if (uMode == 10 || uMode == 11 || uMode == 16 || uMode == 17 || uMode == 3) sky += starField(rd);
  if (uMode == 8) {
    // dusk wash + aurora ribbon over the ridges
    sky += palf(0.2) * 0.05 * pow(clamp(rd.y * 1.6 + 0.2, 0.0, 1.0), 1.5);
    float band = exp(-pow((rd.y - 0.26) * 6.0, 2.0));
    float ripple = 0.45 + 0.55 * sin(rd.x * 7.0 + uTime * 0.5) * sin(rd.x * 3.0 - uTime * 0.3);
    sky += palf(0.7) * band * ripple * (0.3 + uLevel * 0.55);
    sky += starField(rd) * 0.5;
  }
  if (uMode == 1) {
    // low sun on a sea horizon: the ribbons used to play to an empty void
    vec3 sun = normalize(vec3(0.42, 0.10, -0.90));
    sky += palf(0.88) * pow(clamp(dot(rd, sun), 0.0, 1.0), 260.0) * (2.4 + uBeat * 1.4);
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
  float wrap = clamp(dot(n, key) * 0.65 + 0.35, 0.18, 1.0);
  vec3 hot = mix(m.emis, vec3(dot(m.emis, vec3(0.2126, 0.7152, 0.0722))) * 1.35, 0.28);
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
    float radius = length(q.xz);
    float angle = atan2s(q.z, q.x);
    float arms = 0.5 + 0.5 * cos(angle * 3.0 - radius * 1.55 + uTime * 0.16);
    float filaments = pow(max(0.0, cos(angle * 7.0 - radius * 2.7 + f * 3.2 + uTime * 0.12)), 9.0);
    float d = disc * f * (0.20 + arms * 0.58) + disc * filaments * (0.18 + f * 0.34);
    d += 0.32 * exp(-length(q) * 1.1) * (1.0 + uBass + uDrop * 0.55);   // hot core
    d *= smoothstep(6.4, 1.4, length(q));                // a wider cloud, not a ball
    d *= mix(0.58, 1.0, smoothstep(0.5, 1.8, radius));  // open a soft cavity around the starbirth core
    /* mids thicken the wisps, highs burn off the outer veil, so the cloud
       answers the whole mix instead of only the kick; the drop slams it all */
    return max(0.0, d - 0.07) * (2.4 + uLevel * 2.0 + uMid * 0.8 - uHigh * 0.35 + uDrop * 0.7);
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
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ph = uTime * (0.25 + fi * 0.07) + fi * 2.1;
    vec3 c = vec3(sin(ph * 0.7) * 0.42, sin(ph) * 1.45, cos(ph * 0.6) * 0.42);
    float rr = 0.46 + spec(fi / 5.0) * 0.3 * uSens + uBass * 0.14 + uDrop * 0.1;
    float s = length(q - c) - rr;
    d = (i == 0) ? s : smin(d, s, 0.3);
  }
  float cyl = sdCyl(q, 2.1, 1.15);
  return max(0.0, -d * 1.1) * step(cyl, 0.0) * (0.9 + uBass * 0.7 + uDrop * 0.5);
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
  float paleMix = (uMode == 20) ? 0.24 : 0.55;
  c = mix(c, palf(0.78), smoothstep(0.35, 0.9, t) * paleMix);
  float whiteCore = (uMode == 20) ? 0.025 : 0.25;
  c = mix(c, vec3(1.0, 0.95, 0.9), pow(t, 4.0) * whiteCore);   // keep hue in the dense core
  /* the lamp wax sits behind glass and loses half its light to the wall
     march — it measured a third of the nebula's brightness. Base it hotter
     so the lamp actually glows between beats. */
  float base = (uMode == 20) ? 0.46 : 0.6;
  if (uMode == 20) {
    float heat = smoothstep(-1.8, 1.8, p.y + 0.35 * sin(uTime * 0.35 + p.x * 2.0));
    vec3 wax = mix(palf(0.10), palf(0.62), heat);
    c = mix(c, wax, 0.82);
  }
  return c * (base + uBeat * 0.5 + uDrop * 0.3);
}

/* Volume march with an optional far limit, so a surface can occlude it. */
vec3 marchVolume(vec3 ro, vec3 rd, float tmax) {
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float t = 0.4;
  int steps = min(uSteps / 3, 72);
  float stepSize = 0.16;
  /* the wax is enclosed in glass and read as murk against the bright
     vessel highlights — the lamp gets a gain the open volumes don't need */
  float gain = (uMode == 20) ? 0.88 : 1.0;
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
  if (tmax > 13.0) acc += envBase(rd) * trans;   // only the open sky adds background
  return acc;
}

bool isVolumetric(int m) { return m == 10 || m == 11; }

/* ---------------- camera ---------------- */

void camera(float t, vec2 uv, vec2 dofJitter, out vec3 ro, out vec3 rd) {
  t *= 1.45 + uLevel * 1.05;
  vec3 ta = vec3(0.0);
  float fov = 1.5;
  float ap = 0.012;
  float sway = sin(t * 0.21) * 0.22;
  if (uMode == 0)       { ro = vec3(sway * 2.0, 2.4 + uBeat * 0.1, 8.4); ta = vec3(0.0, 1.3, 0.0); ap = 0.035; }
  else if (uMode == 1)  { ro = vec3(sway * 1.4, 1.1, 6.6); ta = vec3(0.0, 0.0, -1.2); ap = 0.03; }
  else if (uMode == 2)  { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(0.0, 0.0, 5.2 + sin(t * 0.3) * 0.3); ta = vec3(0.0); ap = 0.02; fov = min(1.65, 1.6 * aspect); }
  else if (uMode == 3)  { ro = vec3(sin(t * 0.13) * 1.6, cos(t * 0.11) * 0.9, 4.25); ap = 0.022; }
  else if (uMode == 4)  { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(0.0, 0.0, 3.9); ap = 0.008; fov = 1.35 * min(1.0, aspect); }
  else if (uMode == 5)  { ro = vec3(0.0, 3.35, 6.5); ta = vec3(0.0, 0.35, -0.6); ap = 0.022; }
  else if (uMode == 6)  { ro = vec3(sin(t * 0.4) * 0.3, cos(t * 0.33) * 0.3, 4.0); ta = ro + vec3(0.0, 0.0, -1.0); ap = 0.02; }
  else if (uMode == 7)  { ro = vec3(sway, 0.75, 4.05); ap = 0.018; fov = 1.28; }
  else if (uMode == 8)  { ro = vec3(sway * 1.6, 3.2, 9.0); ta = vec3(0.0, 0.35, -3.5); ap = 0.008; }
  else if (uMode == 9)  { ro = vec3(sin(t * 0.09) * 7.0, 3.0 + sin(t * 0.14), cos(t * 0.09) * 7.0); ta = vec3(0.0, 1.8, 0.0); ap = 0.04; }
  else if (uMode == 10) { ro = vec3(sin(t * 0.08) * 5.4, 1.6, cos(t * 0.08) * 5.4); ap = 0.0; }
  else if (uMode == 11) { ro = vec3(sin(t * 0.06) * 2.8, 4.4 + sin(t * 0.1) * 0.7, cos(t * 0.06) * 2.8); ta = vec3(0.0); ap = 0.0; }
  else if (uMode == 12) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.17) * 3.6, 0.8, cos(t * 0.17) * 3.6); ap = 0.03; fov = min(1.5, 1.65 * aspect); }
  else if (uMode == 13) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.15) * 4.2, 1.3, cos(t * 0.15) * 4.2); ap = 0.035; fov = min(1.5, 1.7 * aspect); }
  else if (uMode == 14) { ro = vec3(sin(t * 0.1) * 3.2, 1.6 + sin(t * 0.07), cos(t * 0.1) * 3.2); ap = 0.04; }
  /* a gentle orbit rather than the locked frontal shot: the slab itself
     rotates, so any camera drift now produces real parallax between beam,
     prism and fan instead of one flat diagram */
  else if (uMode == 15) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.12) * 0.3, 0.2, 4.5 + cos(t * 0.12) * 0.1); ap = 0.004; fov = min(1.5, 1.7 * max(aspect, 0.3)); }
  else if (uMode == 16) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.08) * 3.7, 0.48, cos(t * 0.08) * 3.7); ap = 0.004; fov = 1.35 * min(1.0, aspect); }
  else if (uMode == 17) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.07) * 0.6, 0.14 + cos(t * 0.06) * 0.28, 2.25); ta = vec3(0.0, 0.0, -1.9); ap = 0.02; fov = min(1.8, 1.9 * aspect); }
  else if (uMode == 18) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.12) * 2.4, sin(t * 0.09) * 0.55, cos(t * 0.12) * 2.4); ap = 0.015; fov = min(1.45, 1.5 * aspect); }
  else if (uMode == 19) { float aspect = uRes.x / max(uRes.y, 1.0); ro = vec3(sin(t * 0.045) * 0.04, 3.55, cos(t * 0.045) * 0.04); ta = vec3(0.0); ap = 0.0; fov = 1.32 * min(1.0, aspect); }
  else if (uMode == 20) { ro = vec3(0.0, 0.0, 4.65); ap = 0.0; }
  else if (uMode == 21) { ro = vec3(sin(t * 0.12) * 2.9, 1.95, cos(t * 0.12) * 2.9); ta = vec3(0.0, -0.1, 0.0); ap = 0.015; }
  else if (uMode == 22) { ro = vec3(0.0, 3.3 + sin(t * 0.2) * 0.12, 2.9); ta = vec3(0.0, -0.05, 0.0); ap = 0.028; }
  else                  { ro = vec3(sin(t * 0.12) * 4.0, 2.0, cos(t * 0.12) * 4.0); ap = 0.03; }
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
  if (isVolumetric(uMode)) return marchVolume(ro, rd, 1e9);

  float id, aux;
  float t = march(ro, rd, 40.0, id, aux);
  if (t < 0.0) {
    vec3 bg = envBase(rd);
    if (uMode == 20) bg += marchVolume(ro, rd, 1e9);
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
  if (uMode == 20) col += marchVolume(ro, rd, t + 4.8);
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
    // drop punch-in: the camera flinches toward the action as the slam lands
    uv *= 1.0 - uDrop * uDrop * 0.07;
    float ga = fs * 2.39996;
    float gr = sqrt(fract(fs * 0.618 + seed));
    vec2 lens = vec2(cos(ga), sin(ga)) * gr;
    vec3 ro, rd;
    camera(uTime, uv, lens, ro, rd);
    vec3 c = trace(ro, rd);
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
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.018;
  fragColor = vec4(col, 1.0);
}`;
