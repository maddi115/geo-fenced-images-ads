// Geofence map engine — C++ compiled to WebAssembly.
//
// Does all the map work:
//   * camera (pan, smooth zoom, pinch) and screen <-> lng/lat math
//   * vector tile decoding (OpenMapTiles schema) and triangulation
//   * tile cache with parent-tile fallback and overzoom past z14
//   * GPU rendering of the base map (water, parks, land use, buildings, roads)
//   * GPU rendering of posts: red pixels, 225px icons, zone images, comment bubbles
//   * zone hover hit-testing and the zoom/hover visibility rule
//
// JavaScript only executes draw commands (WebGPU or WebGL2), downloads tiles in
// background workers, and decodes images.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "gfx.hpp"
#include "mvt.hpp"
#include "../third_party/mapbox/earcut.hpp"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr int TILE_PX = 512;  // CSS pixels per tile
constexpr int MAX_TILE_Z = 14; // OpenMapTiles max zoom; deeper zooms reuse z14 tiles
constexpr double MIN_ZOOM = 2.0, MAX_ZOOM = 19.0;
constexpr size_t TILE_CACHE_LIMIT = 400;

void log(const std::string& s) { js_log(s.data(), int(s.size())); }

// ---------------------------------------------------------------- math
struct Merc { double x, y; };

Merc toMerc(double lng, double lat) {
  lat = std::max(-85.05112878, std::min(85.05112878, lat));
  double s = std::sin(lat * PI / 180.0);
  return {(lng + 180.0) / 360.0, 0.5 - std::log((1 + s) / (1 - s)) / (4 * PI)};
}
void fromMerc(Merc m, double& lng, double& lat) {
  lng = m.x * 360.0 - 180.0;
  double n = PI - 2.0 * PI * m.y;
  lat = 180.0 / PI * std::atan(0.5 * (std::exp(n) - std::exp(-n)));
}

struct RGBA { float r, g, b, a; };
RGBA hex(uint32_t c, float a = 1) {
  return {((c >> 16) & 255) / 255.f, ((c >> 8) & 255) / 255.f, (c & 255) / 255.f, a};
}

// ---------------------------------------------------------------- style
enum Kind { FILL, LINE };
struct Style {
  Kind kind;
  RGBA color;
  RGBA casing;     // a == 0 -> no casing
  float width;     // CSS px at z14 (lines)
  float minZoom;
};

enum BucketId {
  B_LANDUSE_RES, B_LANDUSE_OTHER, B_LANDCOVER_WOOD, B_LANDCOVER_GRASS, B_LANDCOVER_OTHER, B_PARK,
  B_WATER, B_WATERWAY, B_BUILDING,
  B_ROAD_PATH, B_ROAD_MINOR, B_ROAD_SECONDARY, B_ROAD_PRIMARY, B_ROAD_MOTORWAY, B_RAIL,
  B_COUNT
};

const Style STYLES[B_COUNT] = {
  /* LANDUSE_RES    */ {FILL, hex(0xebe6df), {}, 0, 0},
  /* LANDUSE_OTHER  */ {FILL, hex(0xe9e2dc), {}, 0, 0},
  /* LANDCOVER_WOOD */ {FILL, hex(0xcfe3c2), {}, 0, 0},
  /* LANDCOVER_GRASS*/ {FILL, hex(0xdde8c4), {}, 0, 0},
  /* LANDCOVER_OTHER*/ {FILL, hex(0xe8e4d0), {}, 0, 0},
  /* PARK           */ {FILL, hex(0xc8e6b4), {}, 0, 0},
  /* WATER          */ {FILL, hex(0xa6cbe8), {}, 0, 0},
  /* WATERWAY       */ {LINE, hex(0xa6cbe8), {}, 1.5f, 8},
  /* BUILDING       */ {FILL, hex(0xdcd3cb), {}, 0, 13},
  /* ROAD_PATH      */ {LINE, hex(0xffffff), {}, 1.0f, 14},
  /* ROAD_MINOR     */ {LINE, hex(0xffffff), hex(0xd8d0c6), 3.0f, 12},
  /* ROAD_SECONDARY */ {LINE, hex(0xffffff), hex(0xcdc3b6), 5.0f, 8},
  /* ROAD_PRIMARY   */ {LINE, hex(0xfde6a0), hex(0xd6b56b), 6.0f, 6},
  /* ROAD_MOTORWAY  */ {LINE, hex(0xf6b66b), hex(0xd08c3a), 7.0f, 4},
  /* RAIL           */ {LINE, hex(0xbdbdbd), {}, 1.2f, 10},
};

const BucketId FILL_ORDER[] = {B_LANDUSE_RES, B_LANDUSE_OTHER, B_LANDCOVER_OTHER, B_LANDCOVER_GRASS,
                               B_LANDCOVER_WOOD, B_PARK, B_WATER, B_BUILDING};
const BucketId LINE_ORDER[] = {B_WATERWAY, B_RAIL, B_ROAD_PATH, B_ROAD_MINOR, B_ROAD_SECONDARY,
                               B_ROAD_PRIMARY, B_ROAD_MOTORWAY};

int bucketFor(const mvt::Layer& l, const mvt::Feature& f) {
  const std::string& n = l.name;
  if (n == "water" && f.type == mvt::POLYGON) return B_WATER;
  if (n == "waterway" && f.type == mvt::LINESTRING) return B_WATERWAY;
  if (n == "park" && f.type == mvt::POLYGON) return B_PARK;
  if (n == "building" && f.type == mvt::POLYGON) return B_BUILDING;
  if (n == "landcover" && f.type == mvt::POLYGON) {
    auto c = l.get(f, "class");
    if (c == "wood" || c == "forest") return B_LANDCOVER_WOOD;
    if (c == "grass" || c == "farmland") return B_LANDCOVER_GRASS;
    return B_LANDCOVER_OTHER;
  }
  if (n == "landuse" && f.type == mvt::POLYGON) {
    auto c = l.get(f, "class");
    if (c == "residential" || c == "suburb" || c == "neighbourhood") return B_LANDUSE_RES;
    if (c == "commercial" || c == "retail" || c == "industrial" || c == "school" || c == "hospital" ||
        c == "cemetery" || c == "university" || c == "stadium" || c == "pitch")
      return B_LANDUSE_OTHER;
    return -1;
  }
  if (n == "transportation" && f.type == mvt::LINESTRING) {
    auto c = l.get(f, "class");
    if (c == "motorway") return B_ROAD_MOTORWAY;
    if (c == "trunk" || c == "primary") return B_ROAD_PRIMARY;
    if (c == "secondary" || c == "tertiary") return B_ROAD_SECONDARY;
    if (c == "minor" || c == "service" || c == "street" || c == "residential") return B_ROAD_MINOR;
    if (c == "path" || c == "track" || c == "footway" || c == "cycleway") return B_ROAD_PATH;
    if (c == "rail" || c == "transit") return B_RAIL;
    return -1;
  }
  return -1;
}

// ---------------------------------------------------------------- GPU meshes
struct Mesh {
  int id = 0;
  void destroy() { if (id) gfx_mesh_delete(id); id = 0; }
};

// floats per vertex: 2 (pos) or 4 (pos + extrude/uv)
Mesh upload(const std::vector<float>& verts, int floatsPerVertex, const std::vector<uint32_t>* indices) {
  Mesh m;
  if (verts.empty()) return m;
  m.id = gfx_mesh_create(verts.data(), int(verts.size()), floatsPerVertex,
                         indices ? indices->data() : nullptr, indices ? int(indices->size()) : 0);
  return m;
}

