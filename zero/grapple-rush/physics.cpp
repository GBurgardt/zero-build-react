#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
using namespace emscripten;

struct Vec2 { float x, y; };

static inline Vec2 add(const Vec2&a,const Vec2&b){ return {a.x+b.x, a.y+b.y}; }
static inline Vec2 sub(const Vec2&a,const Vec2&b){ return {a.x-b.x, a.y-b.y}; }
static inline Vec2 mul(const Vec2&a,float s){ return {a.x*s, a.y*s}; }
static inline float dot(const Vec2&a,const Vec2&b){ return a.x*b.x + a.y*b.y; }
static inline float len(const Vec2&a){ return std::sqrt(dot(a,a)); }
static inline Vec2 norm(const Vec2&a){ float l=len(a); return l>1e-8f? mul(a,1.0f/l): Vec2{0,0}; }

// Mundo normalizado [0,1] x [0,1]
struct Player { Vec2 p{0.2f,0.5f}; Vec2 v{0,0}; float r=0.012f; };

static Player player;
static bool ropeActive=false;
static Vec2 anchor{0.5f,0.5f};
static std::vector<Vec2> rope;          // nodos de la cuerda
static std::vector<Vec2> ropePrev;      // para integración verlet
static float ropeSegLen=0.008f;         // largo de cada segmento
static int ropeIter=48;                 // iteraciones PBD por substep
static int substeps=4;                  // substeps por frame
static float gravity=0.0f;              // casi nula, feel arcade
static float airDamp=0.9992f;           // damping leve

static std::vector<float> ropeBuffer;   // para exponer a JS

static inline void clampToBounds(Vec2 &p, Vec2 &v){
  if(p.x<0){p.x=0; v.x*=-0.4f;} if(p.x>1){p.x=1; v.x*=-0.4f;}
  if(p.y<0){p.y=0; v.y*=-0.4f;} if(p.y>1){p.y=1; v.y*=-0.4f;}
}

static void buildRopeTo(const Vec2 &src,const Vec2 &dst){
  rope.clear(); ropePrev.clear();
  Vec2 d=sub(dst,src); float L=len(d); if(L<1e-5f){ ropeActive=false; return; }
  int n = (int)std::ceil(L/ropeSegLen);
  if(n<2) n=2; if(n>2000) n=2000; // límite prudente
  Vec2 step = mul(norm(d), L/(float)n);
  rope.reserve(n+1); ropePrev.reserve(n+1);
  Vec2 cur=src;
  for(int i=0;i<=n;i++){ rope.push_back(cur); ropePrev.push_back(cur); cur=add(cur,step);} 
  anchor = dst; ropeActive=true;
}

static inline void verletIntegrate(std::vector<Vec2>&p,std::vector<Vec2>&pp,float dt){
  for(size_t i=1;i+1<p.size();++i){ // no mover extremos (0:player, last:anchor)
    Vec2 pos=p[i]; Vec2 prev=pp[i];
    Vec2 vel = mul(sub(pos, prev), airDamp);
    vel.y += gravity*dt;
    Vec2 next = add(pos, vel);
    pp[i]=pos; p[i]=next;
  }
}

static inline void satisfyDistance(std::vector<Vec2>&p,int i,int j,float rest){
  Vec2 d = sub(p[j], p[i]); float L = len(d); if(L<1e-8f) return; Vec2 n = mul(d, 1.0f/L);
  float diff = (L - rest);
  float half = 0.5f * diff;
  // extremos fijos: i==0 (player), j==last (anchor)
  if(i!=0) p[i] = add(p[i], mul(n, half));
  if(j!=(int)p.size()-1) p[j] = add(p[j], mul(n, -half));
}

static inline void playerConstraint(){
  // primer segmento entre player y rope[1], mantener distancia ropeSegLen
  if(rope.size()>=2){ satisfyDistance(rope, 0, 1, ropeSegLen); }
}

static inline void anchorConstraint(){
  // último punto pegado al anchor
  if(!rope.empty()) rope.back() = anchor;
}

static inline void boundsConstraint(std::vector<Vec2>&p){
  for(size_t i=0;i<p.size();++i){ if(i==0||i==p.size()-1) continue; // no extremos
    if(p[i].x<0) p[i].x=0; if(p[i].x>1) p[i].x=1; if(p[i].y<0) p[i].y=0; if(p[i].y>1) p[i].y=1;
  }
}

static inline void solveRope(){
  // aplicar constraints varias veces para rigidez
  for(int it=0; it<ropeIter; ++it){
    // distancia entre puntos consecutivos
    for(size_t i=0;i+1<rope.size();++i){ satisfyDistance(rope, (int)i, (int)i+1, ropeSegLen); }
    playerConstraint();
    anchorConstraint();
    boundsConstraint(rope);
  }
}

static inline void updatePlayer(float dt){
  // player unido al nodo 0 de la cuerda
  if(ropeActive && !rope.empty()){
    // usar posición del nodo 0 como player.p; derivar velocidad
    Vec2 prevP = player.p;
    player.p = rope[0];
    player.v = mul(sub(player.p, prevP), 1.0f/std::max(dt,1e-6f));
  } else {
    // libre: damping
    player.v = mul(player.v, 0.998f);
    player.p = add(player.p, mul(player.v, dt));
  }
  clampToBounds(player.p, player.v);
}

static inline void fillRopeBuffer(){
  ropeBuffer.resize(rope.size()*2);
  for(size_t i=0;i<rope.size();++i){ ropeBuffer[i*2]=rope[i].x; ropeBuffer[i*2+1]=rope[i].y; }
}

// API
void init(){ player=Player(); rope.clear(); ropePrev.clear(); ropeActive=false; ropeIter=64; substeps=4; }
void setMouse(float nx,float ny){ anchor = {nx,ny}; }
void attach(){ buildRopeTo(player.p, anchor); }
void detach(){ ropeActive=false; rope.clear(); ropePrev.clear(); }
void setIterations(int it){ ropeIter = it<1?1:it; }
int  getIterations(){ return ropeIter; }
int  getRopeCount(){ return (int)rope.size(); }
val  getRopePositions(){ fillRopeBuffer(); return val(typed_memory_view(ropeBuffer.size(), ropeBuffer.data())); }
val  getPlayer(){ static float p[2]; p[0]=player.p.x; p[1]=player.p.y; return val(typed_memory_view(2, p)); }

void step(float dtMs){
  float dt = dtMs/1000.0f;
  float h = dt / (float)substeps;
  for(int s=0;s<substeps;++s){
    if(ropeActive){
      // nodo 0 = player; forzar a player.p antes de integrar
      if(rope.empty()) { buildRopeTo(player.p, anchor); }
      rope[0]=player.p; ropePrev[0]=player.p; // fijo al player
      anchorConstraint();
      verletIntegrate(rope, ropePrev, h);
      solveRope();
    }
    updatePlayer(h);
  }
}

EMSCRIPTEN_BINDINGS(grapple_bindings){
  function("init", &init);
  function("setMouse", &setMouse);
  function("attach", &attach);
  function("detach", &detach);
  function("setIterations", &setIterations);
  function("getIterations", &getIterations);
  function("getRopeCount", &getRopeCount);
  function("getRopePositions", &getRopePositions);
  function("getPlayer", &getPlayer);
  function("step", &step);
}
