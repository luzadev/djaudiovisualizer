// Interactive camera family: the webcam watches the room, frame-differencing
// builds a motion map, and physical balls on screen get pushed away when a
// person "touches" them (their movement overlaps a ball). Same takeover
// pattern as FluidSim: while an interactive preset is active this engine owns
// the shared WebGL2 canvas. Falls back to mouse/touch interaction when no
// camera is available.
(function () {

const MAXB = 24;          // uniform array size in the shader
const GW = 96, GH = 54;   // motion grid resolution (screen-mapped, row 0 = top)

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

// One fullscreen pass: dark background + motion mist (so people see where the
// camera detects them) + shaded balls with beat/touch glow halos.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform vec4 uBalls[${MAXB}];   // x,y (uv, y up), radius (y units), pulse 0..1
uniform vec3 uCols[${MAXB}];
uniform int uNum;
uniform vec3 uColA; uniform vec3 uColB;
uniform sampler2D uMotion;
uniform float uT, uBeat, uBass, uLevel;
uniform vec2 uRes;
void main(){
  float as = uRes.x/max(uRes.y,1.0);
  vec2 p = vec2(vUv.x*as, vUv.y);
  // Motion grid row 0 is the top of the screen; GL v=0 is the bottom.
  float m = texture(uMotion, vec2(vUv.x, 1.0-vUv.y)).r;
  vec3 col = uColA*0.10*(0.7+0.5*uLevel)*(1.2-0.8*length(vUv-0.5));
  vec3 mist = mix(uColA, uColB, 0.45) + vec3(0.05);
  col += mist*pow(clamp(m,0.0,1.0),1.15)*0.6;
  float px = 2.0/uRes.y; // ~2px soft edge in y units
  for (int i=0;i<${MAXB};i++){
    if (i>=uNum) break;
    vec4 b = uBalls[i];
    vec2 bp = vec2(b.x*as, b.y);
    float d = length(p-bp);
    float body = smoothstep(b.z, b.z-3.0*px, d);
    vec3 bc = uCols[i];
    if (body>0.001){
      vec2 n = (p-bp)/max(b.z,1e-4);
      float hl = pow(max(0.0, 1.0-length(n-vec2(-0.42,0.46))*0.85), 4.0);
      float shade = 0.50+0.50*max(0.0, 1.0-0.65*length(n+vec2(0.30,-0.30)));
      vec3 bcol = bc*shade + vec3(1.0)*hl*0.75;
      bcol *= 1.0 + b.w*0.9 + uBeat*0.15;
      col = mix(col, bcol, body);
    }
    float halo = exp(-pow(max(0.0,d-b.z)*(26.0-10.0*b.w),2.0));
    col += bc*halo*(0.10+0.55*b.w+0.12*uBeat);
  }
  frag = vec4(pow(max(col,0.0), vec3(0.9)), 1.0);
}`;

// Rotate an RGB colour around the luminance axis (same matrix as CSS
// hue-rotate) so per-ball colours drift with the palette's hueCycle.
function hueRotate(c, a) {
  const cs = Math.cos(a), sn = Math.sin(a);
  return [
    c[0]*(0.213+cs*0.787-sn*0.213)+c[1]*(0.715-cs*0.715-sn*0.715)+c[2]*(0.072-cs*0.072+sn*0.928),
    c[0]*(0.213-cs*0.213+sn*0.143)+c[1]*(0.715+cs*0.285+sn*0.140)+c[2]*(0.072-cs*0.072-sn*0.283),
    c[0]*(0.213-cs*0.213-sn*0.787)+c[1]*(0.715-cs*0.715+sn*0.715)+c[2]*(0.072+cs*0.928+sn*0.072)
  ];
}

class InteractiveSim {
  constructor(gl) {
    this.gl = gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error('Interactive shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('Interactive link: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.aPos = gl.getAttribLocation(p, 'aPos');
    const U = (n) => gl.getUniformLocation(p, n);
    this.u = { uBalls: U('uBalls[0]'), uCols: U('uCols[0]'), uNum: U('uNum'),
      uColA: U('uColA'), uColB: U('uColB'), uMotion: U('uMotion'), uT: U('uT'),
      uBeat: U('uBeat'), uBass: U('uBass'), uLevel: U('uLevel'), uRes: U('uRes') };

    // Motion grid + its GPU texture (single channel).
    this.grid = new Float32Array(GW*GH);
    this.gridU8 = new Uint8Array(GW*GH);
    this.motTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, GW, GH, 0, gl.RED, gl.UNSIGNED_BYTE, this.gridU8);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Camera downscale canvas for frame differencing.
    this.vcv = document.createElement('canvas');
    this.vcv.width = GW; this.vcv.height = GH;
    this.vctx = this.vcv.getContext('2d', { willReadFrequently: true });
    this.prevGray = null;
    this.video = null;
    this.camState = 'off'; // off | starting | on | error
    this.camErr = '';

    this.balls = null;
    this.ballData = new Float32Array(MAXB*4);
    this.colData = new Float32Array(MAXB*3);
    this.lastT = 0;
    this.prevBeat = 0;
    this.pointer = { x: 0, y: 0, t: -1e9 };
    this._bound = null;
  }

  // ------------------------------------------------------------- camera
  async _startCam() {
    if (this.camState !== 'off') return;
    this.camState = 'starting';
    try {
      if (window.djv && window.djv.camAccess) await window.djv.camAccess();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: false
      });
      const v = document.createElement('video');
      v.srcObject = stream; v.muted = true; v.playsInline = true;
      await v.play();
      this.video = v;
      this.camState = 'on';
    } catch (e) {
      this.camState = 'error';
      this.camErr = e && e.message ? e.message : String(e);
    }
  }

  // Called when a non-interactive preset takes over: release the camera so
  // the green indicator light goes off, and reset for a fresh start later.
  suspend() {
    if (this.video) {
      try { this.video.srcObject.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.video = null;
    }
    this.camState = 'off';
    this.balls = null;
    this.grid.fill(0);
    this.lastT = 0;
  }

  // ------------------------------------------------------------- motion
  // Inject a gaussian blob of motion (used by pointer fallback and tests).
  splatMotion(px, py, radius, val) {
    const cx = px*GW, cy = py*GH, r2 = radius*radius;
    const x0 = Math.max(0, Math.floor(cx-radius-1)), x1 = Math.min(GW-1, Math.ceil(cx+radius+1));
    const y0 = Math.max(0, Math.floor(cy-radius-1)), y1 = Math.min(GH-1, Math.ceil(cy+radius+1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x-cx, dy = y-cy;
      const v = val*Math.exp(-(dx*dx+dy*dy)/r2);
      const i = y*GW+x;
      if (v > this.grid[i]) this.grid[i] = Math.min(1, v);
    }
  }

  _updateMotion(dt, nowMs) {
    // Decay so touches are brief pushes, not permanent walls.
    const k = Math.exp(-dt*6.0);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] *= k;

    // Camera frame differencing, mirrored so it behaves like a mirror.
    const v = this.video;
    if (v && v.readyState >= 2 && v.videoWidth) {
      const ctx = this.vctx;
      // Cover-fit the camera frame onto the grid, horizontally mirrored.
      const s = Math.max(GW/v.videoWidth, GH/v.videoHeight);
      const dw = v.videoWidth*s, dh = v.videoHeight*s;
      ctx.save();
      ctx.translate(GW, 0); ctx.scale(-1, 1);
      ctx.drawImage(v, (GW-dw)/2, (GH-dh)/2, dw, dh);
      ctx.restore();
      const img = ctx.getImageData(0, 0, GW, GH).data;
      if (!this.prevGray) this.prevGray = new Uint8Array(GW*GH);
      const prev = this.prevGray;
      const first = this.grayInit !== true;
      for (let i = 0, j = 0; i < GW*GH; i++, j += 4) {
        const g = (img[j]+img[j+1]*2+img[j+2]) >> 2;
        if (!first) {
          const d = g > prev[i] ? g-prev[i] : prev[i]-g;
          if (d > 16) {
            const m = Math.min(1, (d-16)/48);
            if (m > this.grid[i]) this.grid[i] = m;
          }
        }
        prev[i] = g;
      }
      this.grayInit = true;
    }

    // Pointer fallback / extra input: recent mouse or touch movement.
    if (nowMs - this.pointer.t < 90)
      this.splatMotion(this.pointer.x, this.pointer.y, 2.6, 1.0);

    // Upload to the GPU.
    for (let i = 0; i < this.grid.length; i++) this.gridU8[i] = (this.grid[i]*255) | 0;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RED, gl.UNSIGNED_BYTE, this.gridU8);
  }

  _bindPointer(canvas) {
    if (this._bound === canvas) return;
    this._bound = canvas;
    const set = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.x = (cx-r.left)/Math.max(1, r.width);
      this.pointer.y = (cy-r.top)/Math.max(1, r.height);
      this.pointer.t = performance.now();
    };
    canvas.addEventListener('mousemove', (e) => set(e.clientX, e.clientY));
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length) set(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  // ------------------------------------------------------------- physics
  _initBalls(e, aspect) {
    // Variant symmetry picks the ball count (Mirror12 -> a crowd of 22).
    const count = e.sym > 0 ? Math.min(MAXB, 10 + e.sym) : 12;
    this.balls = [];
    for (let i = 0; i < count; i++) {
      const r = 0.055 + 0.045*((i*0.618) % 1);
      this.balls.push({
        x: 0.12*aspect + Math.random()*(aspect-0.24*aspect),
        y: 0.15 + Math.random()*0.7,
        vx: (Math.random()-0.5)*0.10,
        vy: (Math.random()-0.5)*0.10,
        r, pulse: 0
      });
    }
  }

  _physics(dt, e, audio, aspect) {
    const balls = this.balls, grid = this.grid;
    const cw = aspect/GW, ch = 1/GH;
    const speed = Math.min(2.5, e.speed || 1);
    const dtp = dt*speed;

    for (const b of balls) {
      // Push away from nearby camera motion ("touch").
      const R = b.r*2.1;
      const gx0 = Math.max(0, Math.floor((b.x-R)/cw)), gx1 = Math.min(GW-1, Math.ceil((b.x+R)/cw));
      // Grid row 0 = screen top; ball y is bottom-up -> flip when indexing.
      const gy0 = Math.max(0, Math.floor((1-b.y-R)/ch)), gy1 = Math.min(GH-1, Math.ceil((1-b.y+R)/ch));
      let fx = 0, fy = 0, tot = 0;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const m = grid[gy*GW+gx];
        if (m < 0.06) continue;
        const cx = (gx+0.5)*cw, cy = 1-(gy+0.5)*ch;
        let dx = b.x-cx, dy = b.y-cy;
        const d = Math.sqrt(dx*dx+dy*dy);
        if (d > R || d < 1e-5) continue;
        const w = m*(1-d/R);
        fx += (dx/d)*w; fy += (dy/d)*w;
        tot += w;
      }
      if (tot > 0.02) {
        const fl = Math.sqrt(fx*fx+fy*fy) || 1;
        const acc = Math.min(9.0, tot*4.0);
        b.vx += (fx/fl)*acc*dtp;
        b.vy += (fy/fl)*acc*dtp;
        b.pulse = Math.min(1, b.pulse + tot*0.5);
      }

      // Gentle wander so the scene never looks frozen.
      b.vx += (Math.random()-0.5)*0.05*dtp;
      b.vy += (Math.random()-0.5)*0.05*dtp;

      // Damping + speed cap.
      const damp = Math.exp(-dt*0.55);
      b.vx *= damp; b.vy *= damp;
      const sp = Math.sqrt(b.vx*b.vx+b.vy*b.vy);
      if (sp > 1.5) { b.vx *= 1.5/sp; b.vy *= 1.5/sp; }

      b.x += b.vx*dtp; b.y += b.vy*dtp;

      // Wall bounce.
      if (b.x < b.r)        { b.x = b.r;        b.vx = Math.abs(b.vx)*0.9; }
      if (b.x > aspect-b.r) { b.x = aspect-b.r; b.vx = -Math.abs(b.vx)*0.9; }
      if (b.y < b.r)        { b.y = b.r;        b.vy = Math.abs(b.vy)*0.9; }
      if (b.y > 1-b.r)      { b.y = 1-b.r;      b.vy = -Math.abs(b.vy)*0.9; }

      b.pulse *= Math.exp(-dt*3.0);
    }

    // Ball-ball collisions (small N, O(n^2) is fine).
    for (let i = 0; i < balls.length; i++) for (let j = i+1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      let dx = c.x-a.x, dy = c.y-a.y;
      const d = Math.sqrt(dx*dx+dy*dy), min = a.r+c.r;
      if (d >= min || d < 1e-6) continue;
      dx /= d; dy /= d;
      const overlap = (min-d)/2;
      a.x -= dx*overlap; a.y -= dy*overlap;
      c.x += dx*overlap; c.y += dy*overlap;
      const rel = (c.vx-a.vx)*dx + (c.vy-a.vy)*dy;
      if (rel < 0) {
        const imp = -rel*0.92;
        a.vx -= dx*imp; a.vy -= dy*imp;
        c.vx += dx*imp; c.vy += dy*imp;
      }
    }

    // Beat: a little kick + glow on every ball.
    if (audio.beat > 0.6 && this.prevBeat <= 0.6) {
      for (const b of balls) {
        b.vx += (Math.random()-0.5)*0.10;
        b.vy += (Math.random()-0.5)*0.10;
        b.pulse = Math.min(1, b.pulse + 0.30);
      }
    }
    this.prevBeat = audio.beat;
  }

  // ------------------------------------------------------------- render
  render(timeSec, audio, e, canvas) {
    const gl = this.gl;
    this._bindPointer(canvas);
    this._startCam(); // async, guarded; no-op once on/erroring

    const aspect = canvas.width/Math.max(1, canvas.height);
    if (!this.balls || this._sym !== (e.sym|0)) { this._sym = e.sym|0; this._initBalls(e, aspect); }

    const dt = this.lastT ? Math.min(0.045, timeSec-this.lastT) : 0.016;
    this.lastT = timeSec;
    const nowMs = performance.now();

    this._updateMotion(dt, nowMs);
    this._physics(Math.max(0.001, dt), e, audio, aspect);

    // Pack uniforms: positions as uv (x/aspect), radius stays in y units.
    const bd = this.ballData, cd = this.colData, n = this.balls.length;
    const hueA = (e.hueBase || 0)*6.2832 + timeSec*(e.hueCycle || 0)*6.2832;
    const ca = e.colorA || [0.05, 0, 0.2], cb = e.colorB || [0.2, 1, 1];
    for (let i = 0; i < n; i++) {
      const b = this.balls[i];
      bd[i*4] = b.x/aspect; bd[i*4+1] = b.y;
      bd[i*4+2] = b.r*(1 + 0.14*(audio.bass || 0) + 0.20*b.pulse);
      bd[i*4+3] = b.pulse;
      const f = 0.30 + 0.70*((i*0.618) % 1);
      const base = [ca[0]+(cb[0]-ca[0])*f, ca[1]+(cb[1]-ca[1])*f, ca[2]+(cb[2]-ca[2])*f];
      // Small per-ball hue offset: variety without losing the palette identity.
      const col = hueRotate(base, hueA + (i%5)*0.16 - 0.32);
      cd[i*3] = Math.max(0, col[0]); cd[i*3+1] = Math.max(0, col[1]); cd[i*3+2] = Math.max(0, col[2]);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(this.u.uBalls, bd);
    gl.uniform3fv(this.u.uCols, cd);
    gl.uniform1i(this.u.uNum, n);
    gl.uniform3fv(this.u.uColA, ca);
    gl.uniform3fv(this.u.uColB, cb);
    gl.uniform1f(this.u.uT, timeSec);
    gl.uniform1f(this.u.uBeat, audio.beat || 0);
    gl.uniform1f(this.u.uBass, audio.bass || 0);
    gl.uniform1f(this.u.uLevel, audio.level || 0);
    gl.uniform2f(this.u.uRes, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.uniform1i(this.u.uMotion, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

window.InteractiveSim = InteractiveSim;

})();