// Lines become thin triangles with square caps; the width is applied in the shader,
// so lines keep a constant pixel width at every zoom.
template <typename P>
void buildLine(const std::vector<P>& pts, std::vector<float>& out, bool closed) {
  size_t n = pts.size();
  if (n < 2) return;
  size_t segs = closed ? n : n - 1;
  for (size_t i = 0; i < segs; i++) {
    double ax = pts[i].x, ay = pts[i].y;
    double bx = pts[(i + 1) % n].x, by = pts[(i + 1) % n].y;
    double dx = bx - ax, dy = by - ay;
    double len = std::sqrt(dx * dx + dy * dy);
    if (len == 0) continue;
    float tx = float(dx / len), ty = float(dy / len);
    float nx = -ty, ny = tx;
    // extrude = +-normal, with the ends pushed out along the line (square caps hide gaps at joins)
    float v[6][4] = {
      {float(ax), float(ay), nx - tx, ny - ty}, {float(ax), float(ay), -nx - tx, -ny - ty},
      {float(bx), float(by), nx + tx, ny + ty}, {float(ax), float(ay), -nx - tx, -ny - ty},
      {float(bx), float(by), -nx + tx, -ny + ty}, {float(bx), float(by), nx + tx, ny + ty},
    };
    for (auto& vv : v) out.insert(out.end(), vv, vv + 4);
  }
}

using EPoint = std::array<double, 2>;

// Triangulate rings (first ring sets the "outer" winding; opposite winding = hole)
template <typename RingT, typename GetXY>
void buildFill(const std::vector<RingT>& rings, GetXY xy, std::vector<float>& verts, std::vector<uint32_t>& idx) {
  std::vector<std::vector<EPoint>> poly;
  double outerSign = 0;
  auto flush = [&]() {
    if (poly.empty()) return;
    std::vector<uint32_t> tri = mapbox::earcut<uint32_t>(poly);
    uint32_t base = uint32_t(verts.size() / 2);
    for (auto& ring : poly)
      for (auto& p : ring) { verts.push_back(float(p[0])); verts.push_back(float(p[1])); }
    for (uint32_t t : tri) idx.push_back(base + t);
    poly.clear();
  };
  for (const auto& ring : rings) {
    if (ring.size() < 3) continue;
    std::vector<EPoint> r;
    r.reserve(ring.size());
    double area = 0;
    for (size_t i = 0, j = ring.size() - 1; i < ring.size(); j = i++) {
      auto [x1, y1] = xy(ring[j]);
      auto [x2, y2] = xy(ring[i]);
      area += x1 * y2 - x2 * y1;
    }
    for (const auto& p : ring) { auto [x, y] = xy(p); r.push_back({x, y}); }
    double sign = area > 0 ? 1 : -1;
    if (outerSign == 0) outerSign = sign;
    if (sign == outerSign) { flush(); poly.push_back(std::move(r)); }
    else if (!poly.empty()) poly.push_back(std::move(r)); // hole
  }
  flush();
}

// ---------------------------------------------------------------- tiles
struct TileKey {
  int z, x, y;
  bool operator==(const TileKey& o) const { return z == o.z && x == o.x && y == o.y; }
};
struct TileKeyHash {
  size_t operator()(const TileKey& k) const {
    uint64_t h = (uint64_t(k.z) << 50) ^ (uint64_t(k.x) << 25) ^ uint64_t(k.y);
    return size_t(h ^ (h >> 32));
  }
};

enum TileState { LOADING, READY, FAILED };
struct NamedLine {               // a named street, in tile coordinates (for cross streets)
  std::string name;
  std::vector<std::pair<float, float>> pts;
};
struct Tile {
  TileState state = LOADING;
  uint32_t extent = 4096;
  Mesh buckets[B_COUNT];
  std::vector<NamedLine> names;
  double lastUsed = 0;
};

std::unordered_map<TileKey, Tile, TileKeyHash> tiles;

// Decode + triangulate one tile into a compact binary blob.
// This runs inside a background Web Worker (its own copy of this engine), so the
// main thread never stalls on big city tiles.
// blob: u32 totalBytes, u32 extent, then per bucket: u32 nFloats, u32 nIdx, f32[nFloats], u32[nIdx]
//       then street names: u32 nLines, per line: u32 nameLen, name bytes (padded to 4), u32 nPts, f32 x,y...
std::vector<uint8_t> buildTileBlob(const uint8_t* data, size_t len) {
  std::vector<mvt::Layer> layers = mvt::readTile(data, len);
  std::vector<float> verts[B_COUNT];
  std::vector<uint32_t> idx[B_COUNT];
  std::vector<NamedLine> names;
  uint32_t extent = 4096;
  for (const auto& l : layers) {
    extent = l.extent ? l.extent : 4096;
    if (l.name == "transportation_name") {
      for (const auto& f : l.features) {
        if (f.type != mvt::LINESTRING) continue;
        std::string_view n = l.get(f, "name");
        if (n.empty()) n = l.get(f, "name_en");
        if (n.empty()) continue;
        for (auto& r : mvt::decodeGeometry(f)) {
          if (r.size() < 2) continue;
          NamedLine nl{std::string(n), {}};
          for (auto& pt : r) nl.pts.push_back({float(pt.x), float(pt.y)});
          names.push_back(std::move(nl));
        }
      }
      continue;
    }
    for (const auto& f : l.features) {
      int b = bucketFor(l, f);
      if (b < 0) continue;
      auto rings = mvt::decodeGeometry(f);
      if (STYLES[b].kind == FILL) {
        buildFill(rings, [](const mvt::Point& p) { return std::pair<double, double>(p.x, p.y); }, verts[b], idx[b]);
      } else {
        for (auto& r : rings) buildLine(r, verts[b], false);
      }
    }
  }
  auto pad4 = [](size_t n) { return (n + 3) & ~size_t(3); };
  size_t total = 8;
  for (int b = 0; b < B_COUNT; b++) total += 8 + verts[b].size() * 4 + idx[b].size() * 4;
  total += 4;
  for (auto& nl : names) total += 8 + pad4(nl.name.size()) + nl.pts.size() * 8;
  std::vector<uint8_t> out(total);
  uint8_t* w = out.data();
  auto put32 = [&](uint32_t v) { std::memcpy(w, &v, 4); w += 4; };
  put32(uint32_t(total));
  put32(extent);
  for (int b = 0; b < B_COUNT; b++) {
    put32(uint32_t(verts[b].size()));
    put32(uint32_t(idx[b].size()));
    std::memcpy(w, verts[b].data(), verts[b].size() * 4); w += verts[b].size() * 4;
    std::memcpy(w, idx[b].data(), idx[b].size() * 4); w += idx[b].size() * 4;
  }
  put32(uint32_t(names.size()));
  for (auto& nl : names) {
    put32(uint32_t(nl.name.size()));
    std::memcpy(w, nl.name.data(), nl.name.size());
    w += pad4(nl.name.size());
    put32(uint32_t(nl.pts.size()));
    for (auto& pt : nl.pts) { std::memcpy(w, &pt.first, 4); std::memcpy(w + 4, &pt.second, 4); w += 8; }
  }
  return out;
}

void uploadTileBlob(Tile& t, const uint8_t* blob, size_t len) {
  if (len < 8) { t.state = FAILED; return; }
  const uint8_t* r = blob;
  const uint8_t* end = blob + len;
  auto get32 = [&]() { uint32_t v = 0; if (r + 4 <= end) std::memcpy(&v, r, 4); r += 4; return v; };
  get32(); // total
  t.extent = get32();
  for (int b = 0; b < B_COUNT && r < end; b++) {
    uint32_t nf = get32(), ni = get32();
    if (r + size_t(nf) * 4 + size_t(ni) * 4 > end) break;
    const float* v = reinterpret_cast<const float*>(r);
    r += size_t(nf) * 4;
    const uint32_t* ix = reinterpret_cast<const uint32_t*>(r);
    r += size_t(ni) * 4;
    if (!nf) continue;
    int fpv = STYLES[b].kind == FILL ? 2 : 4;
    t.buckets[b].id = gfx_mesh_create(v, int(nf), fpv, ni ? ix : nullptr, int(ni));
  }
  // street names
  uint32_t nLines = r + 4 <= end ? get32() : 0;
  for (uint32_t i = 0; i < nLines && r < end; i++) {
    uint32_t nl = get32();
    if (r + nl > end) break;
    NamedLine line{std::string(reinterpret_cast<const char*>(r), nl), {}};
    r += (nl + 3) & ~3u;
    uint32_t np = get32();
    if (r + size_t(np) * 8 > end) break;
    for (uint32_t k = 0; k < np; k++) {
      float x, y;
      std::memcpy(&x, r, 4); std::memcpy(&y, r + 4, 4); r += 8;
      line.pts.push_back({x, y});
    }
    t.names.push_back(std::move(line));
  }
  t.state = READY;
}

