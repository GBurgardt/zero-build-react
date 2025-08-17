#include <emscripten.h>
#include <cmath>
#include <vector>
#include <cstdlib>
#include <emscripten/bind.h>

// Estructura para cada círculo
struct Circle {
    float x, y;
    float vx, vy;  // velocidad
    float r, g, b; // color
    float size;
};

std::vector<Circle> circles;
const int MAX_CIRCLES = 50000;

extern "C" {
    // Inicializar
    EMSCRIPTEN_KEEPALIVE
    void init() {
        circles.clear();
        circles.reserve(MAX_CIRCLES);
    }
    
    // Agregar círculo
    EMSCRIPTEN_KEEPALIVE
    void addCircle(float x, float y) {
        if ((int)circles.size() >= MAX_CIRCLES) return;
        
        Circle c;
        c.x = x;
        c.y = y;
        // Velocidad random para efecto cool
        c.vx = (std::rand() % 100 - 50) * 0.001f;
        c.vy = (std::rand() % 100 - 50) * 0.001f;
        // Color gradiente basado en posición
        c.r = x;
        c.g = 0.5f;
        c.b = 1.0f - x;
        c.size = 3.0f + (std::rand() % 20);
        
        circles.push_back(c);
    }
    
    // Update physics
    EMSCRIPTEN_KEEPALIVE
    void updateCircles(float deltaTime) {
        for (auto& c : circles) {
            c.x += c.vx * deltaTime;
            c.y += c.vy * deltaTime;
            
            // Bounce en bordes
            if (c.x < 0 || c.x > 1) c.vx *= -0.9f;
            if (c.y < 0 || c.y > 1) c.vy *= -0.9f;
            
            // Gravedad sutil
            c.vy += 0.00001f * deltaTime;
            
            // Damping
            c.vx *= 0.999f;
            c.vy *= 0.999f;
        }
    }
    
    // Obtener buffer de posiciones para WebGL
    EMSCRIPTEN_KEEPALIVE
    float* getPositions() {
        static std::vector<float> positions;
        positions.clear();
        positions.reserve(circles.size() * 2);
        
        for (const auto& c : circles) {
            positions.push_back(c.x);
            positions.push_back(c.y);
        }
        
        return positions.data();
    }
    
    // Obtener buffer de colores
    EMSCRIPTEN_KEEPALIVE
    float* getColors() {
        static std::vector<float> colors;
        colors.clear();
        colors.reserve(circles.size() * 3);
        
        for (const auto& c : circles) {
            colors.push_back(c.r);
            colors.push_back(c.g);
            colors.push_back(c.b);
        }
        
        return colors.data();
    }
    
    // Obtener buffer de tamaños
    EMSCRIPTEN_KEEPALIVE
    float* getSizes() {
        static std::vector<float> sizes;
        sizes.clear();
        sizes.reserve(circles.size());
        
        for (const auto& c : circles) {
            sizes.push_back(c.size);
        }
        
        return sizes.data();
    }
    
    // Obtener cantidad de círculos
    EMSCRIPTEN_KEEPALIVE
    int getCircleCount() {
        return (int)circles.size();
    }
    
    // Limpiar todo
    EMSCRIPTEN_KEEPALIVE
    void clearCircles() {
        circles.clear();
    }
}

// --- Embind: vistas tipadas para evitar acceso manual al HEAP desde JS ---
using namespace emscripten;

static std::vector<float> positionsScratch;
static std::vector<float> colorsScratch;
static std::vector<float> sizesScratch;

val getPositionsView() {
    positionsScratch.clear();
    positionsScratch.reserve(circles.size() * 2);
    for (const auto& c : circles) {
        positionsScratch.push_back(c.x);
        positionsScratch.push_back(c.y);
    }
    return val(typed_memory_view(positionsScratch.size(), positionsScratch.data()));
}

val getColorsView() {
    colorsScratch.clear();
    colorsScratch.reserve(circles.size() * 3);
    for (const auto& c : circles) {
        colorsScratch.push_back(c.r);
        colorsScratch.push_back(c.g);
        colorsScratch.push_back(c.b);
    }
    return val(typed_memory_view(colorsScratch.size(), colorsScratch.data()));
}

val getSizesView() {
    sizesScratch.clear();
    sizesScratch.reserve(circles.size());
    for (const auto& c : circles) {
        sizesScratch.push_back(c.size);
    }
    return val(typed_memory_view(sizesScratch.size(), sizesScratch.data()));
}

EMSCRIPTEN_BINDINGS(renderer_bindings) {
    function("getPositionsView", &getPositionsView);
    function("getColorsView", &getColorsView);
    function("getSizesView", &getSizesView);
}
