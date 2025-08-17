const VS = `
attribute vec2 a_position;
attribute float a_size;
attribute vec3 a_color;
varying vec3 v_color;
void main(){
  gl_Position = vec4(a_position*2.0-1.0,0.0,1.0);
  gl_PointSize = a_size;
  v_color = a_color;
}
`;
const FS = `
precision mediump float;
varying vec3 v_color;
void main(){
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = dot(uv,uv);
  if(d>0.25) discard;
  float alpha = 1.0 - smoothstep(0.20,0.25,sqrt(d));
  gl_FragColor = vec4(v_color, alpha);
}
`;

class GL {
  constructor(canvas){
    this.c = canvas; this.g = canvas.getContext('webgl');
    const g=this.g; if(!g) throw new Error('WebGL no');
    const v=this._sh(g.VERTEX_SHADER,VS), f=this._sh(g.FRAGMENT_SHADER,FS);
    this.p=g.createProgram(); g.attachShader(this.p,v); g.attachShader(this.p,f); g.linkProgram(this.p);
    this.locPos=g.getAttribLocation(this.p,'a_position');
    this.locSize=g.getAttribLocation(this.p,'a_size');
    this.locCol=g.getAttribLocation(this.p,'a_color');
    this.bufPos=g.createBuffer(); this.bufSize=g.createBuffer(); this.bufCol=g.createBuffer();
    g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);
    g.clearColor(0.02,0.02,0.03,1);
  }
  _sh(t,src){ const g=this.g; const s=g.createShader(t); g.shaderSource(s,src); g.compileShader(s); return s; }
  resize(){ this.c.width=innerWidth; this.c.height=innerHeight; this.g.viewport(0,0,this.c.width,this.c.height); }
  draw(points, sizes, colors){
    const g=this.g; g.clear(g.COLOR_BUFFER_BIT); g.useProgram(this.p);
    g.bindBuffer(g.ARRAY_BUFFER,this.bufPos); g.bufferData(g.ARRAY_BUFFER,new Float32Array(points),g.DYNAMIC_DRAW);
    g.enableVertexAttribArray(this.locPos); g.vertexAttribPointer(this.locPos,2,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bufSize); g.bufferData(g.ARRAY_BUFFER,new Float32Array(sizes),g.DYNAMIC_DRAW);
    g.enableVertexAttribArray(this.locSize); g.vertexAttribPointer(this.locSize,1,g.FLOAT,false,0,0);
    g.bindBuffer(g.ARRAY_BUFFER,this.bufCol); g.bufferData(g.ARRAY_BUFFER,new Float32Array(colors),g.DYNAMIC_DRAW);
    g.enableVertexAttribArray(this.locCol); g.vertexAttribPointer(this.locCol,3,g.FLOAT,false,0,0);
    g.drawArrays(g.POINTS,0,points.length/2);
  }
}

class Game{
  constructor(){
    this.canvas=document.getElementById('canvas');
    this.gl=new GL(this.canvas);
    this.fps=0; this.frame=0; this.last=performance.now();
    this.mouse={x:0.5,y:0.5,down:false};
    this.state='detached';
    this.loop=this.loop.bind(this);
    this.init();
  }
  async init(){
    this.mod=await this.loadWASM(); this.mod.init();
    this.gl.resize(); addEventListener('resize',()=>this.gl.resize());
    this.bindUI(); requestAnimationFrame(this.loop);
  }
  loadWASM(){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script'); s.src='physics.js';
      s.onload=async()=>{ try{
        if(typeof Module==='function'){ const m=await Module({}); resolve(m);} else if(typeof Module==='object'){ Module.onRuntimeInitialized=()=>resolve(Module);} else reject(new Error('Module not found')); }
        catch(e){reject(e);} };
      s.onerror=reject; document.body.appendChild(s);
    });
  }
  bindUI(){
    const ropeEl=id=>document.getElementById(id);
    const fpsEl=ropeEl('fps'), stepEl=ropeEl('step'), itEl=ropeEl('iters'), ropeCountEl=ropeEl('ropeCount'), stEl=ropeEl('state');
    ropeEl('attach').onclick=()=>{ this.mod.attach(); this.state='attached'; stEl.textContent=this.state; };
    ropeEl('detach').onclick=()=>{ this.mod.detach(); this.state='detached'; stEl.textContent=this.state; };
    ropeEl('reset').onclick=()=>{ this.mod.init(); this.state='detached'; stEl.textContent=this.state; };
    ropeEl('stress').onclick=()=>{ this.mod.setIterations(256); };
    // mouse
    this.canvas.addEventListener('mousemove',(e)=>{
      const r=this.canvas.getBoundingClientRect();
      this.mouse.x=(e.clientX-r.left)/r.width; this.mouse.y=(e.clientY-r.top)/r.height;
      this.mod.setMouse(this.mouse.x,this.mouse.y);
    });
    this.canvas.addEventListener('mousedown',()=>{ this.mod.attach(); this.state='attached'; stEl.textContent=this.state; });
    this.canvas.addEventListener('mouseup',()=>{ /* keep attached until space */ });
    addEventListener('keydown',(e)=>{ if(e.code==='Space'){ if(this.state==='attached'){ this.mod.detach(); this.state='detached'; } else { this.mod.attach(); this.state='attached'; } stEl.textContent=this.state; } });
    this.updateHUD=(stepMs)=>{
      this.frame++; if(this.frame%30===0){ const now=performance.now(), d=now-(this.lastFps||now); this.fps=Math.round(30000/d); this.lastFps=now; fpsEl.textContent=this.fps; itEl.textContent=this.mod.getIterations(); }
      stepEl.textContent=stepMs.toFixed(2); ropeCountEl.textContent=this.mod.getRopeCount(); stEl.textContent=this.state;
    };
  }
  loop(){
    const now=performance.now(); const dt=now-this.last; this.last=now;
    const t0=performance.now(); this.mod.step(dt); const stepMs=performance.now()-t0;
    const player=this.mod.getPlayer(); const rope=this.mod.getRopePositions();
    const N=(rope.length/2); const points=new Float32Array((N+2)*2); const sizes=new Float32Array(N+2); const colors=new Float32Array((N+2)*3);
    // rope nodes
    for(let i=0;i<N;i++){ points[i*2]=rope[i*2]; points[i*2+1]=rope[i*2+1]; sizes[i]=3.0; colors[i*3]=0.9; colors[i*3+1]=0.95; colors[i*3+2]=1.0; }
    // anchor point
    points[N*2]=this.mouse.x; points[N*2+1]=this.mouse.y; sizes[N]=6.0; colors[N*3]=0.8; colors[N*3+1]=0.6; colors[N*3+2]=1.0;
    // player point
    points[(N+1)*2]=player[0]; points[(N+1)*2+1]=player[1]; sizes[N+1]=8.0; colors[(N+1)*3]=0.5; colors[(N+1)*3+1]=1.0; colors[(N+1)*3+2]=0.6;
    this.gl.draw(points,sizes,colors);
    this.updateHUD(stepMs);
    requestAnimationFrame(this.loop);
  }
}

document.addEventListener('DOMContentLoaded',()=>new Game());
