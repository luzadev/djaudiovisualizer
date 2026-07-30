// Interactive camera families: the webcam watches the room, frame-differencing
// builds a motion map, and each mode turns that motion into a different
// interaction (pushing balls, popping bubbles, painting light, carving fire...).
// Same takeover pattern as FluidSim: while an interactive preset is active this
// engine owns the shared WebGL2 canvas. Falls back to mouse/touch interaction
// when no camera is available.
//
// Modes (effect.interactiveMode): balls, bubbles, balloons, mirror, cloth,
// paint, fluid, silhouette, swarm, tiles, firewall.
(function () {

const MAXB = 24;            // ball-style uniform array size in the shader
const GW = 160, GH = 90;    // motion grid resolution (screen-mapped, row 0 = top)
const TX = 26, TY = 15;     // tile wall resolution
const MAXV = 12000;         // dynamic vertex buffer capacity (points/lines)

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

// Fullscreen pass shared by every mode. uMode picks the look:
// 0 balls, 1 bubbles, 2 balloons, 3 silhouette, 4 firewall, 5 tiles,
// 6 paint display, 7 plain background (mist only, particles drawn on top).
const FIELD_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform vec4 uBalls[${MAXB}];   // x,y (uv, y up), radius (y units), pulse 0..1
uniform vec3 uCols[${MAXB}];
uniform int uNum;
uniform int uMode;
uniform vec3 uColA; uniform vec3 uColB;
uniform sampler2D uMotion;      // instantaneous motion (row 0 = screen top)
uniform sampler2D uAux;         // silhouette ghost / paint trail
uniform sampler2D uTiles;       // tile openness (TX x TY)
uniform float uT, uBeat, uBass, uLevel;
uniform vec2 uRes;

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm2(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise2(p); p*=2.03; a*=.5; } return v; }
float mo(vec2 uv){ return texture(uMotion, vec2(uv.x, 1.0-uv.y)).r; }
float aux(vec2 uv){ return texture(uAux, vec2(uv.x, 1.0-uv.y)).r; }

void main(){
  float as = uRes.x/max(uRes.y,1.0);
  vec2 uv = vUv;
  vec2 p = vec2(uv.x*as, uv.y);
  vec3 col = vec3(0.0);

  if (uMode <= 2 || uMode == 7) {
    // Dark vignetted background + motion mist, so people see where the camera
    // detects them. Ball-style modes then draw their bodies on top.
    float m = mo(uv);
    col = uColA*0.10*(0.7+0.5*uLevel)*(1.2-0.8*length(uv-0.5));
    vec3 mist = mix(uColA, uColB, 0.45) + vec3(0.05);
    col += mist*pow(clamp(m,0.0,1.0),1.15)*0.6;
    float px = 2.0/uRes.y;
    for (int i=0;i<${MAXB};i++){
      if (i>=uNum) break;
      vec4 b = uBalls[i];
      if (b.z < 1e-4) continue;
      vec2 bp = vec2(b.x*as, b.y);
      vec2 rel = p-bp;
      if (uMode == 2) rel.x *= 1.10;          // balloons: slightly taller
      float d = length(rel);
      float body = smoothstep(b.z, b.z-3.0*px, d);
      vec3 bc = uCols[i];
      if (body>0.001){
        vec2 n = rel/max(b.z,1e-4);
        vec3 bcol;
        if (uMode == 1) {
          // soap bubble: bright iridescent rim, glassy inside
          float inner = smoothstep(0.86, 0.62, d/max(b.z,1e-4));
          float rim = 1.0-inner*0.88;
          vec3 irid = mix(bc, uColB, 0.5+0.5*sin(atan(n.y,n.x)*3.0+uT*1.3));
          float hl = pow(max(0.0, 1.0-length(n-vec2(-0.40,0.44))*0.9), 5.0);
          bcol = irid*(0.18+1.05*rim) + vec3(1.0)*hl*0.9;
        } else {
          float hl = pow(max(0.0, 1.0-length(n-vec2(-0.42,0.46))*0.85), 4.0);
          float shade = 0.50+0.50*max(0.0, 1.0-0.65*length(n+vec2(0.30,-0.30)));
          bcol = bc*shade + vec3(1.0)*hl*(uMode==2 ? 0.45 : 0.75);
        }
        bcol *= 1.0 + b.w*0.9 + uBeat*0.15;
        col = mix(col, bcol, body);
      }
      float halo = exp(-pow(max(0.0,d-b.z)*(26.0-10.0*b.w),2.0));
      col += bc*halo*(0.10+0.55*b.w+0.12*uBeat);
    }
  }
  else if (uMode == 3) {
    // Electric silhouette: neon edges around the (ghosted) motion shape.
    float s = aux(uv);
    vec2 gpx = vec2(1.2/${GW}.0, 1.2/${GH}.0);
    float gx = aux(uv+vec2(gpx.x,0.))-aux(uv-vec2(gpx.x,0.));
    float gy = aux(uv+vec2(0.,gpx.y))-aux(uv-vec2(0.,gpx.y));
    float edge = clamp(length(vec2(gx,gy))*2.8, 0.0, 1.0);
    float flick = 0.8+0.45*sin(uT*46.0+uv.y*90.0)+0.25*sin(uT*13.7);
    col = uColA*0.07*(1.0-0.6*length(uv-0.5));
    col += uColB*pow(edge,1.15)*flick*(1.0+0.9*uBeat);
    col += mix(uColA,uColB,0.35)*s*0.22;
    float bolt = step(0.965, noise2(vec2(uv.y*14.0, floor(uT*9.0)))) * edge;
    col += vec3(1.0)*bolt*0.8;
  }
  else if (uMode == 4) {
    // Firewall: a wall of flames; motion carves a glowing hole through it.
    float hole = clamp(aux(uv)*2.6, 0.0, 1.0);
    float n = fbm2(vec2(uv.x*5.0+0.3*sin(uv.y*3.0+uT*0.7), uv.y*2.6 - uT*(1.1+0.8*uBass)));
    float flame = n*(1.30 - uv.y*0.95)*(0.72+0.55*uBass+0.25*uBeat);
    float f2 = flame*(1.0-hole);
    vec3 fc = mix(uColA, uColB, clamp(f2*1.7,0.0,1.0));
    col = fc*pow(clamp(f2*1.55,0.0,1.0),1.05)*1.5;
    float rim = clamp(hole*(1.0-hole)*4.0,0.0,1.0)*flame;
    col += uColB*rim*1.2 + vec3(1.0)*rim*0.35;
  }
  else if (uMode == 5) {
    // Tile wall: dark tiles shrink away where you move, revealing plasma.
    float pl = fbm2(uv*3.0 + vec2(uT*0.25, -uT*0.18)) + 0.30*sin(uv.x*6.0+uT*0.8) + 0.30*uBass;
    vec3 back = mix(uColA, uColB, clamp(pl,0.0,1.0))*(1.05+0.45*uBeat);
    vec2 tuv = vec2(uv.x, 1.0-uv.y) * vec2(${TX}.0, ${TY}.0);
    float open = texture(uTiles, (floor(tuv)+0.5)/vec2(${TX}.0, ${TY}.0)).r;
    vec2 l = fract(tuv);
    vec2 d = abs(l-0.5);
    float hs = 0.5*(1.0-open);              // tile half-size shrinks as it opens
    float inTile = step(max(d.x,d.y), hs);
    float bevel = smoothstep(hs, hs-0.10, max(d.x,d.y));
    vec3 face = uColA*0.30 + vec3(0.045) + mix(uColA,uColB,0.2)*0.25*(1.0-bevel) + vec3(0.05)*uBeat;
    col = mix(back, face, inTile);
  }
  else if (uMode == 6) {
    // Light painting: the accumulated trail texture is the picture.
    vec3 trail = texture(uAux, uv).rgb;    // already screen-oriented
    float m = mo(uv);
    col = uColA*0.05 + trail*(1.05+0.15*uBeat);
    col += (mix(uColA,uColB,0.5)+vec3(0.05))*m*0.30;
  }

  frag = vec4(pow(max(col,0.0), vec3(0.9)), 1.0);
}`;

// Point/line renderer for particle modes (mirror, swarm, pops, cloth).
const PTS_VERT = `#version 300 es
in vec2 aPos; in vec4 aCol; in float aSize;
out vec4 vCol;
void main(){ vCol=aCol; gl_Position=vec4(aPos*2.0-1.0,0.0,1.0); gl_PointSize=aSize; }`;
const PTS_FRAG = `#version 300 es
precision highp float; in vec4 vCol; out vec4 frag;
void main(){
  float a = smoothstep(0.5, 0.12, length(gl_PointCoord-0.5));
  frag = vec4(vCol.rgb*a*vCol.a, 1.0);
}`;
const LINE_FRAG = `#version 300 es
precision highp float; in vec4 vCol; out vec4 frag;
void main(){ frag = vec4(vCol.rgb*vCol.a, 1.0); }`;

// Paint trail accumulation (ping-pong): fade the previous frame, add the
// current motion tinted with a slowly cycling palette colour.
const TRAIL_FRAG = `#version 300 es
precision highp float; in vec2 vUv; out vec4 frag;
uniform sampler2D uPrev; uniform sampler2D uMotion;
uniform float uFade, uGain, uT;
uniform vec3 uPA, uPB;
void main(){
  vec3 prev = texture(uPrev, vUv).rgb * uFade;
  float m = texture(uMotion, vec2(vUv.x, 1.0-vUv.y)).r;
  vec3 c = mix(uPA, uPB, 0.5+0.5*sin(uT*0.6 + vUv.x*4.0 + vUv.y*3.0));
  frag = vec4(prev + c*pow(clamp(m,0.0,1.0),1.25)*uGain, 1.0);
}`;

// Rotate an RGB colour around the luminance axis (same matrix as CSS
// hue-rotate) so colours drift with the palette's hueCycle.
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
    const prog = (v, f) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, v));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('Interactive link: ' + gl.getProgramInfoLog(p));
      return p;
    };
    this.progField = prog(VERT, FIELD_FRAG);
    this.progPts = prog(PTS_VERT, PTS_FRAG);
    this.progLine = prog(PTS_VERT, LINE_FRAG);
    this.progTrail = prog(VERT, TRAIL_FRAG);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    const U = (p, n) => gl.getUniformLocation(p, n);
    const pf = this.progField;
    this.aPosField = gl.getAttribLocation(pf, 'aPos');
    this.u = { uBalls: U(pf,'uBalls[0]'), uCols: U(pf,'uCols[0]'), uNum: U(pf,'uNum'),
      uMode: U(pf,'uMode'), uColA: U(pf,'uColA'), uColB: U(pf,'uColB'),
      uMotion: U(pf,'uMotion'), uAux: U(pf,'uAux'), uTiles: U(pf,'uTiles'),
      uT: U(pf,'uT'), uBeat: U(pf,'uBeat'), uBass: U(pf,'uBass'),
      uLevel: U(pf,'uLevel'), uRes: U(pf,'uRes') };
    this.uT = { uPrev: U(this.progTrail,'uPrev'), uMotion: U(this.progTrail,'uMotion'),
      uFade: U(this.progTrail,'uFade'), uGain: U(this.progTrail,'uGain'),
      uT: U(this.progTrail,'uT'), uPA: U(this.progTrail,'uPA'), uPB: U(this.progTrail,'uPB') };
    this.attribPts = { pos: gl.getAttribLocation(this.progPts,'aPos'),
      col: gl.getAttribLocation(this.progPts,'aCol'), size: gl.getAttribLocation(this.progPts,'aSize') };
    this.attribLine = { pos: gl.getAttribLocation(this.progLine,'aPos'),
      col: gl.getAttribLocation(this.progLine,'aCol'), size: gl.getAttribLocation(this.progLine,'aSize') };

    // Single-channel uploads with row widths not divisible by 4 (the tile
    // grid is 26 wide) need byte alignment; the default is 4.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Small helper for single-channel textures.
    const r8 = (w, h, nearest) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      return t;
    };

    // Motion grid (instantaneous) + slow-decay ghost (silhouette/firewall).
    this.grid = new Float32Array(GW*GH);
    this.sil = new Float32Array(GW*GH);
    this.gradX = new Float32Array(GW*GH);
    this.gradY = new Float32Array(GW*GH);
    this.gridU8 = new Uint8Array(GW*GH);
    this.silU8 = new Uint8Array(GW*GH);
    this.motTex = r8(GW, GH);
    this.silTex = r8(GW, GH);
    this.tilesU8 = new Uint8Array(TX*TY);
    this.tilesTex = r8(TX, TY, true);
    this.motTotal = 0; this.motCx = 0.5; this.motCy = 0.5;
    this.flowX = 0; this.flowY = 0;

    // Dynamic vertex buffer for points/lines: x,y,r,g,b,a,size (7 floats).
    this.dyn = new Float32Array(MAXV*7);
    this.dynVbo = gl.createBuffer();

    // Camera downscale canvas for frame differencing.
    this.vcv = document.createElement('canvas');
    this.vcv.width = GW; this.vcv.height = GH;
    this.vctx = this.vcv.getContext('2d', { willReadFrequently: true });
    this.prevGray = null;
    this.video = null;
    this.camState = 'off'; // off | starting | on | error
    this.camErr = '';
    // Body tracking (MediaPipe, optional): precise head/hands/feet points on
    // top of the coarse motion grid. Never required: everything falls back to
    // plain motion when the tracker is unavailable.
    this.pose = null;
    this.poseState = 'off';
    this.body = null;        // { head, handL, handR, footL, footR } smoothed
    this.lms = null;         // mapped skeleton landmarks (silhouette overlay)
    this._camMap = null;
    this._lastDetect = 0;
    this._bodyMiss = 0;

    this.ballData = new Float32Array(MAXB*4);
    this.colData = new Float32Array(MAXB*3);
    this.lastT = 0;
    this.prevBeat = 0;
    this.beatEdge = false;
    this.pointer = { x: 0, y: 0, t: -1e9 };
    this._bound = null;
    this.customSource = null;
    this._mode = '';
    this._resetMode();
  }

  _resetMode() {
    this.mpose = null;
    this.balls = null;
    this.parts = [];       // transient particles (bubble pops)
    this.mirror = null;
    this.cloth = null;
    this.boids = null;
    this.tiles = null;
    this._trailNeedsClear = true;
    this.grid.fill(0);
    this.sil.fill(0);
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
      this._startPose();
    } catch (e) {
      this.camState = 'error';
      this.camErr = e && e.message ? e.message : String(e);
    }
  }

  _startPose() {
    if (this.poseState !== 'off' || !window.PoseTracker) return;
    this.poseState = 'starting';
    window.PoseTracker.create()
      .then(t => { this.pose = t; this.poseState = 'on'; })
      .catch(err => {
        this.poseState = 'error';
        console.warn('PoseTracker non disponibile (fallback movimento):', err);
      });
  }

  // Detect the body ~30 times/s and map the landmarks into screen space
  // (mirrored + cover-fitted exactly like the motion grid).
  _updateBody(nowMs) {
    const v = this.video;
    if (!this.pose || !v || v.readyState < 2 || !this._camMap) return;
    if (nowMs - this._lastDetect < 33) return;
    this._lastDetect = nowMs;
    let raw = null;
    try { raw = this.pose.detect(v, nowMs); } catch (e) { return; }
    if (!raw) {
      if (++this._bodyMiss > 15) { this.body = null; this.lms = null; this.lmsRaw = null; this._lmsS = null; }
      return;
    }
    this._bodyMiss = 0;
    const m = this._camMap;
    const map = (l) => ({ x: (1 - l.x)*m.sx + m.ox, y: l.y*m.sy + m.oy,
      vis: l.visibility !== undefined ? l.visibility : 1 });
    const lms = raw.map(map);
    this.lms = lms;
    // Mirrored raw landmarks with depth, smoothed — the avatar's skeleton.
    const rawM = raw.map(l => ({ x: 1 - l.x, y: l.y, z: l.z || 0,
      vis: l.visibility !== undefined ? l.visibility : 1 }));
    if (!this._lmsS) this._lmsS = rawM;
    else this._lmsS = this._lmsS.map((p, i) => ({
      x: p.x + (rawM[i].x - p.x)*0.5, y: p.y + (rawM[i].y - p.y)*0.5,
      z: p.z + (rawM[i].z - p.z)*0.4, vis: rawM[i].vis }));
    this.lmsRaw = this._lmsS;
    const KEYS = { head: 0, handL: 16, handR: 15, footL: 28, footR: 27 }; // mirrored L/R
    if (!this.body) this.body = {};
    for (const k in KEYS) {
      const p = lms[KEYS[k]];
      const prev = this.body[k];
      const dt = Math.max(0.02, (nowMs - (prev ? prev.t : nowMs - 33)) / 1000);
      const b = this.body[k] = this.body[k] || { x: p.x, y: p.y, vx: 0, vy: 0, vis: 0, t: nowMs };
      const nx = b.x + (p.x - b.x)*0.55, ny = b.y + (p.y - b.y)*0.55; // smooth
      b.vx = b.vx*0.5 + ((nx - b.x)/dt)*0.5;
      b.vy = b.vy*0.5 + ((ny - b.y)/dt)*0.5;
      b.x = nx; b.y = ny; b.vis = p.vis; b.t = nowMs;
      // moving body parts stamp precise motion blobs, so every physical mode
      // (balls, bubbles, fluid…) reacts to hands/head/feet for free
      const sp = Math.hypot(b.vx, b.vy);
      if (b.vis > 0.5 && sp > 0.25)
        this.splatMotion(b.x, b.y, 3.0 + Math.min(3, sp*1.6), Math.min(1, 0.35 + sp*0.5));
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
    this.grayInit = false;
    this.lastT = 0;
    this._mode = '';
    this.body = null;
    this.lms = null;
    // the pose tracker stays loaded (expensive to recreate); it simply idles
    this._resetMode();
  }

  // ------------------------------------------------------------- motion
  // Inject a gaussian blob of motion (pointer fallback and tests).
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
    const grid = this.grid, sil = this.sil;
    // Decay: touches are brief pushes; the ghost fades slower for silhouettes.
    const k = Math.exp(-dt*6.0), ks = Math.exp(-dt*2.2);
    for (let i = 0; i < grid.length; i++) grid[i] *= k;

    // Camera frame differencing, mirrored so it behaves like a mirror.
    const v = this.video;
    if (v && v.readyState >= 2 && v.videoWidth) {
      const ctx = this.vctx;
      const s = Math.max(GW/v.videoWidth, GH/v.videoHeight);
      const dw = v.videoWidth*s, dh = v.videoHeight*s;
      // normalized cover-fit mapping, reused to place the pose landmarks
      this._camMap = { sx: dw/GW, ox: (GW-dw)/2/GW, sy: dh/GH, oy: (GH-dh)/2/GH };
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
            if (m > grid[i]) grid[i] = m;
          }
        }
        prev[i] = g;
      }
      this.grayInit = true;
    }

    // Pointer fallback / extra input: recent mouse or touch movement.
    if (nowMs - this.pointer.t < 90)
      this.splatMotion(this.pointer.x, this.pointer.y, 4.2, 1.0);

    // Ghost, gradient and centroid of the motion field.
    let tot = 0, cx = 0, cy = 0;
    for (let i = 0; i < grid.length; i++) {
      const m = grid[i];
      sil[i] = Math.max(sil[i]*ks, m);
      if (m > 0.08) { tot += m; cx += m*(i%GW); cy += m*((i/GW)|0); }
    }
    const pcx = this.motCx, pcy = this.motCy;
    if (tot > 0.5) {
      this.motCx = (cx/tot)/GW; this.motCy = (cy/tot)/GH; // 0..1, top-down
      const fx = (this.motCx-pcx)/Math.max(dt,1e-3), fy = (this.motCy-pcy)/Math.max(dt,1e-3);
      const fl = Math.hypot(fx, fy);
      const cap = fl > 3 ? 3/fl : 1;
      this.flowX = this.flowX*0.6 + fx*cap*0.4;
      this.flowY = this.flowY*0.6 + fy*cap*0.4;
    } else { this.flowX *= 0.8; this.flowY *= 0.8; }
    this.motTotal = tot;
    for (let y = 1; y < GH-1; y++) for (let x = 1; x < GW-1; x++) {
      const i = y*GW+x;
      this.gradX[i] = (grid[i+1]-grid[i-1])*0.5;
      this.gradY[i] = (grid[i+GW]-grid[i-GW])*0.5;
    }

    // Upload to the GPU.
    const gl = this.gl;
    for (let i = 0; i < grid.length; i++) this.gridU8[i] = (grid[i]*255) | 0;
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RED, gl.UNSIGNED_BYTE, this.gridU8);
    for (let i = 0; i < sil.length; i++) this.silU8[i] = (Math.min(1, sil[i])*255) | 0;
    gl.bindTexture(gl.TEXTURE_2D, this.silTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RED, gl.UNSIGNED_BYTE, this.silU8);
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

  // Push force from nearby motion on a disc at world (x, y-up) with reach R.
  _pushAt(x, y, R, aspect) {
    const grid = this.grid, cw = aspect/GW, ch = 1/GH;
    const gx0 = Math.max(0, Math.floor((x-R)/cw)), gx1 = Math.min(GW-1, Math.ceil((x+R)/cw));
    const gy0 = Math.max(0, Math.floor((1-y-R)/ch)), gy1 = Math.min(GH-1, Math.ceil((1-y+R)/ch));
    let fx = 0, fy = 0, tot = 0;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const m = grid[gy*GW+gx];
      if (m < 0.06) continue;
      const cx = (gx+0.5)*cw, cy = 1-(gy+0.5)*ch;
      let dx = x-cx, dy = y-cy;
      const d = Math.sqrt(dx*dx+dy*dy);
      if (d > R || d < 1e-5) continue;
      const w = m*(1-d/R);
      fx += (dx/d)*w; fy += (dy/d)*w;
      tot += w;
    }
    return { fx, fy, tot };
  }

  // Motion gradient force at a world point (push away from moving areas).
  _gradAt(x, y, aspect) {
    const gx = Math.max(1, Math.min(GW-2, Math.round(x/aspect*GW)));
    const gy = Math.max(1, Math.min(GH-2, Math.round((1-y)*GH)));
    const i = gy*GW+gx;
    // Grid y is top-down; world y is bottom-up, so flip the y component.
    return { fx: -this.gradX[i], fy: this.gradY[i], m: this.grid[i] };
  }

  // ---------------------------------------------------- balls / bubbles / balloons
  _initBalls(e, aspect, kind) {
    const sym = e.sym|0;
    const count = kind === 'balloons'
      ? Math.min(16, 8 + (sym>>1))
      : (sym > 0 ? Math.min(MAXB, 10 + sym) : 12);
    this.balls = [];
    for (let i = 0; i < count; i++) {
      const r = (kind === 'balloons' ? 0.075 : 0.055) + 0.045*((i*0.618) % 1);
      this.balls.push({
        x: 0.1*aspect + Math.random()*aspect*0.8,
        y: 0.15 + Math.random()*0.7,
        vx: (Math.random()-0.5)*0.10,
        vy: (Math.random()-0.5)*0.10,
        r, pulse: 0, popT: 0
      });
    }
  }

  _stepBalls(dt, e, audio, aspect, kind) {
    const balls = this.balls;
    const speed = Math.min(2.5, e.speed || 1);
    const dtp = dt*speed;
    const pushK = (kind === 'balloons' ? 1.5 : 1.0) * (1 + (e.warp || 0));

    for (const b of balls) {
      if (b.popT > 0) { b.popT -= dt; if (b.popT <= 0) { // bubble respawn from below
        b.x = 0.1*aspect + Math.random()*aspect*0.8; b.y = -b.r;
        b.vx = 0; b.vy = 0.10; b.pulse = 0;
      } else continue; }

      const f = this._pushAt(b.x, b.y, b.r*2.1, aspect);
      if (f.tot > 0.02) {
        const fl = Math.sqrt(f.fx*f.fx+f.fy*f.fy) || 1;
        const acc = Math.min(9.0, f.tot*4.0)*pushK;
        b.vx += (f.fx/fl)*acc*dtp;
        b.vy += (f.fy/fl)*acc*dtp;
        b.pulse = Math.min(1, b.pulse + f.tot*0.5);
        if (kind === 'bubbles' && f.tot > 0.35) { this._pop(b, e, audio); continue; }
        if (kind === 'balloons') b.vy += Math.min(3.0, f.tot*1.6)*dtp; // flick upward
      }

      if (kind === 'bubbles') {        // gentle rise + wobble
        b.vy += (0.10 + 0.06*Math.sin(this.lastT*1.7 + b.x*9)) * dtp;
        b.vx += Math.sin(this.lastT*1.2 + b.y*7) * 0.035 * dtp;
      } else if (kind === 'balloons') { // gravity: keep them in the air!
        b.vy -= 0.32*dtp;
      } else {
        b.vx += (Math.random()-0.5)*0.05*dtp;
        b.vy += (Math.random()-0.5)*0.05*dtp;
      }

      const damp = Math.exp(-dt*(kind === 'balloons' ? 0.25 : 0.55));
      b.vx *= damp; b.vy *= damp;
      const sp = Math.sqrt(b.vx*b.vx+b.vy*b.vy);
      if (sp > 1.5) { b.vx *= 1.5/sp; b.vy *= 1.5/sp; }

      b.x += b.vx*dtp; b.y += b.vy*dtp;

      if (b.x < b.r)        { b.x = b.r;        b.vx = Math.abs(b.vx)*0.9; }
      if (b.x > aspect-b.r) { b.x = aspect-b.r; b.vx = -Math.abs(b.vx)*0.9; }
      if (kind === 'bubbles') {
        if (b.y > 1+b.r*2) { b.y = -b.r; b.x = 0.1*aspect + Math.random()*aspect*0.8; b.vy = 0.1; }
      } else {
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy)*(kind === 'balloons' ? 0.55 : 0.9); }
        if (b.y > 1-b.r) { b.y = 1-b.r; b.vy = -Math.abs(b.vy)*0.9; }
      }
      b.pulse *= Math.exp(-dt*3.0);
    }

    // Ball-ball collisions (small N).
    for (let i = 0; i < balls.length; i++) for (let j = i+1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      if (a.popT > 0 || c.popT > 0) continue;
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

    if (this.beatEdge) {
      for (const b of balls) {
        if (b.popT > 0) continue;
        b.vx += (Math.random()-0.5)*0.10;
        b.vy += (Math.random()-0.5)*0.10 + (kind === 'balloons' ? 0.04 : 0);
        b.pulse = Math.min(1, b.pulse + 0.30);
      }
    }
  }

  _pop(b, e, audio) {
    b.popT = 0.9 + Math.random()*0.9;
    const n = 26;
    for (let i = 0; i < n && this.parts.length < 600; i++) {
      const a = Math.random()*Math.PI*2, sp = 0.25 + Math.random()*0.55;
      this.parts.push({ x: b.x + Math.cos(a)*b.r*0.8, y: b.y + Math.sin(a)*b.r*0.8,
        vx: Math.cos(a)*sp + b.vx*0.4, vy: Math.sin(a)*sp + b.vy*0.4,
        life: 0.9, max: 0.9, grav: 0.5 });
    }
  }

  _stepParts(dt) {
    const out = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav*dt;
      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx*dt; p.y += p.vy*dt;
      out.push(p);
    }
    this.parts = out;
  }

  // ---------------------------------------------------------------- mirror
  _initMirror(e, aspect) {
    // Build particle home positions from a mask: the custom SVG/image if one
    // was loaded (SVG/Immagine controls), otherwise a big "DJ LUZA" wordmark.
    const MW = 480, MH = 270;
    const cv = document.createElement('canvas');
    cv.width = MW; cv.height = MH;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MW, MH);
    const src = this.customSource;
    if (src && (src.width || src.naturalWidth)) {
      const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
      const s = Math.min(MW*0.9/iw, MH*0.9/ih);
      ctx.drawImage(src, (MW-iw*s)/2, (MH-ih*s)/2, iw*s, ih*s);
    } else {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let size = 150;
      ctx.font = `900 ${size}px Arial`;
      const w = ctx.measureText('DJ LUZA').width;
      size = Math.floor(size * Math.min(1, MW*0.92/w));
      ctx.font = `900 ${size}px Arial`;
      ctx.fillText('DJ LUZA', MW/2, MH/2);
    }
    const img = ctx.getImageData(0, 0, MW, MH).data;
    const homes = [];
    for (let y = 0; y < MH; y += 2) for (let x = 0; x < MW; x += 2) {
      const j = (y*MW+x)*4;
      if (img[j]+img[j+1]+img[j+2] > 220) homes.push([x/MW, y/MH]);
    }
    const target = Math.min(3000, 2000 + (e.sym|0)*60, homes.length || 1);
    const pts = [];
    for (let i = 0; i < target && homes.length; i++) {
      const h = homes[(Math.random()*homes.length) | 0];
      pts.push({ hx: h[0]*aspect, hy: 1-h[1],
        x: Math.random()*aspect, y: Math.random(),
        vx: 0, vy: 0, ph: h[0] });
    }
    this.mirror = { pts, srcRef: src };
  }

  _stepMirror(dt, e, aspect) {
    const speed = Math.min(2.5, e.speed || 1);
    const dtp = dt*speed;
    const damp = Math.exp(-dt*4.0);
    for (const p of this.mirror.pts) {
      const g = this._gradAt(p.x, p.y, aspect);
      if (g.m > 0.08) {
        const gl2 = Math.hypot(g.fx, g.fy) || 1;
        const k = Math.min(5.0, g.m*7.0);
        p.vx += (g.fx/gl2)*k*dtp + (Math.random()-0.5)*g.m*0.4*dtp;
        p.vy += (g.fy/gl2)*k*dtp + (Math.random()-0.5)*g.m*0.4*dtp;
      }
      p.vx += (p.hx-p.x)*6.0*dtp;
      p.vy += (p.hy-p.y)*6.0*dtp;
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx*dtp; p.y += p.vy*dtp;
      if (this.beatEdge) { p.vx += (Math.random()-0.5)*0.10; p.vy += (Math.random()-0.5)*0.10; }
    }
  }

  // ---------------------------------------------------------------- cloth
  _initCloth(aspect) {
    const NX = 36, NY = 22, nodes = [];
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const wx = x/(NX-1)*aspect, wy = 1 - y/(NY-1);
      nodes.push({ x: wx, y: wy, px: wx, py: wy, ox: wx, oy: wy,
        pin: x === 0 || y === 0 || x === NX-1 || y === NY-1 });
    }
    this.cloth = { NX, NY, nodes, restX: aspect/(NX-1), restY: 1/(NY-1) };
  }

  _stepCloth(dt, e, audio, aspect) {
    const c = this.cloth, speed = Math.min(2.5, e.speed || 1);
    const dtp = Math.min(0.03, dt)*speed;
    for (const n of c.nodes) {
      if (n.pin) continue;
      const g = this._gradAt(n.x, n.y, aspect);
      let ax = 0, ay = Math.sin(n.x*9 + this.lastT*3)* (audio.bass || 0)*0.35;
      if (g.m > 0.08) {
        const gl2 = Math.hypot(g.fx, g.fy) || 1;
        ax += (g.fx/gl2)*g.m*15.0; ay += (g.fy/gl2)*g.m*15.0;
      }
      const nx = n.x + (n.x-n.px)*0.975 + ax*dtp*dtp*60;
      const ny = n.y + (n.y-n.py)*0.975 + ay*dtp*dtp*60;
      n.px = n.x; n.py = n.y; n.x = nx; n.y = ny;
    }
    // Spring constraints (structural), 2 relaxation iterations.
    for (let it = 0; it < 2; it++) {
      for (let y = 0; y < c.NY; y++) for (let x = 0; x < c.NX; x++) {
        const i = y*c.NX+x, n = c.nodes[i];
        const rel = (j, rest) => {
          const o = c.nodes[j];
          let dx = o.x-n.x, dy = o.y-n.y;
          const d = Math.sqrt(dx*dx+dy*dy) || 1e-6;
          const diff = (d-rest)/d*0.5;
          if (!n.pin) { n.x += dx*diff; n.y += dy*diff; }
          if (!o.pin) { o.x -= dx*diff; o.y -= dy*diff; }
        };
        if (x < c.NX-1) rel(i+1, c.restX);
        if (y < c.NY-1) rel(i+c.NX, c.restY);
      }
    }
  }

  // ---------------------------------------------------------------- swarm
  _initBoids(e, aspect) {
    const n = Math.min(400, 220 + (e.sym|0)*12);
    this.boids = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2;
      this.boids.push({ x: Math.random()*aspect, y: Math.random(),
        vx: Math.cos(a)*0.2, vy: Math.sin(a)*0.2 });
    }
  }

  _stepBoids(dt, e, aspect) {
    const bs = this.boids, speed = Math.min(2.5, e.speed || 1);
    const dtp = dt*speed;
    // Target: the tracked head when available, else the motion centroid,
    // else a slow wander.
    let tx, ty, tw;
    const head = this.body && this.body.head;
    if (head && head.vis > 0.5) {
      tx = head.x*aspect; ty = 1-head.y; tw = 2.8;
    } else if (this.motTotal > 2) {
      tx = this.motCx*aspect; ty = 1-this.motCy; tw = 2.4;
    } else {
      tx = aspect*(0.5 + 0.3*Math.sin(this.lastT*0.23));
      ty = 0.5 + 0.3*Math.sin(this.lastT*0.31+1.7); tw = 0.35;
    }
    const SEP = 0.035, ALI = 0.08, COH = 0.10;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      let sx = 0, sy = 0, axv = 0, ayv = 0, cx = 0, cy = 0, na = 0, nc = 0;
      for (let j = 0; j < bs.length; j++) {
        if (j === i) continue;
        const o = bs[j];
        const dx = o.x-b.x, dy = o.y-b.y;
        const d2 = dx*dx+dy*dy;
        if (d2 > COH*COH) continue;
        const d = Math.sqrt(d2) || 1e-5;
        if (d < SEP) { sx -= dx/d*(1-d/SEP); sy -= dy/d*(1-d/SEP); }
        if (d < ALI) { axv += o.vx; ayv += o.vy; na++; }
        cx += o.x; cy += o.y; nc++;
      }
      let fx = sx*1.6, fy = sy*1.6;
      if (na) { fx += (axv/na - b.vx)*0.7; fy += (ayv/na - b.vy)*0.7; }
      if (nc) { fx += (cx/nc - b.x)*0.5; fy += (cy/nc - b.y)*0.5; }
      fx += (tx-b.x)*tw; fy += (ty-b.y)*tw;
      b.vx += fx*dtp; b.vy += fy*dtp;
      if (this.beatEdge) { // a light scatter on the beat (attraction must win)
        const dx = b.x-aspect/2, dy = b.y-0.5, d = Math.hypot(dx,dy) || 1;
        b.vx += dx/d*0.08; b.vy += dy/d*0.08;
      }
      const sp = Math.hypot(b.vx, b.vy) || 1e-5;
      const max = 0.55*speed, min = 0.12;
      if (sp > max) { b.vx *= max/sp; b.vy *= max/sp; }
      if (sp < min) { b.vx *= min/sp; b.vy *= min/sp; }
      b.x += b.vx*dtp; b.y += b.vy*dtp;
      if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); }
      if (b.x > aspect) { b.x = aspect; b.vx = -Math.abs(b.vx); }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
      if (b.y > 1) { b.y = 1; b.vy = -Math.abs(b.vy); }
    }
  }

  // ---------------------------------------------------------------- tiles
  _stepTiles(dt) {
    if (!this.tiles) this.tiles = new Float32Array(TX*TY);
    const tiles = this.tiles, grid = this.grid;
    const cw = GW/TX, ch = GH/TY;
    const dec = Math.exp(-dt*0.45);
    for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
      let m = 0;
      const gx0 = Math.floor(tx*cw), gx1 = Math.min(GW-1, Math.floor((tx+1)*cw));
      const gy0 = Math.floor(ty*ch), gy1 = Math.min(GH-1, Math.floor((ty+1)*ch));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const v = grid[gy*GW+gx];
        if (v > m) m = v;
      }
      const i = ty*TX+tx;
      let o = tiles[i]*dec;
      if (m > 0.14) o = Math.min(1, o + m*dt*7);
      tiles[i] = o;
    }
    const gl = this.gl;
    for (let i = 0; i < tiles.length; i++) this.tilesU8[i] = (tiles[i]*255) | 0;
    gl.bindTexture(gl.TEXTURE_2D, this.tilesTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TX, TY, gl.RED, gl.UNSIGNED_BYTE, this.tilesU8);
  }

  // ---------------------------------------------------------------- paint
  _allocTrail(w, h) {
    const gl = this.gl;
    const mk = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { tex: t, fbo: f };
    };
    this.trail = { a: mk(), b: mk(), w, h };
    this._trailNeedsClear = true;
  }

  _stepPaint(dt, e, hueA) {
    const gl = this.gl;
    if (!this.trail) this._allocTrail(1024, 576);
    const tr = this.trail;
    if (this._trailNeedsClear) {
      this._trailNeedsClear = false;
      for (const s of [tr.a, tr.b]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    // Bright palette colours for the brush (near-black colorA would paint
    // nothing): hue-rotate then normalise to full brightness.
    const norm = (c) => {
      const col = hueRotate(c, hueA);
      const mx = Math.max(col[0], col[1], col[2], 1e-4);
      return [Math.max(0, col[0]/mx), Math.max(0, col[1]/mx), Math.max(0, col[2]/mx)];
    };
    const pa = norm(e.colorB || [0.2, 1, 1]);
    const pb = norm([(e.colorB||[1,1,1])[0]*0.4+(e.colorA||[0,0,0])[0]+0.15,
                     (e.colorB||[1,1,1])[1]*0.4+(e.colorA||[0,0,0])[1]+0.15,
                     (e.colorB||[1,1,1])[2]*0.4+(e.colorA||[0,0,0])[2]+0.15]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tr.b.fbo);
    gl.viewport(0, 0, tr.w, tr.h);
    gl.useProgram(this.progTrail);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const ap = gl.getAttribLocation(this.progTrail, 'aPos');
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tr.a.tex);
    gl.uniform1i(this.uT.uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.uniform1i(this.uT.uMotion, 1);
    gl.uniform1f(this.uT.uFade, Math.exp(-dt*0.35));
    gl.uniform1f(this.uT.uGain, Math.min(0.2, dt*3.2));
    gl.uniform1f(this.uT.uT, this.lastT);
    gl.uniform3fv(this.uT.uPA, pa);
    gl.uniform3fv(this.uT.uPB, pb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = tr.a; tr.a = tr.b; tr.b = t;
  }

  // ---------------------------------------------------------------- fluid
  _stepFluid(timeSec, audio, e, canvas) {
    if (!window.FluidSim) return;
    if (!this.fluidSim) this.fluidSim = new window.FluidSim(this.gl);
    // Turn the strongest motion spots into dye+velocity splats. Direction:
    // the tracked flow of the motion centroid (how the person is moving).
    const grid = this.grid, splats = [];
    let fdx = this.flowX, fdy = -this.flowY;   // to y-up uv
    const fl = Math.hypot(fdx, fdy);
    for (let gy = 2; gy < GH-2 && splats.length < 8; gy += 4) {
      for (let gx = 2; gx < GW-2 && splats.length < 8; gx += 4) {
        const m = grid[gy*GW+gx];
        if (m < 0.16) continue;
        const x = (gx+0.5)/GW, y = 1-(gy+0.5)/GH;
        let ok = true;
        for (const s of splats) if (Math.hypot(s.x-x, s.y-y) < 0.13) { ok = false; break; }
        if (!ok) continue;
        let dx, dy;
        if (fl > 0.05) { dx = fdx/fl; dy = fdy/fl; }
        else { // fall back on the local gradient (push away from the body)
          const i = gy*GW+gx, gm = Math.hypot(this.gradX[i], this.gradY[i]) || 1;
          dx = -this.gradX[i]/gm; dy = this.gradY[i]/gm;
        }
        splats.push({ x, y, dx, dy, k: m, ph: x });
      }
    }
    this.fluidSim.extSplats = splats;
    this.fluidSim.render(timeSec, audio, Object.assign({}, e, { fluidMode: 'touch' }), canvas);
  }

  // ---------------------------------------------------------------- drawing
  _drawField(mode, e, audio, canvas, n, auxTex) {
    const gl = this.gl, u = this.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progField);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aPosField);
    gl.vertexAttribPointer(this.aPosField, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(u.uBalls, this.ballData);
    gl.uniform3fv(u.uCols, this.colData);
    gl.uniform1i(u.uNum, n);
    gl.uniform1i(u.uMode, mode);
    gl.uniform3fv(u.uColA, e.colorA || [0.05, 0, 0.2]);
    gl.uniform3fv(u.uColB, e.colorB || [0.2, 1, 1]);
    gl.uniform1f(u.uT, this.lastT);
    gl.uniform1f(u.uBeat, audio.beat || 0);
    gl.uniform1f(u.uBass, audio.bass || 0);
    gl.uniform1f(u.uLevel, audio.level || 0);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.motTex);
    gl.uniform1i(u.uMotion, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, auxTex || this.silTex);
    gl.uniform1i(u.uAux, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tilesTex);
    gl.uniform1i(u.uTiles, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _drawDyn(count, asLines) {
    if (!count) return;
    const gl = this.gl;
    const prog = asLines ? this.progLine : this.progPts;
    const at = asLines ? this.attribLine : this.attribPts;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.dyn.subarray(0, count*7), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(at.pos);
    gl.vertexAttribPointer(at.pos, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(at.col);
    gl.vertexAttribPointer(at.col, 4, gl.FLOAT, false, 28, 8);
    if (at.size >= 0) {
      gl.enableVertexAttribArray(at.size);
      gl.vertexAttribPointer(at.size, 1, gl.FLOAT, false, 28, 24);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(asLines ? gl.LINES : gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(at.col);
    if (at.size >= 0) gl.disableVertexAttribArray(at.size);
  }

  // Append one vertex to the dynamic buffer; returns the new count.
  _v(i, x, y, r, g, b, a, size, aspect) {
    const o = i*7, d = this.dyn;
    d[o] = x/aspect; d[o+1] = y;
    d[o+2] = r; d[o+3] = g; d[o+4] = b; d[o+5] = a; d[o+6] = size;
    return i+1;
  }

  // ---------------------------------------------------------------- render
  render(timeSec, audio, e, canvas) {
    const gl = this.gl;
    this._bindPointer(canvas);
    this._startCam(); // async, guarded; no-op once on/erroring

    const mode = e.interactiveMode || 'balls';
    if (this._mode !== mode) { this._mode = mode; this._resetMode(); }

    const aspect = canvas.width/Math.max(1, canvas.height);
    const dt = this.lastT ? Math.min(0.045, Math.max(0.001, timeSec-this.lastT)) : 0.016;
    this.lastT = timeSec;
    const nowMs = performance.now();

    this._updateMotion(dt, nowMs);
    this._updateBody(nowMs);
    this.beatEdge = (audio.beat || 0) > 0.6 && this.prevBeat <= 0.6;
    this.prevBeat = audio.beat || 0;

    if (mode === 'fluid') { this._stepFluid(timeSec, audio, e, canvas); return; }

    // ---- Robot avatar: a robot built from 3D parts whose limbs follow your
    // tracked skeleton 1:1 — raise your arm and the robot raises its arm.
    if (mode === 'avatar') {
      const L = this.lmsRaw;
      const ok = this.modelSim && L && L[11] && L[11].vis > 0.5 && L[12].vis > 0.5
        && L[23].vis > 0.4 && L[24].vis > 0.4;
      if (!ok) { this._drawField(7, e, audio, canvas, 0); return; }
      const S = 2.6;
      const W = (i) => [(L[i].x - 0.5)*S, (0.5 - L[i].y)*S, -(L[i].z || 0)*1.2];
      const mid = (p, q) => [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
      const sh1 = W(11), sh2 = W(12), hp1 = W(23), hp2 = W(24);
      const neck = mid(sh1, sh2), pelvis = mid(hp1, hp2);
      const shw = Math.max(0.15, Math.hypot(sh1[0]-sh2[0], sh1[1]-sh2[1], sh1[2]-sh2[2]));
      const t = shw;
      const metal = [0.60, 0.64, 0.72], dark = [0.28, 0.30, 0.36];
      const acc = e.colorB || [0.2, 1, 1];
      const parts = [];
      const limb = (a, b, r, col) => parts.push({ a, b, rx: r, rz: r, kind: 'cube', col });
      const ball = (a, r, col) => parts.push({ a, b: null, rx: r, kind: 'sphere', col });
      // torso + chest light
      parts.push({ a: neck, b: pelvis, rx: shw*0.52, rz: shw*0.28, kind: 'cube', col: metal });
      ball(mid(neck, mid(neck, pelvis)), t*0.10, acc);
      // head with visor + antenna
      const nose = L[0].vis > 0.4 ? W(0) : [neck[0], neck[1]+t*0.55, neck[2]];
      const headC = [nose[0], nose[1] + t*0.05, nose[2]];
      parts.push({ a: headC, b: null, rx: t*0.34, ry: t*0.38, rz: t*0.30, kind: 'cube', col: metal });
      parts.push({ a: [headC[0], headC[1]+t*0.02, headC[2]+t*0.30], b: null,
        rx: t*0.24, ry: t*0.08, rz: t*0.06, kind: 'cube', col: acc });
      ball([headC[0], headC[1]+t*0.52, headC[2]], t*0.07, acc);
      // arms (shoulder->elbow->wrist), glowing hands
      const arm = (s, elI, wrI) => {
        if (L[elI].vis < 0.4 || L[wrI].vis < 0.4) return;
        const el = W(elI), wr = W(wrI);
        limb(s, el, t*0.14, metal);
        limb(el, wr, t*0.12, metal);
        ball(el, t*0.15, dark);
        ball(wr, t*0.17, acc);
      };
      arm(sh1, 13, 15); arm(sh2, 14, 16);
      ball(sh1, t*0.16, dark); ball(sh2, t*0.16, dark);
      // legs with feet
      const leg = (h, knI, anI) => {
        if (L[knI].vis < 0.4 || L[anI].vis < 0.4) return;
        const kn = W(knI), an = W(anI);
        limb(h, kn, t*0.16, metal);
        limb(kn, an, t*0.13, metal);
        ball(kn, t*0.16, dark);
        parts.push({ a: [an[0], an[1]-t*0.06, an[2]+t*0.12], b: null,
          rx: t*0.14, ry: t*0.08, rz: t*0.22, kind: 'cube', col: dark });
      };
      leg(hp1, 25, 27); leg(hp2, 26, 28);
      this.modelSim.renderAvatar(timeSec, audio, e, canvas, parts);
      return;
    }

    // ---- 3D model puppet: swipe to spin (with inertia), the model leans
    // toward where you move, big motion makes it hop with squash & stretch.
    if (mode === 'model') {
      if (!this.modelSim) { this._drawField(7, e, audio, canvas, 0); return; }
      if (!this.mpose) this.mpose = { yaw: 0, yawVel: 0, hopY: 0, hopVel: 0,
        leanX: 0, squash: 1, rim: 0, hopCool: 0 };
      const p = this.mpose;
      const bd = this.body;
      const handL = bd && bd.handL && bd.handL.vis > 0.5 ? bd.handL : null;
      const handR = bd && bd.handR && bd.handR.vis > 0.5 ? bd.handR : null;
      const head = bd && bd.head && bd.head.vis > 0.5 ? bd.head : null;
      // spin: tracked hand swipes when available, else the coarse motion flow
      if (handL || handR) {
        const hvx = (handL ? handL.vx : 0) + (handR ? handR.vx : 0);
        p.yawVel += hvx * dt * 9;
      } else {
        p.yawVel += this.flowX * dt * 14;
      }
      p.yawVel *= Math.exp(-dt*1.1);
      p.yaw += p.yawVel * dt * (e.speed || 1);
      // lean toward your head (or the motion centroid without tracking)
      const leanTarget = head ? (head.x - 0.5) * 0.7
        : (this.motTotal > 2 ? (this.motCx - 0.5) * 0.55 : 0);
      p.leanX += (leanTarget - p.leanX) * (1 - Math.exp(-dt*3.5));
      // jump: raise a hand fast (tracked) or strong overall agitation
      p.hopCool -= dt;
      const handUp = (handL && handL.vy < -1.3) || (handR && handR.vy < -1.3);
      if ((handUp || this.motTotal > 16) && p.hopY <= 0.001 && p.hopCool <= 0) {
        p.hopVel = 1.5; p.hopCool = 0.9;
      }
      p.hopVel -= 5.5 * dt;
      p.hopY = Math.max(0, p.hopY + p.hopVel * dt);
      if (p.hopY === 0 && p.hopVel < 0) p.hopVel = 0;
      // stretch going up, squash on the ground after landing
      const sqTarget = p.hopY > 0.001 ? 1 + Math.max(-0.2, Math.min(0.18, p.hopVel*0.12)) : 1;
      p.squash += (sqTarget - p.squash) * (1 - Math.exp(-dt*10));
      // touch glow from overall motion
      p.rim += (Math.min(1, this.motTotal/22) - p.rim) * (1 - Math.exp(-dt*5));
      this.modelSim.render(timeSec, audio, e, canvas, p);
      return;
    }

    const hueA = (e.hueBase || 0)*6.2832 + timeSec*(e.hueCycle || 0)*6.2832;
    const ca = e.colorA || [0.05, 0, 0.2], cb = e.colorB || [0.2, 1, 1];
    const palCol = (f, off) => {
      const base = [ca[0]+(cb[0]-ca[0])*f, ca[1]+(cb[1]-ca[1])*f, ca[2]+(cb[2]-ca[2])*f];
      const col = hueRotate(base, hueA + (off || 0));
      return [Math.max(0, col[0]), Math.max(0, col[1]), Math.max(0, col[2])];
    };
    const pxScale = canvas.height/540;   // point sizes tuned at 540p

    // ---- ball-style modes -------------------------------------------------
    if (mode === 'balls' || mode === 'bubbles' || mode === 'balloons') {
      if (!this.balls || this._sym !== (e.sym|0)) { this._sym = e.sym|0; this._initBalls(e, aspect, mode); }
      this._stepBalls(dt, e, audio, aspect, mode);
      if (mode === 'bubbles') this._stepParts(dt);
      const bd = this.ballData, cd = this.colData, n = this.balls.length;
      for (let i = 0; i < n; i++) {
        const b = this.balls[i];
        bd[i*4] = b.x/aspect; bd[i*4+1] = b.y;
        bd[i*4+2] = b.popT > 0 ? 0 : b.r*(1 + 0.14*(audio.bass || 0) + 0.20*b.pulse);
        bd[i*4+3] = b.pulse;
        const f = 0.30 + 0.70*((i*0.618) % 1);
        const col = palCol(f, (i%5)*0.16 - 0.32);
        cd[i*3] = col[0]; cd[i*3+1] = col[1]; cd[i*3+2] = col[2];
      }
      const uMode = mode === 'bubbles' ? 1 : (mode === 'balloons' ? 2 : 0);
      this._drawField(uMode, e, audio, canvas, n);
      if (mode === 'bubbles' && this.parts.length) {
        let vc = 0;
        for (const p of this.parts) {
          const a = p.life/p.max;
          const col = palCol(0.75, 0);
          vc = this._v(vc, p.x, p.y, col[0], col[1], col[2], a*0.9, (2+3*a)*pxScale, aspect);
        }
        this._drawDyn(vc, false);
      }
      return;
    }

    // ---- particle mirror --------------------------------------------------
    if (mode === 'mirror') {
      if (!this.mirror || this.mirror.srcRef !== this.customSource) this._initMirror(e, aspect);
      this._stepMirror(dt, e, aspect);
      this._drawField(7, e, audio, canvas, 0);
      let vc = 0;
      for (const p of this.mirror.pts) {
        if (vc >= MAXV) break;
        const col = palCol(0.25 + 0.7*p.ph, 0);
        const away = Math.min(1, Math.hypot(p.x-p.hx, p.y-p.hy)*6);
        vc = this._v(vc, p.x, p.y,
          col[0]*(1+away*0.6), col[1]*(1+away*0.6), col[2]*(1+away*0.6),
          0.75, (2.4 + 1.4*away + (audio.beat || 0))*pxScale, aspect);
      }
      this._drawDyn(vc, false);
      return;
    }

    // ---- elastic cloth ----------------------------------------------------
    if (mode === 'cloth') {
      if (!this.cloth) this._initCloth(aspect);
      this._stepCloth(dt, e, audio, aspect);
      this._drawField(7, e, audio, canvas, 0);
      const c = this.cloth;
      let vc = 0;
      const segCol = (n1, n2) => {
        const disp = (Math.hypot(n1.x-n1.ox, n1.y-n1.oy) + Math.hypot(n2.x-n2.ox, n2.y-n2.oy))*4;
        const k = Math.min(1, disp);
        const col = palCol(0.45 + 0.55*k, 0);
        return [col, 0.38 + 0.62*k];
      };
      for (let y = 0; y < c.NY && vc < MAXV-4; y++) for (let x = 0; x < c.NX && vc < MAXV-4; x++) {
        const i = y*c.NX+x, n1 = c.nodes[i];
        if (x < c.NX-1) {
          const n2 = c.nodes[i+1], [col, al] = segCol(n1, n2);
          vc = this._v(vc, n1.x, n1.y, col[0], col[1], col[2], al, 1, aspect);
          vc = this._v(vc, n2.x, n2.y, col[0], col[1], col[2], al, 1, aspect);
        }
        if (y < c.NY-1) {
          const n2 = c.nodes[i+c.NX], [col, al] = segCol(n1, n2);
          vc = this._v(vc, n1.x, n1.y, col[0], col[1], col[2], al, 1, aspect);
          vc = this._v(vc, n2.x, n2.y, col[0], col[1], col[2], al, 1, aspect);
        }
      }
      this._drawDyn(vc, true);
      vc = 0;
      for (const n of c.nodes) {
        if (vc >= MAXV) break;
        const disp = Math.min(1, Math.hypot(n.x-n.ox, n.y-n.oy)*6);
        const col = palCol(0.4 + 0.6*disp, 0);
        vc = this._v(vc, n.x, n.y, col[0], col[1], col[2], 0.5+0.5*disp, (2.4+2.5*disp)*pxScale, aspect);
      }
      this._drawDyn(vc, false);
      return;
    }

    // ---- swarm ------------------------------------------------------------
    if (mode === 'swarm') {
      if (!this.boids || this._sym !== (e.sym|0)) { this._sym = e.sym|0; this._initBoids(e, aspect); }
      this._stepBoids(dt, e, aspect);
      this._drawField(7, e, audio, canvas, 0);
      let vc = 0;
      for (const b of this.boids) {
        if (vc >= MAXV-3) break;
        const ang = Math.atan2(b.vy, b.vx);
        const col = palCol(0.3 + 0.65*(0.5+0.5*Math.sin(ang*2)), 0);
        vc = this._v(vc, b.x, b.y, col[0], col[1], col[2], 1.0, 4.8*pxScale, aspect);
        vc = this._v(vc, b.x-b.vx*0.03, b.y-b.vy*0.03, col[0], col[1], col[2], 0.5, 3.6*pxScale, aspect);
        vc = this._v(vc, b.x-b.vx*0.06, b.y-b.vy*0.06, col[0], col[1], col[2], 0.25, 2.8*pxScale, aspect);
      }
      this._drawDyn(vc, false);
      return;
    }

    // ---- shader-only modes ------------------------------------------------
    if (mode === 'tiles') {
      this._stepTiles(dt);
      this._drawField(5, e, audio, canvas, 0);
      return;
    }
    if (mode === 'paint') {
      this._stepPaint(dt, e, hueA);
      this._drawField(6, e, audio, canvas, 0, this.trail.a.tex);
      return;
    }
    if (mode === 'silhouette') {
      this._drawField(3, e, audio, canvas, 0);
      // With body tracking: a neon skeleton over the electric silhouette.
      if (this.lms) {
        const L = this.lms;
        const W = (i) => ({ x: L[i].x*aspect, y: 1-L[i].y, v: L[i].vis });
        const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],
          [11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
        const col = palCol(0.85, 0);
        const glowA = 0.55 + 0.45*(audio.beat || 0);
        let vc = 0;
        for (const [a, b] of BONES) {
          const p1 = W(a), p2 = W(b);
          if (p1.v < 0.5 || p2.v < 0.5) continue;
          vc = this._v(vc, p1.x, p1.y, col[0], col[1], col[2], glowA, 1, aspect);
          vc = this._v(vc, p2.x, p2.y, col[0], col[1], col[2], glowA, 1, aspect);
        }
        // neck: nose -> shoulder midpoint
        const n = W(0), s1 = W(11), s2 = W(12);
        if (n.v > 0.5 && s1.v > 0.5 && s2.v > 0.5) {
          vc = this._v(vc, n.x, n.y, col[0], col[1], col[2], glowA, 1, aspect);
          vc = this._v(vc, (s1.x+s2.x)/2, (s1.y+s2.y)/2, col[0], col[1], col[2], glowA, 1, aspect);
        }
        this._drawDyn(vc, true);
        vc = 0;
        const JOINTS = [11,12,13,14,15,16,23,24,25,26,27,28];
        for (const j of JOINTS) {
          const p = W(j);
          if (p.v < 0.5) continue;
          vc = this._v(vc, p.x, p.y, col[0], col[1], col[2], 0.9, 5*pxScale, aspect);
        }
        if (n.v > 0.5) { // glowing head
          const hc = palCol(0.5, 0);
          vc = this._v(vc, n.x, n.y, hc[0], hc[1], hc[2], 1.0,
            (16 + 5*(audio.beat || 0))*pxScale, aspect);
        }
        this._drawDyn(vc, false);
      }
      return;
    }
    if (mode === 'firewall')   { this._drawField(4, e, audio, canvas, 0); return; }

    // Unknown mode: plain background.
    this._drawField(7, e, audio, canvas, 0);
  }
}

window.InteractiveSim = InteractiveSim;

})();