void evictTiles(double now) {
  if (tiles.size() <= TILE_CACHE_LIMIT) return;
  std::vector<std::pair<double, TileKey>> order;
  for (auto& [k, t] : tiles) if (t.state != LOADING) order.push_back({t.lastUsed, k});
  std::sort(order.begin(), order.end(), [](auto& a, auto& b) { return a.first < b.first; });
  size_t remove = tiles.size() - TILE_CACHE_LIMIT;
  for (size_t i = 0; i < remove && i < order.size(); i++) {
    if (now - order[i].first < 1000) break; // never evict tiles used in the last second
    auto it = tiles.find(order[i].second);
    for (auto& m : it->second.buckets) m.destroy();
    tiles.erase(it);
  }
}

// ---------------------------------------------------------------- camera + input
struct Camera {
  double cx = 0.5, cy = 0.5, zoom = 13;
  bool flying = false;
  double flyX = 0, flyY = 0, flyZ = 0;
  double targetZoom = 13;
  double anchorX = 0, anchorY = 0; // screen point kept fixed while zooming
  int w = 1, h = 1;
  float dpr = 1;
  double worldPx() const { return TILE_PX * dpr * std::pow(2.0, zoom); }
} cam;

struct Pointer { int id; float x, y, startX, startY; };
std::vector<Pointer> pointers;

// Momentum ("fling"): after a quick drag the map keeps gliding and slows down,
// like Google Maps / iOS scrolling.
struct MoveSample { double t, dx, dy; };
std::vector<MoveSample> moveSamples;   // recent drag movements (last ~100 ms)
double inertiaVX = 0, inertiaVY = 0;  // device px per ms
bool inertia = false;
double lastFrameMs = 0;
constexpr double FLING_MIN_SPEED = 0.25;  // px/ms needed to start gliding
constexpr double FLING_MAX_SPEED = 5.0;   // cap
constexpr double FLING_DECAY_MS = 325.0;  // time constant of the slow-down
bool panEnabled = true;
bool dirty = true;
double pinchDist = 0, pinchZoom = 0;

Merc screenToMerc(double sx, double sy) {
  double wp = cam.worldPx();
  return {cam.cx + (sx - cam.w / 2.0) / wp, cam.cy + (sy - cam.h / 2.0) / wp};
}
void mercToScreen(Merc m, double& sx, double& sy) {
  double wp = cam.worldPx();
  sx = (m.x - cam.cx) * wp + cam.w / 2.0;
  sy = (m.y - cam.cy) * wp + cam.h / 2.0;
}

void clampCamera() {
  cam.cx = std::max(0.0, std::min(1.0, cam.cx));
  cam.cy = std::max(0.0, std::min(1.0, cam.cy));
}

// zoom to `z` keeping screen point (ax, ay) in place
void zoomAround(double z, double ax, double ay) {
  z = std::max(MIN_ZOOM, std::min(MAX_ZOOM, z));
  Merc before = screenToMerc(ax, ay);
  cam.zoom = z;
  Merc after = screenToMerc(ax, ay);
  cam.cx += before.x - after.x;
  cam.cy += before.y - after.y;
  clampCamera();
  dirty = true;
}

// ---------------------------------------------------------------- posts
struct Config {
  float iconSize = 225, iconRefZoom = 16, iconMin = 24;
  bool iconScaleWithZoom = true;
  float pixelSize = 10, markerSize = 80, adInfoZoom = 16, labelGap = 8;
  RGBA pixelColor = hex(0xef4444);
  RGBA zoneFill = hex(0x0066ff, 0.09f);
  RGBA zoneBorder = hex(0x0066ff);
  float zoneBorderWidth = 2;
} cfg;

enum PostKind { P_PIXEL, P_ICON, P_ZONE };

struct Post {
  PostKind kind;
  Merc at{};                  // pixel / icon
  int tex = 0, tw = 0, th = 0; // icon image
  int labelTex = 0, lw = 0, lh = 0;
  int thumbTex = 0, thw = 0, thh = 0;
  float alpha = 1;
  bool draft = false;
  // zone
  Merc origin{};               // zone-local coordinates are (merc - origin) * LOCAL
  std::vector<Merc> ring;      // merc, for hit testing
  Mesh fillTex;                // pos + uv (also drawn as a solid fill)
  Mesh outline;
  Merc center{};
};
constexpr double LOCAL = 1 << 22;

std::vector<Post> posts;
int hovered = -1;
Mesh previewLine;
std::vector<Merc> preview;
Merc previewOrigin{};

void destroyPost(Post& p) { p.fillTex.destroy(); p.outline.destroy(); }

bool pointInRing(const std::vector<Merc>& r, Merc p) {
  bool inside = false;
  for (size_t i = 0, j = r.size() - 1; i < r.size(); j = i++) {
    if (((r[i].y > p.y) != (r[j].y > p.y)) &&
        (p.x < (r[j].x - r[i].x) * (p.y - r[i].y) / (r[j].y - r[i].y) + r[i].x))
      inside = !inside;
  }
  return inside;
}

// hover info bubble (cross streets), texture made by JS
int hoverInfoTex = 0, hoverInfoW = 0, hoverInfoH = 0;
bool hoverInfoPending = false;

void clearHoverInfo() {
  if (hoverInfoTex) gfx_tex_delete(hoverInfoTex);
  hoverInfoTex = hoverInfoW = hoverInfoH = 0;
  hoverInfoPending = false;
}

double iconSizePx();

// which post is under the mouse? pixels and icons sit on top of zones
bool overCard(float sx, float sy);

void updateHover(float sx, float sy) {
  if (overCard(sx, sy)) return; // moving onto the open card keeps it open
  Merc m = screenToMerc(sx, sy);
  int found = -1;
  for (int i = int(posts.size()) - 1; i >= 0 && found < 0; i--) {
    const Post& p = posts[i];
    if (p.draft || p.kind == P_ZONE) continue;
    double px, py;
    mercToScreen(p.at, px, py);
    if (p.kind == P_PIXEL) {
      double r = (cfg.pixelSize / 2 + 5) * cam.dpr;
      if (std::fabs(sx - px) <= r && std::fabs(sy - py) <= r) found = i;
    } else {
      double s = iconSizePx();
      double maxDim = std::max(p.tw, p.th);
      double w = maxDim ? s * p.tw / maxDim : s, h = maxDim ? s * p.th / maxDim : s;
      if (std::fabs(sx - px) <= w / 2 && std::fabs(sy - py) <= h / 2) found = i;
    }
  }
  for (int i = int(posts.size()) - 1; i >= 0 && found < 0; i--) {
    const Post& p = posts[i];
    if (p.kind == P_ZONE && !p.draft && pointInRing(p.ring, m)) found = i;
  }
  if (found != hovered) {
    hovered = found;
    clearHoverInfo();
    dirty = true;
    js_on_hover(found);
  }
}

// ---------------------------------------------------------------- cross streets
// Finds the nearest intersection of two differently named streets around a point,
// using street names from z14 vector tiles. Returns false while the tile is still loading.
constexpr int NAME_Z = 14;
constexpr double SEARCH_METERS = 500;

struct Seg { double ax, ay, bx, by; const std::string* name; };

double distPointSeg(double px, double py, const Seg& s) {
  double dx = s.bx - s.ax, dy = s.by - s.ay;
  double l2 = dx * dx + dy * dy;
  double t = l2 > 0 ? std::max(0.0, std::min(1.0, ((px - s.ax) * dx + (py - s.ay) * dy) / l2)) : 0;
  double qx = s.ax + t * dx - px, qy = s.ay + t * dy - py;
  return std::sqrt(qx * qx + qy * qy);
}

