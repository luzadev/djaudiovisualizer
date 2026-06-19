// WebGL2 engine: renders a fullscreen quad through one of the scene shaders.

class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 non disponibile su questo sistema.');
    this.gl = gl;

    this.programs = window.SHADERS.scenes.map(src => this._buildProgram(window.SHADERS.vert, src));
    this.sceneIndex = 0;

    // Fullscreen triangle covering the viewport.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vbo = buf;

    // Per-program attribute/uniform locations.
    this.locs = this.programs.map(p => {
      gl.useProgram(p);
      const aPos = gl.getAttribLocation(p, 'aPos');
      return {
        aPos,
        uRes: gl.getUniformLocation(p, 'uRes'),
        uTime: gl.getUniformLocation(p, 'uTime'),
        uBass: gl.getUniformLocation(p, 'uBass'),
        uMid: gl.getUniformLocation(p, 'uMid'),
        uTreble: gl.getUniformLocation(p, 'uTreble'),
        uLevel: gl.getUniformLocation(p, 'uLevel'),
        uBeat: gl.getUniformLocation(p, 'uBeat')
      };
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      throw new Error('Errore compilazione shader:\n' + log + '\n\n' + src);
    }
    return sh;
  }

  _buildProgram(vsrc, fsrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Errore link programma: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setScene(i) {
    this.sceneIndex = Math.max(0, Math.min(this.programs.length - 1, i));
  }

  // audio: { bass, mid, treble, level, beat }
  render(timeSec, audio) {
    const gl = this.gl;
    const p = this.programs[this.sceneIndex];
    const l = this.locs[this.sceneIndex];
    gl.useProgram(p);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(l.aPos);
    gl.vertexAttribPointer(l.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(l.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(l.uTime, timeSec);
    gl.uniform1f(l.uBass, audio.bass);
    gl.uniform1f(l.uMid, audio.mid);
    gl.uniform1f(l.uTreble, audio.treble);
    gl.uniform1f(l.uLevel, audio.level);
    gl.uniform1f(l.uBeat, audio.beat);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

window.Visualizer = Visualizer;
