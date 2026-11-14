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
// JavaScript only provides WebGL calls, network downloads and image decoding.

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

#include "gl.hpp"
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

// ---------------------------------------------------------------- shaders
struct Program {
  int id = 0;
  int u_offset = 0, u_scale = 0, u_view = 0, u_color = 0, u_width = 0, u_tex = 0, u_alpha = 0;
};

int compile(int type, const char* src) {
  int s = glCreateShader(type);
  glShaderSource(s, src, int(std::strlen(src)));
  if (!glCompileShader(s)) log("shader compile failed");
  return s;
}

Program link(const char* vs, const char* fs) {
  Program p;
  p.id = glCreateProgram();
  glAttachShader(p.id, compile(GL_VERTEX_SHADER, vs));
  glAttachShader(p.id, compile(GL_FRAGMENT_SHADER, fs));
  if (!glLinkProgram(p.id)) log("program link failed");
  auto U = [&](const char* n) { return glGetUniformLocation(p.id, n, int(std::strlen(n))); };
  p.u_offset = U("u_offset");
  p.u_scale = U("u_scale");
  p.u_view = U("u_view");
  p.u_color = U("u_color");
  p.u_width = U("u_width");
  p.u_tex = U("u_tex");
  p.u_alpha = U("u_alpha");
  return p;
}

const char* VS_SOLID = R"(#version 300 es
layout(location=0) in vec2 a_pos;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view;
void main() {
  vec2 px = u_offset + a_pos * u_scale;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
})";

const char* VS_LINE = R"(#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_extrude;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view; uniform float u_width;
void main() {
  vec2 px = u_offset + a_pos * u_scale + a_extrude * (u_width * 0.5);
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
})";

const char* FS_SOLID = R"(#version 300 es
precision mediump float;
uniform vec4 u_color; out vec4 o;
void main() { o = vec4(u_color.rgb * u_color.a, u_color.a); })";

const char* VS_TEX = R"(#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
uniform vec2 u_offset; uniform float u_scale; uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 px = u_offset + a_pos * u_scale;
  v_uv = a_uv;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
})";

const char* FS_TEX = R"(#version 300 es
precision mediump float;
uniform sampler2D u_tex; uniform float u_alpha;
in vec2 v_uv; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; })";

Program P_SOLID, P_LINE, P_TEX;

// ---------------------------------------------------------------- GPU meshes
struct Mesh {
  int vao = 0, vbo = 0, ibo = 0;
  int count = 0;      // index count (fill) or vertex count (line / tex)
  bool indexed = false;
  void destroy() {
    if (vao) glDeleteVertexArray(vao);
    if (vbo) glDeleteBuffer(vbo);
    if (ibo) glDeleteBuffer(ibo);
    vao = vbo = ibo = count = 0;
  }
};

// floats per vertex: 2 (pos) or 4 (pos + extrude/uv)
Mesh upload(const std::vector<float>& verts, int floatsPerVertex, const std::vector<uint32_t>* indices) {
  Mesh m;
  if (verts.empty()) return m;
  m.vao = glCreateVertexArray();
  glBindVertexArray(m.vao);
  m.vbo = glCreateBuffer();
  glBindBuffer(GL_ARRAY_BUFFER, m.vbo);
  glBufferData(GL_ARRAY_BUFFER, verts.data(), int(verts.size() * sizeof(float)), GL_STATIC_DRAW);
  int stride = floatsPerVertex * 4;
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, 0, stride, 0);
  if (floatsPerVertex == 4) {
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, 0, stride, 8);
  }
  if (indices && !indices->empty()) {
    m.ibo = glCreateBuffer();
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m.ibo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices->data(), int(indices->size() * 4), GL_STATIC_DRAW);
    m.count = int(indices->size());
    m.indexed = true;
  } else {
    m.count = int(verts.size() / floatsPerVertex);
  }
  glBindVertexArray(0);
  return m;
}

