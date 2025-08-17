const VS=`
attribute vec2 a_position; attribute float a_size; attribute vec3 a_color; varying vec3 v_color; void main(){ gl_Position=vec4(a_position*2.0-1.0,0.0,1.0); gl_PointSize=a_size; v_color=a_color; }
`; const FS=`
precision mediump float; varying vec3 v_color; void main(){ vec2 uv=gl_PointCoord-vec2(0.5); float d=dot(uv,uv); if(d>0.25) discard; float a=1.0-smoothstep(0.20,0.25,sqrt(d)); gl_FragColor=vec4(v_color,a);} 
`;
class GL{ constructor(c){ this.c=c; this.g=c.getContext('webgl'); const g=this.g; const v=this._s(g.VERTEX_SHADER,VS), f=this._s(g.FRAGMENT_SHADER,FS); this.p=g.createProgram(); g.attachShader(this.p,v); g.attachShader(this.p,f); g.linkProgram(this.p); this.lPos=g.getAttribLocation(this.p,'a_position'); this.lSize=g.getAttribLocation(this.p,'a_size'); this.lCol=g.getAttribLocation(this.p,'a_color'); this.bPos=g.createBuffer(); this.bSize=g.createBuffer(); this.bCol=g.createBuffer(); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA); g.clearColor(0.02,0.02,0.03,1);} _s(t,src){ const g=this.g; const s=g.createShader(t); g.shaderSource(s,src); g.compileShader(s); return s;} resize(){ this.c.width=innerWidth; this.c.height=innerHeight; this.g.viewport(0,0,this.c.width,this.c.height);} draw(pts,sizes,cols){ const g=this.g; g.clear(g.COLOR_BUFFER_BIT); g.useProgram(this.p);
    // Dibujar “arcos” laterales como grandes puntos alargados (simples pero visibles)
    const goalsPts=new Float32Array([0.0,0.5, 1.0,0.5]); const goalsSizes=new Float32Array([80,80]); const goalsCols=new Float32Array([0.6,1.0,0.6, 0.8,0.6,1.0]);
    g.bindBuffer(g.ARRAY_BUFFER,this.bPos); g.bufferData(g.ARRAY_BUFFER,goalsPts,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lPos); g.vertexAttribPointer(this.lPos,2,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bSize); g.bufferData(g.ARRAY_BUFFER,goalsSizes,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lSize); g.vertexAttribPointer(this.lSize,1,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bCol); g.bufferData(g.ARRAY_BUFFER,goalsCols,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lCol); g.vertexAttribPointer(this.lCol,3,g.FLOAT,false,0,0);
    g.drawArrays(g.POINTS,0,2);
    // Entidades
    g.bindBuffer(g.ARRAY_BUFFER,this.bPos); g.bufferData(g.ARRAY_BUFFER,pts,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lPos); g.vertexAttribPointer(this.lPos,2,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bSize); g.bufferData(g.ARRAY_BUFFER,sizes,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lSize); g.vertexAttribPointer(this.lSize,1,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bCol); g.bufferData(g.ARRAY_BUFFER,cols,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lCol); g.vertexAttribPointer(this.lCol,3,g.FLOAT,false,0,0);
    g.drawArrays(g.POINTS,0,pts.length/2);
  } }
class Game{ constructor(){ this.cv=document.getElementById('canvas'); this.gl=new GL(this.cv); this.fps=0; this.last=performance.now(); this.keys={}; this.loop=this.loop.bind(this); this.init(); }
 async init(){ this.mod=await this.loadWASM(); this.mod.reset(); this.gl.resize(); addEventListener('resize',()=>this.gl.resize()); this.bindInput(); requestAnimationFrame(this.loop); }
 loadWASM(){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='physics.js'; s.onload=async()=>{ try{ if(typeof Module==='function'){ const m=await Module({}); resolve(m);} else if(typeof Module==='object'){ Module.onRuntimeInitialized=()=>resolve(Module);} else reject(new Error('Module not found')); } catch(e){reject(e);} }; s.onerror=reject; document.body.appendChild(s); }); }
 bindInput(){ addEventListener('keydown',(e)=>{ this.keys[e.code]=true; if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); if(e.code==='KeyR'){ this.mod.reset(); } }); addEventListener('keyup',(e)=>{ this.keys[e.code]=false; }); }
 loop(){ const now=performance.now(); const dt=(now-this.last)/1000; this.last=now;
  const up=!!(this.keys['KeyW']); const down=!!(this.keys['KeyS']); const left=!!(this.keys['KeyA']); const right=!!(this.keys['KeyD']); const kick=!!(this.keys['KeyJ']);
  const up2=!!(this.keys['ArrowUp']); const down2=!!(this.keys['ArrowDown']); const left2=!!(this.keys['ArrowLeft']); const right2=!!(this.keys['ArrowRight']); const kick2=!!(this.keys['Slash']);
  this.mod.input(0,up,down,left,right,kick);
  this.mod.input(1,up2,down2,left2,right2,kick2);
  const t0=performance.now(); this.mod.step(dt); const stepMs=performance.now()-t0;
  const ps=this.mod.getPlayers(); const ball=this.mod.getBall(); const sA=this.mod.getScoreA(); const sB=this.mod.getScoreB(); const tm=this.mod.getTime(); const ko=this.mod.getKickoff(); const win=this.mod.getWinner();
  // build draw buffers
  const n=ps.length/4 + 1; const pts=new Float32Array(n*2); const sizes=new Float32Array(n); const cols=new Float32Array(n*3);
  let k=0; for(let i=0;i<ps.length/4;i++,k++){ const x=ps[i*4], y=ps[i*4+1], r=ps[i*4+2], team=ps[i*4+3]|0; pts[k*2]=x; pts[k*2+1]=y; sizes[k]=Math.max(20.0, r*1400.0); if(team===0){ cols[k*3]=0.4; cols[k*3+1]=0.8; cols[k*3+2]=1.0; } else { cols[k*3]=1.0; cols[k*3+1]=0.5; cols[k*3+2]=0.5; } }
  // ball
  pts[k*2]=ball[0]; pts[k*2+1]=ball[1]; sizes[k]=Math.max(14.0, ball[2]*1600.0); cols[k*3]=1.0; cols[k*3+1]=1.0; cols[k*3+2]=0.6; k++;
  this.gl.draw(pts,sizes,cols);
  // Mensajes simples de estado
  if(win!==-2){
    const msg = win===-1? 'Empate' : (win===0? '¡Gana P1!' : '¡Gana P2!');
    document.title = `Air Hockey WASM · ${msg}`;
  } else if(ko>0){
    document.title = `Air Hockey WASM · Kickoff`;
  } else {
    document.title = `Air Hockey WASM`;
  }
  // HUD
  this.updateHUD(stepMs, sA, sB, tm);
  requestAnimationFrame(this.loop); }
 updateHUD(stepMs,sA,sB,tm){ const fpsEl=document.getElementById('fps'); const timeEl=document.getElementById('time'); const scEl=document.getElementById('score'); this._frames=(this._frames||0)+1; if(this._frames%30===0){ const now=performance.now(); const d=now-(this._lastFps||now); this._fps=Math.round(30000/d); this._lastFps=now; fpsEl.textContent=this._fps; } timeEl.textContent=tm.toFixed(1); scEl.textContent=`${sA} - ${sB}`; }
}

document.addEventListener('DOMContentLoaded',()=>new Game());
