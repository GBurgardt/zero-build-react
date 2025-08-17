#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>
using namespace emscripten;

struct Vec2{ float x,y; };
static inline Vec2 add(const Vec2&a,const Vec2&b){ return {a.x+b.x,a.y+b.y}; }
static inline Vec2 sub(const Vec2&a,const Vec2&b){ return {a.x-b.x,a.y-b.y}; }
static inline Vec2 mul(const Vec2&a,float s){ return {a.x*s,a.y*s}; }
static inline float dot(const Vec2&a,const Vec2&b){ return a.x*b.x+a.y*b.y; }
static inline float len(const Vec2&a){ return std::sqrt(dot(a,a)); }
static inline Vec2 norm(const Vec2&a){ float L=len(a); return L>1e-8f? mul(a,1.0f/L):Vec2{0,0}; }

// Mundo [0,1]^2
struct Player{ Vec2 p{0.2f,0.5f}; Vec2 v{0,0}; float r=0.012f; };
static Player player;

// Rope PBD
static bool ropeActive=false; static Vec2 anchor{0.5f,0.5f};
static std::vector<Vec2> rope, ropePrev; static float ropeSegLen=0.008f; static int ropeIter=64; static int substeps=4;
static float airDamp=0.9992f; static float dashSpeed=0.6f; static int dashCooldown=0; // ms

// Bullets SoA
static std::vector<float> bx, by, bvx, bvy; static int bullets=0; static const int MAXB=300000;

// Goals (objetivos a romper)
struct Goal{ Vec2 p; float r; bool alive; }; static std::vector<Goal> goals;

// HUD buffers
static std::vector<float> ropeBuf, playerBuf, bulletBuf, goalBuf;

static inline void clamp(Vec2 &p, Vec2 &v){ if(p.x<0){p.x=0; v.x*=-0.4f;} if(p.x>1){p.x=1; v.x*=-0.4f;} if(p.y<0){p.y=0; v.y*=-0.4f;} if(p.y>1){p.y=1; v.y*=-0.4f;} }

static void buildRopeTo(const Vec2 &src,const Vec2 &dst){
  rope.clear(); ropePrev.clear();
  Vec2 d=sub(dst,src); float L=len(d); if(L<1e-5f){ ropeActive=false; return; }
  int n=(int)std::ceil(L/ropeSegLen); n=std::max(2,std::min(n,2000)); Vec2 step=mul(norm(d),L/(float)n);
  Vec2 cur=src; for(int i=0;i<=n;i++){ rope.push_back(cur); ropePrev.push_back(cur); cur=add(cur,step);} anchor=dst; ropeActive=true;
}

static inline void verlet(std::vector<Vec2>&p,std::vector<Vec2>&pp,float dt){
  for(size_t i=1;i+1<p.size();++i){ Vec2 pos=p[i]; Vec2 prev=pp[i]; Vec2 vel=mul(sub(pos,prev),airDamp); Vec2 next=add(pos,vel); pp[i]=pos; p[i]=next; }
}
static inline void satisfy(std::vector<Vec2>&p,int i,int j,float rest){ Vec2 d=sub(p[j],p[i]); float L=len(d); if(L<1e-8f) return; Vec2 n=mul(d,1.0f/L); float diff=L-rest; float half=0.5f*diff; if(i!=0)p[i]=add(p[i],mul(n, half)); if(j!=(int)p.size()-1)p[j]=add(p[j],mul(n,-half)); }
static inline void anchorC(){ if(!rope.empty()) rope.back()=anchor; }
static inline void boundsC(std::vector<Vec2>&p){ for(size_t i=1;i+1<p.size();++i){ if(p[i].x<0)p[i].x=0; if(p[i].x>1)p[i].x=1; if(p[i].y<0)p[i].y=0; if(p[i].y>1)p[i].y=1; } }
static inline void solveRope(){ for(int it=0;it<ropeIter;++it){ for(size_t i=0;i+1<rope.size();++i) satisfy(rope,(int)i,(int)i+1,ropeSegLen); anchorC(); boundsC(rope);} }

static inline void updatePlayer(float dt){ if(ropeActive && !rope.empty()){ Vec2 prev=player.p; player.p=rope[0]; player.v=mul(sub(player.p,prev),1.0f/std::max(dt,1e-6f)); } else { player.v=mul(player.v,0.998f); player.p=add(player.p,mul(player.v,dt)); } clamp(player.p,player.v); }

static inline void spawnBullet(Vec2 p, Vec2 v){ if(bullets>=MAXB) return; bx.push_back(p.x); by.push_back(p.y); bvx.push_back(v.x); bvy.push_back(v.y); bullets++; }

static inline void stepBullets(float dt){ for(int i=0;i<bullets;i++){ bx[i]+=bvx[i]*dt; by[i]+=bvy[i]*dt; if(bx[i]<0||bx[i]>1||by[i]<0||by[i]>1){ bx[i]=bx[bullets-1]; by[i]=by[bullets-1]; bvx[i]=bvx[bullets-1]; bvy[i]=bvy[bullets-1]; bullets--; i--; } } }

static inline void spawnTurretRing(Vec2 center,int count,float speed){ for(int i=0;i<count;i++){ float a= (6.2831853f*(float)i)/(float)count; Vec2 v={std::cos(a)*speed, std::sin(a)*speed}; spawnBullet(center,v); } }

