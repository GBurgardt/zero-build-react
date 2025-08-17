#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>
using namespace emscripten;

static inline float rnd(){ return (float)rand()/(float)RAND_MAX; }

// type: 0=player,1=enemy,2=bullet,3=particle,4=key,5=gate,6=beamVisual
struct Ent { float x,y,vx,vy,r; uint8_t type; uint8_t hp; };
static std::vector<Ent> ents; static int playerIdx=-1; static int score=0;

// Spatial hash grid
static const int GW=128, GH=128; static std::vector<int> grid[GW*GH];
static inline int cell(float v){ int c=(int)floorf(v*(float)GW); if(c<0) c=0; if(c>=GW) c=GW-1; return c; }
static inline int idxCell(int cx,int cy){ if(cx<0) cx=0; if(cx>=GW) cx=GW-1; if(cy<0) cy=0; if(cy>=GH) cy=GH-1; return cy*GW+cx; }
static inline void clearGrid(){ for(int i=0;i<GW*GH;i++) grid[i].clear(); }
static inline void addToGrid(int i){ int cx=cell(ents[i].x), cy=cell(ents[i].y); grid[idxCell(cx,cy)].push_back(i); }

static int levelNum=1; static int keysTotal=0; static int keysLeft=0; static bool gateActive=false;
// Beam state
static int beamCooldown=0; static int beamTicks=0; static float beamNx=0.0f, beamNy=-1.0f; static float beamWidth=0.18f; static float beamLen=1.2f;

static inline void spawnKey(){ Ent k; k.x=rnd(); k.y=rnd(); k.vx=0; k.vy=0; k.r=0.025f; k.type=4; k.hp=1; ents.push_back(k); }

static void buildLevel(){ // limpia todo menos player
  std::vector<Ent> keep; keep.reserve(1);
  if(playerIdx>=0 && playerIdx<(int)ents.size()){ keep.push_back(ents[playerIdx]); }
  ents.swap(keep); playerIdx=0; clearGrid(); gateActive=false;
  // enemigos segun nivel
  int baseEnemies = 150 + levelNum*80;
  for(int i=0;i<baseEnemies;i++){ Ent e; e.x=rnd(); e.y=rnd(); float ang=rnd()*6.2831853f; float sp=0.05f+0.23f*rnd(); e.vx=cosf(ang)*sp; e.vy=sinf(ang)*sp; e.r=0.02f; e.type=1; e.hp=1; ents.push_back(e);} 
  // llaves
  keysTotal = std::min(6, 2 + levelNum);
  keysLeft = keysTotal;
  for(int i=0;i<keysTotal;i++) spawnKey();
}

void reset(){ ents.clear(); score=0; playerIdx=-1; clearGrid(); levelNum=1; gateActive=false;
  // player
  Ent p; p.x=0.5f; p.y=0.5f; p.vx=0; p.vy=0; p.r=0.035f; p.type=0; p.hp=3; ents.push_back(p); playerIdx=0;
  buildLevel(); }

static inline void spawnEnemy(){ Ent e; e.x=rnd(); e.y=rnd(); float ang=rnd()*6.2831853f; float sp=0.05f+0.25f*rnd(); e.vx=cosf(ang)*sp; e.vy=sinf(ang)*sp; e.r=0.02f; e.type=1; e.hp=1; ents.push_back(e); }
static inline void spawnBullet(float x,float y,float vx,float vy){ Ent b{ x,y,vx,vy,0.012f,2,1 }; ents.push_back(b); }
static inline void spawnParticle(float x,float y){ Ent q{ x,y,(rnd()-0.5f)*0.3f,(rnd()-0.5f)*0.3f,0.01f,3,1 }; ents.push_back(q); }
static inline void spawnGate(){ Ent g; g.x=rnd(); g.y=rnd(); g.vx=0; g.vy=0; g.r=0.04f; g.type=5; g.hp=1; ents.push_back(g); gateActive=true; }

void stress(){ // mete muchos enemigos y balas cosméticas
  for(int i=0;i<5000;i++) spawnEnemy();
  for(int i=0;i<50000;i++) spawnParticle(rnd(), rnd());
}

void input(float ax,float ay,bool fire,bool dash){ if(playerIdx<0) return; Ent &p=ents[playerIdx]; float acc=0.9f; p.vx += ax*acc*(1.0f/60.0f); p.vy += ay*acc*(1.0f/60.0f); float dmp=0.96f; p.vx*=dmp; p.vy*=dmp;
  // Massive beam instead of bullets
  if(beamCooldown>0) beamCooldown--;
  if(fire && beamCooldown<=0){ float nx = (ax!=0||ay!=0)? ax: 0.0f; float ny = (ax!=0||ay!=0)? ay: -1.0f; float L = std::sqrt(nx*nx+ny*ny); if(L<1e-6f){ nx=0.0f; ny=-1.0f; } else { nx/=L; ny/=L; }
    beamNx=nx; beamNy=ny; beamTicks=3; beamCooldown=10; // ~150ms
    // spawn visual cloud (type 6)
    int samples=800; for(int i=0;i<samples;i++){ float t=(float)i/(float)samples; float s=t*beamLen; float ox=(rnd()-0.5f)*beamWidth; float oy=(rnd()-0.5f)*beamWidth; Ent v; v.x=p.x + beamNx*s + (-beamNy)*ox; v.y=p.y + beamNy*s + ( beamNx)*ox; v.vx=0; v.vy=0; v.r=0.02f; v.type=6; v.hp=1; ents.push_back(v); }
  }
  if(dash){ p.vx*=1.8f; p.vy*=1.8f; }
}