bool segIntersect(const Seg& a, const Seg& b, double& ix, double& iy) {
  double d1x = a.bx - a.ax, d1y = a.by - a.ay, d2x = b.bx - b.ax, d2y = b.by - b.ay;
  double den = d1x * d2y - d1y * d2x;
  if (std::fabs(den) < 1e-18) return false;
  double t = ((b.ax - a.ax) * d2y - (b.ay - a.ay) * d2x) / den;
  double u = ((b.ax - a.ax) * d1y - (b.ay - a.ay) * d1x) / den;
  // small tolerance: streets often meet exactly at an endpoint
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return false;
  ix = a.ax + t * d1x;
  iy = a.ay + t * d1y;
  return true;
}

// "South Figueroa Street" -> "S Figueroa St", like Google Maps
std::string abbreviate(const std::string& name) {
  static const std::pair<const char*, const char*> SUFFIX[] = {
    {"Street", "St"}, {"Avenue", "Ave"}, {"Boulevard", "Blvd"}, {"Drive", "Dr"}, {"Road", "Rd"},
    {"Lane", "Ln"}, {"Place", "Pl"}, {"Court", "Ct"}, {"Parkway", "Pkwy"}, {"Highway", "Hwy"},
    {"Freeway", "Fwy"}, {"Expressway", "Expy"}, {"Terrace", "Ter"}, {"Circle", "Cir"},
    {"Square", "Sq"}, {"Trail", "Trl"}, {"Alley", "Aly"}, {"Plaza", "Plz"}, {"Mount", "Mt"},
    {"Saint", "St"}, {"Crescent", "Cres"}, {"Point", "Pt"},
  };
  static const std::pair<const char*, const char*> DIR[] = {
    {"North", "N"}, {"South", "S"}, {"East", "E"}, {"West", "W"},
    {"Northeast", "NE"}, {"Northwest", "NW"}, {"Southeast", "SE"}, {"Southwest", "SW"},
  };
  std::vector<std::string> words;
  size_t i = 0;
  while (i < name.size()) {
    size_t j = name.find(' ', i);
    if (j == std::string::npos) j = name.size();
    if (j > i) words.push_back(name.substr(i, j - i));
    i = j + 1;
  }
  for (size_t k = 0; k < words.size(); k++) {
    bool first = k == 0, last = k + 1 == words.size();
    if (words.size() > 1 && (first || last)) {
      for (auto& [full, ab] : DIR) if (words[k] == full) { words[k] = ab; break; }
    }
    // suffixes: not the very first word ("Avenue of the Stars" stays readable)
    if (!first) for (auto& [full, ab] : SUFFIX) if (words[k] == full) { words[k] = ab; break; }
  }
  std::string out;
  for (size_t k = 0; k < words.size(); k++) { if (k) out += ' '; out += words[k]; }
  return out;
}

bool crossStreets(Merc p, std::string& out) {
  out.clear();
  int n = 1 << NAME_Z;
  int tx = std::max(0, std::min(n - 1, int(p.x * n))), ty = std::max(0, std::min(n - 1, int(p.y * n)));
  TileKey center{NAME_Z, tx, ty};
  auto it = tiles.find(center);
  if (it == tiles.end()) {
    tiles[center] = Tile{};
    tiles[center].lastUsed = js_now_ms();
    js_request_tile(center.z, center.x, center.y);
    return false;
  }
  if (it->second.state == LOADING) return false;

  double lng, lat;
  fromMerc(p, lng, lat);
  double radius = SEARCH_METERS / (40075016.686 * std::cos(lat * PI / 180.0)); // meters -> mercator units

  std::vector<Seg> segs;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      auto t = tiles.find(TileKey{NAME_Z, tx + dx, ty + dy});
      if (t == tiles.end() || t->second.state != READY) continue;
      double scale = 1.0 / (double(n) * t->second.extent);
      double ox = double(tx + dx) / n, oy = double(ty + dy) / n;
      for (const auto& nl : t->second.names) {
        for (size_t k = 0; k + 1 < nl.pts.size(); k++) {
          Seg sg{ox + nl.pts[k].first * scale, oy + nl.pts[k].second * scale,
                 ox + nl.pts[k + 1].first * scale, oy + nl.pts[k + 1].second * scale, &nl.name};
          if (distPointSeg(p.x, p.y, sg) <= radius) segs.push_back(sg);
        }
      }
    }
  }
  if (segs.empty()) return true;

  double best = 1e9;
  const std::string *a = nullptr, *b = nullptr;
  for (size_t i = 0; i < segs.size(); i++) {
    for (size_t j = i + 1; j < segs.size(); j++) {
      if (*segs[i].name == *segs[j].name) continue;
      double ix, iy;
      if (!segIntersect(segs[i], segs[j], ix, iy)) continue;
      double d = std::hypot(ix - p.x, iy - p.y);
      if (d < best) { best = d; a = segs[i].name; b = segs[j].name; }
    }
  }
  if (a && b) {
    // nearest street first
    double da = 1e9, db = 1e9;
    for (auto& sg : segs) {
      double d = distPointSeg(p.x, p.y, sg);
      if (sg.name == a || *sg.name == *a) da = std::min(da, d);
      if (sg.name == b || *sg.name == *b) db = std::min(db, d);
    }
    std::string A = abbreviate(*a), B = abbreviate(*b);
    out = da <= db ? A + " & " + B : B + " & " + A;
    return true;
  }
  // no intersection nearby: name the closest street
  double nd = 1e9;
  const std::string* nearest = nullptr;
  for (auto& sg : segs) {
    double d = distPointSeg(p.x, p.y, sg);
    if (d < nd) { nd = d; nearest = sg.name; }
  }
  if (nearest) out = "on " + abbreviate(*nearest);
  return true;
}

void drawQuad(int tex, double x, double y, double w, double h, float alpha) {
  if (tex) gfx_quad_tex(tex, float(x), float(y), float(w), float(h), alpha);
}

void drawSolidQuad(RGBA c, double x, double y, double w, double h) {
  gfx_quad_solid(float(x), float(y), float(w), float(h), c.r, c.g, c.b, c.a);
}

void drawLabel(const Post& p, double cxPx, double bottomPx, float alpha) {
  if (!p.labelTex || alpha <= 0.01f) return;
  double w = p.lw, h = p.lh; // label textures are made at device pixel size
  drawQuad(p.labelTex, std::round(cxPx - w / 2), std::round(bottomPx - h), w, h, alpha);
}

// Focus mode: while a post's card is open, the other posts and the post itself fade out
// (the card already shows its image + comment). 0 = normal, 1 = fully focused.
double focus = 0;
double cardX = 0, cardY = 0, cardW = 0, cardH = 0; // where the card was last drawn (for hover)
bool focusActive() { return hovered >= 0 && hovered < int(posts.size()) && hoverInfoTex; }

double iconSizePx() {
  double s = cfg.iconSize;
  if (cfg.iconScaleWithZoom) {
    s = cfg.iconSize * std::pow(2.0, cam.zoom - cfg.iconRefZoom);
    s = std::max<double>(cfg.iconMin, std::min<double>(cfg.iconSize, s));
  }
  return s * cam.dpr;
}

struct Xform { float ox, oy, scale; };
Xform localXform(Merc origin) {
  double wp = cam.worldPx();
  return {float((origin.x - cam.cx) * wp + cam.w / 2.0), float((origin.y - cam.cy) * wp + cam.h / 2.0), float(wp / LOCAL)};
}

// ---------------------------------------------------------------- my location (blue dot)
bool hasMyLoc = false;
Merc myLoc{};          // what's shown = GPS reading + the user's adjustment
Merc myRaw{};          // GPS reading
double myAdjX = 0, myAdjY = 0; // user's drag adjustment (mercator units)
double myAccuracyM = 0;
bool draggingLoc = false;
constexpr double APPROX_ACCURACY_M = 1000; // worse than this: don't draw the accuracy circle

