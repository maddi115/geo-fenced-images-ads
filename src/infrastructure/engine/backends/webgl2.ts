import { premultiply, type GfxBackend } from './backend';

// Fallback renderer for browsers without WebGPU.

const VS_SOLID = `#version 300 es
layout(location=0) in vec2 a_pos;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view;
void main() {
  vec2 px = u_offset + a_pos * u_scale;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
}`;

const VS_LINE = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_extrude;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view; uniform float u_width;
void main() {
  vec2 px = u_offset + a_pos * u_scale + a_extrude * (u_width * 0.5);
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
}`;

const FS_SOLID = `#version 300 es
precision mediump float;
uniform vec4 u_color; out vec4 o;
void main() { o = vec4(u_color.rgb * u_color.a, u_color.a); }`;

const VS_TEX = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 px = u_offset + a_pos * u_scale;
  v_uv = a_uv;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
}`;

const FS_TEX = `#version 300 es
precision mediump float;
uniform sampler2D u_tex; uniform float u_alpha;
in vec2 v_uv; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`;

interface Prog {
  p: WebGLProgram;
  offset: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  width: WebGLUniformLocation | null;
  tex: WebGLUniformLocation | null;
  alpha: WebGLUniformLocation | null;
}

interface GLMesh { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number; indexed: boolean }

export class WebGL2Backend implements GfxBackend {
  readonly name = 'WebGL2' as const;
  private gl: WebGL2RenderingContext;
  private solid: Prog;
  private line: Prog;
  private texP: Prog;
  private meshes: (GLMesh | null)[] = [null];
  private textures: (WebGLTexture | null)[] = [null];
  private quadVao: WebGLVertexArrayObject;
  private quadVbo: WebGLBuffer;
  private w = 1;
  private h = 1;

  static create(canvas: HTMLCanvasElement): WebGL2Backend | null {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: false });
    return gl ? new WebGL2Backend(gl) : null;
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.solid = this.program(VS_SOLID, FS_SOLID);
    this.line = this.program(VS_LINE, FS_SOLID);
    this.texP = this.program(VS_TEX, FS_TEX);
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  private program(vs: string, fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    const U = (n: string) => gl.getUniformLocation(p, n);
    return { p, offset: U('u_offset'), scale: U('u_scale'), view: U('u_view'), color: U('u_color'),
      width: U('u_width'), tex: U('u_tex'), alpha: U('u_alpha') };
  }

  private use(pr: Prog, ox: number, oy: number, scale: number) {
    const gl = this.gl;
    gl.useProgram(pr.p);
    gl.uniform2f(pr.offset, ox, oy);
    gl.uniform1f(pr.scale, scale);
    gl.uniform2f(pr.view, this.w, this.h);
  }

  private drawMesh(id: number) {
    const m = this.meshes[id];
    if (!m) return;
    const gl = this.gl;
    gl.bindVertexArray(m.vao);
    if (m.indexed) gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  private quad(x: number, y: number, w: number, h: number) {
    const gl = this.gl;
    const q = new Float32Array([x, y, 0, 0, x + w, y, 1, 0, x, y + h, 0, 1, x + w, y, 1, 0, x + w, y + h, 1, 1, x, y + h, 0, 1]);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  imports(memory: () => ArrayBuffer) {
    const gl = this.gl;
    return {
      mesh_create: (vp: number, nFloats: number, fpv: number, ip: number, nIdx: number) => {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(memory(), vp, nFloats), gl.STATIC_DRAW);
        const stride = fpv * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
        if (fpv === 4) {
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
        }
        const buffers = [vbo];
        let count = nFloats / fpv;
        const indexed = nIdx > 0;
        if (indexed) {
          const ibo = gl.createBuffer()!;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(memory(), ip, nIdx), gl.STATIC_DRAW);
          buffers.push(ibo);
          count = nIdx;
        }
        gl.bindVertexArray(null);
        this.meshes.push({ vao, buffers, count, indexed });
        return this.meshes.length - 1;
      },
      mesh_delete: (id: number) => {
        const m = this.meshes[id];
        if (!m) return;
        gl.deleteVertexArray(m.vao);
        m.buffers.forEach((b) => gl.deleteBuffer(b));
        this.meshes[id] = null;
      },
      tex_create: (p: number, w: number, h: number) => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          premultiply(new Uint8Array(memory(), p, w * h * 4)));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.textures.push(t);
        return this.textures.length - 1;
      },
      tex_delete: (id: number) => {
        const t = this.textures[id];
        if (t) gl.deleteTexture(t);
        this.textures[id] = null;
      },
      begin: (w: number, h: number, r: number, g: number, b: number) => {
        this.w = w;
        this.h = h;
        gl.viewport(0, 0, w, h);
        gl.clearColor(r, g, b, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      },
      solid: (m: number, ox: number, oy: number, s: number, r: number, g: number, b: number, a: number) => {
        this.use(this.solid, ox, oy, s);
        gl.uniform4f(this.solid.color, r, g, b, a);
        this.drawMesh(m);
      },
      line: (m: number, ox: number, oy: number, s: number, w: number, r: number, g: number, b: number, a: number) => {
        this.use(this.line, ox, oy, s);
        gl.uniform1f(this.line.width, w);
        gl.uniform4f(this.line.color, r, g, b, a);
        this.drawMesh(m);
      },
      tex: (m: number, ox: number, oy: number, s: number, t: number, alpha: number) => {
        this.use(this.texP, ox, oy, s);
        gl.uniform1f(this.texP.alpha, alpha);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[t]);
        gl.uniform1i(this.texP.tex, 0);
        this.drawMesh(m);
      },
      quad_solid: (x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number) => {
        this.use(this.solid, 0, 0, 1);
        gl.uniform4f(this.solid.color, r, g, b, a);
        this.quad(x, y, w, h);
      },
      quad_tex: (t: number, x: number, y: number, w: number, h: number, alpha: number) => {
        this.use(this.texP, 0, 0, 1);
        gl.uniform1f(this.texP.alpha, alpha);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[t]);
        gl.uniform1i(this.texP.tex, 0);
        this.quad(x, y, w, h);
      },
      end: () => {},
    };
  }
}
