// Drawing commands the C++ engine sends to the GPU backend.
// The backend (src/infrastructure/engine/backends/) is WebGPU when the browser has it,
// otherwise WebGL2. C++ decides WHAT to draw and WHERE; the backend only executes.
#pragma once
#include <cstdint>

#define GFX(name) extern "C" __attribute__((import_module("gfx"), import_name(#name)))

// meshes: floatsPerVertex = 2 (x,y) or 4 (x,y + extrude or uv). indices optional (nIdx = 0)
GFX(mesh_create) int gfx_mesh_create(const float* verts, int nFloats, int floatsPerVertex, const uint32_t* idx, int nIdx);
GFX(mesh_delete) void gfx_mesh_delete(int mesh);
// RGBA8, not premultiplied (the backend premultiplies)
GFX(tex_create) int gfx_tex_create(const uint8_t* rgba, int w, int h);
GFX(tex_delete) void gfx_tex_delete(int tex);

GFX(begin) void gfx_begin(int w, int h, float r, float g, float b);
// screen position of a vertex = (ox, oy) + pos * scale   (device pixels)
GFX(solid) void gfx_solid(int mesh, float ox, float oy, float scale, float r, float g, float b, float a);
GFX(line) void gfx_line(int mesh, float ox, float oy, float scale, float width, float r, float g, float b, float a);
GFX(tex) void gfx_tex(int mesh, float ox, float oy, float scale, int tex, float alpha);
GFX(quad_solid) void gfx_quad_solid(float x, float y, float w, float h, float r, float g, float b, float a);
GFX(quad_tex) void gfx_quad_tex(int tex, float x, float y, float w, float h, float alpha);
GFX(end) void gfx_end();

// Other things only JavaScript can do
#define ENV_IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
ENV_IMPORT(request_tile) void js_request_tile(int z, int x, int y);
ENV_IMPORT(on_hover) void js_on_hover(int postIndex);
ENV_IMPORT(log) void js_log(const char* msg, int len);
ENV_IMPORT(now_ms) double js_now_ms();
