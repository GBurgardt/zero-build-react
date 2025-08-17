#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdlib>

using namespace emscripten;

struct Particle {
    float x, y;
    float vx, vy;
};

static std::vector<Particle> particles;
static const size_t MAX_PARTICLES = 1000000; // 1M

static float blackHoleX = 0.5f;
static float blackHoleY = 0.5f;
static float gravityStrength = 120.0f; // ajustable desde JS si queremos

void init() {
    particles.clear();
    particles.reserve(MAX_PARTICLES);
}

void clearAll() {
    particles.clear();
}

void setBlackHole(float x, float y) {
    blackHoleX = x;
    blackHoleY = y;
}

void spawnRandom(size_t n) {
    if (n > MAX_PARTICLES) n = MAX_PARTICLES;
    size_t canAdd = (particles.size() + n > MAX_PARTICLES) ? (MAX_PARTICLES - particles.size()) : n;
    for (size_t i = 0; i < canAdd; i++) {
        Particle p;
        p.x = static_cast<float>(std::rand()) / RAND_MAX; // [0,1]
        p.y = static_cast<float>(std::rand()) / RAND_MAX;
        p.vx = 0.0f;
        p.vy = 0.0f;
        particles.push_back(p);
    }
}

size_t getCount() {
    return particles.size();
}

// Integración simple con atracción newtoniana hacia el agujero negro
void step(float dtMs) {
    const float dt = dtMs / 1000.0f; // ms a segundos
    const float G = gravityStrength; // constante

    // Evitar ramas: sumar epsilon al denom
    const float epsilon = 1e-5f;

    for (size_t i = 0; i < particles.size(); i++) {
        Particle &p = particles[i];
        float dx = blackHoleX - p.x;
        float dy = blackHoleY - p.y;
        float r2 = dx*dx + dy*dy + epsilon;
        float invR = 1.0f / std::sqrt(r2);

        // fuerza ~ 1/r^2 pero limitamos para estabilidad
        float a = G * invR * invR; // ~ 1/r^2
        // dirección normalizada
        float ux = dx * invR;
        float uy = dy * invR;

        // actualizar velocidad
        p.vx += a * ux * dt;
        p.vy += a * uy * dt;

        // damping leve
        p.vx *= 0.9995f;
        p.vy *= 0.9995f;

        // actualizar posición
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
}

val getPositionsView() {
    static std::vector<float> buf;
    buf.resize(particles.size() * 2);
    for (size_t i = 0; i < particles.size(); i++) {
        buf[i*2]   = particles[i].x;
        buf[i*2+1] = particles[i].y;
    }
    return val(typed_memory_view(buf.size(), buf.data()));
}

EMSCRIPTEN_BINDINGS(physics_bindings) {
    function("init", &init);
    function("clearAll", &clearAll);
    function("setBlackHole", &setBlackHole);
    function("spawnRandom", &spawnRandom);
    function("getCount", &getCount);
    function("step", &step);
    function("getPositionsView", &getPositionsView);
}
