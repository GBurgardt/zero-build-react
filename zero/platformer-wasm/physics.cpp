#include <emscripten/bind.h>
#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>
using namespace emscripten;

struct Rect{ float x,y,w,h; };
struct Bullet{ float x,y,vx,vy,ttl; };

static std::vector<Rect> tiles;
static std::vector<Bullet> bullets;

struct Player{ float x=0.1f,y=0.1f,w=0.02f,h=0.04f,vx=0,vy=0; bool grounded=false; };
static Player player;
static int score=0;

static float GRAV=1.6f; static float MOVE=0.6f; static float JUMP=0.55f; static float FRICTION=0.85f; static float BULLET_SPD=1.2f; static float BULLET_TTL=1.0f;

void reset(){ tiles.clear(); bullets.clear(); player=Player(); score=0;
  // Crear tiles (plataformas) en coords normalizadas [0,1]
  tiles.push_back({0.0f,0.95f,1.0f,0.05f}); // suelo
  tiles.push_back({0.1f,0.75f,0.25f,0.03f});
  tiles.push_back({0.45f,0.65f,0.25f,0.03f});
  tiles.push_back({0.75f,0.55f,0.2f,0.03f});
  tiles.push_back({0.2f,0.45f,0.2f,0.03f});
  tiles.push_back({0.05f,0.32f,0.15f,0.03f});
  tiles.push_back({0.4f,0.32f,0.2f,0.03f});
  tiles.push_back({0.7f,0.25f,0.25f,0.03f});
}

static bool overlap(const Rect&a,const Rect&b){ return !(a.x+a.w<b.x || b.x+b.w<a.x || a.y+a.h<b.y || b.y+b.h<a.y); }

static void collidePlayer(){ player.grounded=false; Rect pr{player.x,player.y,player.w,player.h};
  for(const auto&t:tiles){ Rect r=t; if(!overlap(pr,r)) continue; // resolver mínimamente por ejes
    float dx1 = (r.x + r.w) - pr.x; // empuje hacia izq
    float dx2 = (pr.x + pr.w) - r.x; // empuje hacia der
    float dy1 = (r.y + r.h) - pr.y; // empuje hacia arriba
    float dy2 = (pr.y + pr.h) - r.y; // empuje hacia abajo
    float minx = std::min(dx1, dx2); float miny = std::min(dy1, dy2);
    if(minx < miny){ // resolver en x
      if(dx1 < dx2){ player.x = r.x + r.w; } else { player.x = r.x - pr.w; }
      player.vx = 0;
      pr.x = player.x;
    } else { // resolver en y
      if(dy1 < dy2){ player.y = r.y + r.h; player.vy = std::max(0.0f, player.vy); } else { player.y = r.y - pr.h; player.vy = 0; player.grounded=true; }
      pr.y = player.y;
    }
  }
}

void step(float dt){ // gravedad y movimiento
  player.vy += GRAV*dt; player.y += player.vy*dt; collidePlayer();
  player.x += player.vx*dt; collidePlayer();
  // fricción horizontal cuando está en el suelo
  if(player.grounded) player.vx *= FRICTION; 
  // límites
  if(player.x<0) { player.x=0; player.vx=0;} if(player.x+player.w>1){ player.x=1-player.w; player.vx=0; }
  if(player.y+player.h>1){ player.y=1-player.h; player.vy=0; player.grounded=true; }
  // bullets
  for(size_t i=0;i<bullets.size();){ Bullet &b=bullets[i]; b.x+=b.vx*dt; b.y+=b.vy*dt; b.ttl-=dt; Rect br{b.x,b.y,0.006f,0.006f}; bool hit=false; for(const auto&t:tiles){ if(overlap(br,t)){ hit=true; break; } }
    if(hit||b.ttl<=0||b.x<0||b.x>1||b.y<0||b.y>1){ bullets[i]=bullets.back(); bullets.pop_back(); } else { ++i; }
  }
}

void input(bool left,bool right,bool jump,bool fire){ if(left) player.vx -= MOVE*(1.0f/60.0f); if(right) player.vx += MOVE*(1.0f/60.0f); if(jump && player.grounded){ player.vy = -JUMP; player.grounded=false; }
  if(fire){ Bullet b; b.x=player.x+player.w*0.5f; b.y=player.y+player.h*0.4f; b.vx=BULLET_SPD; b.vy=0; b.ttl=BULLET_TTL; bullets.push_back(b); score+=1; }
}

// getters
val getPlayer(){ static float p[4]; p[0]=player.x; p[1]=player.y; p[2]=player.w; p[3]=player.h; return val(typed_memory_view(4,p)); }
val getTiles(){ static std::vector<float> buf; buf.resize(tiles.size()*4); for(size_t i=0;i<tiles.size();++i){ buf[i*4]=tiles[i].x; buf[i*4+1]=tiles[i].y; buf[i*4+2]=tiles[i].w; buf[i*4+3]=tiles[i].h; } return val(typed_memory_view(buf.size(), buf.data())); }
val getBullets(){ static std::vector<float> buf; buf.resize(bullets.size()*2); for(size_t i=0;i<bullets.size();++i){ buf[i*2]=bullets[i].x; buf[i*2+1]=bullets[i].y; } return val(typed_memory_view(buf.size(), buf.data())); }
int getScore(){ return score; }

EMSCRIPTEN_BINDINGS(platformer){ function("reset", &reset); function("step", &step); function("input", &input); function("getPlayer", &getPlayer); function("getTiles", &getTiles); function("getBullets", &getBullets); function("getScore", &getScore); }
