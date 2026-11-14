// Minimal Mapbox Vector Tile (protobuf) decoder.
// Spec: https://github.com/mapbox/vector-tile-spec
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mvt {

struct Reader {
  const uint8_t* p;
  const uint8_t* end;
  bool ok() const { return p < end; }

  uint64_t varint() {
    uint64_t v = 0;
    int shift = 0;
    while (p < end) {
      uint8_t b = *p++;
      v |= uint64_t(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return v;
  }
  Reader sub() {
    uint64_t len = varint();
    const uint8_t* s = p;
    p = (p + len <= end) ? p + len : end;
    return Reader{s, p};
  }
  void skip(int wire) {
    switch (wire) {
      case 0: varint(); break;
      case 1: p += 8; break;
      case 2: { uint64_t l = varint(); p += l; break; }
      case 5: p += 4; break;
      default: p = end; break;
    }
    if (p > end) p = end;
  }
};

inline int32_t zigzag(uint32_t n) { return int32_t(n >> 1) ^ -int32_t(n & 1); }

struct Point { int32_t x, y; };
using Ring = std::vector<Point>;

enum GeomType { UNKNOWN = 0, POINT = 1, LINESTRING = 2, POLYGON = 3 };

struct Feature {
  GeomType type = UNKNOWN;
  std::vector<uint32_t> tags;
  std::vector<uint32_t> geometry;
};

struct Layer {
  std::string name;
  uint32_t extent = 4096;
  std::vector<std::string> keys;
  std::vector<std::string> values; // only string values kept (others -> "")
  std::vector<Feature> features;

  std::string_view get(const Feature& f, std::string_view key) const {
    for (size_t i = 0; i + 1 < f.tags.size(); i += 2) {
      uint32_t k = f.tags[i], v = f.tags[i + 1];
      if (k < keys.size() && keys[k] == key && v < values.size()) return values[v];
    }
    return {};
  }
};

inline std::vector<uint32_t> packed(Reader r) {
  std::vector<uint32_t> out;
  while (r.ok()) out.push_back(uint32_t(r.varint()));
  return out;
}

inline Feature readFeature(Reader r) {
  Feature f;
  while (r.ok()) {
    uint64_t key = r.varint();
    int field = int(key >> 3), wire = int(key & 7);
    if (field == 2 && wire == 2) f.tags = packed(r.sub());
    else if (field == 3 && wire == 0) f.type = GeomType(r.varint());
    else if (field == 4 && wire == 2) f.geometry = packed(r.sub());
    else r.skip(wire);
  }
  return f;
}

inline std::string readValue(Reader r) {
  std::string s;
  while (r.ok()) {
    uint64_t key = r.varint();
    int field = int(key >> 3), wire = int(key & 7);
    if (field == 1 && wire == 2) {
      Reader sr = r.sub();
      s.assign(reinterpret_cast<const char*>(sr.p), size_t(sr.end - sr.p));
    } else r.skip(wire);
  }
  return s;
}

inline Layer readLayer(Reader r) {
  Layer l;
  while (r.ok()) {
    uint64_t key = r.varint();
    int field = int(key >> 3), wire = int(key & 7);
    if (field == 1 && wire == 2) { Reader s = r.sub(); l.name.assign((const char*)s.p, size_t(s.end - s.p)); }
    else if (field == 2 && wire == 2) l.features.push_back(readFeature(r.sub()));
    else if (field == 3 && wire == 2) { Reader s = r.sub(); l.keys.emplace_back((const char*)s.p, size_t(s.end - s.p)); }
    else if (field == 4 && wire == 2) l.values.push_back(readValue(r.sub()));
    else if (field == 5 && wire == 0) l.extent = uint32_t(r.varint());
    else r.skip(wire);
  }
  return l;
}

inline std::vector<Layer> readTile(const uint8_t* data, size_t len) {
  std::vector<Layer> layers;
  Reader r{data, data + len};
  while (r.ok()) {
    uint64_t key = r.varint();
    int field = int(key >> 3), wire = int(key & 7);
    if (field == 3 && wire == 2) layers.push_back(readLayer(r.sub()));
    else r.skip(wire);
  }
  return layers;
}

// Decode geometry commands into rings / lines (tile coordinates)
inline std::vector<Ring> decodeGeometry(const Feature& f) {
  std::vector<Ring> rings;
  int32_t x = 0, y = 0;
  size_t i = 0;
  const auto& g = f.geometry;
  while (i < g.size()) {
    uint32_t cmd = g[i] & 7, count = g[i] >> 3;
    i++;
    if (cmd == 1) { // MoveTo
      for (uint32_t c = 0; c < count && i + 1 < g.size(); c++) {
        x += zigzag(g[i++]);
        y += zigzag(g[i++]);
        rings.push_back(Ring{{x, y}});
      }
    } else if (cmd == 2) { // LineTo
      for (uint32_t c = 0; c < count && i + 1 < g.size(); c++) {
        x += zigzag(g[i++]);
        y += zigzag(g[i++]);
        if (!rings.empty()) rings.back().push_back({x, y});
      }
    } else if (cmd == 7) { // ClosePath
      // rings are treated as closed by the triangulator
    } else {
      break;
    }
  }
  return rings;
}

inline double signedArea(const Ring& r) {
  double a = 0;
  for (size_t i = 0, j = r.size() - 1; i < r.size(); j = i++)
    a += double(r[j].x) * r[i].y - double(r[i].x) * r[j].y;
  return a / 2;
}

} // namespace mvt
