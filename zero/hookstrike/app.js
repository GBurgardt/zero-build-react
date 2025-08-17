const VS=`
attribute vec2 a_position; attribute float a_size; attribute vec3 a_color; varying vec3 v_color; void main(){ gl_Position=vec4(a_position*2.0-1.0,0.0,1.0); gl_PointSize=a_size; v_color=a_color; }
`; const FS=`
precision mediump float; varying vec3 v_color; void main(){ vec2 uv=gl_PointCoord-vec2(0.5); float d=dot(uv,uv); if(d>0.25) discard; float a=1.0-smoothstep(0.20,0.25,sqrt(d)); gl_FragColor=vec4(v_color,a);} 
`;
class GL{ constructor(c){ this.c=c; this.g=c.getContext('webgl'); const g=this.g; const v=this._s(g.VERTEX_SHADER,VS), f=this._s(g.FRAGMENT_SHADER,FS); this.p=g.createProgram(); g.attachShader(this.p,v); g.attachShader(this.p,f); g.linkProgram(this.p); this.lPos=g.getAttribLocation(this.p,'a_position'); this.lSize=g.getAttribLocation(this.p,'a_size'); this.lCol=g.getAttribLocation(this.p,'a_color'); this.bPos=g.createBuffer(); this.bSize=g.createBuffer(); this.bCol=g.createBuffer(); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA); g.clearColor(0.02,0.02,0.03,1);} _s(t,src){ const g=this.g; const s=g.createShader(t); g.shaderSource(s,src); g.compileShader(s); return s;} resize(){ this.c.width=innerWidth; this.c.height=innerHeight; this.g.viewport(0,0,this.c.width,this.c.height);} draw(pts,sizes,cols){ const g=this.g; g.clear(g.COLOR_BUFFER_BIT); g.useProgram(this.p); g.bindBuffer(g.ARRAY_BUFFER,this.bPos); g.bufferData(g.ARRAY_BUFFER,pts,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lPos); g.vertexAttribPointer(this.lPos,2,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bSize); g.bufferData(g.ARRAY_BUFFER,sizes,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lSize); g.vertexAttribPointer(this.lSize,1,g.FLOAT,false,0,0); g.bindBuffer(g.ARRAY_BUFFER,this.bCol); g.bufferData(g.ARRAY_BUFFER,cols,g.DYNAMIC_DRAW); g.enableVertexAttribArray(this.lCol); g.vertexAttribPointer(this.lCol,3,g.FLOAT,false,0,0); g.drawArrays(g.POINTS,0,pts.length/2);} }
 class Game{ constructor(){ this.cv=document.getElementById('canvas'); this.gl=new GL(this.cv); this.fps=0; this.frame=0; this.last=performance.now(); this.mouse={x:0.5,y:0.5}; this.state='detached'; this.combo=1; this.score=0; this.timeLeft=60; this.stepTimes=[]; this.keys={}; this.aimSpeed=0.6; this.loop=this.loop.bind(this); this.init(); }
 async init(){ this.mod=await this.loadWASM(); this.mod.init(); this.gl.resize(); addEventListener('resize',()=>this.gl.resize()); this.bindUI(); requestAnimationFrame(this.loop); }
 loadWASM(){ return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='physics.js'; s.onload=async()=>{ try{ if(typeof Module==='function'){ const m=await Module({}); resolve(m);} else if(typeof Module==='object'){ Module.onRuntimeInitialized=()=>resolve(Module);} else reject(new Error('Module not found')); } catch(e){reject(e);} }; s.onerror=reject; document.body.appendChild(s); }); }
 bindUI(){ const $=id=>document.getElementById(id); this.$fps=$('fps'); this.$step=$('step'); this.$iters=$('iters'); this.$time=$('time'); this.$combo=$('combo'); this.$score=$('score'); this.$goals=$('goals'); this.$bullets=$('bullets');
  const resetBtn=$('reset'); if(resetBtn){ resetBtn.addEventListener('click',()=>this.reset()); }
  const stressBtn=$('stress'); if(stressBtn){ stressBtn.addEventListener('click',()=>this.mod.setIterations(256)); }
  // Teclado
  addEventListener('keydown',(e)=>{ this.keys[e.code]=true; if(e.code==='Space'||e.code==='KeyJ'){ if(this.state==='attached'){ this.mod.detach(); this.state='detached'; } else { this.mod.attach(); this.state='attached'; } } if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyK'){ this.mod.dash(); } if(e.code==='KeyR'){ this.reset(); } });
  addEventListener('keyup',(e)=>{ this.keys[e.code]=false; });
  // Mouse opcional
  this.cv.addEventListener('mousemove',(e)=>{ const r=this.cv.getBoundingClientRect(); this.mouse.x=(e.clientX-r.left)/r.width; this.mouse.y=(e.clientY-r.top)/r.height; this.mod.setMouse(this.mouse.x,this.mouse.y); });
  this.cv.addEventListener('mousedown',()=>{ this.mod.attach(); this.state='attached'; });
 }
 reset(){ this.mod.init(); this.state='detached'; this.combo=1; this.score=0; this.timeLeft=60; this.stepTimes.length=0; }
  loop(){ const now=performance.now(); const dt=now-this.last; this.last=now; this.timeLeft-=dt/1000; if(this.timeLeft<=0){ this.timeLeft=0; }
   // Modo teclado: mover retícula
   const aim = this.aimSpeed * (dt/1000);
   if(this.keys['KeyW']||this.keys['ArrowUp']) this.mouse.y -= aim;
   if(this.keys['KeyS']||this.keys['ArrowDown']) this.mouse.y += aim;
   if(this.keys['KeyA']||this.keys['ArrowLeft']) this.mouse.x -= aim;
   if(this.keys['KeyD']||this.keys['ArrowRight']) this.mouse.x += aim;
   this.mouse.x=Math.max(0,Math.min(1,this.mouse.x)); this.mouse.y=Math.max(0,Math.min(1,this.mouse.y));
   this.mod.setMouse(this.mouse.x,this.mouse.y);
  const t0=performance.now(); this.mod.step(dt); const stepMs=performance.now()-t0; this.stepTimes.push(stepMs); if(this.stepTimes.length>100){ this.stepTimes.shift(); }
  const player=this.mod.getPlayer(); const rope=this.mod.getRope(); const bullets=this.mod.getBullets(); const goals=this.mod.getGoals();
  // build draw buffers
  const nR=rope.length/2, nB=bullets.length/2, nG=goals.length/3; const total=nR+2+nB+nG; const pts=new Float32Array(total*2); const sizes=new Float32Array(total); const cols=new Float32Array(total*3);
  let k=0; // rope
  for(let i=0;i<nR;i++,k++){ pts[k*2]=rope[i*2]; pts[k*2+1]=rope[i*2+1]; sizes[k]=3.0; cols[k*3]=0.9; cols[k*3+1]=0.95; cols[k*3+2]=1.0; }
  // anchor
  pts[k*2]=this.mouse.x; pts[k*2+1]=this.mouse.y; sizes[k]=6.0; cols[k*3]=0.8; cols[k*3+1]=0.6; cols[k*3+2]=1.0; k++;
  // player
  pts[k*2]=player[0]; pts[k*2+1]=player[1]; sizes[k]=8.0; cols[k*3]=0.6; cols[k*3+1]=1.0; cols[k*3+2]=0.6; k++;
  // bullets
  for(let i=0;i<nB;i++,k++){ pts[k*2]=bullets[i*2]; pts[k*2+1]=bullets[i*2+1]; sizes[k]=2.5; cols[k*3]=1.0; cols[k*3+1]=0.75; cols[k*3+2]=0.4; }
  // goals
  for(let i=0;i<nG;i++,k++){ pts[k*2]=goals[i*3]; pts[k*2+1]=goals[i*3+1]; sizes[k]=Math.max(4.0, goals[i*3+2]*200.0); cols[k*3]=0.4; cols[k*3+1]=1.0; cols[k*3+2]=0.9; }
  this.gl.draw(pts,sizes,cols);
  // scoring simple: +10 por goal destruido reciente (proxy por diferencia)
  const alive=this.mod.getGoalsAlive(); this._lastAlive=this._lastAlive??alive; if(alive<this._lastAlive){ this.score+=10*(this.combo); this.combo=Math.min(this.combo+1,10); } this._lastAlive=alive;
  // HUD
  this.frame++; if(this.frame%30===0){ const d=now-(this.lastFps||now); this.fps=Math.round(30000/d); this.lastFps=now; this.$fps.textContent=this.fps; this.$iters.textContent=this.mod.getIterations(); this.$bullets.textContent=this.mod.getBulletCount(); }
  // p95 step
  const arr=[...this.stepTimes].sort((a,b)=>a-b); const p95=arr.length?arr[Math.floor(arr.length*0.95)]:0; this.$step.textContent=p95.toFixed(2);
  this.$time.textContent=this.timeLeft.toFixed(2); this.$combo.textContent='x'+this.combo; this.$score.textContent=this.score; this.$goals.textContent=(6-alive)+' / 6';
  requestAnimationFrame(this.loop); }
}

document.addEventListener('DOMContentLoaded',()=>new Game());
