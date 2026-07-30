// 3D model family: renders a GLB (glTF-binary) model audio-reactively on the
// shared WebGL2 canvas — same takeover pattern as FluidSim. Minimal loader
// (static meshes: POSITION/NORMAL/TEXCOORD_0 + baseColorTexture; node TRS is
// baked into the vertices at load). No external libraries. While no model is
// loaded a generated torus knot spins so the family works out of the box.
(function () {

// ------------------------------------------------------------ mat4 helpers
function m4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  return o;
}
function m4persp(fov, asp, n, f) {
  const t = 1/Math.tan(fov/2);
  return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0]);
}
function m4lookAt(eye, at) {
  let zx = eye[0]-at[0], zy = eye[1]-at[1], zz = eye[2]-at[2];
  const zl = Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;
  let xx = zz, xz = -zx; // cross(up=(0,1,0), z)
  const xl = Math.hypot(xx,xz) || 1; xx/=xl; xz/=xl;
  const yx = zy*xz, yy = zz*xx - zx*xz, yz = -zy*xx; // cross(z, x)
  return new Float32Array([
    xx, yx, zx, 0,  0, yy, zy, 0,  xz, yz, zz, 0,
    -(xx*eye[0]+xz*eye[2]), -(yx*eye[0]+yy*eye[1]+yz*eye[2]), -(zx*eye[0]+zy*eye[1]+zz*eye[2]), 1]);
}
function m4rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
}
function m4scale3(sx, sy, sz) {
  return new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1]);
}
function m4trans(t) {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, t[0],t[1],t[2],1]);
}
// quaternion + TRS -> mat4 (column major)
function trsToMat(t, r, s) {
  t = t || [0,0,0]; r = r || [0,0,0,1]; s = s || [1,1,1];
  const [x,y,z,w] = r;
  const m = new Float32Array([
    (1-2*(y*y+z*z))*s[0], (2*(x*y+z*w))*s[0], (2*(x*z-y*w))*s[0], 0,
    (2*(x*y-z*w))*s[1], (1-2*(x*x+z*z))*s[1], (2*(y*z+x*w))*s[1], 0,
    (2*(x*z+y*w))*s[2], (2*(y*z-x*w))*s[2], (1-2*(x*x+y*y))*s[2], 0,
    t[0], t[1], t[2], 1]);
  return m;
}

// ------------------------------------------------------------ shaders
const MESH_VERT = `#version 300 es
in vec3 aPos; in vec3 aNorm; in vec2 aUV;
uniform mat4 uProj, uView, uModel;
uniform float uPulse;
out vec3 vN; out vec3 vW; out vec2 vUv;
void main(){
  vec4 w = uModel * vec4(aPos + aNorm*uPulse, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNorm;
  vUv = aUV;
  gl_Position = uProj * uView * w;
}`;
const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in vec2 vUv;
out vec4 frag;
uniform sampler2D uTex;
uniform int uHasTex;
uniform vec3 uBase, uColA, uColB, uCam;
uniform float uBeat, uLevel, uTreble, uRim;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;               // light double-sided surfaces
  vec3 L = normalize(vec3(0.5, 0.8, 0.6));
  vec3 base = uHasTex == 1 ? texture(uTex, vUv).rgb : uBase;
  float d = max(dot(N, L), 0.0);
  vec3 col = base * (0.26 + 0.85*d);
  col += uColA * 1.6 * max(dot(N, -L), 0.0) * 0.4;          // palette fill light
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uColB * fr * (0.45 + 0.95*uBeat + 0.4*uLevel + 1.3*uRim); // beat + touch
  vec3 H = normalize(L + V);
  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 42.0) * (0.3 + 0.5*uTreble);
  frag = vec4(col, 1.0);
}`;
// backdrop: dark palette gradient + a soft glow behind the model
const BG_VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform vec3 uColA, uColB;
uniform vec2 uRes;
uniform float uT, uBass, uBeat;
void main(){
  float as = uRes.x/max(uRes.y,1.0);
  vec2 p = vec2((vUv.x-0.5)*as, vUv.y-0.5);
  vec3 col = uColA*0.16*(1.15 - vUv.y*0.9);
  col += uColB * exp(-dot(p,p)*2.6) * (0.10 + 0.14*uBass + 0.08*uBeat);
  // faint drifting halo bands for depth
  col += uColA*0.35 * (0.5+0.5*sin(p.y*9.0 - uT*0.4)) * exp(-dot(p,p)*1.2) * 0.12;
  frag = vec4(col, 1.0);
}`;

