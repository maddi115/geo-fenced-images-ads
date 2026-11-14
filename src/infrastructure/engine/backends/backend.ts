// A GPU backend executes the drawing commands the C++ engine sends (engine/src/gfx.hpp).
export interface GfxBackend {
  readonly name: 'WebGPU' | 'WebGL2';
  /** graphics card description, for the stats */
  readonly gpu: string;
  /** functions imported by the C++ engine under the "gfx" module */
  imports(memory: () => ArrayBuffer): Record<string, (...args: number[]) => number | void>;
}

/** RGBA8 straight alpha -> premultiplied alpha (what both backends blend with) */
export function premultiply(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    out[i] = (src[i] * a + 127) / 255;
    out[i + 1] = (src[i + 1] * a + 127) / 255;
    out[i + 2] = (src[i + 2] * a + 127) / 255;
    out[i + 3] = a;
  }
  return out;
}