// how far the user may move their dot away from the GPS reading
double maxAdjustMerc() {
  double lng, lat;
  fromMerc(myRaw, lng, lat);
  double meters = std::max(150.0, std::min(3000.0, myAccuracyM));
  return meters / (40075016.686 * std::cos(lat * PI / 180.0));
}
void applyAdjust() {
  double lim = maxAdjustMerc();
  double len = std::hypot(myAdjX, myAdjY);
  if (len > lim) { myAdjX *= lim / len; myAdjY *= lim / len; }
  myLoc = {myRaw.x + myAdjX, myRaw.y + myAdjY};
}
Mesh unitCircle; // radius-1 circle, drawn at any size via the scale
Mesh unitRing;   // radius-1 outline (line width stays in pixels)

void ensureUnitCircle() {
  if (unitCircle.id) return;
  std::vector<float> v{0, 0};
  std::vector<uint32_t> idx;
  const int N = 48;
  for (int i = 0; i <= N; i++) {
    double a = 2 * PI * i / N;
    v.push_back(float(std::cos(a)));
    v.push_back(float(std::sin(a)));
    if (i > 0) { idx.push_back(0); idx.push_back(uint32_t(i)); idx.push_back(uint32_t(i + 1)); }
  }
  unitCircle = upload(v, 2, &idx);
  struct P { double x, y; };
  std::vector<P> ring;
  for (int i = 0; i < 96; i++) ring.push_back({std::cos(2 * PI * i / 96), std::sin(2 * PI * i / 96)});
  std::vector<float> lv;
  buildLine(ring, lv, true);
  unitRing = upload(lv, 4, nullptr);
}

void drawCircle(double sx, double sy, double r, RGBA c) {
  gfx_solid(unitCircle.id, float(sx), float(sy), float(r), c.r, c.g, c.b, c.a);
}

void drawMyLocation() {
  if (!hasMyLoc) return;
  ensureUnitCircle();
  double sx, sy;
  mercToScreen(myLoc, sx, sy);
  double lng, lat;
  fromMerc(myLoc, lng, lat);
  // accuracy circle: meters -> device pixels at this latitude and zoom
  double metersPerWorld = 40075016.686 * std::cos(lat * PI / 180.0);
  double dotR = 8 * cam.dpr;
  if (draggingLoc) {
    // show how far the dot may be moved, around the GPS reading
    double rx, ry;
    mercToScreen(myRaw, rx, ry);
    double limPx = maxAdjustMerc() * cam.worldPx();
    RGBA c = hex(0x4285f4, 0.7f);
    gfx_line(unitRing.id, float(rx), float(ry), float(limPx), 2.0f * cam.dpr, c.r, c.g, c.b, c.a);
  } else if (myAccuracyM <= APPROX_ACCURACY_M) {
    double accPx = myAccuracyM / metersPerWorld * cam.worldPx();
    if (accPx > dotR * 1.5) drawCircle(sx, sy, accPx, hex(0x4285f4, 0.15f));
  }
  if (draggingLoc) dotR *= 1.25;
  drawCircle(sx, sy, dotR + 4 * cam.dpr, hex(0x000000, 0.12f)); // soft edge
  drawCircle(sx, sy, dotR + 2.5 * cam.dpr, hex(0xffffff));       // white ring
  drawCircle(sx, sy, dotR, hex(0x4285f4));                       // Google blue
}

bool overCard(float sx, float sy) {
  return focusActive() && focus > 0.5 && sx >= cardX && sx <= cardX + cardW && sy >= cardY && sy <= cardY + cardH;
}

void drawPosts() {
  const bool zoomedIn = cam.zoom >= cfg.adInfoZoom;
  const float others = float(1.0 - focus);       // alpha for every other post
  const float self = float(1.0 - focus);         // alpha for the focused post's own marker
  const double gap = cfg.labelGap * cam.dpr;
  const double dot = 8 * cam.dpr;                // small marker left at the focused spot

  // zones first (they sit on the ground), then markers and labels on top
  for (size_t i = 0; i < posts.size(); i++) {
    Post& p = posts[i];
    if (p.kind != P_ZONE) continue;
    bool isFocus = int(i) == hovered;
    float a = p.alpha * (isFocus ? 1.f : others);
    if (a <= 0.01f) continue;
    bool showImage = p.tex && !zoomedIn && !isFocus;
    Xform x = localXform(p.origin);
    if (showImage) {
      gfx_tex(p.fillTex.id, x.ox, x.oy, x.scale, p.tex, a);
    } else {
      gfx_solid(p.fillTex.id, x.ox, x.oy, x.scale, cfg.zoneFill.r, cfg.zoneFill.g, cfg.zoneFill.b, cfg.zoneFill.a * a);
    }
    gfx_line(p.outline.id, x.ox, x.oy, x.scale, cfg.zoneBorderWidth * cam.dpr,
             cfg.zoneBorder.r, cfg.zoneBorder.g, cfg.zoneBorder.b, (p.draft ? 0.6f : 1.f) * (isFocus ? 1.f : others));
  }

  drawMyLocation();

  double fx = 0, fy = 0, fLabelBottom = 0; // focused post: screen point + where its label would sit
  bool haveFocus = false;

  for (size_t i = 0; i < posts.size(); i++) {
    const Post& p = posts[i];
    bool isFocus = int(i) == hovered;
    float a = p.alpha * (isFocus ? self : others);
    double sx, sy, labelBottom;
    if (p.kind == P_PIXEL) {
      mercToScreen(p.at, sx, sy);
      double s = cfg.pixelSize * cam.dpr;
      labelBottom = sy - s / 2 - gap;
      if (a > 0.01f) {
        RGBA edge{0, 0, 0, 0.35f * a};
        drawSolidQuad(edge, std::round(sx - s / 2), std::round(sy - s / 2), s, s);
        RGBA c = cfg.pixelColor;
        c.a *= a;
        drawSolidQuad(c, std::round(sx - s / 2) + cam.dpr, std::round(sy - s / 2) + cam.dpr, s - 2 * cam.dpr, s - 2 * cam.dpr);
        drawLabel(p, sx, labelBottom, a);
      }
    } else if (p.kind == P_ICON) {
      mercToScreen(p.at, sx, sy);
      double s = iconSizePx();
      double maxDim = std::max(p.tw, p.th);
      double w = s * p.tw / maxDim, h = s * p.th / maxDim;
      labelBottom = sy - h / 2 - gap;
      if (a > 0.01f) {
        drawQuad(p.tex, std::round(sx - w / 2), std::round(sy - h / 2), w, h, a);
        drawLabel(p, sx, labelBottom, a);
      }
    } else {
      bool showInfo = p.draft || zoomedIn || isFocus;
      mercToScreen(p.center, sx, sy);
      labelBottom = sy - (p.thumbTex ? p.thh / 2.0 : 0) - gap;
      if (showInfo && a > 0.01f) {
        if (p.thumbTex) drawQuad(p.thumbTex, std::round(sx - p.thw / 2.0), std::round(sy - p.thh / 2.0), p.thw, p.thh, a);
        drawLabel(p, sx, labelBottom, a);
      }
    }
    if (isFocus) { haveFocus = true; fx = sx; fy = sy; fLabelBottom = labelBottom; }
  }

  // the focused post: small red dot at its exact spot + the card pointing at it
  if (haveFocus && focusActive()) {
    float fa = float(focus);
    RGBA edge{1, 1, 1, fa};
    drawSolidQuad(edge, std::round(fx - dot / 2 - cam.dpr), std::round(fy - dot / 2 - cam.dpr), dot + 2 * cam.dpr, dot + 2 * cam.dpr);
    RGBA c = cfg.pixelColor;
    c.a = fa;
    drawSolidQuad(c, std::round(fx - dot / 2), std::round(fy - dot / 2), dot, dot);
    // slide from where the label was down to the dot
    double bottom = fLabelBottom + (fy - dot / 2 - gap - fLabelBottom) * focus;
    cardW = hoverInfoW; cardH = hoverInfoH;
    cardX = std::round(fx - hoverInfoW / 2.0);
    cardY = std::round(bottom - hoverInfoH);
    drawQuad(hoverInfoTex, cardX, cardY, cardW, cardH, std::min(1.f, fa * 1.5f));
  }

  if (previewLine.id) {
    Xform x = localXform(previewOrigin);
    gfx_line(previewLine.id, x.ox, x.oy, x.scale, 2.0f * cam.dpr, cfg.zoneBorder.r, cfg.zoneBorder.g, cfg.zoneBorder.b, 0.9f);
  }
}

