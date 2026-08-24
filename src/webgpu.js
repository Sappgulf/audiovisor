// WebGPU 3D ray-marched stage — fallback to canvas if unavailable
export async function initWebGPU(canvas) {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    /* Everything that can fail is built before the canvas is touched.
       A canvas keeps the first context type it is given, so once
       getContext('webgpu') succeeds, getContext('webgl2') on the same
       element returns null forever. This used to claim the canvas up
       front and could then still bail out — on a shader compile error,
       a pipeline error, or a buffer allocation — at which point main.js
       fell back to initWebGL2() on that same canvas and got nothing. The
       WGSL bug fixed in v8.9.1 took exactly that path, so GPU Core had no
       working renderer at all. */

    const shader = `
      @group(0) @binding(0) var<uniform> time: f32;
      @group(0) @binding(1) var<uniform> level: f32;
      struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
        var o: VSOut; o.pos = vec4f(p[i], 0, 1); o.uv = (p[i] + 1) * 0.5; return o;
      }
      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let uv = in.uv * 2.0 - 1.0;
        let d = length(uv);
        let r = 0.35 + sin(time*0.7)*0.02 + level*0.12;
        let ring = smoothstep(0.015, 0.0, abs(d - r));
        let glow = exp(-abs(d - r)*18.0) * 0.6 * (0.6 + level);
        // var, not let: WGSL lets are immutable, and assigning to one made
        // the whole module fail to compile, leaving the pipeline invalid and
        // every frame submitting a broken command buffer
        var col = vec3f(0.85, 0.68, 0.53) * (ring + glow);
        // ray-marched void core
        let core = smoothstep(r*0.45, r*0.42, d);
        col = mix(col, vec3f(0.02,0.015,0.015), core);
        // vignette
        let vig = 1.0 - dot(uv, uv)*0.22;
        return vec4f(col * vig, 1.0);
      }
    `;
    const module = device.createShaderModule({ code: shader });
    // surface compile errors instead of silently shipping an invalid pipeline
    const info = await module.getCompilationInfo?.();
    if (info && info.messages.some((m) => m.type === 'error')) {
      console.warn('webgpu shader failed to compile:', info.messages.filter((m) => m.type === 'error').map((m) => m.message).join('; '));
      return null;
    }
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });
    const timeBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const levelBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: timeBuf } }, { binding: 1, resource: { buffer: levelBuf } }]
    });

    // last step, and the only one that consumes the canvas
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    context.configure({ device, format, alphaMode: 'opaque' });
    return { device, context, pipeline, bindGroup, timeBuf, levelBuf, format };
  } catch { return null; }
}

export function renderWebGPU(state, t, level) {
  if (!state) return;
  const { device, context, pipeline, bindGroup, timeBuf, levelBuf } = state;
  device.queue.writeBuffer(timeBuf, 0, new Float32Array([t]));
  device.queue.writeBuffer(levelBuf, 0, new Float32Array([level]));
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0.06,0.05,0.045,1], loadOp: 'clear', storeOp: 'store' }]
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([enc.finish()]);
}