// ------------------------------------------------------------ GLB parsing
const CTYPE = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const CSIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, bin, idx) {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const Comp = CTYPE[acc.componentType];
  const n = CSIZE[acc.type];
  const stride = bv.byteStride || 0;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Comp(acc.count * n);
  if (!stride || stride === n * Comp.BYTES_PER_ELEMENT) {
    out.set(new Comp(bin, base, acc.count * n));
  } else {
    for (let i = 0; i < acc.count; i++) {
      const src = new Comp(bin, base + i*stride, n);
      out.set(src, i*n);
    }
  }
  return { data: out, acc };
}

function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('non è un file GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off+4, true);
    const chunk = buf.slice(off+8, off+8+len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len + (len % 4 ? 4 - len % 4 : 0);
  }
  if (!json || !bin) throw new Error('GLB incompleto');

  // world transform per node (baked into the vertices below)
  const worlds = {};
  const walk = (ni, parent) => {
    const node = json.nodes[ni];
    const local = node.matrix ? new Float32Array(node.matrix)
      : trsToMat(node.translation, node.rotation, node.scale);
    const world = parent ? m4mul(parent, local) : local;
    worlds[ni] = world;
    (node.children || []).forEach(c => walk(c, world));
  };
  const scene = json.scenes[json.scene || 0];
  scene.nodes.forEach(n => walk(n, null));

  const prims = [];
  let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
  Object.keys(worlds).forEach(niKey => {
    const ni = parseInt(niKey, 10);
    const node = json.nodes[ni];
    if (node.mesh == null) return;
    const W = worlds[ni];
    json.meshes[node.mesh].primitives.forEach(p => {
      if ((p.mode || 4) !== 4 || p.attributes.POSITION == null) return;
      const pos = readAccessor(json, bin, p.attributes.POSITION).data;
      const nrm = p.attributes.NORMAL != null
        ? readAccessor(json, bin, p.attributes.NORMAL).data
        : new Float32Array(pos.length); // flat fallback (lit by fresnel only)
      const uv = p.attributes.TEXCOORD_0 != null
        ? readAccessor(json, bin, p.attributes.TEXCOORD_0).data
        : new Float32Array(pos.length / 3 * 2);
      // bake the node world transform (positions + normals)
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i+1], z = pos[i+2];
        pos[i]   = W[0]*x + W[4]*y + W[8]*z  + W[12];
        pos[i+1] = W[1]*x + W[5]*y + W[9]*z  + W[13];
        pos[i+2] = W[2]*x + W[6]*y + W[10]*z + W[14];
        const nx = nrm[i], ny = nrm[i+1], nz = nrm[i+2];
        nrm[i]   = W[0]*nx + W[4]*ny + W[8]*nz;
        nrm[i+1] = W[1]*nx + W[5]*ny + W[9]*nz;
        nrm[i+2] = W[2]*nx + W[6]*ny + W[10]*nz;
        for (let k = 0; k < 3; k++) {
          const v = pos[i+k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
      let idxData = null, idxType = 0;
      if (p.indices != null) {
        const r = readAccessor(json, bin, p.indices);
        idxData = r.data instanceof Uint32Array || r.data instanceof Uint16Array
          ? r.data : Uint16Array.from(r.data);
        idxType = idxData instanceof Uint32Array ? 5125 : 5123;
      }
      // base colour: texture (PNG/JPEG bytes) or factor
      let texBytes = null, baseColor = [0.75, 0.75, 0.8];
      const mat = p.material != null ? json.materials[p.material] : null;
      const pbr = mat && mat.pbrMetallicRoughness || {};
      if (pbr.baseColorFactor) baseColor = pbr.baseColorFactor.slice(0, 3);
      if (pbr.baseColorTexture && json.textures && json.images) {
        const tex = json.textures[pbr.baseColorTexture.index];
        const img = json.images[tex.source];
        if (img && img.bufferView != null) {
          const bv = json.bufferViews[img.bufferView];
          texBytes = { bytes: new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength),
            mime: img.mimeType || 'image/png' };
        }
      }
      prims.push({ pos, nrm, uv, idxData, idxType, baseColor, texBytes });
    });
  });
  if (!prims.length) throw new Error('nessuna mesh triangolare nel GLB');
  return { prims, min, max };
}

