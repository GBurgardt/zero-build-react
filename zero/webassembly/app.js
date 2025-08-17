// WebGL Shaders
const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec3 a_color;
    attribute float a_size;
    
    varying vec3 v_color;
    
    void main() {
        gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = a_size;
        v_color = a_color;
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    varying vec3 v_color;
    
    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        
        if (dist > 0.5) {
            discard;
        }
        
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        gl_FragColor = vec4(v_color, alpha);
    }
`;

class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl');
        
        if (!this.gl) {
            throw new Error('WebGL no soportado!');
        }
        
        this.setupShaders();
        this.setupBuffers();
        this.setupGL();
    }
    
    setupShaders() {
        const gl = this.gl;
        
        // Crear y compilar vertex shader
        const vShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vShader, vertexShaderSource);
        gl.compileShader(vShader);
        
        // Crear y compilar fragment shader
        const fShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fShader, fragmentShaderSource);
        gl.compileShader(fShader);
        
        // Crear programa y linkear
        this.program = gl.createProgram();
        gl.attachShader(this.program, vShader);
        gl.attachShader(this.program, fShader);
        gl.linkProgram(this.program);
        
        // Obtener locations
        this.positionLoc = gl.getAttribLocation(this.program, 'a_position');
        this.colorLoc = gl.getAttribLocation(this.program, 'a_color');
        this.sizeLoc = gl.getAttribLocation(this.program, 'a_size');
    }
    
    setupBuffers() {
        const gl = this.gl;
        this.positionBuffer = gl.createBuffer();
        this.colorBuffer = gl.createBuffer();
        this.sizeBuffer = gl.createBuffer();
    }
    
    setupGL() {
        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0.04, 0.04, 0.04, 1.0);
    }
    
    render(wasmModule) {
        const gl = this.gl;
        const count = wasmModule._getCircleCount();
        
        if (count === 0) {
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }
        
        // Usar Embind: obtener vistas tipadas directamente
        const positions = wasmModule.getPositionsView();
        const colors = wasmModule.getColorsView();
        const sizes = wasmModule.getSizesView();
        
        // Clear
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Usar programa
        gl.useProgram(this.program);
        
        // Subir positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, 0, 0);
        
        // Subir colors
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.colorLoc);
        gl.vertexAttribPointer(this.colorLoc, 3, gl.FLOAT, false, 0, 0);
        
        // Subir sizes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sizes), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.sizeLoc);
        gl.vertexAttribPointer(this.sizeLoc, 1, gl.FLOAT, false, 0, 0);
        
        // Dibujar!
        gl.drawArrays(gl.POINTS, 0, count);
    }
    
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
}

// App principal
class App {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.renderer = new WebGLRenderer(this.canvas);
        this.wasmModule = null;
        this.isDrawing = false;
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.fps = 60;
        
        this.init();
    }
    
    async init() {
        // Cargar WASM
        try {
            this.wasmModule = await this.loadWASM();
            this.wasmModule._init();
            
            this.setupEvents();
            this.renderer.resize();
            this.animate();
            
            console.log('✅ WASM cargado correctamente!');
        } catch (e) {
            console.error('Error cargando WASM:', e);
            alert('Error cargando WASM. Verifica que compilaste el código C++');
        }
    }
    
    async loadWASM() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'renderer.js';
            script.onload = async () => {
                try {
                    // Con MODULARIZE=1, EXPORT_NAME=Module expone una función global Module()
                    if (typeof Module === 'function') {
                        const instance = await Module({});
                        resolve(instance);
                        return;
                    }
                    // Fallback si no se usa MODULARIZE (no esperado, pero por compatibilidad)
                    if (typeof Module === 'object') {
                        if (Module.calledRun) {
                            resolve(Module);
                        } else {
                            Module.onRuntimeInitialized = () => resolve(Module);
                        }
                        return;
                    }
                    reject(new Error('No se encontró el factory Module()'));
                } catch (err) {
                    reject(err);
                }
            };
            script.onerror = reject;
            document.body.appendChild(script);
        });
    }
    
    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDrawing = true;
            this.addCircleAtMouse(e);
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDrawing) {
                this.addCircleAtMouse(e);
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });
        
        // Touch events para mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.isDrawing = true;
            this.addCircleAtTouch(e.touches[0]);
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.isDrawing) {
                this.addCircleAtTouch(e.touches[0]);
            }
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.isDrawing = false;
        });
        
        // Keyboard
        window.addEventListener('keydown', (e) => {
            if (e.key === 'c' || e.key === 'C') {
                this.wasmModule._clearCircles();
            }
        });
        
        // Resize
        window.addEventListener('resize', () => {
            this.renderer.resize();
        });
    }
    
    addCircleAtMouse(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        
        // Agregar múltiples círculos para efecto más denso
        for (let i = 0; i < 5; i++) {
            const offsetX = (Math.random() - 0.5) * 0.02;
            const offsetY = (Math.random() - 0.5) * 0.02;
            this.wasmModule._addCircle(x + offsetX, y + offsetY);
        }
    }
    
    addCircleAtTouch(touch) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) / rect.width;
        const y = (touch.clientY - rect.top) / rect.height;
        
        for (let i = 0; i < 5; i++) {
            const offsetX = (Math.random() - 0.5) * 0.02;
            const offsetY = (Math.random() - 0.5) * 0.02;
            this.wasmModule._addCircle(x + offsetX, y + offsetY);
        }
    }
    
    animate() {
        const now = performance.now();
        const deltaTime = now - this.lastTime;
        this.lastTime = now;
        
        // Update physics en WASM
        this.wasmModule._updateCircles(deltaTime);
        
        // Render con WebGL
        this.renderer.render(this.wasmModule);
        
        // Update UI
        this.updateStats();
        
        requestAnimationFrame(() => this.animate());
    }
    
    updateStats() {
        this.frameCount++;
        
        if (this.frameCount % 30 === 0) {
            const now = performance.now();
            const delta = now - (this.lastFPSUpdate || now);
            this.fps = Math.round(30000 / delta);
            this.lastFPSUpdate = now;
            
            document.getElementById('fps').textContent = this.fps;
            document.getElementById('count').textContent = this.wasmModule._getCircleCount();
        }
    }
}

// Iniciar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
