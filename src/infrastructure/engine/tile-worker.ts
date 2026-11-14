// Background thread: downloads a vector tile, then runs the C++ engine's tile builder
// (decode + triangulate) on it, and sends the finished geometry back to the main thread.
// Uses the same engine.wasm as the map, so all the tile logic stays in C++.

type Ex = {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  engine_alloc: (n: number) => number;
  engine_free: (p: number) => void;
  worker_build_tile: (ptr: number, len: number) => number;
};

let ex: Ex | null = null;

const noop = () => 0;
const stubs = new Proxy({}, { get: () => noop });

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const instance = await WebAssembly.instantiate(msg.module as WebAssembly.Module, {
      gfx: stubs,
      env: { request_tile: noop, on_hover: noop, log: noop, now_ms: () => performance.now() },
      wasi_snapshot_preview1: stubs,
    });
    ex = instance.exports as unknown as Ex;
    ex._initialize();
    (self as any).postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'tile') {
    const { z, x, y, url } = msg;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
        buf = new Uint8Array(await ds.arrayBuffer());
      }
      const t0 = performance.now();
      const e2 = ex!;
      const ptr = e2.engine_alloc(buf.length);
      new Uint8Array(e2.memory.buffer, ptr, buf.length).set(buf);
      const out = e2.worker_build_tile(ptr, buf.length);
      e2.engine_free(ptr);
      const size = new Uint32Array(e2.memory.buffer, out, 1)[0];
      const blob = new Uint8Array(e2.memory.buffer, out, size).slice(); // copy out of wasm memory
      const ms = performance.now() - t0;
      (self as any).postMessage({ type: 'tile', z, x, y, blob, ms }, [blob.buffer]);
    } catch {
      (self as any).postMessage({ type: 'fail', z, x, y });
    }
  }
};
