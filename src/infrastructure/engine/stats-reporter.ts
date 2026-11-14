import type { EngineStats } from './engine';

// DEV ONLY: sends the engine stats to the `npm run dev` terminal (see vite.config.js)
// so they can be copied. While the map moves: one line every 2 seconds.
// When it stops: one summary line for that movement.

let moving = false;
let movingSince = 0;
let lastLine = 0;
let samples: EngineStats[] = [];

function send(text: string) {
  fetch('/__engine-stats', { method: 'POST', body: text }).catch(() => {});
}

const f = (n: number, d = 1) => n.toFixed(d);

function line(s: EngineStats) {
  return `${s.backend} (${s.gpu}) · ${f(s.fps, 0)} fps · ${f(s.frameMs, 2)} ms/frame ` +
    `(${f(s.budgetPct)}% of budget, worst ${f(s.maxFrameMs, 2)} ms) · tiles ${s.tiles} · ` +
    `build ${f(s.tileBuildMs)} ms · ${s.workers} workers · ${s.screen}`;
}

export function reportStats(s: EngineStats) {
  if (!import.meta.env.DEV) return;
  const now = performance.now();
  if (s.moving) {
    if (!moving) {
      moving = true;
      movingSince = now;
      samples = [];
    }
    samples.push(s);
    if (now - lastLine >= 2000) {
      lastLine = now;
      send(line(s));
    }
  } else if (moving) {
    moving = false;
    // the first and last half-second windows are only partly moving, so leave them out of fps
    const full = samples.length > 2 ? samples.slice(1, -1) : samples;
    const n = full.length || 1;
    const avgFps = full.reduce((a, x) => a + x.fps, 0) / n;
    const minFps = Math.min(...full.map((x) => x.fps));
    const avgMs = samples.reduce((a, x) => a + x.frameMs, 0) / (samples.length || 1);
    const worst = Math.max(...samples.map((x) => x.maxFrameMs));
    const last = samples[samples.length - 1] ?? s;
    send(
      `SUMMARY moved ${f((now - movingSince) / 1000)} s · avg ${f(avgFps)} fps · min ${f(minFps, 0)} fps · ` +
        `avg ${f(avgMs, 2)} ms/frame · worst frame ${f(worst, 2)} ms · ${last.backend} (${last.gpu}) · ${last.screen}`
    );
  }
}
