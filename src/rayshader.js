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
float histBlock(float x, float age) {
  // hard texel fetch, for a crisp spectrogram matrix
  float row = fract(uHistRow - age);
  int ci = int(clamp(x, 0.0, 0.9999) * 255.0);
  int ri = int(clamp(row, 0.0, 0.9999) * 127.0);
  return texelFetch(uHist, ivec2(ci, ri), 0).r;
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

/* 6 tunnel — ribbed hyperspace bore */
float scTunnel(vec3 p) {
  float z = p.z + uTime * 3.2;
  float cell = floor(z / 1.1);
  float lz = mod(z, 1.1) - 0.55;
  float band = spec(fract(cell * 0.083));
  float r = max(2.3 - band * 0.7 * uSens - uBeat * 0.12 - uDrop * 0.2, 0.9);
  float rad = length(p.xy);
  /* a tiny radial breath instead of an atan2 + sin per SDF step */
  float wob = (rad - 2.0) * 0.025 * (0.3 + uMid) * sin(cell * 0.7 + uTime);
  float ring = length(vec2(rad - r + wob, lz)) - (0.03 + band * 0.05);
  float d = ring;
  g_id = 4.0; g_aux = fract(cell * 0.083);
  float wall = -(rad - (r + 0.85));
  if (wall < d) { d = wall; g_id = 6.0; g_aux = 0.2; }
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
  ridge += vnoise2(vec2(p.x * 1.7, p.z * 1.7)) * 0.24;    // crest detail
  float d = (p.y + 1.2 - ridge) * 0.40;            // conservative slope for the heightfield march
  g_id = 7.0; g_aux = clamp(ridge * 0.4, 0.0, 1.0);
  return d;
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
  if (uMode == 6)  return scTunnel(p);
  if (uMode == 8)  return scTerrain(p);
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

/* Tunnel wall is a cylinder per 1.1-long cell, so when the wall is the
   nearest surface the march can jump straight to it analytically instead of
   creeping along it: rays bounced off the wall skim the tube at grazing
   angles, and with the radial gap as the step they burned the whole step
   budget. The jump stops at the next cell boundary, where the radius can
   change, and at the own-cell ring, the nearest ring inside a cell. */
float tunnelStep(vec3 p, vec3 rd, float d) {
  float z = p.z + uTime * 3.2;
  float cell = floor(z / 1.1);
  float band = spec(fract(cell * 0.083));
  float r = max(2.3 - band * 0.7 * uSens - uBeat * 0.12 - uDrop * 0.2, 0.9);
  float R = r + 0.85;
  float rad = length(p.xy);
  float mz = mod(z, 1.1);
  float ring = length(vec2(rad - r, mz - 0.55)) - 0.12;
  float a = dot(rd.xy, rd.xy);
  float wallS = 1e3;
  if (a > 1e-6) {
    float b = dot(p.xy, rd.xy);
    float c = dot(p.xy, p.xy) - R * R;
    float disc = b * b - a * c;
    if (disc > 0.0) wallS = (-b + sqrt(disc)) / a;
  }
  float cellS = rd.z > 1e-4 ? (1.1 - mz) / rd.z + 0.002
              : rd.z < -1e-4 ? mz / -rd.z + 0.002 : 1e3;
  return max(d, min(min(wallS * 0.97, cellS), max(ring, d)));
}

/* ---------------- march ---------------- */

float march(vec3 ro, vec3 rd, float tmax, out float id, out float aux) {
  float t = 0.02;
  id = -1.0; aux = 0.0;
  /* The tunnel's reflection bounce (the only tunnel march with tmax < 20)
     gets 20 steps: the long tail of rays skimming the bore past that cost
     ~3ms a frame. A ray that runs out of steps still reports a miss: taking
     the nearest surface instead picked up ring emission and lit the whole
     bore magenta. */
  bool tunnelBounce = uMode == 6 && tmax < 20.0;
  int cap = tunnelBounce ? min(uSteps, 20) : uSteps;
  for (int i = 0; i < 256; i++) {
    if (i >= cap) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012 * t + 0.0006) { id = g_id; aux = g_aux; return t; }
    t += (uMode == 6 && g_id == 6.0) ? tunnelStep(p, rd, d * 0.72) : d * 0.72;
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

/* ---------------- camera ---------------- */

void camera(float t, vec2 uv, vec2 dofJitter, out vec3 ro, out vec3 rd) {
  t *= 1.75;
  vec3 ta = vec3(0.0);
  float fov = 1.5;
  float ap = 0.012;
  float sway = sin(t * 0.21) * 0.22;
  if (uMode == 6) {
    ro = vec3(sin(t * 0.4) * 0.3, cos(t * 0.33) * 0.3, 4.0);
    ta = ro + vec3(0.0, 0.0, -1.0);
    ap = 0.02;
  } else if (uMode == 8) {
    ro = vec3(sway * 1.6, 3.2, 9.0);
    ta = vec3(0.0, 0.35, -3.5);
    ap = 0.008;
  } else if (uMode == 23) {
    ro = vec3(sin(t * 0.06) * 0.7, 3.8 + sin(t * 0.09) * 0.08,
              1.9 + cos(t * 0.06) * 0.4);
    ta = vec3(0.0, 0.0, -0.8);
    ap = 0.006;
    fov = 1.42;
  } else {
    ro = vec3(sin(t * 0.12) * 4.0, 2.0, cos(t * 0.12) * 4.0);
    ap = 0.03;
  }
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
  if (uMode == 6) ta = ro + vec3(0.0, 0.0, -1.0);
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 dir = normalize(uv.x * rt + uv.y * up + fov * fw);
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

/* 2D segment distance for the flat instrument fields. */
float sdSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

bool isFieldMode(int m) {
  /* only the tunnel, terrain and chladni signatures still ray-march */
  return m != 6 && m != 8 && m != 23;
}

float modeHue(int m) {
  if (m == 0) return 0.00;
  if (m == 1) return 0.55;
  if (m == 2) return 0.80;
  if (m == 3) return 0.92;
  if (m == 4) return 0.18;
  if (m == 5) return 0.52;
  if (m == 7) return 0.68;
  if (m == 9) return 0.08;
  if (m == 10) return 0.32;
  if (m == 11) return 0.22;
  if (m == 12) return 0.62;
  if (m == 13) return 0.45;
  if (m == 14) return 0.86;
  if (m == 15) return 0.00;
  if (m == 16) return 0.96;
  if (m == 17) return 0.72;
  if (m == 18) return 0.38;
  if (m == 19) return 0.42;
  if (m == 20) return 0.04;
  if (m == 21) return 0.40;
  if (m == 22) return 0.12;
  return 0.0;
}
vec3 fieldPal(float t) {
  return palf(fract(t + modeHue(uMode)));
}

vec3 fieldScene(vec2 uv, vec3 field) {
  /* shared field motion: breathe with the beat, punch in on the drop, and
     add a tiny drop-only shake. The 3D scenes keep their own camera rigs. */
  float modeSeed = float(uMode) * 1.37;
  float beat = pow(clamp(uBeat, 0.0, 1.0), 0.7);
  float drop = clamp(uDrop, 0.0, 1.0);
  uv *= 1.0 - (0.012 + 0.022 * beat + 0.055 * drop);
  uv = rot(0.006 * sin(uTime * 0.6 + modeSeed)
         + 0.018 * drop * sin(uTime * 8.0 + modeSeed)) * uv;
  uv += vec2(sin(uTime * 61.0 + modeSeed), cos(uTime * 57.0 + modeSeed))
      * drop * drop * 0.008;
  float aspect = uRes.x / max(uRes.y, 1.0);
  /* Portrait phones: the modes built around one centred object (scope,
     kaleidoscope, spiral, orb, prism, void, radar, vinyl) were framed for a
     wide screen and ran off both sides. Scale them so the object fits the
     width; full-frame fields keep filling the screen. */
  bool centred = uMode == 2 || uMode == 4 || uMode == 11 || uMode == 12 ||
                 uMode == 15 || uMode == 16 || uMode == 19 || uMode == 22;
  if (centred && aspect < 1.0) uv /= max(aspect, 0.5);
  float r = length(uv);
  float a = atan2s(uv.y, uv.x);
  vec3 col = vec3(0.0);

  if (uMode == 2) {
    /* phosphor Lissajous trace */
    vec2 p = uv * 2.40;
    float thin = 0.012 + uLevel * 0.008 + uBeat * 0.006;
    for (int i = 0; i < 40; i++) {
      vec4 A = uScope[i];
      vec4 B = uScope[i + 1];
      vec2 a = A.xy + vec2(A.w, 0.0);
      vec2 b = B.xy + vec2(B.w, 0.0);
      float d = sdSegment2(p, a, b);
      float core = 1.0 - smoothstep(thin, thin * 2.0, d);
      float halo = exp(-d * 35.0);
      vec3 cc = fieldPal(fract(float(i) / 40.0 + uTime * 0.04));
      col += cc * (core * (1.0 + uLevel) + halo * 0.18) * (0.6 + uBeat * 0.4);
    }
    col += fieldPal(0.80) * exp(-length(p) * 1.5) * 0.03;
    /* CRT graticule: the trace used to float on pure black. An 8x8 division
       grid with minor ticks on the axes, a round bezel and a faint phosphor
       floor give it an instrument to live in; the grid glows with the level. */
    vec2 gq = uv * 4.0;
    vec2 gd = abs(fract(gq) - 0.5);
    float grid = max(1.0 - smoothstep(0.004, 0.016, 0.5 - gd.x),
                     1.0 - smoothstep(0.004, 0.016, 0.5 - gd.y));
    float axes = max(1.0 - smoothstep(0.0015, 0.006, abs(uv.x)),
                     1.0 - smoothstep(0.0015, 0.006, abs(uv.y)));
    vec2 tq = abs(fract(uv * 20.0) - 0.5);
    float ticks = (1.0 - smoothstep(0.0, 0.02, abs(uv.y)) ) * (1.0 - smoothstep(0.30, 0.42, tq.x))
                + (1.0 - smoothstep(0.0, 0.02, abs(uv.x)) ) * (1.0 - smoothstep(0.30, 0.42, tq.y));
    float face = 1.0 - smoothstep(0.92, 0.94, r);
    float bezel = 1.0 - smoothstep(0.0, 0.010, abs(r - 0.945));
    vec3 phos = fieldPal(0.42);
    col += phos * face * (grid * (0.030 + uLevel * 0.035) + axes * 0.05 + ticks * 0.06);
    col += phos * face * exp(-r * 2.2) * (0.020 + uBass * 0.035);
    col += fieldPal(0.88) * bezel * (0.22 + uBeat * 0.30);
  } else if (uMode == 0) {
    /* full-frame spectrum equalizer with a mirror finish */
    float x = uv.x / (2.0 * aspect) + 0.5;
    float idx = floor(x * 56.0);
    float u = clamp((idx + 0.5) / 56.0, 0.0, 1.0);
    float e = pow(spec(u), 1.25) * uSens;
    float h = 0.10 + 0.95 * e / (1.0 + 0.35 * e);
    float fx = fract(x * 56.0) - 0.5;
    float base = -0.55;
    float width = 0.34;
    float body = step(base, uv.y) * step(uv.y, base + h)
               * (1.0 - smoothstep(width, width + 0.08, abs(fx)));
    float cap = exp(-abs(uv.y - (base + h)) * 90.0)
              * (1.0 - smoothstep(width, width + 0.08, abs(fx)));
    float mirror = step(base - h * 0.45, uv.y) * step(uv.y, base)
                 * (1.0 - smoothstep(width, width + 0.08, abs(fx)));
    vec3 cc = fieldPal(fract(u * 0.82 + 0.08 + uTime * 0.01));
    col = cc * body * (0.18 + e * 1.2 + uBeat * 0.35)
        + fieldPal(0.92) * cap * (0.6 + uBeat * 0.8)
        + cc * mirror * 0.16;
    col += fieldPal(0.60) * exp(-abs(uv.y - base) * 80.0) * (0.08 + uLevel * 0.12);
    col += fieldPal(0.15) * exp(-abs(uv.y + 0.85) * 2.0) * 0.02;
  } else if (uMode == 1) {
    /* layered waveform ribbons */
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float off = (fi - 3.0) * 0.17;
      float amp = (0.32 - fi * 0.018) * (1.0 + uLevel * 1.1);
      float w = wav(uv.x * 0.32 + fi * 0.11 + uTime * 0.05) * amp;
      w += sin(uv.x * 1.6 + fi * 0.8 + uTime * 0.7) * (0.035 + uMid * 0.05);
      float y0 = off + w;
      float d = abs(uv.y - y0);
      float line = 1.0 - smoothstep(0.006, 0.020 + fi * 0.002, d);
      vec3 cc = fieldPal(fract(0.12 + fi * 0.135 + uTime * 0.01));
      /* depth: the outer ribbons sit further back and dimmer, and each
         ribbon drops a translucent curtain beneath it that swells with the
         bass, so the stack reads as layered surfaces instead of seven wires */
      float depth = 1.0 - abs(fi - 3.0) * 0.16;
      float below = uv.y < y0 ? exp(-(y0 - uv.y) * 7.0) : 0.0;
      col += cc * depth * (line * (0.5 + uLevel * 1.2 + uBeat * 0.45)
             + exp(-d * 50.0) * 0.08 * (0.4 + uLevel)
             + below * (0.030 + uBass * 0.045));
    }
    col += fieldPal(0.10) * exp(-abs(uv.y) * 2.5) * 0.02;
  } else if (uMode == 3) {
    /* ember vortex */
    float twist = a + log(r + 0.25) * 2.6 - uTime * 0.35;
    float arm = pow(0.5 + 0.5 * sin(twist * 2.0), 5.0);
    vec2 g = vec2(a / TAU * 28.0 + r * 2.0, r * 9.0 - uTime * 0.4);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash11(id.x * 13.7 + id.y * 71.3);
    float star = (1.0 - smoothstep(0.0, 0.18, length(f))) * step(0.62, h);
    float band = spec(fract(h * 3.1));
    vec3 cc = fieldPal(fract(h * 4.0 + r * 0.18 + uTime * 0.02));
    col += cc * star * (0.35 + band * 1.4 + uBeat * 0.4);
    col += cc * arm * (0.08 + uLevel * 0.20) * exp(-r * 0.35);
    col += fieldPal(0.90) * exp(-r * 7.0) * (0.6 + uBass * 1.5 + uBeat * 0.8);
    col += fieldPal(0.55) * exp(-abs(r - (0.55 + uBass * 0.10)) * 90.0) * (0.4 + uBeat * 0.8);
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
    vec3 cc = fieldPal(fract(r * 0.85 + uTime * 0.02));
    col = cc * pattern * (0.45 + uLevel * 0.9 + uBeat * 0.4)
        + fieldPal(0.92) * pow(pattern, 4.0) * 0.55;
  } else if (uMode == 5) {
    /* time/frequency waterfall as a crisp matrix */
    float u = clamp(uv.x / (2.0 * aspect) + 0.5, 0.0, 1.0);
    float cols = 48.0, rows = 24.0;
    vec2 g = vec2(u * cols, (0.5 - uv.y * 0.5) * rows + uTime * 3.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float age = fract(id.y / rows - uTime * 0.04);
    float e = histBlock((id.x + 0.5) / cols, age);
    /* the newest row is the leading edge: it shows the live spectrum, not
       the last stored history row, so the matrix answers the instant a hit
       lands instead of a row later */
    float front = step(age, 1.0 / rows);
    e = mix(e, spec((id.x + 0.5) / cols), front);
    float lit = smoothstep(0.10, 0.50, e);
    float cell = (1.0 - smoothstep(0.30, 0.46, max(abs(f.x), abs(f.y)))) * lit;
    vec3 cc = fieldPal(fract(0.55 + (id.x / cols) * 0.32 + (id.y / rows) * 0.10));
    col = cc * cell * (0.45 + e * 2.0 + uBeat * 0.25)
        + fieldPal(0.95) * pow(cell, 3.0) * 0.55;
    col += cc * cell * (1.0 - smoothstep(0.0, 0.10, abs(f.y))) * 0.20;
    col += fieldPal(0.95) * cell * front * (0.18 + uBeat * 0.55 + uBass * 0.25);
    float se = pow(spec(u), 1.2);
    float curve = 1.0 - smoothstep(0.0, 0.012, abs(uv.y + 0.86 - se * 0.38));
    col += fieldPal(0.90) * curve * (0.55 + uBeat * 0.5);
  } else if (uMode == 7) {
    /* plasma storm */
    vec2 p = uv * 1.4;
    p += 0.35 * vec2(sin(p.y * 2.1 + uTime * 0.6), cos(p.x * 1.7 - uTime * 0.5));
    float n = fbm2a(p * 1.1 + uTime * 0.06);
    float bands = sin(p.x * 3.2 + p.y * 2.4 + n * 7.0 - uTime * 1.4);
    float fil = pow(0.5 + 0.5 * bands, 7.0);
    float cells = pow(0.5 + 0.5 * sin(n * 22.0 + uTime * 0.4), 6.0);
    vec3 cc = fieldPal(fract(0.1 + n * 1.3 + uTime * 0.02));
    col = cc * fil * (0.8 + uLevel * 1.5 + uBeat * 0.6)
        + fieldPal(0.90) * cells * (0.15 + uHigh * 0.5)
        + fieldPal(0.30) * exp(-r * 0.8) * 0.05;
  } else if (uMode == 9) {
    /* neon skyline and wet-street reflection */
    float x = uv.x / (2.0 * aspect) + 0.5;
    float y = uv.y;
    float horizon = -0.42;
    col = mix(fieldPal(0.04) * 0.01, fieldPal(0.24) * 0.06, smoothstep(horizon, 0.9, y));
    /* moon */
    vec2 mp = vec2((x - 0.22) * aspect, y - 0.68);
    float moon = 1.0 - smoothstep(0.055, 0.072, length(mp));
    col += fieldPal(0.95) * moon * 0.75
         + fieldPal(0.72) * exp(-length(mp) * 11.0) * 0.12;
    /* stars */
    vec2 sg = floor(vec2(x, y) * vec2(130.0, 90.0));
    vec2 sf = fract(vec2(x, y) * vec2(130.0, 90.0)) - 0.5;
    float sh = hash11(sg.x * 13.0 + sg.y * 29.0);
    float star = (1.0 - smoothstep(0.0, 0.20, length(sf)))
               * step(0.986, sh) * step(horizon, y);
    col += fieldPal(fract(sh * 6.0)) * star * 0.8;
    /* far layer */
    float cellB = floor(x * 30.0);
    float hB = hash11(cellB * 23.0) * 0.34 + 0.08;
    float bodyB = step(horizon, y) * step(y, horizon + hB)
                * (1.0 - smoothstep(0.38, 0.46, abs(fract(x * 30.0) - 0.5)));
    col += fieldPal(0.12) * bodyB * 0.045;
    /* near layer */
    float cell = floor(x * 14.0);
    float fx = fract(x * 14.0) - 0.5;
    float h = hash11(cell * 17.3);
    float bw = 0.26 + 0.14 * hash11(cell * 3.7);
    float top = horizon + 0.16 + h * 0.72 + spec(fract(hash11(cell * 7.1))) * 0.22;
    float bodyMask = step(horizon, y) * step(y, top)
                   * (1.0 - smoothstep(bw, bw + 0.05, abs(fx)));
    float wc = 2.0 + floor(hash11(cell * 9.1) * 2.0);
    float wr = 8.0 + floor(hash11(cell * 2.7) * 5.0);
    vec2 wf = abs(fract(vec2((fx + bw) / (bw * 2.0) * wc,
                             (y - horizon) * wr)) - 0.5);
    float lit = step(0.55, hash11(cell * 5.7 + floor((y - horizon) * wr)
                   + floor((fx + bw) * wc * 3.0)));
    float win = (1.0 - smoothstep(0.12, 0.22, wf.x))
              * (1.0 - smoothstep(0.18, 0.30, wf.y)) * lit;
    vec3 bc = fieldPal(fract(0.10 + hash11(cell * 3.1) * 0.7));
    col += bc * bodyMask * (0.08 + win * (0.5 + uLevel * 0.5))
         + fieldPal(0.92) * win * bodyMask * 0.65;
    /* neon sign on some towers */
    float signOn = step(0.72, hash11(cell * 11.3));
    float sign = signOn * (1.0 - smoothstep(0.0, 0.018, abs(y - (top - 0.10))))
               * (1.0 - smoothstep(0.10, 0.16, abs(fx)));
    col += fieldPal(fract(hash11(cell * 4.1))) * sign * (0.8 + uBeat * 0.6);
    /* antenna on the tall towers */
    float crown = step(0.68, hash11(cell * 9.7))
                * (1.0 - smoothstep(0.0, 0.010, abs(fx)))
                * step(top, y) * step(top + 0.22, y + 0.22);
    col += fieldPal(0.85) * crown * (0.5 + uBeat * 0.7);
    /* reflection with a ripple */
    float ry = horizon - (y - horizon);
    float wob = 0.004 * sin(y * 90.0 + uTime * 2.0);
    vec2 mwf = abs(fract(vec2(((fx + wob) + bw) / (bw * 2.0) * wc,
                              (ry - horizon) * wr)) - 0.5);
    float mwin = (1.0 - smoothstep(0.12, 0.22, mwf.x))
               * (1.0 - smoothstep(0.18, 0.30, mwf.y))
               * step(0.55, hash11(cell * 5.7 + floor((ry - horizon) * wr)));
    float mirror = step(-1.0, y) * step(y, horizon) * step(ry, top)
                 * (1.0 - smoothstep(bw, bw + 0.05, abs(fx + wob)));
    col += bc * mirror * 0.07 + fieldPal(0.92) * mwin * mirror * 0.14;
    col += fieldPal(0.55) * exp(-abs(y - horizon) * 70.0) * (0.10 + uLevel * 0.15);
    /* rain */
    vec2 rp = vec2((x + y * 0.18) * 90.0, y * 55.0 + uTime * 26.0);
    vec2 ri = floor(rp), rf = fract(rp) - 0.5;
    float rh = hash11(ri.x * 7.1 + ri.y * 3.7);
    float rain = (1.0 - smoothstep(0.0, 0.06, abs(rf.x)))
               * (1.0 - smoothstep(0.0, 0.40, abs(rf.y)))
               * step(0.72, rh) * smoothstep(horizon, 0.55, y);
    col += fieldPal(0.72) * rain * (0.06 + uLevel * 0.05);
    /* car light trails along the street */
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float yy = horizon + 0.018 + fi * 0.020;
      float xx = fract(x * 3.0 + uTime * (0.10 + fi * 0.06) + fi * 0.37);
      float trail = (1.0 - smoothstep(0.0, 0.004, abs(y - yy)))
                  * smoothstep(0.0, 0.10, xx) * (1.0 - smoothstep(0.10, 0.28, xx));
      col += fieldPal(0.92) * trail * (0.22 + uLevel * 0.18);
    }
    /* occasional lightning */
    float strike = step(0.985, hash11(floor(uTime * 0.7)));
    float flash = strike * exp(-abs(y - 0.35) * 4.0)
                * (0.5 + 0.5 * sin(uTime * 40.0));
    col += fieldPal(0.85) * flash * 0.10;
  } else if (uMode == 10) {
    /* filamented nebula cloud */
    vec2 p = uv * 1.2;
    float n1 = fbm2a(p * 2.2 + vec2(uTime * 0.03, 0.0));
    float n2 = fbm2b(p * 5.2 - vec2(0.0, uTime * 0.02));
    float n3 = vnoise2(p * 11.0 + uTime * 0.05);
    float cloud = smoothstep(0.42, 0.76, n1 * 0.70 + n2 * 0.35 + n3 * 0.15);
    float rim = pow(clamp(1.0 - abs(n1 * 2.0 - 1.0), 0.0, 1.0), 10.0);
    float dust = smoothstep(0.55, 0.76, fbm2a(p * 3.2 + vec2(7.0, 2.0)));
    vec3 cc = fieldPal(fract(0.30 + n1 * 0.55 + uv.x * 0.05));
    col = cc * cloud * (0.20 + uLevel * 0.90 + uBeat * 0.25) * (1.0 - dust * 0.70)
        + fieldPal(0.95) * rim * cloud * (0.35 + uHigh * 0.90)
        + fieldPal(0.95) * exp(-length(uv * vec2(1.0, 1.5)) * 4.0) * (0.18 + uBass * 0.50);
    vec2 g = floor(uv * 100.0), f = fract(uv * 100.0) - 0.5;
    float h = hash11(g.x * 13.0 + g.y * 29.0);
    float star = (1.0 - smoothstep(0.0, 0.13, length(f))) * step(0.982, h);
    col += fieldPal(fract(h * 7.0)) * star * (0.7 + uHigh);
    /* god rays and a dense cluster around the core */
    float rays = pow(0.5 + 0.5 * sin(a * 36.0 + n1 * 9.0), 12.0) * exp(-r * 1.5);
    col += fieldPal(0.92) * rays * (0.18 + uHigh * 0.55);
    vec2 cg = floor(uv * vec2(60.0, 60.0) + 17.0);
    vec2 cf = fract(uv * vec2(60.0, 60.0) + 17.0) - 0.5;
    float ch = hash11(cg.x * 11.0 + cg.y * 37.0);
    float cluster = exp(-length(uv * vec2(1.0, 1.5)) * 4.0)
                  * (1.0 - smoothstep(0.0, 0.16, length(cf))) * step(0.90, ch);
    col += fieldPal(fract(ch * 5.0)) * cluster * (0.9 + uHigh);
  } else if (uMode == 11) {
    /* spiral galaxy */
    float arms = pow(0.5 + 0.5 * sin(a * 2.0 + log(r + 0.06) * 7.0 - uTime * 0.12), 8.0);
    float arms2 = pow(0.5 + 0.5 * sin(a * 2.0 + log(r + 0.06) * 7.0 - uTime * 0.12 + PI), 10.0) * 0.35;
    float dust = fbm2a(vec2(a * 3.0, log(r + 0.12) * 5.0 + uTime * 0.02));
    float disc = exp(-r * 1.20) * smoothstep(0.0, 0.10, r);
    vec3 cc = fieldPal(fract(0.12 + r * 0.50 + uTime * 0.01));
    disc *= 0.85 + uBass * 0.45;
    col = cc * disc * (0.04 + (arms + arms2) * (1.1 + uLevel * 1.0 + uBeat * 0.9) + dust * 0.10)
        + fieldPal(0.95) * exp(-r * 12.0) * (0.70 + uBass * 1.4 + uBeat * 0.6);
    col *= 1.0 - dust * 0.60;
    vec2 sg = floor(uv * 80.0), sf = fract(uv * 80.0) - 0.5;
    float sh = hash11(sg.x * 17.0 + sg.y * 31.0);
    float star = (1.0 - smoothstep(0.0, 0.12, length(sf))) * step(0.984, sh) * disc;
    col += fieldPal(fract(sh * 5.0)) * star * 1.5 * (0.4 + arms);
  } else if (uMode == 12) {
    /* gas-giant orb */
    float rr = length(uv);
    float sphere = 1.0 - smoothstep(0.86, 0.90, rr);
    vec3 n = vec3(uv, sqrt(max(0.0, 1.0 - rr * rr)));
    float bands = sin(n.y * 11.0 + sin(n.x * 4.0 + uTime * 0.7) * 2.0 - uTime * 0.9);
    float fil = pow(0.5 + 0.5 * bands, 3.0);
    float noise = fbm2a(vec2(atan2s(n.z, n.x) * 1.8 + uTime * 0.08, n.y * 3.0));
    vec3 cc = fieldPal(fract(0.12 + n.y * 0.35 + noise * 0.45 + uTime * 0.02));
    float rim = exp(-abs(rr - 0.88) * 55.0);
    col = cc * sphere * (0.20 + fil * (0.85 + uLevel * 1.2) + uBeat * 0.35)
        + fieldPal(0.90) * rim * (0.5 + uBeat * 0.7)
        + fieldPal(0.55) * exp(-rr * 5.0) * (0.10 + uBass * 0.30);
  } else if (uMode == 13) {
    /* liquid chrome */
    vec2 p = uv * 1.2;
    p += (0.22 + uBass * 0.10) * vec2(sin(p.y * 2.1 + uTime * 0.7), cos(p.x * 2.3 - uTime * 0.6));
    float n = fbm2a(p * 1.4 + uTime * 0.05);
    float n2 = fbm2b(p * 3.1 - uTime * 0.03);
    float h = n * 0.7 + n2 * 0.3;
    float bands = 0.5 + 0.5 * sin(h * 12.0 - uTime * 1.4 + uv.x * 3.0);
    float shine = pow(0.5 + 0.5 * cos(h * 18.0 + uv.y * 5.0 - uTime * 1.8), 14.0);
    vec3 cc = fieldPal(fract(0.24 + h * 0.52 + uTime * 0.01));
    col = cc * (0.10 + bands * (0.30 + uBass * 0.35) + shine * (0.8 + uLevel * 1.2 + uBeat * 1.1))
        + fieldPal(0.99) * shine * (0.35 + uBeat * 0.4);
    col *= 0.55 + 0.8 * smoothstep(0.15, 0.85, h);
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
    vec3 cc = fieldPal(fract(h * 1.7 + uTime * 0.02));
    col = cc * (lines * (0.16 + uLevel * 0.45) + node * (0.6 + spec(fract(h)) * 1.2))
        + fieldPal(0.90) * exp(-r * 3.0) * 0.22;
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
      fan += fieldPal(fi / 6.0) * beam * (0.6 + spec(fi / 6.0) * 1.2 + uBeat * 0.3);
    }
    col = fan + fieldPal(0.90) * beamIn * (0.8 + uLevel * 0.6)
        + fieldPal(0.85) * inside * 0.10
        + fieldPal(0.75) * outline * (0.7 + uLevel * 0.8);
  } else if (uMode == 16) {
    /* black hole and accretion disc */
    float coreR = 0.34 + uBass * 0.02 - uDrop * 0.04;
    vec2 e = vec2(uv.x, uv.y * 3.4);
    float er = length(e);
    float discMask = smoothstep(coreR + 0.02, coreR + 0.13, er)
                   * (1.0 - smoothstep(0.68, 0.92, er));
    float bands = 0.5 + 0.5 * sin(atan2s(e.y, e.x) * 3.0 + er * 22.0 - uTime * 1.8);
    vec3 cc = fieldPal(fract(0.15 + er * 0.75 + uTime * 0.02));
    col += cc * discMask * bands * (0.45 + uLevel * 1.1 + uBeat * 0.35);
    float photon = exp(-abs(r - (coreR + 0.015)) * 90.0);
    col += fieldPal(0.95) * photon * (0.8 + uBeat * 0.7);
    col += fieldPal(0.55) * exp(-abs(r - (coreR + 0.10)) * 22.0) * 0.12;
    col *= smoothstep(coreR - 0.012, coreR + 0.012, r);
    vec2 lens = uv + normalize(uv + 1e-5) * (0.06 / (r + 0.10));
    vec2 g = floor(lens * 90.0), f = fract(lens * 90.0) - 0.5;
    float h = hash11(g.x * 19.0 + g.y * 23.0);
    float star = (1.0 - smoothstep(0.0, 0.14, length(f))) * step(0.985, h);
    col += fieldPal(fract(h * 6.0)) * star * 0.6;
    col += fieldPal(0.9) * exp(-abs(r - 0.46) * 90.0) * (0.25 + uLevel * 0.55);
  } else if (uMode == 17) {
    /* soft bioluminescent bloom field */
    float phase = uTime * 0.20 + uMid * 0.5;
    vec3 petals = vec3(0.0);
    for (int k = 0; k < 10; k++) {
      float fi = float(k);
      float ang = fi * TAU / 10.0 + phase + 0.15 * sin(r * 3.0 + fi);
      float da = abs(mod(a - ang + PI, TAU) - PI);
      float petal = pow(exp(-pow(da * 2.6, 2.0)), 2.0)
                  * smoothstep(0.05, 0.14, r)
                  * (1.0 - smoothstep(0.58, 1.48, r));
      vec3 pc = fieldPal(fract(fi / 10.0 + 0.10 + uTime * 0.015));
      petals += pc * petal;
    }
    float heart = exp(-r * 6.0) * (0.8 + uBass * 1.2 + uBeat * 0.8);
    vec2 g = floor(uv * 8.0), f = fract(uv * 8.0) - 0.5;
    float h = hash11(g.x * 19.0 + g.y * 23.0);
    float bokeh = (1.0 - smoothstep(0.05, 0.35, length(f))) * step(0.85, h) * (0.4 + uHigh);
    col = petals * (0.30 + uLevel * 0.9)
        + fieldPal(0.90) * heart
        + fieldPal(0.60) * bokeh * 0.4;
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
    vec3 cc = fieldPal(fract(glow * 1.6 + uTime * 0.015));
    col = cc * (glow * glow * (0.5 + uLevel * 1.2) + vein * (0.3 + uHigh * 0.8))
        + fieldPal(0.90) * pow(vein, 3.0) * 0.5;
  } else if (uMode == 19) {
    /* full-frame phosphor radar */
    float disc = 1.0 - smoothstep(0.94, 0.97, r);
    float rings = 1.0 - smoothstep(0.006, 0.024, abs(fract(r * 4.8) - 0.5));
    float spokes = 1.0 - smoothstep(0.004, 0.018,
      abs(fract(a / TAU * 12.0 + 0.5) - 0.5));
    float sweep = fract(a / TAU - uTime * 0.25);
    float wedge = pow(1.0 - sweep, 5.0) * disc;
    float sweepLine = 1.0 - smoothstep(0.0, 0.018, min(sweep, 1.0 - sweep));
    vec3 cc = mix(vec3(0.15, 1.0, 0.55), fieldPal(0.42), 0.35);
    col = disc * (cc * (rings * (0.12 + uBass * 0.30) + spokes * 0.05 + wedge * (0.30 + uLevel * 0.45))
                + fieldPal(0.90) * sweepLine * 0.55
                + cc * (exp(-abs(uv.x) * 90.0) + exp(-abs(uv.y) * 90.0)) * 0.04);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float ang = hash11(fi * 3.1) * TAU;
      float rr = 0.18 + 0.68 * hash11(fi * 7.7);
      vec2 c = vec2(cos(ang), sin(ang)) * rr;
      float band = spec(fract(fi / 6.0 * 0.8 + 0.04));
      float dot = 1.0 - smoothstep(0.0, 0.012 + band * 0.022, length(uv - c));
      float fresh = pow(1.0 - fract(ang / TAU - uTime * 0.25), 6.0);
      col += fieldPal(fract(fi * 0.19)) * dot * (0.25 + band * 0.9 + fresh * 0.9);
    }
    col += cc * exp(-r * 26.0) * (0.35 + uBass * 0.6);
    /* sonar ping: each beat launches a ring that runs out to the rim */
    float pingR = (1.0 - uBeat) * 0.95;
    col += fieldPal(0.90) * disc * uBeat * (1.0 - smoothstep(0.0, 0.03, abs(r - pingR))) * 0.9;
    float trail = 0.0;
    for (int i = 0; i < 4; i++) {
      float s = fract(a / TAU - uTime * 0.25 + float(i) * 0.022);
      trail += pow(1.0 - s, 8.0) * (1.0 - float(i) * 0.22);
    }
    col += cc * trail * 0.22 * disc;
    /* the phosphor breathes with the mix: dim in a breakdown, flaring on hits */
    col *= 0.62 + uLevel * 0.65 + uBeat * 0.35;
    col += cc * (hash11(dot(floor(uv * 420.0), vec2(12.9, 78.2)) + floor(uTime * 60.0)) - 0.5) * 0.012 * disc;
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
    vec3 cc = fieldPal(fract(0.12 + r * 0.3 + uTime * 0.02));
    col = cc * inside * wax * (0.7 + uBass * 1.2 + uBeat * 0.5)
        + fieldPal(0.95) * rim * (0.5 + uHigh * 0.8)
        + fieldPal(0.25) * exp(-r * 1.2) * 0.08;
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
    /* data packets run along each trace, one band per trace, so busy bands
       carry visibly faster traffic (was one diagonal sine over the board) */
    float bandH = spec(fract(h * 0.8 + 0.05));
    float bandV = spec(fract(hash11(id.y * 13.0 + id.x * 7.0) * 0.8 + 0.05));
    float pktH = pow(fract(g.x * 0.5 - uTime * (0.6 + bandH * 2.4) + h * 7.0), 18.0) * traceH * (0.3 + bandH);
    float pktV = pow(fract(g.y * 0.5 - uTime * (0.6 + bandV * 2.4) + h * 3.0), 18.0) * traceV * (0.3 + bandV);
    float pulse = max(pktH, pktV) / max(traces, 1e-3);
    float chipGlow = exp(-max(abs(f2.x), abs(f2.y)) * 9.0) * step(0.55, h2);
    vec3 cc = fieldPal(fract(h2 * 2.0 + uTime * 0.02));
    float dieR = max(abs(uv.x), abs(uv.y));
    float dieInner = 1.0 - smoothstep(0.27, 0.30, dieR);
    float dieEdge = 1.0 - smoothstep(0.0, 0.012, abs(dieR - 0.305));
    vec2 dg = abs(fract(uv * 11.0) - 0.5);
    float dieGrid = max(1.0 - smoothstep(0.02, 0.05, dg.x),
                        1.0 - smoothstep(0.02, 0.05, dg.y)) * dieInner;
    col = cc * (traces * 0.14 + chip * (0.45 + spec(fract(h2)) * 1.2 + uBeat * 0.30))
        + fieldPal(0.90) * pulse * traces * (0.45 + uLevel * 0.60)
        + fieldPal(0.60) * (dieInner * 0.10 + dieEdge * (0.70 + uBass * 1.0))
        + fieldPal(0.75) * dieGrid * (0.04 + uLevel * 0.10);
    col += cc * chipGlow * (0.05 + spec(fract(h2)) * 0.12 + uBeat * 0.06);
    /* the die runs hot with the bass */
    col += fieldPal(0.05) * dieInner * exp(-dieR * 6.0) * (0.04 + uBass * 0.22);
  } else if (uMode == 22) {
    /* full-frame vinyl groove */
    float disc = 1.0 - smoothstep(0.92, 0.94, r);
    float grooves = 0.5 + 0.5 * sin(r * 190.0);
    float band = spec(pow(clamp(r / 0.92, 0.0, 1.0), 0.9));
    float sweep = smoothstep(-0.5, 0.5, sin(a - uTime * 1.5 + uBeat * 0.2));
    vec3 cc = fieldPal(pow(clamp(r / 0.92, 0.0, 1.0), 1.1));
    col = disc * cc * (grooves * (0.03 + band * 0.10)
                     + sweep * grooves * band * (1.0 + uBeat * 0.7)
                     + grooves * uHigh * 0.05);
    float label = 1.0 - smoothstep(0.20, 0.215, r);
    col = mix(col, fieldPal(0.45) * (0.55 + uBeat * 0.25), label);
    float arm = 1.0 - smoothstep(0.005, 0.011,
      sdSegment2(uv, vec2(0.62, 0.62), vec2(0.16, 0.16)));
    col = mix(col, fieldPal(0.75), arm * 0.85);
    col += vec3(1.0) * exp(-abs(r - 0.93) * 40.0) * 0.06;
    /* dust, scratches and a raised label ring */
    vec2 dg = floor(uv * 110.0);
    float dh = hash11(dg.x * 13.0 + dg.y * 7.0);
    float dust = (1.0 - smoothstep(0.0, 0.20,
      length(fract(uv * 110.0) - 0.5))) * step(0.992, dh) * disc;
    col += fieldPal(0.80) * dust * 0.8;
    float scratch = (1.0 - smoothstep(0.0, 0.004,
      abs(fract(r * 18.0 + a * 1.5 + floor(uTime * 0.1)) - 0.5)))
      * step(0.93, hash11(floor(a * 9.0) * 1.7)) * disc;
    col += vec3(0.7) * scratch * 0.25;
    col += fieldPal(0.55) * exp(-abs(r - 0.215) * 120.0) * 0.25;
    float armShadow = 1.0 - smoothstep(0.012, 0.020,
      sdSegment2(uv + vec2(0.006, 0.006), vec2(0.62, 0.62), vec2(0.16, 0.16)));
    col *= 1.0 - armShadow * 0.35 * disc;
  }

  return col + field * 0.18;
}

/* ---------------- main trace ---------------- */

vec3 trace(vec3 ro, vec3 rd, vec3 field) {
  float id, aux;
  float t = march(ro, rd, 40.0, id, aux);
  if (t < 0.0) {
    return envBase(rd) + field;
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
    /* Inside the tunnel every wall pixel reflects the tube itself, so a full
       26-unit bounce plus a full shade() was half the mode's frame (10.5ms ->
       5.4ms with it off, sweep at 896x514). What the bore reflects is almost
       all ring emission, so its bounce is shorter and emission-shaded, with
       no normal or light evaluation at the hit. */
    float t2 = march(p + n * 0.02, rr, uMode == 6 ? 12.0 : 26.0, id2, aux2);
    vec3 rc;
    if (t2 < 0.0) rc = envColor(rr);
    else if (uMode == 6) {
      Mat m2 = matOf(id2, aux2, p + n * 0.02 + rr * t2);
      rc = m2.emis + m2.alb * envColor(rr) * 0.5;
    } else {
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
