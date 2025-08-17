const VS=`
attribute vec2 a_position; attribute float a_size; attribute vec3 a_color; varying vec3 v_color; void main(){ gl_Position=vec4(a_position*2.0-1.0,0.0,1.0); gl_PointSize=a_size; v_color=a_color; }
`; const FS=`
precision mediump float; varying vec3 v_color; void main(){ vec2 uv=gl_PointCoord-vec2(0.5); float d=dot(uv,uv); if(d>0.25) discard; float a=1.0-smoothstep(0.20,0.25,sqrt(d)); gl_FragColor=vec4(v_color,a);} 
`;
class GL{ constructor(c){ this.c=c; this.g=c.getContext('webgl'); const g=this.g; const v=this._s(g.VERTEX_SHADER,VS), f=this._s(g.FRAGMENT_SHADER,FS); this.p=g.createProgram(); g.attachShader(this.p,v); g.attachShader(this.p,f); g.linkProgram(this.p); this.lPos=g.getAttribLocation(this.p,'a_position'); this.lSize=g.getAttribLocation(this.p,'a_size'); this.lCol=g.getAttribLocation(this.p,'a_color'); this.bPos=g.createBuffer(); this.bSize=g.createBuffer(); this.bCol=g.createBuffer(); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA); g.clearColor(0.02,0.02,0.03,1);} _s(t,src){ const g=this.g; const s=g.createShader(t); g.shaderSource(s,src); g.compileShader(s); return s;} resize(){ this.c.width=innerWidth; this.c.height=innerHeight; this.g.viewport(0,0,this.c.width,this.c.height);} draw(pts,sizes,cols){ const g=this.g; g.clear(g.COLOR_BUFFER_BIT); g.useProgram(this.p); g.bindBuffer(g.ARRAY_BUFFER,this.bPos); g.bufferData(g.ARRAY_BUFFER,pts,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lPos); g.vertexAttribPointer(this.lPos,2,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bSize); g.bufferData(g.ARRAY_BUFFER,sizes,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lSize); g.vertexAttribPointer(this.lSize,1,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bCol); g.bufferData(g.ARRAY_BUFFER,cols,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lCol); g.vertexAttribPointer(this.lCol,3,g.FLOAT,false,0,0); g.drawArrays(g.POINTS,0,pts.length/2);} }
class Game{ constructor(){ this.cv=document.getElementById('canvas'); this.gl=new GL(this.cv); this.fps=0; this.last=performance.now(); this.keys={}; this.loop=this.loop.bind(this); this.init(); }
 async init(){ this.mod=await this.loadWASM(); this.mod.reset(); this.gl.resize(); addEventListener('resize',()=>this.gl.resize()); this.bindInput(); requestAnimationFrame(this.loop); }
 loadWASM(){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='physics.js'; s.onload=async()=>{ try{ if(typeof Module==='function'){ const m=await Module({}); resolve(m);} else if(typeof Module==='object'){ Module.onRuntimeInitialized=()=>resolve(Module);} else reject(new Error('Module not found')); } catch(e){reject(e);} }; s.onerror=reject; document.body.appendChild(s); }); }
 bindInput(){ addEventListener('keydown',(e)=>{ this.keys[e.code]=true; if(e.code==='KeyR'){ this.mod.reset(); } if(e.code==='KeyT'){ this.mod.stress(); } }); addEventListener('keyup',(e)=>{ this.keys[e.code]=false; }); }
 loop(){ const now=performance.now(); const dt=(now-this.last)/1000; this.last=now;
  // input: WASD movimiento; J dispara; K dash
  const ax = (this.keys['KeyA']?-1:0) + (this.keys['KeyD']?1:0);
  const ay = (this.keys['KeyW']?-1:0) + (this.keys['KeyS']?1:0);
  const fire = !!this.keys['KeyJ'];
  const dash = !!this.keys['KeyK'];
  this.mod.input(ax,ay,fire,dash);
  const t0=performance.now(); this.mod.step(dt); const stepMs=performance.now()-t0;
  const all=this.mod.getAll(); const en=this.mod.getCountByType(1); const bu=this.mod.getCountByType(2); const sc=this.mod.getScore();
  const lv=this.mod.getLevel(); const kl=this.mod.getKeysLeft(); const kt=this.mod.getKeysTotal(); const hp=this.mod.getPlayerHP();
  // build draw buffers
  const n=all.length/4; const pts=new Float32Array(n*2); const sizes=new Float32Array(n); const cols=new Float32Array(n*3);
  for(let i=0;i<n;i++){ const x=all[i*4], y=all[i*4+1], r=all[i*4+2], t=all[i*4+3]|0; pts[i*2]=x; pts[i*2+1]=y; let scale= (t===0? 1800.0 : t===6? 800.0 : 600.0); let minSize=(t===0? 20.0 : 6.0); sizes[i]=Math.max(minSize,r*scale); if(t===0){ cols[i*3]=1.0; cols[i*3+1]=0.9; cols[i*3+2]=0.4; } else if(t===1){ cols[i*3]=0.9; cols[i*3+1]=0.95; cols[i*3+2]=1.0; } else if(t===2){ cols[i*3]=1.0; cols[i*3+1]=0.6; cols[i*3+2]=0.4; } else if(t===4){ cols[i*3]=0.6; cols[i*3+1]=1.0; cols[i*3+2]=0.6; } else if(t===5){ cols[i*3]=0.8; cols[i*3+1]=0.6; cols[i*3+2]=1.0; } else { cols[i*3]=0.6; cols[i*3+1]=0.7; cols[i*3+2]=0.9; } }
  this.gl.draw(pts,sizes,cols);
  this.updateHUD(stepMs,en,bu,sc,lv,kl,kt,hp);
  requestAnimationFrame(this.loop); }
 updateHUD(stepMs,en,bu,sc,lv,kl,kt,hp){ const fpsEl=document.getElementById('fps'); const stepEl=document.getElementById('step'); const enEl=document.getElementById('en'); const buEl=document.getElementById('bu'); const scEl=document.getElementById('sc'); const lvEl=document.getElementById('lv'); const klEl=document.getElementById('kl'); const ktEl=document.getElementById('kt'); const hpEl=document.getElementById('hp'); this._frames=(this._frames||0)+1; if(this._frames%30===0){ const now=performance.now(); const d=now-(this._lastFps||now); this._fps=Math.round(30000/d); this._lastFps=now; fpsEl.textContent=this._fps; } stepEl.textContent=stepMs.toFixed(2); enEl.textContent=en; buEl.textContent=bu; scEl.textContent=sc; lvEl.textContent=lv; klEl.textContent=kl; ktEl.textContent=kt; hpEl.textContent=hp; }
}

document.addEventListener('DOMContentLoaded',()=>new Game());
