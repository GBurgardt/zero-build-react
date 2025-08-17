#!/bin/bash
set -euo pipefail

echo "🔨 Compilando Soccer WASM ..."

emcc physics.cpp \
  -O3 \
  --bind \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=Module \
  -s ALLOW_MEMORY_GROWTH=1 \
  -o physics.js

echo "✅ Compilación OK"
ls -la physics.js physics.wasm || true
