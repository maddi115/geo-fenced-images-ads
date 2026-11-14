import { premultiply, type GfxBackend } from './backend';

// WebGPU renderer. The C++ engine's draw commands for a frame are recorded, then
// sent to the GPU in ONE render pass with one uniform upload (dynamic offsets),
// with 4x MSAA for smooth edges.

const SHADER = /* wgsl */ `
struct U {
  offset: vec2f,
  view: vec2f,
  color: vec4f,
  scale: f32,
  width: f32,
  alpha: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> u: U;

fn clip(px: vec2f) -> vec4f {
  return vec4f(px.x / u.view.x * 2.0 - 1.0, 1.0 - px.y / u.view.y * 2.0, 0.0, 1.0);
}

@vertex fn vs_solid(@location(0) pos: vec2f) -> @builtin(position) vec4f {
  return clip(u.offset + pos * u.scale);
}

@vertex fn vs_line(@location(0) pos: vec2f, @location(1) ex: vec2f) -> @builtin(position) vec4f {
  return clip(u.offset + pos * u.scale + ex * (u.width * 0.5));
}

@fragment fn fs_solid() -> @location(0) vec4f {
  return vec4f(u.color.rgb * u.color.a, u.color.a);
}

struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };

@vertex fn vs_tex(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VO {
  var o: VO;
  o.p = clip(u.offset + pos * u.scale);
  o.uv = uv;
  return o;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

@fragment fn fs_tex(i: VO) -> @location(0) vec4f {
  return textureSample(tex, samp, i.uv) * u.alpha;
}
`;

const UNIFORM_FLOATS = 12; // 48 bytes used per draw
const SAMPLES = 4;

interface GPUMesh { vb: GPUBuffer; ib: GPUBuffer | null; count: number; fpv: number }
interface GPUTex { texture: GPUTexture; group: GPUBindGroup }
type Cmd =
  | { k: 'solid'; mesh: number; u: number }
  | { k: 'line'; mesh: number; u: number }
  | { k: 'tex'; mesh: number; tex: number; u: number }
  | { k: 'qsolid'; first: number; u: number }
  | { k: 'qtex'; first: number; tex: number; u: number };

export class WebGPUBackend implements GfxBackend {
  readonly name = 'WebGPU' as const;
  private meshes: (GPUMesh | null)[] = [null];
  private textures: (GPUTex | null)[] = [null];
  private cmds: Cmd[] = [];
  private uniforms = new Float32Array(64 * 256);
  private quads = new Float32Array(24 * 256);
  private quadCount = 0;
  private uniformBuf!: GPUBuffer;
  private uniformGroup!: GPUBindGroup;
  private quadBuf!: GPUBuffer;
  private msaa: GPUTexture | null = null;
  private stride: number; // bytes between uniform blocks (device alignment)
  private clear = { r: 1, g: 1, b: 1, a: 1 };
  private w = 1;
  private h = 1;
  private pSolid2: GPURenderPipeline;
  private pSolid4: GPURenderPipeline;
  private pLine: GPURenderPipeline;
  private pTex: GPURenderPipeline;
  private uLayout: GPUBindGroupLayout;
  private tLayout: GPUBindGroupLayout;
  private sampler: GPUSampler;