// Generated fallback: a torus knot, so the family shows something before any
// GLB is loaded.
function torusKnot() {
  const P = 2, Q = 3, SEG = 220, TUBE = 26, R2 = 0.34;
  const pos = [], nrm = [], uv = [], idx = [];
  const C = (t) => {
    const r = 1 + 0.45*Math.cos(Q*t);
    return [r*Math.cos(P*t), 0.45*Math.sin(Q*t), r*Math.sin(P*t)];
  };
  for (let i = 0; i <= SEG; i++) {
    const t = i/SEG*Math.PI*2;
    const c = C(t), c2 = C(t+0.01);
    let tx = c2[0]-c[0], ty = c2[1]-c[1], tz = c2[2]-c[2];
    const tl = Math.hypot(tx,ty,tz); tx/=tl; ty/=tl; tz/=tl;
    let bx = tz, bz = -tx, bl = Math.hypot(bx,bz) || 1; bx/=bl; bz/=bl;
    const nx0 = ty*bz, ny0 = tz*bx - tx*bz, nz0 = -ty*bx;
    for (let j = 0; j <= TUBE; j++) {
      const a = j/TUBE*Math.PI*2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ca*bx + sa*nx0, ny = sa*ny0, nz = ca*bz + sa*nz0;
      pos.push(c[0]+R2*nx, c[1]+R2*ny, c[2]+R2*nz);
      nrm.push(nx, ny, nz);
      uv.push(i/SEG*8, j/TUBE);
      if (i < SEG && j < TUBE) {
        const a0 = i*(TUBE+1)+j;
        idx.push(a0, a0+TUBE+1, a0+1, a0+1, a0+TUBE+1, a0+TUBE+2);
      }
    }
  }
  return { prims: [{ pos: new Float32Array(pos), nrm: new Float32Array(nrm),
    uv: new Float32Array(uv), idxData: new Uint32Array(idx), idxType: 5125,
    baseColor: [0.72, 0.74, 0.85], texBytes: null }],
    min: [-1.45,-0.8,-1.45], max: [1.45,0.8,1.45] };
}