// ---------------------------------------------------------------- base map
float lineWidthPx(const Style& s) {
  // CSS px at z14, grows/shrinks with zoom
  double f = std::pow(2.0, (cam.zoom - 14.0) * 0.75);
  f = std::max(0.35, std::min(4.0, f));
  return float(s.width * f * cam.dpr);
}

struct DrawTile { TileKey key; Tile* tile; };

std::vector<DrawTile> collectTiles(double now) {
  int tz = std::max(0, std::min(MAX_TILE_Z, int(std::floor(cam.zoom))));
  int n = 1 << tz;
  double wp = cam.worldPx();
  double minX = cam.cx - cam.w / 2.0 / wp, maxX = cam.cx + cam.w / 2.0 / wp;
  double minY = cam.cy - cam.h / 2.0 / wp, maxY = cam.cy + cam.h / 2.0 / wp;
  int x0 = std::max(0, int(std::floor(minX * n))), x1 = std::min(n - 1, int(std::floor(maxX * n)));
  int y0 = std::max(0, int(std::floor(minY * n))), y1 = std::min(n - 1, int(std::floor(maxY * n)));

  std::vector<DrawTile> out;
  std::unordered_set<TileKey, TileKeyHash> added;
  for (int y = y0; y <= y1; y++) {
    for (int x = x0; x <= x1; x++) {
      TileKey k{tz, x, y};
      auto it = tiles.find(k);
      if (it == tiles.end()) {
        tiles[k] = Tile{};
        tiles[k].lastUsed = now;
        js_request_tile(k.z, k.x, k.y);
      }
      Tile& t = tiles[k];
      t.lastUsed = now;
      if (t.state == READY) {
        if (added.insert(k).second) out.push_back({k, &t});
        continue;
      }
      // not ready yet: show the closest loaded parent tile so the map never goes blank
      for (int up = 1; up <= 6 && tz - up >= 0; up++) {
        TileKey pk{tz - up, x >> up, y >> up};
        auto pit = tiles.find(pk);
        if (pit != tiles.end() && pit->second.state == READY) {
          pit->second.lastUsed = now;
          if (added.insert(pk).second) out.push_back({pk, &pit->second});
          break;
        }
      }
    }
  }
  // parents first so sharper children draw on top
  std::sort(out.begin(), out.end(), [](const DrawTile& a, const DrawTile& b) { return a.key.z < b.key.z; });
  return out;
}

Xform tileXform(const DrawTile& d) {
  double n = double(1 << d.key.z);
  double wp = cam.worldPx();
  return {float((d.key.x / n - cam.cx) * wp + cam.w / 2.0), float((d.key.y / n - cam.cy) * wp + cam.h / 2.0),
          float(wp / n / d.tile->extent)};
}

void drawBaseMap(const std::vector<DrawTile>& list) {
  std::vector<Xform> xf;
  xf.reserve(list.size());
  for (auto& d : list) xf.push_back(tileXform(d));
  for (BucketId b : FILL_ORDER) {
    const Style& s = STYLES[b];
    if (cam.zoom < s.minZoom) continue;
    for (size_t i = 0; i < list.size(); i++) {
      int m = list[i].tile->buckets[b].id;
      if (m) gfx_solid(m, xf[i].ox, xf[i].oy, xf[i].scale, s.color.r, s.color.g, s.color.b, s.color.a);
    }
  }
  // casings (darker, wider) under all roads, then the road fills
  for (int pass = 0; pass < 2; pass++) {
    for (BucketId b : LINE_ORDER) {
      const Style& s = STYLES[b];
      if (cam.zoom < s.minZoom) continue;
      if (pass == 0 && s.casing.a == 0) continue;
      RGBA c = pass == 0 ? s.casing : s.color;
      float w = lineWidthPx(s) + (pass == 0 ? 2.0f * cam.dpr : 0.f);
      for (size_t i = 0; i < list.size(); i++) {
        int m = list[i].tile->buckets[b].id;
        if (m) gfx_line(m, xf[i].ox, xf[i].oy, xf[i].scale, w, c.r, c.g, c.b, c.a);
      }
    }
  }
}

} // namespace

// ================================================================= exports

EXPORT(engine_alloc) void* engine_alloc(int n) { return std::malloc(size_t(n)); }
EXPORT(engine_free) void engine_free(void* p) { std::free(p); }

EXPORT(engine_init) void engine_init() { log("C++ map engine ready"); }

EXPORT(engine_config) void engine_config(float iconSize, float iconRefZoom, float iconMin, int iconScale,
                                         float pixelSize, uint32_t pixelColor, float markerSize, float adInfoZoom,
                                         uint32_t zoneFill, float zoneFillOpacity, uint32_t zoneBorder, float zoneBorderWidth) {
  cfg.iconSize = iconSize; cfg.iconRefZoom = iconRefZoom; cfg.iconMin = iconMin; cfg.iconScaleWithZoom = iconScale != 0;
  cfg.pixelSize = pixelSize; cfg.pixelColor = hex(pixelColor);
  cfg.markerSize = markerSize; cfg.adInfoZoom = adInfoZoom;
  cfg.zoneFill = hex(zoneFill, zoneFillOpacity); cfg.zoneBorder = hex(zoneBorder); cfg.zoneBorderWidth = zoneBorderWidth;
  dirty = true;
}

EXPORT(engine_set_view) void engine_set_view(double lng, double lat, double zoom) {
  Merc m = toMerc(lng, lat);
  cam.cx = m.x; cam.cy = m.y; cam.zoom = cam.targetZoom = zoom;
  dirty = true;
}

EXPORT(engine_get_zoom) double engine_get_zoom() { return cam.zoom; }

// blue "you are here" dot. accuracy in meters; pass accuracy < 0 to hide the dot
EXPORT(engine_set_my_location) void engine_set_my_location(double lng, double lat, double accuracyM) {
  hasMyLoc = accuracyM >= 0;
  if (!hasMyLoc) { myAdjX = myAdjY = 0; draggingLoc = false; dirty = true; return; }
  myRaw = toMerc(lng, lat);
  myAccuracyM = accuracyM;
  applyAdjust(); // keeps the user's adjustment (within the limit)
  dirty = true;
}

// the location as shown (GPS + the user's adjustment), as lng,lat
EXPORT(engine_get_my_location) int engine_get_my_location(double* out) {
  if (!hasMyLoc) return 0;
  fromMerc(myLoc, out[0], out[1]);
  return 1;
}

EXPORT(engine_reset_my_location_adjust) void engine_reset_my_location_adjust() {
  myAdjX = myAdjY = 0;
  applyAdjust();
  dirty = true;
}

// smoothly move the camera to a point
EXPORT(engine_fly_to) void engine_fly_to(double lng, double lat, double zoom) {
  Merc m = toMerc(lng, lat);
  cam.flyX = m.x; cam.flyY = m.y;
  cam.flyZ = std::max(MIN_ZOOM, std::min(MAX_ZOOM, zoom));
  cam.flying = true;
  dirty = true;
}

EXPORT(engine_screen_to_lnglat) void engine_screen_to_lnglat(float sx, float sy, double* out) {
  fromMerc(screenToMerc(sx, sy), out[0], out[1]);
}

EXPORT(engine_lnglat_to_screen) void engine_lnglat_to_screen(double lng, double lat, double* out) {
  mercToScreen(toMerc(lng, lat), out[0], out[1]);
}

// ---- tiles
// Called inside a background worker: raw tile bytes -> triangulated blob.
// Returns a pointer to the blob; its first u32 is the blob size. Valid until the next call.
EXPORT(worker_build_tile) const uint8_t* worker_build_tile(const uint8_t* data, int len) {
  static std::vector<uint8_t> blob;
  blob = buildTileBlob(data, size_t(len));
  return blob.data();
}

