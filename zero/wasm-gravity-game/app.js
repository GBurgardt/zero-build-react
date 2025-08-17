const vertexShaderSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 2.0;
}
`;

const fragmentShaderSource = `
precision mediump float;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = dot(uv, uv);
  if (d > 0.25) discard;
  gl_FragColor = vec4(0.85, 0.95, 1.0, 1.0);
}
`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL no soportado');
    this.program = this.createProgram(vertexShaderSource, fragmentShaderSource);
    this.posLoc = this.gl.getAttribLocation(this.program, 'a_position');
    this.posBuffer = this.gl.createBuffer();

    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.02, 0.02, 0.03, 1.0);
  }

  createShader(type, source) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    return sh;
  }

  createProgram(vs, fs) {
    const gl = this.gl;
    const v = this.createShader(gl.VERTEX_SHADER, vs);
    const f = this.createShader(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    return p;
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(points) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, points.length / 2);
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.renderer = new Renderer(this.canvas);
    this.last = performance.now();
    this.fps = 0; this.frameCount = 0; this.mode = 'WASM';
    this.mouse = { x: 0.5, y: 0.5, down: false };
    this.positionsView = new Float32Array();
    this.init();
  }

  async init() {
    const mod = await this.loadWASM();
    this.wasm = mod;
    this.wasm.init();

    this.bindUI();
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
    this.loop();
  }

  loadWASM() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'physics.js';
      s.onload = async () => {
        try {
          if (typeof Module === 'function') {
            const instance = await Module({});
            resolve(instance);
          } else if (typeof Module === 'object') {
            if (Module.calledRun) resolve(Module);
            else Module.onRuntimeInitialized = () => resolve(Module);
          } else reject(new Error('Module no encontrado'));
        } catch (e) { reject(e); }
      };
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  bindUI() {
    const fpsEl = document.getElementById('fps');
    const countEl = document.getElementById('count');
    const updateEl = document.getElementById('updateMs');
    const dtEl = document.getElementById('dtMs');

    document.getElementById('spawn100k').onclick = () => this.wasm.spawnRandom(100000);
    document.getElementById('spawn500k').onclick = () => this.wasm.spawnRandom(500000);
    document.getElementById('clear').onclick = () => this.wasm.clearAll();

    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.wasm.setBlackHole(this.mouse.x, this.mouse.y);
    });
    this.canvas.addEventListener('mousedown', () => this.mouse.down = true);
    this.canvas.addEventListener('mouseup', () => this.mouse.down = false);

    this.updateHUD = (updateMs) => {
      this.frameCount++;
      if (this.frameCount % 30 === 0) {
        const now = performance.now();
        const delta = now - (this.lastFps || now);
        this.fps = Math.round(30000 / delta);
        this.lastFps = now;
        fpsEl.textContent = this.fps;
        countEl.textContent = this.wasm.getCount();
      }
      updateEl.textContent = updateMs.toFixed(2);
      dtEl.textContent = this.dt.toFixed(2);
    };
  }

  loop() {
    const now = performance.now();
    this.dt = now - this.last; // ms
    this.last = now;

    const t0 = performance.now();
    this.wasm.step(this.dt);
    const upd = performance.now() - t0;

    const pts = this.wasm.getPositionsView();
    this.renderer.draw(pts);

    this.updateHUD(upd);
    requestAnimationFrame(() => this.loop());
  }
}

document.addEventListener('DOMContentLoaded', () => new Game());
