const VS=`
attribute vec2 a_position; attribute float a_size; attribute vec3 a_color; varying vec3 v_color; void main(){ gl_Position=vec4(a_position*2.0-1.0,0.0,1.0); gl_PointSize=a_size; v_color=a_color; }
`; const FS=`
precision mediump float; varying vec3 v_color; void main(){ vec2 uv=gl_PointCoord-vec2(0.5); float d=dot(uv,uv); if(d>0.25) discard; float a=1.0-smoothstep(0.20,0.25,sqrt(d)); gl_FragColor=vec4(v_color,a);} 
`;
class GL{ constructor(c){ this.c=c; this.g=c.getContext('webgl'); const g=this.g; const v=this._s(g.VERTEX_SHADER,VS), f=this._s(g.FRAGMENT_SHADER,FS); this.p=g.createProgram(); g.attachShader(this.p,v); g.attachShader(this.p,f); g.linkProgram(this.p); this.lPos=g.getAttribLocation(this.p,'a_position'); this.lSize=g.getAttribLocation(this.p,'a_size'); this.lCol=g.getAttribLocation(this.p,'a_color'); this.bPos=g.createBuffer(); this.bSize=g.createBuffer(); this.bCol=g.createBuffer(); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA); g.clearColor(0.02,0.02,0.03,1);} _s(t,src){ const g=this.g; const s=g.createShader(t); g.shaderSource(s,src); g.compileShader(s); return s;} resize(){ this.c.width=innerWidth; this.c.height=innerHeight; this.g.viewport(0,0,this.c.width,this.c.height);} draw(pts,sizes,cols){ const g=this.g; g.clear(g.COLOR_BUFFER_BIT); g.useProgram(this.p); g.bindBuffer(g.ARRAY_BUFFER,this.bPos); g.bufferData(g.ARRAY_BUFFER,pts,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lPos); g.vertexAttribPointer(this.lPos,2,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bSize); g.bufferData(g.ARRAY_BUFFER,sizes,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lSize); g.vertexAttribPointer(this.lSize,1,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bCol); g.bufferData(g.ARRAY_BUFFER,cols,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lCol); g.vertexAttribPointer(this.lCol,3,g.FLOAT,false,0,0); g.drawArrays(g.POINTS,0,pts.length/2);} }
class Game{ constructor(){ this.cv=document.getElementById('canvas'); this.gl=new GL(this.cv); this.fps=0; this.last=performance.now(); this.keys={}; this.loop=this.loop.bind(this); this.init(); }
 async init(){ this.mod=await this.loadWASM(); this.mod.start(); this.gl.resize(); addEventListener('resize',()=>this.gl.resize()); this.bindInput(); requestAnimationFrame(this.loop); }
 loadWASM(){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='physics.js'; s.onload=async()=>{ try{ if(typeof Module==='function'){ const m=await Module({}); resolve(m);} else if(typeof Module==='object'){ Module.onRuntimeInitialized=()=>resolve(Module);} else reject(new Error('Module not found')); } catch(e){reject(e);} }; s.onerror=reject; document.body.appendChild(s); }); }
 bindInput(){
  addEventListener('keydown',(e)=>{
    this.keys[e.code]=true;
    // Evitar scroll con flechas
    if(e.code.startsWith('Arrow')) e.preventDefault();
    if(e.code==='KeyR'){ this.mod.reset(); this.mod.start(); }
  });
  addEventListener('keyup',(e)=>{ this.keys[e.code]=false; });
 }
 loop(){ const now=performance.now(); const dt=(now-this.last)/1000; this.last=now;
  // input
  const thrust = !!(this.keys['KeyW'] || this.keys['ArrowUp']);
  const rot = (this.keys['KeyA']||this.keys['ArrowLeft'] ? -1 : 0) + (this.keys['KeyD']||this.keys['ArrowRight'] ? 1 : 0);
  const fire = !!(this.keys['KeyJ'] || this.keys['KeyF']);
  this.mod.input(thrust, rot, fire);
  // step
  const t0=performance.now(); this.mod.step(dt); const stepMs=performance.now()-t0;
  // read
  const ship=this.mod.getShip(); const bullets=this.mod.getBullets(); const asts=this.mod.getAsts();
  const score=this.mod.getScore(); const lives=this.mod.getLives(); const wave=this.mod.getWave();
  // build draw
  const nP=1, nB=bullets.length/2, nA=asts.length/3; const total=nP+nB+nA; const pts=new Float32Array(total*2); const sizes=new Float32Array(total); const cols=new Float32Array(total*3);
  let k=0; // ship (punto + dirección con color distinto)
  pts[k*2]=ship[0]; pts[k*2+1]=ship[1]; sizes[k]=7.0; cols[k*3]=0.7; cols[k*3+1]=1.0; cols[k*3+2]=0.7; k++;
  for(let i=0;i<nB;i++,k++){ pts[k*2]=bullets[i*2]; pts[k*2+1]=bullets[i*2+1]; sizes[k]=3.0; cols[k*3]=1.0; cols[k*3+1]=0.9; cols[k*3+2]=0.6; }
  for(let i=0;i<nA;i++,k++){ pts[k*2]=asts[i*3]; pts[k*2+1]=asts[i*3+1]; sizes[k]=Math.max(3.0,asts[i*3+2]*200.0); cols[k*3]=0.9; cols[k*3+1]=0.95; cols[k*3+2]=1.0; }
  this.gl.draw(pts,sizes,cols);
  // HUD
  this.updateHUD(stepMs, score, lives, wave);
  requestAnimationFrame(this.loop); }
 updateHUD(stepMs,score,lives,wave){ const fpsEl=document.getElementById('fps'); const stepEl=document.getElementById('step'); const sEl=document.getElementById('score'); const lEl=document.getElementById('lives'); const wEl=document.getElementById('wave'); this._frames=(this._frames||0)+1; if(this._frames%30===0){ const now=performance.now(); const d=now-(this._lastFps||now); this._fps=Math.round(30000/d); this._lastFps=now; fpsEl.textContent=this._fps; } stepEl.textContent=stepMs.toFixed(2); sEl.textContent=score; lEl.textContent=lives; wEl.textContent=wave; }
}

document.addEventListener('DOMContentLoaded',()=>new Game());
