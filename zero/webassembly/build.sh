#!/bin/bash
set -euo pipefail

echo "🔨 Compilando C++ a WebAssembly..."

emcc renderer.cpp \
    -O3 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_init","_addCircle","_updateCircles","_getPositions","_getColors","_getSizes","_getCircleCount","_clearCircles"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAPU8","HEAPF32"]' \
    --bind \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=Module \
    -o renderer.js

echo "✅ Compilación exitosa!"

if [ -f renderer.js ] && [ -f renderer.wasm ]; then
  echo "📁 Archivos generados:"
  ls -la renderer.js renderer.wasm
else
  echo "⚠️ Advertencia: archivos esperados no encontrados."
  ls -la
fi
