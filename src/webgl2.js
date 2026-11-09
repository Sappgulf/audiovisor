// WebGL2 fallback — same ray-marched void core when WebGPU unavailable
export function initWebGL2(canvas) {
  if (!window.WebGL2RenderingContext) return null;
  try {
    const gl = canvas.getContext('webgl2');
    if (!gl) return null;
    const vs = `#version 300 es
      void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`;
    const fs = `#version 300 es
      precision highp float;
      out vec4 outColor;
      uniform float u_time;
      uniform float u_level;
      uniform vec2 u_res;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res * 2.0 - 1.0;
        float d = length(uv);
        float r = 0.35 + sin(u_time * 0.7) * 0.02 + u_level * 0.12;
        float ring = smoothstep(0.015, 0.0, abs(d - r));
        float glow = exp(-abs(d - r) * 18.0) * 0.6 * (0.6 + u_level);
        vec3 col = vec3(0.85, 0.68, 0.53) * (ring + glow);
        float core = smoothstep(r * 0.45, r * 0.42, d);
        col = mix(col, vec3(0.02, 0.015, 0.015), core);
        float vig = 1.0 - dot(uv, uv) * 0.22;
        outColor = vec4(col * vig, 1.0);
      }`;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      /* headless/fake contexts may not implement the status query */
      if (gl.getShaderParameter && !gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('webgl2 shader failed:', gl.getShaderInfoLog?.(s));
        gl.deleteShader?.(s);
        return null;
      }
      return s;
    };
    const state = { gl, prog: null, lost: false, w: 0, h: 0, uTime: null, uLevel: null, uRes: null };
    /* Rebuild the program after a context restore. This used to set
       lost = true on restore too, so the fallback stayed dead for the rest
       of the session even though the context was healthy again. */
    const build = () => {
      const vsh = compile(gl.VERTEX_SHADER, vs);
      const fsh = compile(gl.FRAGMENT_SHADER, fs);
      if (!vsh || !fsh) return false;
      const prog = gl.createProgram();
      gl.attachShader(prog, vsh);
      gl.attachShader(prog, fsh);
      gl.linkProgram(prog);
      gl.deleteShader?.(vsh);
      gl.deleteShader?.(fsh);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('webgl2 link failed:', gl.getProgramInfoLog?.(prog));
        gl.deleteProgram?.(prog);
        return false;
      }
      gl.useProgram(prog);
      state.prog = prog;
      state.w = 0;
      state.h = 0;
      state.uTime = gl.getUniformLocation(prog, 'u_time');
      state.uLevel = gl.getUniformLocation(prog, 'u_level');
      state.uRes = gl.getUniformLocation(prog, 'u_res');
      return true;
    };
    if (!build()) return null;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { state.lost = !build(); });
    return state;
  } catch { return null; }
}

export function renderWebGL2(state, t, level, w, h) {
  if (!state || state.lost) return;
  const { gl, prog, uTime, uLevel, uRes } = state;
  gl.useProgram(prog);
  gl.uniform1f(uTime, t);
  gl.uniform1f(uLevel, level);
  if (state.w !== w || state.h !== h) {
    state.w = w; state.h = h;
    gl.uniform2f(uRes, w, h);
    gl.viewport(0, 0, w, h);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
