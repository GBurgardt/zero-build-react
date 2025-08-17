#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>
using namespace emscripten;

static inline float wrap01(float v){ if(v<0) v+=1.0f; if(v>1) v-=1.0f; return v; }
static inline float rnd(){ return (float)rand()/(float)RAND_MAX; }

struct Ship{ float x=0.5f,y=0.5f,vx=0,vy=0,ang=0; int cooldown=0; int lives=3; bool alive=true; };
struct Bullet{ float x,y,vx,vy,ttl; };
struct Ast{ float x,y,vx,vy,r; };

static Ship ship;
static std::vector<Bullet> bullets;
static std::vector<Ast> asts;
static int wave=1; static int score=0;

static const float SHIP_THRUST=0.35f; static const float SHIP_ROT=3.2f; static const float SHIP_DAMP=0.995f;
static const float BULLET_SPEED=0.8f; static const float BULLET_TTL=1.2f; static const float AST_MIN_R=0.01f; static const float AST_MAX_R=0.06f;

void reset(){ ship=Ship(); bullets.clear(); asts.clear(); wave=1; score=0; }

static void spawnWave(){ int n=3 + wave; for(int i=0;i<n;i++){ Ast a; a.r = AST_MAX_R * (0.6f + 0.4f*rnd()); a.x=rnd(); a.y=rnd(); float ang=rnd()*6.2831853f; float sp=0.05f+0.12f*rnd(); a.vx=std::cos(ang)*sp; a.vy=std::sin(ang)*sp; asts.push_back(a);} }

void start(){ reset(); spawnWave(); }

void input(bool thrust, float rot, bool fire){ // rot: -1..1
  // rotación
  ship.ang += rot * SHIP_ROT * (1.0f/60.0f);
  // thrust
  if(thrust){ ship.vx += std::cos(ship.ang)*SHIP_THRUST*(1.0f/60.0f); ship.vy += std::sin(ship.ang)*SHIP_THRUST*(1.0f/60.0f); }
  // disparo
  if(fire && ship.cooldown<=0 && ship.alive){ Bullet b; b.x=ship.x; b.y=ship.y; b.vx=std::cos(ship.ang)*BULLET_SPEED; b.vy=std::sin(ship.ang)*BULLET_SPEED; b.ttl=BULLET_TTL; bullets.push_back(b); ship.cooldown=9; }
}

static void wrap(float &x,float &y){ x=wrap01(x); y=wrap01(y); }

static void stepBullets(float dt){ for(size_t i=0;i<bullets.size();){ Bullet &b=bullets[i]; b.x+=b.vx*dt; b.y+=b.vy*dt; wrap(b.x,b.y); b.ttl-=dt; if(b.ttl<=0){ bullets[i]=bullets.back(); bullets.pop_back(); } else { ++i; } } }
static void stepAst(float dt){ for(auto &a:asts){ a.x+=a.vx*dt; a.y+=a.vy*dt; wrap(a.x,a.y);} }

static void splitAst(size_t idx){ Ast a=asts[idx]; asts[idx]=asts.back(); asts.pop_back(); score+= (a.r>0.045f? 20 : a.r>0.025f? 50 : 100);
  if(a.r>AST_MIN_R*2.0f){ int pieces=2 + (rand()%2); for(int i=0;i<pieces;i++){ Ast c; c.r=a.r*0.55f; float ang=rnd()*6.2831853f; float sp=0.08f+0.12f*rnd(); c.vx=std::cos(ang)*sp; c.vy=std::sin(ang)*sp; c.x=a.x; c.y=a.y; asts.push_back(c);} }
}

static void collisions(){ // bullets vs asts
  for(size_t i=0;i<bullets.size();){ bool hit=false; for(size_t j=0;j<asts.size();++j){ float dx=wrap01(bullets[i].x-asts[j].x); if(dx>0.5f) dx-=1.0f; float dy=wrap01(bullets[i].y-asts[j].y); if(dy>0.5f) dy-=1.0f; float d2=dx*dx+dy*dy; if(d2 < asts[j].r*asts[j].r){ splitAst(j); bullets[i]=bullets.back(); bullets.pop_back(); hit=true; break; } } if(!hit) ++i; }
  // ship vs asts
  if(ship.alive){ for(auto &a:asts){ float dx=wrap01(ship.x-a.x); if(dx>0.5f) dx-=1.0f; float dy=wrap01(ship.y-a.y); if(dy>0.5f) dy-=1.0f; float d2=dx*dx+dy*dy; if(d2 < (a.r+0.012f)*(a.r+0.012f)){ ship.lives--; ship.alive=false; break; } } }
}

void step(float dt){ if(ship.cooldown>0) ship.cooldown--; if(ship.alive){ ship.vx*=SHIP_DAMP; ship.vy*=SHIP_DAMP; ship.x+=ship.vx*dt; ship.y+=ship.vy*dt; wrap(ship.x,ship.y);} stepBullets(dt); stepAst(dt); collisions(); if(asts.empty()){ wave++; spawnWave(); ship.alive=true; }
}

// getters para render
val getShip(){ static float s[3]; s[0]=ship.x; s[1]=ship.y; s[2]=ship.ang; return val(typed_memory_view(3,s)); }
val getBullets(){ static std::vector<float> buf; buf.resize(bullets.size()*2); for(size_t i=0;i<bullets.size();++i){ buf[i*2]=bullets[i].x; buf[i*2+1]=bullets[i].y; } return val(typed_memory_view(buf.size(), buf.data())); }
val getAsts(){ static std::vector<float> buf; buf.resize(asts.size()*3); for(size_t i=0;i<asts.size();++i){ buf[i*3]=asts[i].x; buf[i*3+1]=asts[i].y; buf[i*3+2]=asts[i].r; } return val(typed_memory_view(buf.size(), buf.data())); }
int getScore(){ return score; }
int getLives(){ return ship.lives; }
int getWave(){ return wave; }
bool isAlive(){ return ship.alive; }
void respawn(){ if(ship.lives>0){ ship.alive=true; ship.x=0.5f; ship.y=0.5f; ship.vx=ship.vy=0; ship.ang=0; } }

EMSCRIPTEN_BINDINGS(ast_bind){
  function("start", &start);
  function("reset", &reset);
  function("input", &input);
  function("step", &step);
  function("getShip", &getShip);
  function("getBullets", &getBullets);
  function("getAsts", &getAsts);
  function("getScore", &getScore);
  function("getLives", &getLives);
  function("getWave", &getWave);
  function("isAlive", &isAlive);
  function("respawn", &respawn);
}