// ------------------------------------------------------------ renderer
class ModelSim {
  constructor(gl) {
    this.gl = gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error('Model3D shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = (v, f) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, v));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('Model3D link: ' + gl.getProgramInfoLog(p));
      return p;
    };
    this.progMesh = prog(MESH_VERT, MESH_FRAG);
    this.progBg = prog(BG_VERT, BG_FRAG);
    const U = (p, n) => gl.getUniformLocation(p, n);
    this.um = { uProj: U(this.progMesh,'uProj'), uView: U(this.progMesh,'uView'),
      uModel: U(this.progMesh,'uModel'), uPulse: U(this.progMesh,'uPulse'),
      uTex: U(this.progMesh,'uTex'), uHasTex: U(this.progMesh,'uHasTex'),
      uBase: U(this.progMesh,'uBase'), uColA: U(this.progMesh,'uColA'),
      uColB: U(this.progMesh,'uColB'), uCam: U(this.progMesh,'uCam'),
      uBeat: U(this.progMesh,'uBeat'), uLevel: U(this.progMesh,'uLevel'),
      uTreble: U(this.progMesh,'uTreble'), uRim: U(this.progMesh,'uRim') };
    this.ub = { uColA: U(this.progBg,'uColA'), uColB: U(this.progBg,'uColB'),
      uRes: U(this.progBg,'uRes'), uT: U(this.progBg,'uT'),
      uBass: U(this.progBg,'uBass'), uBeat: U(this.progBg,'uBeat') };
    this.aMesh = { pos: gl.getAttribLocation(this.progMesh,'aPos'),
      nrm: gl.getAttribLocation(this.progMesh,'aNorm'),
      uv: gl.getAttribLocation(this.progMesh,'aUV') };
    this.aBg = gl.getAttribLocation(this.progBg, 'aPos');
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.meshes = null;
    this.loadError = '';
    this._upload(torusKnot());
  }

  _freeMeshes() {
    const gl = this.gl;
    (this.meshes || []).forEach(m => {
      gl.deleteBuffer(m.vboP); gl.deleteBuffer(m.vboN); gl.deleteBuffer(m.vboU);
      if (m.ibo) gl.deleteBuffer(m.ibo);
      if (m.tex) gl.deleteTexture(m.tex);
    });
    this.meshes = null;
  }