// Called on the main thread with a blob from a worker: upload it to the GPU.
EXPORT(engine_tile_upload) void engine_tile_upload(int z, int x, int y, const uint8_t* blob, int len) {
  auto it = tiles.find(TileKey{z, x, y});
  if (it == tiles.end()) return; // evicted while loading
  uploadTileBlob(it->second, blob, size_t(len));
  dirty = true;
  // the street names the hover bubble was waiting for may have just arrived
  if (z == NAME_Z && hoverInfoPending && hovered >= 0) { hoverInfoPending = false; js_on_hover(hovered); }
}
EXPORT(engine_tile_failed) void engine_tile_failed(int z, int x, int y) {
  auto it = tiles.find(TileKey{z, x, y});
  if (it != tiles.end()) it->second.state = FAILED;
  if (z == NAME_Z && hoverInfoPending && hovered >= 0) { hoverInfoPending = false; js_on_hover(hovered); }
}

// Cross streets for a post, written as UTF-8 into buf. Returns the length,
// 0 if no streets are known there, or -1 while the street data is still loading
// (the engine calls on_hover again when it arrives).
EXPORT(engine_cross_streets) int engine_cross_streets(int index, char* buf, int cap) {
  if (index < 0 || index >= int(posts.size())) return 0;
  const Post& p = posts[index];
  std::string out;
  if (!crossStreets(p.kind == P_ZONE ? p.center : p.at, out)) {
    if (index == hovered) hoverInfoPending = true;
    return -1;
  }
  int n = std::min(int(out.size()), cap);
  std::memcpy(buf, out.data(), size_t(n));
  return n;
}

// Cross streets for any lng/lat (used by the panel's Location row). Same return values.
EXPORT(engine_cross_streets_at) int engine_cross_streets_at(double lng, double lat, char* buf, int cap) {
  std::string out;
  if (!crossStreets(toMerc(lng, lat), out)) return -1;
  int n = std::min(int(out.size()), cap);
  std::memcpy(buf, out.data(), size_t(n));
  return n;
}

// texture with the cross-street text for the currently hovered post
EXPORT(engine_set_hover_info) void engine_set_hover_info(int index, int tex, int w, int h) {
  if (index != hovered) { if (tex) gfx_tex_delete(tex); return; }
  if (hoverInfoTex && hoverInfoTex != tex) gfx_tex_delete(hoverInfoTex);
  hoverInfoTex = tex; hoverInfoW = w; hoverInfoH = h;
  dirty = true;
}

// ---- textures (RGBA, not premultiplied)
EXPORT(engine_tex_create) int engine_tex_create(const uint8_t* rgba, int w, int h) { return gfx_tex_create(rgba, w, h); }
EXPORT(engine_tex_delete) void engine_tex_delete(int t) { gfx_tex_delete(t); }

// ---- stats for the on-screen overlay
EXPORT(engine_stat_tiles) int engine_stat_tiles() {
  int n = 0;
  for (auto& [k, t] : tiles) if (t.state == READY) n++;
  return n;
}

// ---- posts
EXPORT(engine_posts_clear) void engine_posts_clear() {
  for (auto& p : posts) destroyPost(p);
  posts.clear();
  clearHoverInfo();
  if (hovered != -1) { hovered = -1; js_on_hover(-1); }
  dirty = true;
}

EXPORT(engine_add_pixel) int engine_add_pixel(double lng, double lat, int labelTex, int lw, int lh, float alpha) {
  Post p;
  p.kind = P_PIXEL; p.at = toMerc(lng, lat);
  p.labelTex = labelTex; p.lw = lw; p.lh = lh; p.alpha = alpha;
  posts.push_back(std::move(p));
  dirty = true;
  return int(posts.size()) - 1;
}

EXPORT(engine_add_icon) int engine_add_icon(double lng, double lat, int tex, int tw, int th,
                                            int labelTex, int lw, int lh, float alpha) {
  Post p;
  p.kind = P_ICON; p.at = toMerc(lng, lat);
  p.tex = tex; p.tw = tw; p.th = th;
  p.labelTex = labelTex; p.lw = lw; p.lh = lh; p.alpha = alpha;
  posts.push_back(std::move(p));
  dirty = true;
  return int(posts.size()) - 1;
}

// coords: lng,lat pairs. The zone image is stretched over the zone's bounding box and
// cut to the zone shape by the triangles themselves (no pre-clipping needed).
EXPORT(engine_add_zone) int engine_add_zone(const double* coords, int n, int tex, int thumbTex, int thw, int thh,
                                            int labelTex, int lw, int lh, float alpha, int isDraft) {
  if (n < 3) return -1;
  Post p;
  p.kind = P_ZONE; p.tex = tex; p.thumbTex = thumbTex; p.thw = thw; p.thh = thh;
  p.labelTex = labelTex; p.lw = lw; p.lh = lh; p.alpha = alpha; p.draft = isDraft != 0;
  double minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (int i = 0; i < n; i++) {
    Merc m = toMerc(coords[i * 2], coords[i * 2 + 1]);
    p.ring.push_back(m);
    minX = std::min(minX, m.x); maxX = std::max(maxX, m.x);
    minY = std::min(minY, m.y); maxY = std::max(maxY, m.y);
  }
  p.origin = {minX, minY};
  p.center = {(minX + maxX) / 2, (minY + maxY) / 2};
  double bw = (maxX - minX) * LOCAL, bh = (maxY - minY) * LOCAL;

  struct LP { double x, y; };
  std::vector<LP> local;
  for (auto& m : p.ring) local.push_back({(m.x - minX) * LOCAL, (m.y - minY) * LOCAL});

  std::vector<float> pv;
  std::vector<uint32_t> idx;
  std::vector<std::vector<LP>> rings{local};
  buildFill(rings, [](const LP& q) { return std::pair<double, double>(q.x, q.y); }, pv, idx);
  std::vector<float> tv; // pos + uv
  for (size_t i = 0; i + 1 < pv.size(); i += 2) {
    tv.push_back(pv[i]); tv.push_back(pv[i + 1]);
    tv.push_back(bw > 0 ? float(pv[i] / bw) : 0.f);
    tv.push_back(bh > 0 ? float(pv[i + 1] / bh) : 0.f);
  }
  p.fillTex = upload(tv, 4, &idx);
  std::vector<float> lv;
  buildLine(local, lv, true);
  p.outline = upload(lv, 4, nullptr);
  posts.push_back(std::move(p));
  dirty = true;
  return int(posts.size()) - 1;
}

// zone drawing preview (lng,lat pairs)
EXPORT(engine_set_preview) void engine_set_preview(const double* coords, int n, int closed) {
  previewLine.destroy();
  preview.clear();
  if (n >= 2) {
    double minX = 1e9, minY = 1e9;
    for (int i = 0; i < n; i++) {
      Merc m = toMerc(coords[i * 2], coords[i * 2 + 1]);
      preview.push_back(m);
      minX = std::min(minX, m.x); minY = std::min(minY, m.y);
    }
    previewOrigin = {minX, minY};
    struct LP { double x, y; };
    std::vector<LP> local;
    for (auto& m : preview) local.push_back({(m.x - minX) * LOCAL, (m.y - minY) * LOCAL});
    std::vector<float> lv;
    buildLine(local, lv, closed != 0 && n >= 3);
    previewLine = upload(lv, 4, nullptr);
  }
  dirty = true;
}

// ---- input (coordinates in device pixels)
EXPORT(engine_set_pan) void engine_set_pan(int enabled) { panEnabled = enabled != 0; }

bool hitMyLocation(float x, float y) {
  if (!hasMyLoc) return false;
  double sx, sy;
  mercToScreen(myLoc, sx, sy);
  return std::hypot(sx - x, sy - y) <= 22 * cam.dpr;
}

EXPORT(engine_hit_my_location) int engine_hit_my_location(float x, float y) { return hitMyLocation(x, y) ? 1 : 0; }
EXPORT(engine_is_dragging_location) int engine_is_dragging_location() { return draggingLoc ? 1 : 0; }