  /** offscreen = debug/testing: draw into a texture instead of the canvas (see readPixels) */
  static async create(canvas: HTMLCanvasElement, offscreen = false): Promise<WebGPUBackend | null> {
    if (!('gpu' in navigator)) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      device.addEventListener('uncapturederror', (e) => console.error('[webgpu]', (e as GPUUncapturedErrorEvent).error.message));
      // if the GPU driver resets, reload once with the WebGL2 renderer
      device.lost.then((info) => {
        if (info.reason === 'destroyed') return;
        console.warn('WebGPU device lost, switching to WebGL2:', info.message);
        const url = new URL(location.href);
        if (url.searchParams.get('renderer') !== 'webgl') {
          url.searchParams.set('renderer', 'webgl');
          location.replace(url);
        }
      });
      if (offscreen) return new WebGPUBackend(device, null, 'rgba8unorm');
      const ctx = canvas.getContext('webgpu');
      if (!ctx) return null;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, alphaMode: 'opaque' });
      return new WebGPUBackend(device, ctx, format);
    } catch (e) {
      console.warn('WebGPU unavailable, falling back to WebGL2', e);
      return null;
    }
  }

  private offscreen: GPUTexture | null = null;

  private constructor(private device: GPUDevice, private ctx: GPUCanvasContext | null, private format: GPUTextureFormat) {
    const d = device;
    this.stride = Math.max(256, d.limits.minUniformBufferOffsetAlignment);
    const module = d.createShaderModule({ code: SHADER });

    this.uLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_FLOATS * 4 } }],
    });
    this.tLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const blend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const pipe = (vs: string, fs: string, stride: number, attrs: GPUVertexAttribute[], layouts: GPUBindGroupLayout[]) =>
      d.createRenderPipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: vs, buffers: [{ arrayStride: stride, attributes: attrs }] },
        fragment: { module, entryPoint: fs, targets: [{ format: this.format, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        multisample: { count: SAMPLES },
      });
    const pos: GPUVertexAttribute = { shaderLocation: 0, offset: 0, format: 'float32x2' };
    const second: GPUVertexAttribute = { shaderLocation: 1, offset: 8, format: 'float32x2' };
    this.pSolid2 = pipe('vs_solid', 'fs_solid', 8, [pos], [this.uLayout]);
    this.pSolid4 = pipe('vs_solid', 'fs_solid', 16, [pos], [this.uLayout]);
    this.pLine = pipe('vs_line', 'fs_solid', 16, [pos, second], [this.uLayout]);
    this.pTex = pipe('vs_tex', 'fs_tex', 16, [pos, second], [this.uLayout, this.tLayout]);

    this.allocUniforms(256);
    this.allocQuads(256);
  }

  private allocUniforms(draws: number) {
    this.uniformBuf?.destroy();
    this.uniformBuf = this.device.createBuffer({ size: draws * this.stride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniformGroup = this.device.createBindGroup({
      layout: this.uLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuf, size: UNIFORM_FLOATS * 4 } }],
    });
    const floats = (draws * this.stride) / 4;
    if (this.uniforms.length < floats) this.uniforms = new Float32Array(floats);
  }

  private allocQuads(n: number) {
    this.quadBuf?.destroy();
    this.quadBuf = this.device.createBuffer({ size: n * 96, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    if (this.quads.length < n * 24) this.quads = new Float32Array(n * 24);
  }

  // write one uniform block, returns its index
  private pushU(ox: number, oy: number, scale: number, r: number, g: number, b: number, a: number, width = 0, alpha = 1) {
    const i = this.cmds.length;
    const need = ((i + 1) * this.stride) / 4;
    if (this.uniforms.length < need) {
      const bigger = new Float32Array(need * 2);
      bigger.set(this.uniforms);
      this.uniforms = bigger;
    }
    const o = (i * this.stride) / 4;
    const U = this.uniforms;
    U[o] = ox; U[o + 1] = oy; U[o + 2] = this.w; U[o + 3] = this.h;
    U[o + 4] = r; U[o + 5] = g; U[o + 6] = b; U[o + 7] = a;
    U[o + 8] = scale; U[o + 9] = width; U[o + 10] = alpha; U[o + 11] = 0;
    return i;
  }

  private pushQuad(x: number, y: number, w: number, h: number) {
    const i = this.quadCount++;
    if (this.quads.length < this.quadCount * 24) {
      const bigger = new Float32Array(this.quadCount * 48);
      bigger.set(this.quads);
      this.quads = bigger;
    }
    this.quads.set([x, y, 0, 0, x + w, y, 1, 0, x, y + h, 0, 1, x + w, y, 1, 0, x + w, y + h, 1, 1, x, y + h, 0, 1], i * 24);
    return i * 6;
  }

  imports(memory: () => ArrayBuffer) {
    const d = this.device;
    return {
      mesh_create: (vp: number, nFloats: number, fpv: number, ip: number, nIdx: number) => {
        const vb = d.createBuffer({ size: Math.max(4, nFloats * 4), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(vb, 0, new Float32Array(memory(), vp, nFloats));
        let ib: GPUBuffer | null = null;
        if (nIdx > 0) {
          ib = d.createBuffer({ size: nIdx * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
          d.queue.writeBuffer(ib, 0, new Uint32Array(memory(), ip, nIdx));
        }
        this.meshes.push({ vb, ib, count: nIdx > 0 ? nIdx : nFloats / fpv, fpv });
        return this.meshes.length - 1;
      },
      mesh_delete: (id: number) => {
        const m = this.meshes[id];
        if (!m) return;
        // destroy after the GPU is done with the current frame
        d.queue.onSubmittedWorkDone().then(() => { m.vb.destroy(); m.ib?.destroy(); });
        this.meshes[id] = null;
      },
      tex_create: (p: number, w: number, h: number) => {
        const texture = d.createTexture({ size: [w, h], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        d.queue.writeTexture({ texture }, premultiply(new Uint8Array(memory(), p, w * h * 4)), { bytesPerRow: w * 4 }, [w, h]);
        const group = d.createBindGroup({ layout: this.tLayout,
          entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: texture.createView() }] });
        this.textures.push({ texture, group });
        return this.textures.length - 1;
      },
      tex_delete: (id: number) => {
        const t = this.textures[id];
        if (t) d.queue.onSubmittedWorkDone().then(() => t.texture.destroy());
        this.textures[id] = null;
      },
      begin: (w: number, h: number, r: number, g: number, b: number) => {
        this.w = w;
        this.h = h;
        this.clear = { r, g, b, a: 1 };
        this.cmds = [];
        this.quadCount = 0;
        if (!this.msaa || this.msaa.width !== w || this.msaa.height !== h) {
          this.msaa?.destroy();
          this.msaa = d.createTexture({ size: [w, h], sampleCount: SAMPLES, format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT });
          if (!this.ctx) {
            this.offscreen?.destroy();
            this.offscreen = d.createTexture({ size: [w, h], format: this.format,
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          }
        }
      },
      solid: (m: number, ox: number, oy: number, s: number, r: number, g: number, b: number, a: number) => {
        this.cmds.push({ k: 'solid', mesh: m, u: this.pushU(ox, oy, s, r, g, b, a) });
      },
      line: (m: number, ox: number, oy: number, s: number, w: number, r: number, g: number, b: number, a: number) => {
        this.cmds.push({ k: 'line', mesh: m, u: this.pushU(ox, oy, s, r, g, b, a, w) });
      },
      tex: (m: number, ox: number, oy: number, s: number, t: number, alpha: number) => {
        this.cmds.push({ k: 'tex', mesh: m, tex: t, u: this.pushU(ox, oy, s, 0, 0, 0, 0, 0, alpha) });
      },
      quad_solid: (x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number) => {
        const u = this.pushU(0, 0, 1, r, g, b, a);
        this.cmds.push({ k: 'qsolid', first: this.pushQuad(x, y, w, h), u });
      },
      quad_tex: (t: number, x: number, y: number, w: number, h: number, alpha: number) => {
        const u = this.pushU(0, 0, 1, 0, 0, 0, 0, 0, alpha);
        this.cmds.push({ k: 'qtex', first: this.pushQuad(x, y, w, h), tex: t, u });
      },
      end: () => this.submit(),
    };
  }

  private submit() {
    const d = this.device;
    const n = this.cmds.length;
    if (n * this.stride > this.uniformBuf.size) this.allocUniforms(Math.ceil(n * 1.5));
    if (n) d.queue.writeBuffer(this.uniformBuf, 0, this.uniforms, 0, (n * this.stride) / 4);
    if (this.quadCount * 96 > this.quadBuf.size) this.allocQuads(Math.ceil(this.quadCount * 1.5));
    if (this.quadCount) d.queue.writeBuffer(this.quadBuf, 0, this.quads, 0, this.quadCount * 24);

    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.msaa!.createView(),
        resolveTarget: this.ctx ? this.ctx.getCurrentTexture().createView() : this.offscreen!.createView(),
        clearValue: this.clear,
        loadOp: 'clear',
        storeOp: 'discard',
      }],
    });
    let current: GPURenderPipeline | null = null;
    const setPipe = (p: GPURenderPipeline) => { if (p !== current) { pass.setPipeline(p); current = p; } };

    for (const c of this.cmds) {
      if (c.k === 'qsolid' || c.k === 'qtex') {
        if (c.k === 'qtex') {
          const t = this.textures[c.tex];
          if (!t) continue;
          setPipe(this.pTex);
          pass.setBindGroup(1, t.group);
        } else {
          setPipe(this.pSolid4);
        }
        pass.setBindGroup(0, this.uniformGroup, [c.u * this.stride]);
        pass.setVertexBuffer(0, this.quadBuf);
        pass.draw(6, 1, c.first);
        continue;
      }
      const m = this.meshes[c.mesh];
      if (!m) continue;
      if (c.k === 'solid') setPipe(m.fpv === 2 ? this.pSolid2 : this.pSolid4);
      else if (c.k === 'line') setPipe(this.pLine);
      else {
        const t = this.textures[c.tex];
        if (!t) continue;
        setPipe(this.pTex);
        pass.setBindGroup(1, t.group);
      }
      pass.setBindGroup(0, this.uniformGroup, [c.u * this.stride]);
      pass.setVertexBuffer(0, m.vb);
      if (m.ib) {
        pass.setIndexBuffer(m.ib, 'uint32');
        pass.drawIndexed(m.count);
      } else {
        pass.draw(m.count);
      }
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** debug/testing: read back the last frame when created with offscreen = true */
  async readPixels(): Promise<{ w: number; h: number; data: Uint8Array } | null> {
    if (!this.offscreen) return null;
    const { width: w, height: h } = this.offscreen;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.offscreen }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap();
    buf.destroy();
    return { w, h, data };
  }
}
