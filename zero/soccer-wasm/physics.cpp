#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>
using namespace emscripten;

static inline float clamp(float v,float a,float b){ return v<a?a:(v>b?b:v); }
static inline float rnd(){ return (float)rand()/(float)RAND_MAX; }

struct Vec{ float x,y; };
static inline float dot(const Vec&a,const Vec&b){ return a.x*b.x + a.y*b.y; }
static inline float len(const Vec&a){ return std::sqrt(dot(a,a)); }
static inline Vec add(const Vec&a,const Vec&b){ return {a.x+b.x,a.y+b.y}; }
static inline Vec sub(const Vec&a,const Vec&b){ return {a.x-b.x,a.y-b.y}; }
static inline Vec mul(const Vec&a,float s){ return {a.x*s,a.y*s}; }
static inline Vec norm(const Vec&a){ float L=len(a); return L>1e-6f? mul(a,1.0f/L):Vec{0,0}; }

// Campo normalizado [0,1]x[0,1]
// Air hockey: 2 paletas (team 0/1) y 1 puck (team 2)
struct Circle{ Vec p,v; float r; uint8_t team; };
static Circle puck; static std::vector<Circle> paddles; static int scoreA=0, scoreB=0; static float timeLeft=90.0f;
static int maxGoals=5; static bool gameOver=false; static int winner=-1; static float kickoff=0.0f; // congelar tras gol

void reset(){ paddles.clear(); scoreA=0; scoreB=0; timeLeft=90.0f; gameOver=false; winner=-1; kickoff=0.0f; puck={ {0.5f,0.5f}, {0,0}, 0.04f, 2 };
  // 1 vs 1 paletas (más grandes)
  paddles.push_back({ {0.15f,0.5f}, {0,0}, 0.08f, 0 });
  paddles.push_back({ {0.85f,0.5f}, {0,0}, 0.08f, 1 });
}

static const float MAX_PADDLE_SPEED=3.0f; static const float MAX_PUCK_SPEED=4.5f;
static inline void clampSpeed(Circle &c){ float s=std::sqrt(c.v.x*c.v.x + c.v.y*c.v.y); float maxv = (c.team==2? MAX_PUCK_SPEED : MAX_PADDLE_SPEED); if(s>maxv && s>1e-6f){ float k=maxv/s; c.v.x*=k; c.v.y*=k; } }
static void collideWalls(Circle &c){ float wallE = (c.team==2? -0.94f : -0.9f); if(c.p.x<c.r){ c.p.x=c.r; c.v.x*=wallE; } if(c.p.x>1-c.r){ c.p.x=1-c.r; c.v.x*=wallE; } if(c.p.y<c.r){ c.p.y=c.r; c.v.y*=wallE; } if(c.p.y>1-c.r){ c.p.y=1-c.r; c.v.y*=wallE; } }
static void integrate(Circle &c,float dt){ c.p.x+=c.v.x*dt; c.p.y+=c.v.y*dt; c.v = mul(c.v, 0.995f); clampSpeed(c); collideWalls(c); }

static void resolve(Circle &a,Circle &b){ Vec d=sub(b.p,a.p); float L=len(d); float minDist=a.r+b.r; if(L<minDist && L>1e-6f){ Vec n=mul(d,1.0f/L); float pen=minDist-L; a.p = add(a.p, mul(n, -pen*0.5f)); b.p = add(b.p, mul(n,  pen*0.5f)); float rel=dot(sub(b.v,a.v),n); if(rel<0){ float e=0.75f; float j=-(1.0f+e)*rel*0.5f; a.v=add(a.v, mul(n,-j)); b.v=add(b.v, mul(n, j)); // clamp and light friction
      clampSpeed(a); clampSpeed(b); a.v=mul(a.v,0.995f); b.v=mul(b.v,0.995f); } } }