void step(float dt){ clearGrid(); for(size_t i=0;i<ents.size();++i){ Ent &e=ents[i];
    // enemigos orientados levemente al jugador
    if(e.type==1 && playerIdx>=0){ Ent &p=ents[playerIdx]; float dx=p.x-e.x, dy=p.y-e.y; float L=std::sqrt(dx*dx+dy*dy)+1e-6f; float accel=0.2f; e.vx += (dx/L)*accel*dt; e.vy += (dy/L)*accel*dt; float sp=0.35f; float s=std::sqrt(e.vx*e.vx+e.vy*e.vy); if(s>sp){ e.vx*=sp/s; e.vy*=sp/s; } }
    e.x+=e.vx*dt; e.y+=e.vy*dt; if(e.x<0) e.x+=1; if(e.x>1) e.x-=1; if(e.y<0) e.y+=1; if(e.y>1) e.y-=1; addToGrid(i); }
  // colisiones balas-enemigos
  for(size_t i=0;i<ents.size();++i){ if(ents[i].type!=2) continue; Ent &b=ents[i]; int cx=cell(b.x), cy=cell(b.y); for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++){ auto &v=grid[idxCell(cx+ox,cy+oy)]; for(int j: v){ if(ents[j].type!=1) continue; float dx=ents[j].x-b.x, dy=ents[j].y-b.y; if(dx*dx+dy*dy < (ents[j].r+b.r)*(ents[j].r+b.r)){ ents[j].hp=0; b.hp=0; score+=1; spawnParticle(ents[j].x,ents[j].y); } } }
  }
  // Beam kill: wide stripe ahead of player
  if(beamTicks>0 && playerIdx>=0){ Ent &p=ents[playerIdx]; float nx=beamNx, ny=beamNy; float half=beamWidth*0.5f; for(size_t j=0;j<ents.size();++j){ if(ents[j].type!=1 && ents[j].type!=3) continue; Ent &e=ents[j]; float rx=e.x-p.x, ry=e.y-p.y; // wrap shortest vector
      if(rx>0.5f) rx-=1.0f; if(rx<-0.5f) rx+=1.0f; if(ry>0.5f) ry-=1.0f; if(ry<-0.5f) ry+=1.0f; float tproj = rx*nx + ry*ny; if(tproj<0 || tproj>beamLen) continue; float cx = rx - nx*tproj; float cy = ry - ny*tproj; float dist2 = cx*cx + cy*cy; if(dist2 < (half+e.r)*(half+e.r)){ e.hp=0; if(ents[j].type==1){ score+=1; spawnParticle(e.x,e.y); } } }
    beamTicks--; }
  // player con llaves/puerta y daño con enemigos
  if(playerIdx>=0){ Ent &p=ents[playerIdx];
    int cx=cell(p.x), cy=cell(p.y);
    for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++){
      auto &v=grid[idxCell(cx+ox,cy+oy)];
      for(int j: v){ if(j==playerIdx) continue; Ent &e=ents[j]; float dx=e.x-p.x, dy=e.y-p.y; float rr=(e.r+p.r)*(e.r+p.r); if(dx*dx+dy*dy>rr) continue;
        if(e.type==1){ // enemigo daña
          if(p.hp>0){ p.hp--; p.vx -= dx*2.0f; p.vy -= dy*2.0f; }
        } else if(e.type==4){ // key
          if(e.hp){ e.hp=0; keysLeft = std::max(0, keysLeft-1); score+=5; spawnParticle(e.x,e.y); }
        } else if(e.type==5){ // gate
          if(gateActive){ levelNum++; if(p.hp<5) p.hp++; buildLevel(); return; }
        }
      }
    }
  }
  // limpiar muertos y limitar partículas
  size_t w=0; for(size_t i=0;i<ents.size();++i){ if(ents[i].type==3 || ents[i].type==6){ // decay fast for visuals
      ents[i].vx*=0.98f; ents[i].vy*=0.98f; if(rnd()< (ents[i].type==6? 0.2f:0.02f)) continue; }
    if(ents[i].hp>0 || (int)i==playerIdx){ ents[w++]=ents[i]; }
  } ents.resize(w);
  // si no hay llaves y no hay puerta, crearla
  if(keysLeft==0 && !gateActive) spawnGate();
  // spawner suave
  if((int)ents.size()<8000){ if(rnd()<0.5f) spawnEnemy(); }
}

// getters para render/HUD
val getAll(){ static std::vector<float> buf; buf.resize(ents.size()*4); for(size_t i=0;i<ents.size();++i){ buf[i*4]=ents[i].x; buf[i*4+1]=ents[i].y; buf[i*4+2]=ents[i].r; buf[i*4+3]=ents[i].type; } return val(typed_memory_view(buf.size(), buf.data())); }
int getCountByType(int t){ int c=0; for(auto &e:ents) if(e.type==t) c++; return c; }
int getScore(){ return score; }
int getLevel(){ return levelNum; }
int getKeysLeft(){ return keysLeft; }
int getKeysTotal(){ return keysTotal; }
int getPlayerHP(){ if(playerIdx>=0) return ents[playerIdx].hp; return 0; }

EMSCRIPTEN_BINDINGS(ns){ function("reset", &reset); function("stress", &stress); function("input", &input); function("step", &step); function("getAll", &getAll); function("getCountByType", &getCountByType); function("getScore", &getScore); function("getLevel", &getLevel); function("getKeysLeft", &getKeysLeft); function("getKeysTotal", &getKeysTotal); function("getPlayerHP", &getPlayerHP); }