static inline void initGoals(){ goals.clear(); goals.push_back({{0.2f,0.2f},0.02f,true}); goals.push_back({{0.8f,0.2f},0.02f,true}); goals.push_back({{0.2f,0.8f},0.02f,true}); goals.push_back({{0.8f,0.8f},0.02f,true}); goals.push_back({{0.5f,0.5f},0.03f,true}); goals.push_back({{0.5f,0.2f},0.02f,true}); }

static inline void checkCollisions(){ // player-bullets
  for(int i=0;i<bullets;i++){ float dx=bx[i]-player.p.x; float dy=by[i]-player.p.y; float rr=player.r*player.r; if(dx*dx+dy*dy<rr){ /* penalización por ahora: eliminar bala */ bx[i]=bx[bullets-1]; by[i]=by[bullets-1]; bvx[i]=bvx[bullets-1]; bvy[i]=bvy[bullets-1]; bullets--; i--; }
  }
  // rope parry: si la distancia bala-seg ≤ 0.005 y velocidad relativa adecuada, reflejar
  for(int i=0;i<bullets;i++){
    for(size_t s=0;s+1<rope.size();++s){ Vec2 a=rope[s], b=rope[s+1]; Vec2 ab=sub(b,a); float t = dot(sub(Vec2{bx[i],by[i]},a),ab)/std::max(1e-6f,dot(ab,ab)); t=std::max(0.0f,std::min(1.0f,t)); Vec2 closest=add(a,mul(ab,t)); float dx=bx[i]-closest.x, dy=by[i]-closest.y; float d2=dx*dx+dy*dy; if(d2<0.000025f){ // 0.005^2
      // reflect about segment normal
      Vec2 n=norm(Vec2{-ab.y, ab.x}); float vn = bvx[i]*n.x + bvy[i]*n.y; bvx[i]-=2*vn*n.x; bvy[i]-=2*vn*n.y; break; }
    }
  }
  // player-goal
  for(auto &g: goals){ if(!g.alive) continue; float dx=g.p.x-player.p.x; float dy=g.p.y-player.p.y; float rr=(g.r+player.r)*(g.r+player.r); if(dx*dx+dy*dy<rr){ g.alive=false; spawnTurretRing(g.p, 30, 0.5f); } }
}

// API
void init(){ player=Player(); rope.clear(); ropePrev.clear(); ropeActive=false; bx.clear(); by.clear(); bvx.clear(); bvy.clear(); bullets=0; initGoals(); }
void setMouse(float x,float y){ anchor={x,y}; }
void attach(){ buildRopeTo(player.p, anchor); }
void detach(){ ropeActive=false; rope.clear(); ropePrev.clear(); }
void dash(){ if(dashCooldown>0) return; Vec2 dir=norm(sub(anchor,player.p)); player.v=add(player.v, mul(dir,dashSpeed)); dashCooldown=120; }
void setIterations(int it){ ropeIter= std::max(1,it); }
int  getIterations(){ return ropeIter; }
int  getBulletCount(){ return bullets; }
int  getGoalsAlive(){ int c=0; for(auto &g:goals) if(g.alive) c++; return c; }

val getPlayer(){ static float p[2]; p[0]=player.p.x; p[1]=player.p.y; return val(typed_memory_view(2,p)); }
val getRope(){ ropeBuf.resize(rope.size()*2); for(size_t i=0;i<rope.size();++i){ ropeBuf[i*2]=rope[i].x; ropeBuf[i*2+1]=rope[i].y; } return val(typed_memory_view(ropeBuf.size(), ropeBuf.data())); }
val getBullets(){ bulletBuf.resize(bullets*2); for(int i=0;i<bullets;i++){ bulletBuf[i*2]=bx[i]; bulletBuf[i*2+1]=by[i]; } return val(typed_memory_view(bulletBuf.size(), bulletBuf.data())); }
val getGoals(){ goalBuf.clear(); for(auto &g:goals){ if(!g.alive) continue; goalBuf.push_back(g.p.x); goalBuf.push_back(g.p.y); goalBuf.push_back(g.r); } return val(typed_memory_view(goalBuf.size(), goalBuf.data())); }

void step(float dtMs){ float dt=dtMs/1000.0f; float h=dt/(float)substeps; if(dashCooldown>0) dashCooldown-= (int)std::round(dtMs);
  for(int s=0;s<substeps;++s){ if(ropeActive){ if(rope.empty()) buildRopeTo(player.p, anchor); rope[0]=player.p; ropePrev[0]=player.p; anchorC(); verlet(rope,ropePrev,h); for(int it=0;it<ropeIter;++it){ for(size_t i=0;i+1<rope.size();++i) satisfy(rope,(int)i,(int)i+1,ropeSegLen); anchorC(); } }
    updatePlayer(h); stepBullets(h); }
  checkCollisions(); }

EMSCRIPTEN_BINDINGS(hookstrike){
  function("init", &init);
  function("setMouse", &setMouse);
  function("attach", &attach);
  function("detach", &detach);
  function("dash", &dash);
  function("setIterations", &setIterations);
  function("getIterations", &getIterations);
  function("getBulletCount", &getBulletCount);
  function("getGoalsAlive", &getGoalsAlive);
  function("getPlayer", &getPlayer);
  function("getRope", &getRope);
  function("getBullets", &getBullets);
  function("getGoals", &getGoals);
  function("step", &step);
}
