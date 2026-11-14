# Geofence Studio — C++ / WebAssembly map

A map where people post on real places:

| Post type | Price | What it is |
|---|---|---|
| Red pixel | Free | A red pixel + a comment |
| Custom icon | $3 (test mode) | Your uploaded image at 225px + a comment |
| Zone image | $5 (test mode) | Your image filling an area you draw + a comment |

The map engine is written from scratch in **C++ compiled to WebAssembly**, drawing with
**WebGPU** (WebGL2 fallback). There is no Leaflet, no MapLibre, and no Google Maps code.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

On your phone (https is needed for location):

```bash
~/cloudflared tunnel --url http://localhost:3000   # open the https://…trycloudflare.com link
```

Rebuild the C++ engine after changing `engine/src/*` (first run downloads wasi-sdk, ~110 MB):

```bash
./engine/build.sh      # -> public/engine.wasm
```

Force the WebGL2 renderer to compare: `http://localhost:3000/?renderer=webgl`

---

## What is C++ (WebAssembly) and what is not

### In C++ → `public/engine.wasm` (~170 KB, `engine/src/`)

| Area | What it does |
|---|---|
| **Camera** | Pan, smooth wheel zoom toward the cursor, pinch zoom, double-tap zoom, **fling momentum** (keeps gliding after a flick), smooth fly-to |
| **Vector tiles** | Decodes Mapbox Vector Tiles (protobuf, OpenMapTiles schema), triangulates polygons (earcut), builds road lines |
| **Tile cache** | Picks the tiles on screen, shows a blurry parent tile while sharper ones load, reuses z14 tiles past zoom 14, frees old tiles |
| **Base map style** | Water, parks, land use, buildings, roads with casings (motorway → path), railways |
| **Posts** | Red pixels, 225px icons (scale with zoom), zone images cut to the zone shape, comment bubbles, the draft preview, zone drawing preview |
| **Hover / tap** | Hit-testing for pixels, icons and zones; the zoom/hover visibility rule; **focus mode** (other posts fade, the post becomes a dot, card slides to it) |
| **Cross streets** | Reads street names from tiles, finds the nearest intersection of two differently named streets, abbreviates like Google Maps (`South Figueroa Street` → `S Figueroa St`) |
| **My location** | Blue dot + accuracy circle, **draggable within a limit** (150 m–3 km) because desktop locations are rough |
| **Render decisions** | What to draw, where, in what order, every frame — and **skipping the frame entirely when nothing changed** |
| **Background tile building** | The same `engine.wasm` runs inside Web Workers to decode + triangulate tiles off the main thread |

### Not C++ (and why)

| Part | Where | Why it isn't C++ |
|---|---|---|
| GPU calls | `src/infrastructure/engine/backends/webgpu.ts`, `webgl2.ts` | Browsers only expose the GPU (WebGPU/WebGL) to JavaScript. These files only **execute** C++'s draw commands. |
| Downloading tiles | `engine.ts`, `tile-worker.ts` | Network access (`fetch`) is JavaScript-only. Workers download, then hand bytes to C++. |
| Images & text → pixels | `engine.ts`, `src/infrastructure/images/` | Uses the browser's image decoder, fonts (Inter) and canvas to make textures; C++ gets raw RGBA. |
| JPEG XL | `src/infrastructure/images/jxl.ts` | Uploads are compressed to `.jxl` with libjxl (WebAssembly, but not our C++). Decoding uses the browser's JXL support when present, otherwise libjxl WASM. |
| GPS | `src/infrastructure/geo/my-location.ts` | `navigator.geolocation` is JavaScript-only. C++ draws the dot. |
| Panel / buttons / location picker | `src/ui-new/` (SolidJS) | Forms, inputs and buttons are HTML. |
| Saving posts | `src/infrastructure/storage/local-posts.ts` | `localStorage` (this browser only — no server yet). |
| Payments | `src/infrastructure/payments/checkout.ts` | **TEST MODE** screen, no real charge. Stripe goes here. |
| Stats | `stats-reporter.ts`, `vite.config.js` | Dev-only: prints `[map stats]` lines in the `npm run dev` terminal. |

### How the pieces talk

```
 mouse / touch ──► JS ──► C++ camera + hit-testing
 tile bytes ─────► Worker (C++ decode + triangulate) ──► C++ uploads to GPU
 C++ every frame ──► draw commands (gfx_solid / gfx_line / gfx_tex / quads)
                      └─► WebGPU backend (one render pass, 4x MSAA)
                          or WebGL2 backend (fallback)
```

---

## How fast is it

Measured while zooming/panning continuously:

| Test | Renderer | FPS | Time per frame | Share of a 60 fps frame |
|---|---|---|---|---|
| Headless Chrome, **software GPU** (no graphics card) | WebGPU | 60 | 0.13 ms | ~1% |
| Headless Chrome, software GPU | WebGL2 | 47–60 | 0.1–0.6 ms | 1–4% |
| Tile decode + triangulate (in a worker) | — | — | 0.2–1 ms per tile | off the main thread |

On a real phone it felt smoother than the Google Maps app (no numbers recorded).

To get your own numbers: run `npm run dev`, zoom around, and copy the `[map stats …]` and
`SUMMARY` lines from that terminal.

### Why it's fast

1. **No work when nothing moves.** C++ only redraws when something changed (camera, posts,
   hover, a tile arriving). Idle = zero GPU work, which also saves battery.
2. **Each frame is tiny.** ~0.1–1 ms of a 16.7 ms budget, so 60 fps has lots of headroom.
3. **Heavy work is off the main thread.** Tiles are decoded and triangulated in background
   workers running the same C++.
4. **Geometry is built once.** Tiles become GPU meshes once; each frame only changes a few
   numbers (position + scale) per draw.
5. **One engine, no layers.** The old version ran Leaflet wrapping MapLibre plus HTML markers.
6. **WebGPU batching.** All draws of a frame go to the GPU in one render pass with one
   uniform upload.

### Honest limits

- The map draws less than Google Maps: **no street names on the map**, no shop icons, 3D,
  traffic or satellite. Cross streets show on post cards instead.
- Posts are saved **in this browser only** until there is a server.
- Payments are **test mode**.

---

## Project layout

```
engine/
  src/engine.cpp      C++ engine (camera, tiles, posts, hover, cross streets, location)
  src/mvt.hpp         vector tile (protobuf) decoder
  src/gfx.hpp         draw commands C++ sends to the GPU backend
  third_party/        earcut (polygon triangulation)
  build.sh            builds public/engine.wasm with wasi-sdk
public/engine.wasm    compiled engine (committed, so npm run dev works without building)
src/infrastructure/engine/
  engine.ts           bridge: GPU backend, workers, textures, input
  tile-worker.ts      background tile building
  backends/           webgpu.ts, webgl2.ts
src/ui-new/           panel, location picker, map screen (SolidJS)
src/use-cases/posts/  post types, saving, drafts
```

Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
[OpenMapTiles](https://www.openmaptiles.org/), tiles by [OpenFreeMap](https://openfreemap.org).
