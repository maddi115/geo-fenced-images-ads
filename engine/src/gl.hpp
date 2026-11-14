// WebGL2 functions provided by the JavaScript bridge (src/infrastructure/engine/engine.ts).
// The browser only exposes the GPU through WebGL, so these are thin imports;
// all decisions about WHAT to draw are made in C++.
#pragma once
#include <cstdint>

#define GL_IMPORT(name) extern "C" __attribute__((import_module("gl"), import_name(#name)))

GL_IMPORT(createShader) int glCreateShader(int type);
GL_IMPORT(shaderSource) void glShaderSource(int shader, const char* src, int len);
GL_IMPORT(compileShader) int glCompileShader(int shader); // returns 1 if ok
GL_IMPORT(createProgram) int glCreateProgram();
GL_IMPORT(attachShader) void glAttachShader(int prog, int shader);
GL_IMPORT(linkProgram) int glLinkProgram(int prog); // returns 1 if ok
GL_IMPORT(useProgram) void glUseProgram(int prog);
GL_IMPORT(getUniformLocation) int glGetUniformLocation(int prog, const char* name, int len);
GL_IMPORT(uniform1f) void glUniform1f(int loc, float a);
GL_IMPORT(uniform2f) void glUniform2f(int loc, float a, float b);
GL_IMPORT(uniform4f) void glUniform4f(int loc, float a, float b, float c, float d);
GL_IMPORT(uniform1i) void glUniform1i(int loc, int a);
GL_IMPORT(createBuffer) int glCreateBuffer();
GL_IMPORT(deleteBuffer) void glDeleteBuffer(int buf);
GL_IMPORT(bindBuffer) void glBindBuffer(int target, int buf);
GL_IMPORT(bufferData) void glBufferData(int target, const void* data, int bytes, int usage);
GL_IMPORT(createVertexArray) int glCreateVertexArray();
GL_IMPORT(deleteVertexArray) void glDeleteVertexArray(int vao);
GL_IMPORT(bindVertexArray) void glBindVertexArray(int vao);
GL_IMPORT(enableVertexAttribArray) void glEnableVertexAttribArray(int index);
GL_IMPORT(vertexAttribPointer) void glVertexAttribPointer(int index, int size, int type, int normalized, int stride, int offset);
GL_IMPORT(drawArrays) void glDrawArrays(int mode, int first, int count);
GL_IMPORT(drawElements) void glDrawElements(int mode, int count, int type, int offset);
GL_IMPORT(viewport) void glViewport(int x, int y, int w, int h);
GL_IMPORT(clearColor) void glClearColor(float r, float g, float b, float a);
GL_IMPORT(clear) void glClear(int mask);
GL_IMPORT(enable) void glEnable(int cap);
GL_IMPORT(disable) void glDisable(int cap);
GL_IMPORT(blendFunc) void glBlendFunc(int s, int d);
GL_IMPORT(createTexture) int glCreateTexture();
GL_IMPORT(deleteTexture) void glDeleteTexture(int tex);
GL_IMPORT(bindTexture) void glBindTexture(int target, int tex);
GL_IMPORT(activeTexture) void glActiveTexture(int unit);
GL_IMPORT(texImage2D) void glTexImage2D(int w, int h, const void* rgba);
GL_IMPORT(texParameteri) void glTexParameteri(int target, int pname, int param);
GL_IMPORT(generateMipmap) void glGenerateMipmap(int target);

// Other things only JavaScript can do
#define ENV_IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
ENV_IMPORT(request_tile) void js_request_tile(int z, int x, int y);
ENV_IMPORT(on_hover) void js_on_hover(int postIndex);
ENV_IMPORT(log) void js_log(const char* msg, int len);
ENV_IMPORT(now_ms) double js_now_ms();

// GL constants used
constexpr int GL_VERTEX_SHADER = 0x8B31;
constexpr int GL_FRAGMENT_SHADER = 0x8B30;
constexpr int GL_ARRAY_BUFFER = 0x8892;
constexpr int GL_ELEMENT_ARRAY_BUFFER = 0x8893;
constexpr int GL_STATIC_DRAW = 0x88E4;
constexpr int GL_DYNAMIC_DRAW = 0x88E8;
constexpr int GL_FLOAT = 0x1406;
constexpr int GL_UNSIGNED_INT = 0x1405;
constexpr int GL_TRIANGLES = 0x0004;
constexpr int GL_TRIANGLE_STRIP = 0x0005;
constexpr int GL_COLOR_BUFFER_BIT = 0x4000;
constexpr int GL_BLEND = 0x0BE2;
constexpr int GL_ONE = 1;
constexpr int GL_ONE_MINUS_SRC_ALPHA = 0x0303;
constexpr int GL_TEXTURE_2D = 0x0DE1;
constexpr int GL_TEXTURE0 = 0x84C0;
constexpr int GL_TEXTURE_MIN_FILTER = 0x2801;
constexpr int GL_TEXTURE_MAG_FILTER = 0x2800;
constexpr int GL_TEXTURE_WRAP_S = 0x2802;
constexpr int GL_TEXTURE_WRAP_T = 0x2803;
constexpr int GL_LINEAR = 0x2601;
constexpr int GL_LINEAR_MIPMAP_LINEAR = 0x2703;
constexpr int GL_CLAMP_TO_EDGE = 0x812F;