void drawMesh(const Mesh& m) {
  if (!m.vao || !m.count) return;
  glBindVertexArray(m.vao);
  if (m.indexed) glDrawElements(GL_TRIANGLES, m.count, GL_UNSIGNED_INT, 0);
  else glDrawArrays(GL_TRIANGLES, 0, m.count);
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
struct Tile {
  TileState state = LOADING;
  uint32_t extent = 4096;
  Mesh buckets[B_COUNT];
  double lastUsed = 0;
};

std::unordered_map<TileKey, Tile, TileKeyHash> tiles;

void buildTile(Tile& t, const uint8_t* data, size_t len) {
  std::vector<mvt::Layer> layers = mvt::readTile(data, len);
  std::vector<float> verts[B_COUNT];
  std::vector<uint32_t> idx[B_COUNT];
  for (const auto& l : layers) {
    t.extent = l.extent ? l.extent : 4096;
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
  for (int b = 0; b < B_COUNT; b++) {
    if (verts[b].empty()) continue;
    t.buckets[b] = STYLES[b].kind == FILL ? upload(verts[b], 2, &idx[b]) : upload(verts[b], 4, nullptr);
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
  double targetZoom = 13;
  double anchorX = 0, anchorY = 0; // screen point kept fixed while zooming
  int w = 1, h = 1;
  float dpr = 1;
  double worldPx() const { return TILE_PX * dpr * std::pow(2.0, zoom); }
} cam;

struct Pointer { int id; float x, y, startX, startY; };
std::vector<Pointer> pointers;
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
int quadVao = 0, quadVbo = 0;

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

void updateHover(float sx, float sy) {
  Merc m = screenToMerc(sx, sy);
  int found = -1;
  for (int i = int(posts.size()) - 1; i >= 0; i--) {
    const Post& p = posts[i];
    if (p.kind == P_ZONE && !p.draft && pointInRing(p.ring, m)) { found = i; break; }
  }
  if (found != hovered) {
    hovered = found;
    dirty = true;
    js_on_hover(found);
  }
}

// draw a textured rectangle: (x, y) is the top-left corner in device pixels
void drawQuad(int tex, double x, double y, double w, double h, float alpha) {
  if (!tex) return;
  float v[24] = {0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1};
  // scale is applied via u_scale on a unit quad; width/height differ so build the quad directly
  float q[24] = {
    float(x), float(y), 0, 0,  float(x + w), float(y), 1, 0,  float(x), float(y + h), 0, 1,
    float(x + w), float(y), 1, 0,  float(x + w), float(y + h), 1, 1,  float(x), float(y + h), 0, 1,
  };
  (void)v;
  glBindVertexArray(quadVao);
  glBindBuffer(GL_ARRAY_BUFFER, quadVbo);
  glBufferData(GL_ARRAY_BUFFER, q, sizeof(q), GL_DYNAMIC_DRAW);
  glUseProgram(P_TEX.id);
  glUniform2f(P_TEX.u_offset, 0, 0);
  glUniform1f(P_TEX.u_scale, 1);
  glUniform2f(P_TEX.u_view, float(cam.w), float(cam.h));
  glUniform1f(P_TEX.u_alpha, alpha);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, tex);
  glUniform1i(P_TEX.u_tex, 0);
  glDrawArrays(GL_TRIANGLES, 0, 6);
}

void drawSolidQuad(RGBA c, double x, double y, double w, double h) {
  float q[12] = {float(x), float(y), float(x + w), float(y), float(x), float(y + h),
                 float(x + w), float(y), float(x + w), float(y + h), float(x), float(y + h)};
  float q4[24];
  for (int i = 0; i < 6; i++) { q4[i * 4] = q[i * 2]; q4[i * 4 + 1] = q[i * 2 + 1]; q4[i * 4 + 2] = 0; q4[i * 4 + 3] = 0; }
  glBindVertexArray(quadVao);
  glBindBuffer(GL_ARRAY_BUFFER, quadVbo);
  glBufferData(GL_ARRAY_BUFFER, q4, sizeof(q4), GL_DYNAMIC_DRAW);
  glUseProgram(P_SOLID.id);
  glUniform2f(P_SOLID.u_offset, 0, 0);
  glUniform1f(P_SOLID.u_scale, 1);
  glUniform2f(P_SOLID.u_view, float(cam.w), float(cam.h));
  glUniform4f(P_SOLID.u_color, c.r, c.g, c.b, c.a);
  glDrawArrays(GL_TRIANGLES, 0, 6);
}

void drawLabel(const Post& p, double cxPx, double bottomPx) {
  if (!p.labelTex) return;
  double w = p.lw, h = p.lh; // label textures are made at device pixel size
  drawQuad(p.labelTex, std::round(cxPx - w / 2), std::round(bottomPx - h), w, h, p.alpha);
}

double iconSizePx() {
  double s = cfg.iconSize;
  if (cfg.iconScaleWithZoom) {
    s = cfg.iconSize * std::pow(2.0, cam.zoom - cfg.iconRefZoom);
    s = std::max<double>(cfg.iconMin, std::min<double>(cfg.iconSize, s));
  }
  return s * cam.dpr;
}

void setLocalUniforms(const Program& pr, Merc origin) {
  double wp = cam.worldPx();
  glUniform2f(pr.u_offset, float((origin.x - cam.cx) * wp + cam.w / 2.0), float((origin.y - cam.cy) * wp + cam.h / 2.0));
  glUniform1f(pr.u_scale, float(wp / LOCAL));
  glUniform2f(pr.u_view, float(cam.w), float(cam.h));
}

void drawPosts() {
  const bool zoomedIn = cam.zoom >= cfg.adInfoZoom;
  // zones first (they sit on the ground), then markers and labels on top
  for (size_t i = 0; i < posts.size(); i++) {
    Post& p = posts[i];
    if (p.kind != P_ZONE) continue;
    bool showImage = p.tex && !zoomedIn && hovered != int(i);
    if (showImage) {
      glUseProgram(P_TEX.id);
      setLocalUniforms(P_TEX, p.origin);
      glUniform1f(P_TEX.u_alpha, p.alpha);
      glActiveTexture(GL_TEXTURE0);
      glBindTexture(GL_TEXTURE_2D, p.tex);
      glUniform1i(P_TEX.u_tex, 0);
      drawMesh(p.fillTex);
    } else {
      glUseProgram(P_SOLID.id);
      setLocalUniforms(P_SOLID, p.origin);
      glUniform4f(P_SOLID.u_color, cfg.zoneFill.r, cfg.zoneFill.g, cfg.zoneFill.b, cfg.zoneFill.a * p.alpha);
      drawMesh(p.fillTex);
    }
    glUseProgram(P_LINE.id);
    setLocalUniforms(P_LINE, p.origin);
    glUniform1f(P_LINE.u_width, cfg.zoneBorderWidth * cam.dpr);
    glUniform4f(P_LINE.u_color, cfg.zoneBorder.r, cfg.zoneBorder.g, cfg.zoneBorder.b, p.draft ? 0.6f : 1.f);
    drawMesh(p.outline);
  }

  for (size_t i = 0; i < posts.size(); i++) {
    const Post& p = posts[i];
    double sx, sy;
    if (p.kind == P_PIXEL) {
      mercToScreen(p.at, sx, sy);
      double s = cfg.pixelSize * cam.dpr;
      RGBA edge{0, 0, 0, 0.35f * p.alpha};
      drawSolidQuad(edge, std::round(sx - s / 2), std::round(sy - s / 2), s, s);
      RGBA c = cfg.pixelColor;
      c.a *= p.alpha;
      drawSolidQuad(c, std::round(sx - s / 2) + cam.dpr, std::round(sy - s / 2) + cam.dpr, s - 2 * cam.dpr, s - 2 * cam.dpr);
      drawLabel(p, sx, sy - s / 2 - cfg.labelGap * cam.dpr);
    } else if (p.kind == P_ICON) {
      mercToScreen(p.at, sx, sy);
      double s = iconSizePx();
      double maxDim = std::max(p.tw, p.th);
      double w = s * p.tw / maxDim, h = s * p.th / maxDim;
      drawQuad(p.tex, std::round(sx - w / 2), std::round(sy - h / 2), w, h, p.alpha);
      drawLabel(p, sx, sy - h / 2 - cfg.labelGap * cam.dpr);
    } else {
      bool showInfo = p.draft || zoomedIn || hovered == int(i);
      if (!showInfo) continue;
      mercToScreen(p.center, sx, sy);
      if (p.thumbTex) {
        double w = p.thw, h = p.thh;
        drawQuad(p.thumbTex, std::round(sx - w / 2), std::round(sy - h / 2), w, h, p.alpha);
        drawLabel(p, sx, sy - h / 2 - cfg.labelGap * cam.dpr);
      } else {
        drawLabel(p, sx, sy);
      }
    }
  }

  if (previewLine.count) {
    glUseProgram(P_LINE.id);
    setLocalUniforms(P_LINE, previewOrigin);
    glUniform1f(P_LINE.u_width, 2.0f * cam.dpr);
    glUniform4f(P_LINE.u_color, cfg.zoneBorder.r, cfg.zoneBorder.g, cfg.zoneBorder.b, 0.9f);
    drawMesh(previewLine);
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

void tileUniforms(const Program& pr, const DrawTile& d) {
  double n = double(1 << d.key.z);
  double wp = cam.worldPx();
  double ox = (d.key.x / n - cam.cx) * wp + cam.w / 2.0;
  double oy = (d.key.y / n - cam.cy) * wp + cam.h / 2.0;
  glUniform2f(pr.u_offset, float(ox), float(oy));
  glUniform1f(pr.u_scale, float(wp / n / d.tile->extent));
  glUniform2f(pr.u_view, float(cam.w), float(cam.h));
}

void drawBaseMap(const std::vector<DrawTile>& list) {
  glUseProgram(P_SOLID.id);
  for (BucketId b : FILL_ORDER) {
    const Style& s = STYLES[b];
    if (cam.zoom < s.minZoom) continue;
    glUniform4f(P_SOLID.u_color, s.color.r, s.color.g, s.color.b, s.color.a);
    for (auto& d : list) { tileUniforms(P_SOLID, d); drawMesh(d.tile->buckets[b]); }
  }
  glUseProgram(P_LINE.id);
  // casings (darker, wider) under all roads, then the road fills
  for (int pass = 0; pass < 2; pass++) {
    for (BucketId b : LINE_ORDER) {
      const Style& s = STYLES[b];
      if (cam.zoom < s.minZoom) continue;
      if (pass == 0 && s.casing.a == 0) continue;
      RGBA c = pass == 0 ? s.casing : s.color;
      float w = lineWidthPx(s) + (pass == 0 ? 2.0f * cam.dpr : 0.f);
      glUniform4f(P_LINE.u_color, c.r, c.g, c.b, c.a);
      glUniform1f(P_LINE.u_width, w);
      for (auto& d : list) { tileUniforms(P_LINE, d); drawMesh(d.tile->buckets[b]); }
    }
  }
}

} // namespace

// ================================================================= exports

EXPORT(engine_alloc) void* engine_alloc(int n) { return std::malloc(size_t(n)); }
EXPORT(engine_free) void engine_free(void* p) { std::free(p); }

EXPORT(engine_init) void engine_init() {
  P_SOLID = link(VS_SOLID, FS_SOLID);
  P_LINE = link(VS_LINE, FS_SOLID);
  P_TEX = link(VS_TEX, FS_TEX);
  quadVao = glCreateVertexArray();
  glBindVertexArray(quadVao);
  quadVbo = glCreateBuffer();
  glBindBuffer(GL_ARRAY_BUFFER, quadVbo);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, 0, 16, 0);
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(1, 2, GL_FLOAT, 0, 16, 8);
  glBindVertexArray(0);
  log("C++ map engine ready");
}

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

EXPORT(engine_screen_to_lnglat) void engine_screen_to_lnglat(float sx, float sy, double* out) {
  fromMerc(screenToMerc(sx, sy), out[0], out[1]);
}

EXPORT(engine_lnglat_to_screen) void engine_lnglat_to_screen(double lng, double lat, double* out) {
  mercToScreen(toMerc(lng, lat), out[0], out[1]);
}

// ---- tiles
EXPORT(engine_tile_loaded) void engine_tile_loaded(int z, int x, int y, const uint8_t* data, int len) {
  auto it = tiles.find(TileKey{z, x, y});
  if (it == tiles.end()) return; // evicted while loading
  buildTile(it->second, data, size_t(len));
  dirty = true;
}
EXPORT(engine_tile_failed) void engine_tile_failed(int z, int x, int y) {
  auto it = tiles.find(TileKey{z, x, y});
  if (it != tiles.end()) it->second.state = FAILED;
}

// ---- textures (RGBA, premultiplied by the bridge)
EXPORT(engine_tex_create) int engine_tex_create(const uint8_t* rgba, int w, int h) {
  int t = glCreateTexture();
  glBindTexture(GL_TEXTURE_2D, t);
  glTexImage2D(w, h, rgba);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  return t;
}
EXPORT(engine_tex_delete) void engine_tex_delete(int t) { glDeleteTexture(t); }

// ---- posts
EXPORT(engine_posts_clear) void engine_posts_clear() {
  for (auto& p : posts) destroyPost(p);
  posts.clear();
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

EXPORT(engine_pointer_down) void engine_pointer_down(int id, float x, float y) {
  pointers.erase(std::remove_if(pointers.begin(), pointers.end(), [&](auto& p) { return p.id == id; }), pointers.end());
  pointers.push_back({id, x, y, x, y});
  cam.targetZoom = cam.zoom; // stop any zoom animation
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
  if (pointers.size() == 1 && panEnabled) {
    double wp = cam.worldPx();
    cam.cx -= dx / wp;
    cam.cy -= dy / wp;
    clampCamera();
    dirty = true;
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
  int click = 0;
  for (auto& p : pointers) {
    if (p.id == id) {
      click = (std::hypot(x - p.startX, y - p.startY) < 5 * cam.dpr && pointers.size() == 1) ? 1 : 0;
    }
  }
  pointers.erase(std::remove_if(pointers.begin(), pointers.end(), [&](auto& p) { return p.id == id; }), pointers.end());
  if (pointers.size() < 2) pinchDist = 0;
  return click;
}

EXPORT(engine_pointer_leave) void engine_pointer_leave() {
  if (hovered != -1) { hovered = -1; dirty = true; js_on_hover(-1); }
}

// smooth zoom toward the cursor
EXPORT(engine_wheel) void engine_wheel(float x, float y, float deltaY) {
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

// ---- one frame. Returns 1 if something is still moving (keep requesting frames).
EXPORT(engine_frame) int engine_frame(int w, int h, float dpr) {
  if (w != cam.w || h != cam.h || dpr != cam.dpr) { cam.w = w; cam.h = h; cam.dpr = dpr; dirty = true; }
  bool animating = std::fabs(cam.targetZoom - cam.zoom) > 0.0005;
  if (animating) {
    double z = cam.zoom + (cam.targetZoom - cam.zoom) * 0.25;
    if (std::fabs(cam.targetZoom - z) < 0.001) z = cam.targetZoom;
    zoomAround(z, cam.anchorX, cam.anchorY);
  }
  if (!dirty && !animating) return 0;
  dirty = false;

  double now = js_now_ms();
  glViewport(0, 0, cam.w, cam.h);
  RGBA bg = hex(0xf2efe9);
  glClearColor(bg.r, bg.g, bg.b, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glEnable(GL_BLEND);
  glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);

  auto list = collectTiles(now);
  drawBaseMap(list);
  drawPosts();
  evictTiles(now);
  return animating ? 1 : 0;
}

// called when a tile finishes loading, an image is ready, etc.
EXPORT(engine_invalidate) void engine_invalidate() { dirty = true; }