EXPORT(engine_pointer_down) void engine_pointer_down(int id, float x, float y) {
  if (pointers.empty() && hitMyLocation(x, y)) {
    // grab the blue dot to adjust your location (desktop location is often rough)
    draggingLoc = true;
    pointers.push_back({id, x, y, x, y});
    inertia = false;
    cam.flying = false;
    dirty = true;
    return;
  }
  pointers.erase(std::remove_if(pointers.begin(), pointers.end(), [&](auto& p) { return p.id == id; }), pointers.end());
  pointers.push_back({id, x, y, x, y});
  cam.targetZoom = cam.zoom; // stop any zoom animation
  cam.flying = false;
  inertia = false;           // touching the map stops the glide
  moveSamples.clear();
  if (pointers.size() == 2) {
    pinchDist = std::hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
    pinchZoom = cam.zoom;
  }
}

EXPORT(engine_pointer_move) void engine_pointer_move(int id, float x, float y) {
  Pointer* p = nullptr;
  for (auto& q : pointers) if (q.id == id) p = &q;
  if (!p) { updateHover(x, y); return; }
  float dx = x - p->x, dy = y - p->y;
  p->x = x; p->y = y;
  if (draggingLoc) {
    Merc m = screenToMerc(x, y);
    myAdjX = m.x - myRaw.x;
    myAdjY = m.y - myRaw.y;
    applyAdjust();
    dirty = true;
    return;
  }
  if (pointers.size() == 1 && panEnabled) {
    double wp = cam.worldPx();
    cam.cx -= dx / wp;
    cam.cy -= dy / wp;
    clampCamera();
    dirty = true;
    double now = js_now_ms();
    moveSamples.push_back({now, dx, dy});
    while (!moveSamples.empty() && now - moveSamples.front().t > 100) moveSamples.erase(moveSamples.begin());
  } else if (pointers.size() == 2 && pinchDist > 0) {
    double d = std::hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
    double mx = (pointers[0].x + pointers[1].x) / 2, my = (pointers[0].y + pointers[1].y) / 2;
    zoomAround(pinchZoom + std::log2(std::max(1.0, d) / pinchDist), mx, my);
    cam.targetZoom = cam.zoom;
    // pan with the midpoint too
    double wp = cam.worldPx();
    cam.cx -= dx / 2 / wp;
    cam.cy -= dy / 2 / wp;
    clampCamera();
  }
}

// returns 1 if this was a click (pointer barely moved), so the app can place things
EXPORT(engine_pointer_up) int engine_pointer_up(int id, float x, float y) {
  if (draggingLoc) {
    draggingLoc = false;
    pointers.erase(std::remove_if(pointers.begin(), pointers.end(), [&](auto& p) { return p.id == id; }), pointers.end());
    dirty = true;
    js_on_my_location_moved();
    return 0;
  }
  int click = 0;
  for (auto& p : pointers) {
    if (p.id == id) {
      click = (std::hypot(x - p.startX, y - p.startY) < 5 * cam.dpr && pointers.size() == 1) ? 1 : 0;
    }
  }
  bool wasSinglePan = pointers.size() == 1 && panEnabled;
  pointers.erase(std::remove_if(pointers.begin(), pointers.end(), [&](auto& p) { return p.id == id; }), pointers.end());
  if (pointers.size() < 2) pinchDist = 0;

  // start gliding if the finger/mouse was still moving fast when released
  double now = js_now_ms();
  if (wasSinglePan && !click && moveSamples.size() >= 2 && now - moveSamples.back().t < 50) {
    double sx = 0, sy = 0;
    for (auto& m : moveSamples) { sx += m.dx; sy += m.dy; }
    double span = std::max(16.0, now - moveSamples.front().t);
    double vx = sx / span, vy = sy / span;
    double speed = std::hypot(vx, vy);
    if (speed > FLING_MIN_SPEED) {
      double k = std::min(1.0, FLING_MAX_SPEED / speed);
      inertiaVX = vx * k;
      inertiaVY = vy * k;
      inertia = true;
      lastFrameMs = now;
      dirty = true;
    }
  }
  moveSamples.clear();
  return click;
}

// tap / click on a post (phones have no hover): selects it like a hover.
// Returns the post index, or -1 if nothing was tapped (then the selection is cleared).
EXPORT(engine_tap) int engine_tap(float x, float y) {
  updateHover(x, y);
  return hovered;
}

EXPORT(engine_pointer_leave) void engine_pointer_leave() {
  if (hovered != -1) { hovered = -1; clearHoverInfo(); dirty = true; js_on_hover(-1); }
}

// smooth zoom toward the cursor
EXPORT(engine_wheel) void engine_wheel(float x, float y, float deltaY) {
  cam.flying = false;
  inertia = false;
  double step = -deltaY / 300.0;
  step = std::max(-1.0, std::min(1.0, step));
  cam.targetZoom = std::max(MIN_ZOOM, std::min(MAX_ZOOM, cam.targetZoom + step));
  cam.anchorX = x; cam.anchorY = y;
  dirty = true;
}

EXPORT(engine_dblclick) void engine_dblclick(float x, float y) {
  cam.targetZoom = std::min(MAX_ZOOM, std::round(cam.zoom) + 1);
  cam.anchorX = x; cam.anchorY = y;
  dirty = true;
}

// ---- one frame. Returns 0 = nothing drawn, 1 = drawn, 3 = drawn and still animating.
EXPORT(engine_frame) int engine_frame(int w, int h, float dpr) {
  if (w != cam.w || h != cam.h || dpr != cam.dpr) { cam.w = w; cam.h = h; cam.dpr = dpr; dirty = true; }
  // focus fade (posts fading out around an open card)
  double focusTarget = focusActive() ? 1.0 : 0.0;
  bool focusMoving = std::fabs(focusTarget - focus) > 0.001;
  if (focusMoving) {
    focus += (focusTarget - focus) * 0.28;
    if (std::fabs(focusTarget - focus) < 0.01) focus = focusTarget;
    dirty = true;
  }
  double nowMs = js_now_ms();
  if (inertia) {
    double dt = std::min(50.0, std::max(1.0, nowMs - lastFrameMs));
    double wp = cam.worldPx();
    cam.cx -= inertiaVX * dt / wp;
    cam.cy -= inertiaVY * dt / wp;
    clampCamera();
    double decay = std::exp(-dt / FLING_DECAY_MS);
    inertiaVX *= decay;
    inertiaVY *= decay;
    if (std::hypot(inertiaVX, inertiaVY) < 0.02) inertia = false;
    dirty = true;
  }
  lastFrameMs = nowMs;
  if (cam.flying) {
    // smooth fly: ease the center and zoom toward the target together
    cam.cx += (cam.flyX - cam.cx) * 0.15;
    cam.cy += (cam.flyY - cam.cy) * 0.15;
    cam.zoom += (cam.flyZ - cam.zoom) * 0.15;
    cam.targetZoom = cam.zoom;
    double wp = cam.worldPx();
    if (std::hypot(cam.flyX - cam.cx, cam.flyY - cam.cy) * wp < 0.5 && std::fabs(cam.flyZ - cam.zoom) < 0.005) {
      cam.cx = cam.flyX; cam.cy = cam.flyY; cam.zoom = cam.targetZoom = cam.flyZ;
      cam.flying = false;
    }
    dirty = true;
  }
  bool animating = inertia || cam.flying || std::fabs(cam.targetZoom - cam.zoom) > 0.0005;
  if (std::fabs(cam.targetZoom - cam.zoom) > 0.0005 && !cam.flying) {
    double z = cam.zoom + (cam.targetZoom - cam.zoom) * 0.25;
    if (std::fabs(cam.targetZoom - z) < 0.001) z = cam.targetZoom;
    zoomAround(z, cam.anchorX, cam.anchorY);
  }
  if (!dirty && !animating) return 0;
  dirty = false;

  double now = js_now_ms();
  RGBA bg = hex(0xf2efe9);
  gfx_begin(cam.w, cam.h, bg.r, bg.g, bg.b);
  auto list = collectTiles(now);
  drawBaseMap(list);
  drawPosts();
  gfx_end();
  evictTiles(now);
  return (animating || focusMoving) ? 3 : 1;
}

// called when a tile finishes loading, an image is ready, etc.
EXPORT(engine_invalidate) void engine_invalidate() { dirty = true; }
