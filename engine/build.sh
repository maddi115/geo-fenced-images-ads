#!/usr/bin/env bash
# Builds the C++ map engine into public/engine.wasm
# First run downloads the wasi-sdk C++ -> WebAssembly compiler (~110 MB) into engine/.toolchain/
set -euo pipefail
cd "$(dirname "$0")"

VER=25
SDK=".toolchain/wasi-sdk-${VER}.0-x86_64-linux"
if [ ! -x "$SDK/bin/clang++" ]; then
  echo "Downloading wasi-sdk ${VER} (one time)..."
  mkdir -p .toolchain
  curl -fL -o .toolchain/wasi-sdk.tar.gz \
    "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${VER}/wasi-sdk-${VER}.0-x86_64-linux.tar.gz"
  tar xzf .toolchain/wasi-sdk.tar.gz -C .toolchain
  rm .toolchain/wasi-sdk.tar.gz
fi

"$SDK/bin/clang++" \
  --target=wasm32-wasip1 --sysroot="$SDK/share/wasi-sysroot" \
  -std=c++20 -O3 -flto -fno-exceptions -fno-rtti -DNDEBUG \
  -mexec-model=reactor -mbulk-memory -msimd128 \
  -Wl,--strip-all -Wl,--gc-sections \
  -o ../public/engine.wasm src/engine.cpp

echo "Built public/engine.wasm ($(wc -c < ../public/engine.wasm) bytes)"