void input(int idx,bool up,bool down,bool left,bool right,bool kick){ if(gameOver||kickoff>0.0f) return; Circle &p=paddles[idx]; float sp=1.2f; if(up) p.v.y+=sp*(1.0f/60.0f); if(down) p.v.y-=sp*(1.0f/60.0f); if(left) p.v.x-=sp*(1.0f/60.0f); if(right) p.v.x+=sp*(1.0f/60.0f);
  // boost al golpear el puck (controlado)
  if(kick){ Vec d=sub(puck.p,p.p); if(len(d)<p.r+puck.r+0.02f){ Vec n=norm(d); // componente hacia puck + influencia de velocidad de paleta
      puck.v = add(puck.v, add(mul(n,5.0f), mul(p.v,0.6f))); clampSpeed(puck); }
 }
}

static void aiStep(){ // la paleta derecha (idx 1) sigue el puck en Y
  if(paddles.size()>1){ Vec d=sub(puck.p, paddles[1].p); float s = (d.y>0?1.0f:-1.0f); paddles[1].v.y += s*0.5f*(1.0f/60.0f); paddles[1].v.x += (puck.p.x>paddles[1].p.x? 0.1f: -0.1f)*(1.0f/60.0f); }
}

void step(float dt){ // integrar
  if(gameOver){ // animación mínima
    for(auto &p:paddles) p.v = mul(p.v, 0.98f);
    puck.v = mul(puck.v, 0.98f);
  }
  if(kickoff>0.0f){ kickoff = std::max(0.0f, kickoff - dt); }
  for(auto &p:paddles) integrate(p,dt); integrate(puck,dt);
  // colisiones entre paletas
  for(size_t i=0;i<paddles.size();++i) for(size_t j=i+1;j<paddles.size();++j) resolve(paddles[i],paddles[j]);
  // colisiones paleta-puck
  if(kickoff<=0.0f) for(auto &p:paddles) resolve(p, puck);
  // goles (arcos en y=0.4..0.6 x=0 o x=1)
  if(!gameOver && kickoff<=0.0f){
    if(puck.p.x<puck.r && puck.p.y>0.4f && puck.p.y<0.6f){ scoreB++; puck={ {0.5f,0.5f},{0,0},0.04f,2 }; kickoff=1.2f; }
    if(puck.p.x>1.0f-puck.r && puck.p.y>0.4f && puck.p.y<0.6f){ scoreA++; puck={ {0.5f,0.5f},{0,0},0.04f,2 }; kickoff=1.2f; }
  }
  // IA simple
  if(!gameOver && kickoff<=0.0f) aiStep();
  // tiempo y fin de juego
  if(!gameOver){ timeLeft = std::max(0.0f, timeLeft - dt); if(timeLeft<=0.0f || scoreA>=maxGoals || scoreB>=maxGoals){ gameOver=true; winner = (scoreA==scoreB? -1 : (scoreA>scoreB? 0:1)); } }
}

// getters
val getPlayers(){ static std::vector<float> buf; buf.resize(paddles.size()*4); for(size_t i=0;i<paddles.size();++i){ buf[i*4]=paddles[i].p.x; buf[i*4+1]=paddles[i].p.y; buf[i*4+2]=paddles[i].r; buf[i*4+3]=paddles[i].team; } return val(typed_memory_view(buf.size(), buf.data())); }
val getBall(){ static float s[3]; s[0]=puck.p.x; s[1]=puck.p.y; s[2]=puck.r; return val(typed_memory_view(3,s)); }
int getScoreA(){ return scoreA; } int getScoreB(){ return scoreB; }
float getTime(){ return timeLeft; }
int getWinner(){ return gameOver? winner : -2; } // -2: en curso, -1: empate, 0: P1, 1: P2
float getKickoff(){ return kickoff; }

EMSCRIPTEN_BINDINGS(soc){ function("reset", &reset); function("step", &step); function("input", &input); function("getPlayers", &getPlayers); function("getBall", &getBall); function("getScoreA", &getScoreA); function("getScoreB", &getScoreB); function("getTime", &getTime); function("getWinner", &getWinner); function("getKickoff", &getKickoff); }