  _upload(model) {
    const gl = this.gl;
    this._freeMeshes();
    const c = [(model.min[0]+model.max[0])/2, (model.min[1]+model.max[1])/2, (model.min[2]+model.max[2])/2];
    this.center = c;
    this.radius = Math.max(0.001, Math.hypot(model.max[0]-c[0], model.max[1]-c[1], model.max[2]-c[2]));
    this.meshes = model.prims.map(p => {
      const mk = (data) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const m = { vboP: mk(p.pos), vboN: mk(p.nrm), vboU: mk(p.uv),
        count: p.idxData ? p.idxData.length : p.pos.length/3,
        idxType: p.idxType, ibo: null, tex: null, baseColor: p.baseColor };
      if (p.idxData) {
        m.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.idxData, gl.STATIC_DRAW);
      }
      if (p.texBytes) {
        // decode the embedded PNG/JPEG asynchronously, then upload
        m.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          new Uint8Array([180, 180, 200, 255]));
        createImageBitmap(new Blob([p.texBytes.bytes], { type: p.texBytes.mime }))
          .then(bmp => {
            gl.bindTexture(gl.TEXTURE_2D, m.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          })
          .catch(() => { /* keep the placeholder pixel */ });
      }
      return m;
    });
  }

  // Load a GLB from an ArrayBuffer (called via the control panel).
  setModel(buf) {
    try {
      this._upload(parseGLB(buf));
      this.loadError = '';
      return true;
    } catch (e) {
      this.loadError = e && e.message ? e.message : String(e);
      if (!this.meshes) this._upload(torusKnot());
      return false;
    }
  }

  // ---------------------------------------------------- avatar primitives
  _primMesh(pos, nrm, idx) {
    const gl = this.gl;
    const mk = (d, target) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, d, gl.STATIC_DRAW);
      return b;
    };
    return { vboP: mk(new Float32Array(pos), gl.ARRAY_BUFFER),
      vboN: mk(new Float32Array(nrm), gl.ARRAY_BUFFER),
      vboU: mk(new Float32Array(pos.length/3*2), gl.ARRAY_BUFFER),
      ibo: mk(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER),
      count: idx.length, idxType: 5123 };
  }

  _ensurePrims() {
    if (this.prims) return;
    // unit cube (±1) with face normals
    const P = [], N = [], I = [];
    const faces = [[[1,0,0],[0,1,0],[0,0,1]], [[-1,0,0],[0,0,1],[0,1,0]],
      [[0,1,0],[0,0,1],[1,0,0]], [[0,-1,0],[1,0,0],[0,0,1]],
      [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[0,1,0],[1,0,0]]];
    faces.forEach(([n, u, v]) => {
      const b = P.length/3;
      for (const [su, sv] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        P.push(n[0]+u[0]*su+v[0]*sv, n[1]+u[1]*su+v[1]*sv, n[2]+u[2]*su+v[2]*sv);
        N.push(n[0], n[1], n[2]);
      }
      I.push(b, b+1, b+2, b, b+2, b+3);
    });
    const cube = this._primMesh(P, N, I);
    // unit sphere
    const SP = [], SN = [], SI = [], ST = 12, SE = 18;
    for (let i = 0; i <= ST; i++) {
      const ph = i/ST*Math.PI, y = Math.cos(ph), r = Math.sin(ph);
      for (let j = 0; j <= SE; j++) {
        const th = j/SE*Math.PI*2;
        const x = r*Math.cos(th), z = r*Math.sin(th);
        SP.push(x, y, z); SN.push(x, y, z);
        if (i < ST && j < SE) {
          const a = i*(SE+1)+j;
          SI.push(a, a+SE+1, a+1, a+1, a+SE+1, a+SE+2);
        }
      }
    }
    // tapered capsule (limb): rounded ends, slightly narrower at the top
    const CP = [], CN = [], CI = [], SEC = 14, CAP = 5;
    const prof = [];
    for (let i = 0; i <= CAP; i++) { const a = Math.PI/2*(1 - i/CAP);
      prof.push({ r: 0.8*Math.cos(a), y: 0.72 + 0.28*Math.sin(a) }); }
    prof.push({ r: 1.0, y: -0.72 });
    for (let i = 1; i <= CAP; i++) { const a = Math.PI/2*i/CAP;
      prof.push({ r: Math.cos(a), y: -0.72 - 0.28*Math.sin(a) }); }
    prof.forEach((p, pi) => {
      for (let j = 0; j <= SEC; j++) {
        const th = j/SEC*Math.PI*2, x = p.r*Math.cos(th), z = p.r*Math.sin(th);
        CP.push(x, p.y, z);
        // capsule-style normal: radiate from the nearest axis point
        const cy = Math.max(-0.72, Math.min(0.72, p.y));
        const nl = Math.hypot(x, p.y-cy, z) || 1;
        CN.push(x/nl, (p.y-cy)/nl, z/nl);
        if (pi < prof.length-1 && j < SEC) {
          const a0 = pi*(SEC+1)+j;
          CI.push(a0, a0+SEC+1, a0+1, a0+1, a0+SEC+1, a0+SEC+2);
        }
      }
    });
    // rounded box: superellipsoid built from the sphere directions
    const RP = [], RN = [], RI = [], RST = 10, RSE = 16, EE = 0.42;
    const se = (c) => Math.sign(c)*Math.pow(Math.abs(c), EE);
    for (let i = 0; i <= RST; i++) {
      const ph = i/RST*Math.PI, y = Math.cos(ph), r = Math.sin(ph);
      for (let j = 0; j <= RSE; j++) {
        const th = j/RSE*Math.PI*2, x = r*Math.cos(th), z = r*Math.sin(th);
        RP.push(se(x), se(y), se(z));
        RN.push(x, y, z);          // smooth rounded-cube shading
        if (i < RST && j < RSE) {
          const a0 = i*(RSE+1)+j;
          RI.push(a0, a0+RSE+1, a0+1, a0+1, a0+RSE+1, a0+RSE+2);
        }
      }
    }
    this.prims = { cube, sphere: this._primMesh(SP, SN, SI),
      caps: this._primMesh(CP, CN, CI), rbox: this._primMesh(RP, RN, RI) };
  }

  // Matrix placing a unit primitive as a limb from a to b (thickness rx/rz)
  // or as a sphere/box at a (b = null).
  _partMatrix(spec) {
    if (!spec.b) return m4mul(m4trans(spec.a), m4scale3(spec.rx, spec.ry || spec.rx, spec.rz || spec.rx));
    const dx = spec.b[0]-spec.a[0], dy = spec.b[1]-spec.a[1], dz = spec.b[2]-spec.a[2];
    const len = Math.max(1e-4, Math.hypot(dx, dy, dz));
    const yx = dx/len, yy = dy/len, yz = dz/len;
    // basis around the limb axis
    let ax = 0, ay = 0, az = 1;
    if (Math.abs(yz) > 0.9) { ax = 1; az = 0; }
    let xx = yy*az - yz*ay, xy = yz*ax - yx*az, xz = yx*ay - yy*ax;
    const xl = Math.hypot(xx, xy, xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    const zx = xy*yz - xz*yy, zy = xz*yx - xx*yz, zz = xx*yy - xy*yx;
    const R = new Float32Array([xx,xy,xz,0, yx,yy,yz,0, zx,zy,zz,0,
      (spec.a[0]+spec.b[0])/2, (spec.a[1]+spec.b[1])/2, (spec.a[2]+spec.b[2])/2, 1]);
    return m4mul(R, m4scale3(spec.rx, len/2, spec.rz || spec.rx));
  }

  // Render a robot avatar made of primitive parts driven by the body pose.
  // parts: [{ a:[x,y,z], b:[x,y,z]|null, rx, ry?, rz?, kind:'cube'|'sphere', col:[r,g,b] }]
  renderAvatar(timeSec, audio, e, canvas, parts) {
    const gl = this.gl;
    this._ensurePrims();
    const mix = e.audioMix !== undefined ? e.audioMix : 1;
    const bass = (audio.bass || 0)*mix, beat = (audio.beat || 0)*mix;
    const ca = e.colorA || [0.05, 0, 0.2], cb = e.colorB || [0.2, 1, 1];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.progBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aBg);
    gl.vertexAttribPointer(this.aBg, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(this.ub.uColA, ca);
    gl.uniform3fv(this.ub.uColB, cb);
    gl.uniform2f(this.ub.uRes, canvas.width, canvas.height);
    gl.uniform1f(this.ub.uT, timeSec);
    gl.uniform1f(this.ub.uBass, bass);
    gl.uniform1f(this.ub.uBeat, beat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const asp = canvas.width/Math.max(1, canvas.height);
    const eye = [0, 0.1, 3.4];
    const proj = m4persp(0.72, asp, 0.1, 20);
    const view = m4lookAt(eye, [0, 0, 0]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.progMesh);
    gl.uniformMatrix4fv(this.um.uProj, false, proj);
    gl.uniformMatrix4fv(this.um.uView, false, view);
    gl.uniform1f(this.um.uPulse, 0);
    gl.uniform3fv(this.um.uColA, ca);
    gl.uniform3fv(this.um.uColB, cb);
    gl.uniform3fv(this.um.uCam, eye);
    gl.uniform1f(this.um.uBeat, beat);
    gl.uniform1f(this.um.uLevel, (audio.level || 0)*mix);
    gl.uniform1f(this.um.uTreble, (audio.treble || 0)*mix);
    gl.uniform1f(this.um.uRim, 0.15 + 0.3*beat);
    gl.uniform1i(this.um.uHasTex, 0);
    for (const spec of parts) {
      const m = this.prims[spec.kind] || this.prims.cube;
      gl.uniformMatrix4fv(this.um.uModel, false, this._partMatrix(spec));
      gl.uniform3fv(this.um.uBase, spec.col);
      const bind = (buf, loc, n) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      };
      bind(m.vboP, this.aMesh.pos, 3);
      bind(m.vboN, this.aMesh.nrm, 3);
      bind(m.vboU, this.aMesh.uv, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disableVertexAttribArray(this.aMesh.nrm);
    gl.disableVertexAttribArray(this.aMesh.uv);
  }

  // pose (optional, from the camera-interactive mode): { yaw, leanX, hopY,
  // squash, rim } — extra rotation, sideways lean, jump height (in radii),
  // vertical squash & stretch, touch-glow 0..1.
  render(timeSec, audio, e, canvas, pose) {
    const gl = this.gl;
    const speed = Math.min(2.5, e.speed || 1);
    const mix = e.audioMix !== undefined ? e.audioMix : 1;
    const bass = (audio.bass || 0)*mix, beat = (audio.beat || 0)*mix;
    const ca = e.colorA || [0.05, 0, 0.2], cb = e.colorB || [0.2, 1, 1];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // backdrop
    gl.useProgram(this.progBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aBg);
    gl.vertexAttribPointer(this.aBg, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(this.ub.uColA, ca);
    gl.uniform3fv(this.ub.uColB, cb);
    gl.uniform2f(this.ub.uRes, canvas.width, canvas.height);
    gl.uniform1f(this.ub.uT, timeSec);
    gl.uniform1f(this.ub.uBass, bass);
    gl.uniform1f(this.ub.uBeat, beat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // model
    const asp = canvas.width/Math.max(1, canvas.height);
    const dist = this.radius*2.6;
    // With a live pose the auto-spin slows right down: the person drives it.
    const yaw = timeSec*0.45*speed*(pose ? 0.12 : 1) + (pose ? pose.yaw : 0);
    const eye = [Math.sin(timeSec*0.13)*this.radius*0.35,
                 this.radius*(0.25 + 0.15*Math.sin(timeSec*0.09)), dist];
    const proj = m4persp(0.72, asp, dist*0.05, dist*4.0);
    const view = m4lookAt(eye, [0, 0, 0]);
    const scale = 1 + 0.05*bass + 0.07*beat;
    const sq = pose ? Math.max(0.7, Math.min(1.3, pose.squash || 1)) : 1;
    const world = pose
      ? [pose.leanX*this.radius*1.6, (pose.hopY || 0)*this.radius, 0]
      : [0, 0, 0];
    const model = m4mul(m4mul(m4mul(m4trans(world), m4rotY(yaw)),
      m4scale3(scale/Math.sqrt(sq), scale*sq, scale/Math.sqrt(sq))),
      m4trans([-this.center[0], -this.center[1], -this.center[2]]));

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.progMesh);
    gl.uniformMatrix4fv(this.um.uProj, false, proj);
    gl.uniformMatrix4fv(this.um.uView, false, view);
    gl.uniformMatrix4fv(this.um.uModel, false, model);
    gl.uniform1f(this.um.uPulse, this.radius*0.01*bass);
    gl.uniform3fv(this.um.uColA, ca);
    gl.uniform3fv(this.um.uColB, cb);
    gl.uniform3fv(this.um.uCam, eye);
    gl.uniform1f(this.um.uBeat, beat);
    gl.uniform1f(this.um.uLevel, (audio.level || 0)*mix);
    gl.uniform1f(this.um.uTreble, (audio.treble || 0)*mix);
    gl.uniform1f(this.um.uRim, pose ? (pose.rim || 0) : 0);
    for (const m of this.meshes) {
      const bind = (buf, loc, n) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      };
      bind(m.vboP, this.aMesh.pos, 3);
      bind(m.vboN, this.aMesh.nrm, 3);
      bind(m.vboU, this.aMesh.uv, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.tex || null);
      gl.uniform1i(this.um.uTex, 0);
      gl.uniform1i(this.um.uHasTex, m.tex ? 1 : 0);
      gl.uniform3fv(this.um.uBase, m.baseColor);
      if (m.ibo) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.drawElements(gl.TRIANGLES, m.count, m.idxType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      }
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disableVertexAttribArray(this.aMesh.nrm);
    gl.disableVertexAttribArray(this.aMesh.uv);
  }
}

window.ModelSim = ModelSim;

})();
