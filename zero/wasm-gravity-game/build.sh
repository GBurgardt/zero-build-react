#!/bin/bash
set -euo pipefail

echo "🔨 Compilando física C++ a WebAssembly (gravity game)..."

emcc physics.cpp \
  -O3 \
  -s WASM=1 \
  --bind \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=Module \
  -s ALLOW_MEMORY_GROWTH=1 \
  -o physics.js

echo "✅ Compilación OK"
ls -la physics.js physics.wasm || true
