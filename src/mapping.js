// Projection mapping: quads ("zone") warped with a projective homography,
// sourcing either the LIVE VISUAL (the main canvas, optionally a sub-region:
// multi-panel LED walls) or an IMAGE file (corner-pin onto physical objects).
// Runs on its own WebGL2 canvas above the visual; editing handles are drawn
// on the output itself so corners are dragged while looking at the real
// projection surface.
(function () {

const QUAD_VS = `#version 300 es
in vec2 aPos;         // zone-space position (0..1 output coords, y down)
out vec2 vZ;
void main(){
  vZ = aPos;
  gl_Position = vec4(aPos.x*2.0-1.0, 1.0-aPos.y*2.0, 0.0, 1.0);
}`;
const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vZ; out vec4 frag;
uniform mat3 uH;          // output coords -> unit square of the zone
uniform sampler2D uTex;
uniform float uOpacity;
uniform vec4 uSrc;        // source sub-rect (x,y,w,h) in texture uv
void main(){
  vec3 q = uH * vec3(vZ, 1.0);
  vec2 uv = q.xy / q.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  frag = vec4(texture(uTex, uSrc.xy + uv*uSrc.zw).rgb, uOpacity);
}`;
const H_VS = `#version 300 es
in vec2 aPos; uniform float uPt;
void main(){
  gl_Position = vec4(aPos.x*2.0-1.0, 1.0-aPos.y*2.0, 0.0, 1.0);
  gl_PointSize = uPt;
}`;
const H_FS = `#version 300 es
precision highp float; uniform vec4 uCol; out vec4 frag;
void main(){ frag = uCol; }`;

// homography mapping the unit square onto quad c (TL,TR,BR,BL), column-major
function squareToQuad(c) {
  const [p0, p1, p2, p3] = c;
  const dx1 = p1[0]-p2[0], dx2 = p3[0]-p2[0], dx3 = p0[0]-p1[0]+p2[0]-p3[0];
  const dy1 = p1[1]-p2[1], dy2 = p3[1]-p2[1], dy3 = p0[1]-p1[1]+p2[1]-p3[1];
  const den = dx1*dy2 - dy1*dx2 || 1e-9;
  const g = (dx3*dy2 - dy3*dx2)/den, h = (dx1*dy3 - dy1*dx3)/den;
  return [p1[0]-p0[0]+g*p1[0], p1[1]-p0[1]+g*p1[1], g,
          p3[0]-p0[0]+h*p3[0], p3[1]-p0[1]+h*p3[1], h,
          p0[0], p0[1], 1];
}
function inv3(m) {
  const [a,b,c,d,e,f,g,h,i] = [m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]];
  const A = e*i-f*h, B = c*h-b*i, C = b*f-c*e;
  const det = a*A + d*B + g*C || 1e-12;
  return [A/det, (f*g-d*i)/det, (d*h-e*g)/det,
          B/det, (a*i-c*g)/det, (b*g-a*h)/det,
          C/det, (c*d-a*f)/det, (a*e-b*d)/det];
}

class MappingSim {
  constructor(canvas, mainCanvas) {
    this.canvas = canvas;
    this.main = mainCanvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 non disponibile (mappatura)');
    this.gl = gl;
    const compile = (t, src) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error('Mapping shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = (v, f) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, v));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('Mapping link: ' + gl.getProgramInfoLog(p));
      return p;
    };
    this.progQ = prog(QUAD_VS, QUAD_FS);
    this.progH = prog(H_VS, H_FS);
    this.uQ = { uH: gl.getUniformLocation(this.progQ, 'uH'),
      uTex: gl.getUniformLocation(this.progQ, 'uTex'),
      uOpacity: gl.getUniformLocation(this.progQ, 'uOpacity'),
      uSrc: gl.getUniformLocation(this.progQ, 'uSrc') };
    this.uH = { uCol: gl.getUniformLocation(this.progH, 'uCol'),
      uPt: gl.getUniformLocation(this.progH, 'uPt') };
    this.aQ = gl.getAttribLocation(this.progQ, 'aPos');
    this.aH = gl.getAttribLocation(this.progH, 'aPos');
    this.vbo = gl.createBuffer();

    // live-visual texture, refreshed from the main canvas every frame
    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.visTex = mkTex();
    this._mkTex = mkTex;
    this.imgTex = {};        // path -> {tex, ok}
    this.zones = [];
    this.editOn = false;
    this.selected = -1;
    this.onChange = null;    // (zones) => {} after a drag edit
    this._drag = null;
    this._bindPointer();
  }

  setZones(zones) {
    this.zones = (zones || []).map(z => ({
      id: z.id, name: z.name || 'Zona',
      src: z.src || { type: 'visual' },
      corners: (z.corners || [[0.25,0.25],[0.75,0.25],[0.75,0.75],[0.25,0.75]]).map(c => c.slice()),
      srcRect: z.srcRect || [0, 0, 1, 1],
      opacity: z.opacity !== undefined ? z.opacity : 1
    }));
    if (this.selected >= this.zones.length) this.selected = this.zones.length - 1;
    // preload image textures
    const gl = this.gl;
    for (const z of this.zones) {
      if (z.src.type !== 'image' || !z.src.url || this.imgTex[z.src.url]) continue;
      const entry = this.imgTex[z.src.url] = { tex: this._mkTex(), ok: false };
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        entry.ok = true;
      };
      img.src = z.src.url;
    }
  }

  _bindPointer() {
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left)/Math.max(1, r.width), (e.clientY - r.top)/Math.max(1, r.height)];
    };
    cv.addEventListener('mousedown', (e) => {
      if (!this.editOn) return;
      const [x, y] = pos(e);
      const r = cv.getBoundingClientRect();
      const tol = 14/Math.max(1, r.width);
      // nearest corner of any zone
      let best = null, bd = tol;
      this.zones.forEach((z, zi) => z.corners.forEach((c, ci) => {
        const d = Math.hypot(c[0]-x, (c[1]-y)*(r.height/r.width));
        if (d < bd) { bd = d; best = { zi, ci }; }
      }));
      if (best) { this._drag = best; this.selected = best.zi; }
      else {
        // click inside a zone selects it and drags the whole quad
        for (let zi = this.zones.length-1; zi >= 0; zi--) {
          if (this._inside(this.zones[zi].corners, x, y)) {
            this._drag = { zi, ci: -1, lx: x, ly: y };
            this.selected = zi;
            break;
          }
        }
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      const [x, y] = pos(e);
      const z = this.zones[this._drag.zi];
      if (!z) { this._drag = null; return; }
      if (this._drag.ci >= 0) {
        z.corners[this._drag.ci] = [Math.min(1.2, Math.max(-0.2, x)), Math.min(1.2, Math.max(-0.2, y))];
      } else {
        const dx = x - this._drag.lx, dy = y - this._drag.ly;
        z.corners.forEach(c => { c[0] += dx; c[1] += dy; });
        this._drag.lx = x; this._drag.ly = y;
      }
    });
    window.addEventListener('mouseup', () => {
      if (this._drag && this.onChange) this.onChange(this.zones);
      this._drag = null;
    });
  }

  _inside(c, x, y) {
    let hit = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      if ((c[i][1] > y) !== (c[j][1] > y) &&
          x < (c[j][0]-c[i][0])*(y-c[i][1])/(c[j][1]-c[i][1]) + c[i][0]) hit = !hit;
    }
    return hit;
  }

  render() {
    const gl = this.gl, cv = this.canvas;
    const w = this.main.width, h = this.main.height;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const needVis = this.zones.some(z => z.src.type === 'visual');
    if (needVis) {
      gl.bindTexture(gl.TEXTURE_2D, this.visTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.main);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.progQ);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.aQ);
    gl.vertexAttribPointer(this.aQ, 2, gl.FLOAT, false, 0, 0);
    for (const z of this.zones) {
      let tex = this.visTex;
      if (z.src.type === 'image') {
        const e = this.imgTex[z.src.url];
        if (!e || !e.ok) continue;
        tex = e.tex;
      }
      const c = z.corners;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1],
        c[0][0], c[0][1], c[2][0], c[2][1], c[3][0], c[3][1]
      ]), gl.DYNAMIC_DRAW);
      gl.uniformMatrix3fv(this.uQ.uH, false, inv3(squareToQuad(c)));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.uQ.uTex, 0);
      gl.uniform1f(this.uQ.uOpacity, z.opacity);
      gl.uniform4fv(this.uQ.uSrc, z.srcRect);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (this.editOn) {
      gl.useProgram(this.progH);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(this.aH);
      gl.vertexAttribPointer(this.aH, 2, gl.FLOAT, false, 0, 0);
      this.zones.forEach((z, zi) => {
        const c = z.corners;
        const flat = new Float32Array([c[0][0],c[0][1], c[1][0],c[1][1], c[2][0],c[2][1], c[3][0],c[3][1]]);
        gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
        const sel = zi === this.selected;
        gl.uniform4fv(this.uH.uCol, sel ? [0.4, 0.75, 1, 0.95] : [1, 1, 1, 0.45]);
        gl.uniform1f(this.uH.uPt, 1);
        gl.drawArrays(gl.LINE_LOOP, 0, 4);
        gl.uniform1f(this.uH.uPt, sel ? 16 : 10);
        gl.drawArrays(gl.POINTS, 0, 4);
      });
    }
    gl.disable(gl.BLEND);
  }
}

window.MappingSim = MappingSim;

})();
