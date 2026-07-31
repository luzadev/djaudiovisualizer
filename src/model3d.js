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

// mat3 (as 9-float, column major) helpers for the retarget solver
function m3FromQuat(q) {
  const [x,y,z,w] = q;
  return [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w),
          2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w),
          2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y)];
}
function m3Mul(a, b) {
  const o = new Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    o[c*3+r] = a[r]*b[c*3] + a[3+r]*b[c*3+1] + a[6+r]*b[c*3+2];
  return o;
}
function m3ApplyT(m, v) { // transpose(m) * v  (inverse for pure rotations)
  return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
}
function v3norm(v) { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
// rotation taking unit vector a onto unit vector b
function m3FromTo(a, b) {
  const cx = a[1]*b[2]-a[2]*b[1], cy = a[2]*b[0]-a[0]*b[2], cz = a[0]*b[1]-a[1]*b[0];
  const d = a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const s2 = cx*cx+cy*cy+cz*cz;
  if (s2 < 1e-12) {
    if (d > 0) return [1,0,0, 0,1,0, 0,0,1];
    return [-1,0,0, 0,1,0, 0,0,-1];       // opposite: 180° around Y
  }
  const k = (1-d)/s2;
  return [d+cx*cx*k, cz+cx*cy*k, -cy+cx*cz*k,
          -cz+cy*cx*k, d+cy*cy*k, cx+cy*cz*k,
          cy+cz*cx*k, -cx+cz*cy*k, d+cz*cz*k];
}
// mat4 rotation part with the scale stripped (for solving in world frames)
function m4Rot3(m) {
  const n = (x,y,z) => { const l = Math.hypot(x,y,z) || 1; return [x/l, y/l, z/l]; };
  const c0 = n(m[0],m[1],m[2]), c1 = n(m[4],m[5],m[6]), c2 = n(m[8],m[9],m[10]);
  return [c0[0],c0[1],c0[2], c1[0],c1[1],c1[2], c2[0],c2[1],c2[2]];
}
function m4FromM3T(r, t) {
  return new Float32Array([r[0],r[1],r[2],0, r[3],r[4],r[5],0, r[6],r[7],r[8],0, t[0],t[1],t[2],1]);
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
// skinned variant: vertices follow up to 4 joint matrices
const MAXJ = 80;
const SKIN_VERT = `#version 300 es
in vec3 aPos; in vec3 aNorm; in vec2 aUV; in vec4 aJ; in vec4 aW;
uniform mat4 uProj, uView, uModel;
uniform mat4 uJoints[${MAXJ}];
uniform float uPulse;
out vec3 vN; out vec3 vW; out vec2 vUv;
void main(){
  mat4 sk = aW.x*uJoints[int(aJ.x)] + aW.y*uJoints[int(aJ.y)]
          + aW.z*uJoints[int(aJ.z)] + aW.w*uJoints[int(aJ.w)];
  vec4 w = uModel * sk * vec4(aPos + aNorm*uPulse, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * mat3(sk) * aNorm;
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

function splitGLB(buf) {
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
  return { json, bin };
}

const PACE_RE = /thriller|break|flair|freeze|spin|moonwalk/i;

// Parse a skeleton-only GLB as an animation LIBRARY: clips whose channels are
// keyed by bone base-name, bindable to any mixamorig-style rig.
function parseAnimLib(buf) {
  const { json, bin } = splitGLB(buf);
  if (!json.animations || !json.animations.length) throw new Error('nessuna animazione nel GLB');
  const nodeBase = json.nodes.map(n => (n.name || '').split(':').pop().split('.').pop());
  return json.animations.map(a => {
    const channels = a.channels
      .filter(ch => ch.target.node != null &&
        (ch.target.path === 'rotation' || ch.target.path === 'translation'))
      .map(ch => {
        const s = a.samplers[ch.sampler];
        return { bone: nodeBase[ch.target.node], path: ch.target.path,
          times: readAccessor(json, bin, s.input).data,
          vals: readAccessor(json, bin, s.output).data };
      });
    let dur = 0;
    channels.forEach(c => { const e = c.times[c.times.length-1]; if (e > dur) dur = e; });
    const name = a.name || 'clip';
    return { name, channels, dur: Math.max(0.1, dur), pace: PACE_RE.test(name) ? 0.5 : 1 };
  });
}

function parseGLB(buf) {
  const { json, bin } = splitGLB(buf);

  // node table (hierarchy kept for skinning) + world transforms
  const nodesInfo = json.nodes.map((n, i) => ({
    name: n.name || ('n' + i),
    t: n.translation || [0, 0, 0],
    r: n.rotation || [0, 0, 0, 1],
    s: n.scale || [1, 1, 1],
    matrix: n.matrix || null,
    children: n.children || [],
    parent: -1
  }));
  nodesInfo.forEach((n, i) => n.children.forEach(c => { nodesInfo[c].parent = i; }));
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

  // skin (first one): joint node indices + inverse bind matrices
  let skel = null;
  if (json.skins && json.skins.length) {
    const sk = json.skins[0];
    skel = { nodes: nodesInfo, joints: sk.joints.slice(),
      ibm: readAccessor(json, bin, sk.inverseBindMatrices).data,
      roots: scene.nodes.slice() };
    if (skel.joints.length > MAXJ) throw new Error('scheletro con troppe ossa (' + skel.joints.length + ')');
  }

  const prims = [];
  let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
  Object.keys(worlds).forEach(niKey => {
    const ni = parseInt(niKey, 10);
    const node = json.nodes[ni];
    if (node.mesh == null) return;
    const skinned = skel && node.skin != null;
    const W = worlds[ni];
    json.meshes[node.mesh].primitives.forEach(p => {
      if ((p.mode || 4) !== 4 || p.attributes.POSITION == null) return;
      if (skinned) {
        // skinned primitive: keep mesh-space vertices, read joints/weights
        const pos = readAccessor(json, bin, p.attributes.POSITION).data;
        const nrm = p.attributes.NORMAL != null
          ? readAccessor(json, bin, p.attributes.NORMAL).data : new Float32Array(pos.length);
        const uv = p.attributes.TEXCOORD_0 != null
          ? readAccessor(json, bin, p.attributes.TEXCOORD_0).data
          : new Float32Array(pos.length/3*2);
        const jr = readAccessor(json, bin, p.attributes.JOINTS_0);
        const joints = Float32Array.from(jr.data);
        const wr = readAccessor(json, bin, p.attributes.WEIGHTS_0);
        let weights = Float32Array.from(wr.data);
        const ct = wr.acc.componentType;
        if (ct === 5121) weights = weights.map(v => v/255);
        else if (ct === 5123) weights = weights.map(v => v/65535);
        let idxData = null, idxType = 0;
        if (p.indices != null) {
          const r = readAccessor(json, bin, p.indices);
          idxData = r.data instanceof Uint32Array || r.data instanceof Uint16Array
            ? r.data : Uint16Array.from(r.data);
          idxType = idxData instanceof Uint32Array ? 5125 : 5123;
        }
        let texBytes = null, baseColor = [0.75, 0.75, 0.8];
        const mat = p.material != null ? json.materials[p.material] : null;
        const pbr = mat && mat.pbrMetallicRoughness || {};
        if (pbr.baseColorFactor) baseColor = pbr.baseColorFactor.slice(0, 3);
        if (pbr.baseColorTexture && json.textures && json.images) {
          const tex = json.textures[pbr.baseColorTexture.index];
          const img = json.images[tex.source];
          if (img && img.bufferView != null) {
            const bv2 = json.bufferViews[img.bufferView];
            texBytes = { bytes: new Uint8Array(bin, bv2.byteOffset || 0, bv2.byteLength),
              mime: img.mimeType || 'image/png' };
          }
        }
        prims.push({ pos, nrm, uv, idxData, idxType, baseColor, texBytes,
          skinned: true, joints, weights });
        return;
      }
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
  const hasSkin = prims.some(p => p.skinned);
  // animation clips (rotation/translation channels) for skinned models
  let anims = null;
  if (hasSkin && json.animations && json.animations.length) {
    anims = json.animations.map(a => {
      const channels = a.channels
        .filter(ch => ch.target.node != null &&
          (ch.target.path === 'rotation' || ch.target.path === 'translation'))
        .map(ch => {
          const s = a.samplers[ch.sampler];
          return { node: ch.target.node, path: ch.target.path,
            times: readAccessor(json, bin, s.input).data,
            vals: readAccessor(json, bin, s.output).data };
        });
      let dur = 0;
      channels.forEach(c => { const e = c.times[c.times.length-1]; if (e > dur) dur = e; });
      const name = a.name || 'clip';
      // expressive/half-time choreographies: one count every TWO beats
      return { name, channels, dur: Math.max(0.1, dur), pace: PACE_RE.test(name) ? 0.5 : 1 };
    });
  }
  return { prims, min, max, skel: hasSkin ? skel : null, anims };
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
    this.progSkin = prog(SKIN_VERT, MESH_FRAG);
    this.progBg = prog(BG_VERT, BG_FRAG);
    const U = (p, n) => gl.getUniformLocation(p, n);
    this.um = { uProj: U(this.progMesh,'uProj'), uView: U(this.progMesh,'uView'),
      uModel: U(this.progMesh,'uModel'), uPulse: U(this.progMesh,'uPulse'),
      uTex: U(this.progMesh,'uTex'), uHasTex: U(this.progMesh,'uHasTex'),
      uBase: U(this.progMesh,'uBase'), uColA: U(this.progMesh,'uColA'),
      uColB: U(this.progMesh,'uColB'), uCam: U(this.progMesh,'uCam'),
      uBeat: U(this.progMesh,'uBeat'), uLevel: U(this.progMesh,'uLevel'),
      uTreble: U(this.progMesh,'uTreble'), uRim: U(this.progMesh,'uRim') };
    this.us = {};
    ['uProj','uView','uModel','uPulse','uTex','uHasTex','uBase','uColA','uColB',
     'uCam','uBeat','uLevel','uTreble','uRim','uJoints'].forEach(n => {
      this.us[n] = U(this.progSkin, n === 'uJoints' ? 'uJoints[0]' : n);
    });
    this.aSkin = { pos: gl.getAttribLocation(this.progSkin,'aPos'),
      nrm: gl.getAttribLocation(this.progSkin,'aNorm'),
      uv: gl.getAttribLocation(this.progSkin,'aUV'),
      j: gl.getAttribLocation(this.progSkin,'aJ'),
      w: gl.getAttribLocation(this.progSkin,'aW') };
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
    this.animLib = null;      // bone-name clips (bundled dance library)
    this.ownAnims = [];       // clips carried by the loaded GLB itself
    this.libAnims = [];       // library clips bound to the current skeleton
    this.clipFilter = null;   // Set of allowed clip names (empty/null = all)
    this.manualBpm = 0;       // 0 = follow the detected beat
    this._upload(torusKnot());
  }

  // Bundled animation library (skeleton-only GLB): bound by bone base-name to
  // whatever rigged model is currently loaded.
  setAnimLibrary(buf) {
    try { this.animLib = parseAnimLib(buf); } catch (e) { this.animLib = null; return; }
    this._bindLibrary();
  }

  _bindLibrary() {
    this.libAnims = [];
    if (this.skel && this.animLib) {
      const idxByBase = {};
      this.skel.nodes.forEach((n, i) => {
        idxByBase[n.name.split(':').pop().split('.').pop()] = i;
      });
      for (const clip of this.animLib) {
        const channels = [];
        for (const ch of clip.channels) {
          const ni = idxByBase[ch.bone];
          if (ni === undefined) continue;
          // foreign clips: translations only for the Hips — per-bone
          // translations carry the SOURCE rig's proportions and would
          // stretch/crush a model with different bone lengths
          if (ch.path === 'translation' && ch.bone !== 'Hips') continue;
          channels.push({ node: ni, path: ch.path, times: ch.times, vals: ch.vals });
        }
        if (channels.length > 4)
          this.libAnims.push({ name: clip.name, channels, dur: clip.dur, pace: clip.pace });
      }
    }
    this._mergeAnims();
  }

  _mergeAnims() {
    if (!this.skel) { this.anims = null; return; }
    const own = this.ownAnims || [];
    const lib = this.libAnims.filter(l => !own.some(o => o.name === l.name));
    const all = own.concat(lib);
    this.anims = all.length ? all : null;
    this._dir = null;
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
    this.skel = model.skel || null;
    this.ownAnims = model.anims || [];
    this.restJoints = null;
    this._db = null;
    if (this.skel) {
      // rest-pose joint matrices, then a CPU-skinned vertex sample for the
      // bounding box (skinned vertices live in mesh space until deformed)
      this.restJoints = this._computeJoints(null);
      this._hipsRest = this._hipsW ? this._hipsW.slice() : null;
      const J = this.restJoints;
      let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
      model.prims.forEach(p => {
        if (!p.skinned) return;
        const n = p.pos.length/3;
        const step = Math.max(1, Math.floor(n/800));
        for (let i = 0; i < n; i += step) {
          let x = 0, y = 0, z = 0;
          const px = p.pos[i*3], py = p.pos[i*3+1], pz = p.pos[i*3+2];
          for (let k = 0; k < 4; k++) {
            const w = p.weights[i*4+k];
            if (!w) continue;
            const o = p.joints[i*4+k]*16;
            x += w*(J[o]*px + J[o+4]*py + J[o+8]*pz + J[o+12]);
            y += w*(J[o+1]*px + J[o+5]*py + J[o+9]*pz + J[o+13]);
            z += w*(J[o+2]*px + J[o+6]*py + J[o+10]*pz + J[o+14]);
          }
          if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
          if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
          if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
        }
      });
      model.min = mn; model.max = mx;
    }
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
        idxType: p.idxType, ibo: null, tex: null, baseColor: p.baseColor,
        skinned: !!p.skinned,
        vboJ: p.skinned ? mk(p.joints) : null,
        vboW: p.skinned ? mk(p.weights) : null };
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
    this._bindLibrary();
  }

  get hasSkin() { return !!this.skel; }

  // Append extra clips (a user-loaded GLB with animations) to the library.
  addAnimLibrary(buf) {
    const extra = parseAnimLib(buf); // throws on invalid input
    if (!this.animLib) this.animLib = [];
    for (const c of extra) {
      const i = this.animLib.findIndex(x => x.name === c.name);
      if (i >= 0) this.animLib[i] = c; else this.animLib.push(c);
    }
    this._bindLibrary();
    return extra.map(c => c.name);
  }

  // Joint matrices (world * inverseBind) for the whole skeleton. With
  // `targets` (base bone name -> world-space direction) an extra local
  // rotation is solved per bone so that its chain child points along the
  // target — FK retargeting of the tracked body onto the Mixamo rig.
  // Sample an animation clip at time tt (looping): node -> {r?, t?}.
  _sampleAnim(a, tt) {
    const T = ((tt % a.dur) + a.dur) % a.dur;
    const out = {};
    for (const ch of a.channels) {
      const times = ch.times;
      let i = 0;
      while (i < times.length - 2 && times[i+1] < T) i++;
      const t0 = times[i], t1 = times[i+1] !== undefined ? times[i+1] : t0;
      const f = t1 > t0 ? Math.min(1, Math.max(0, (T - t0)/(t1 - t0))) : 0;
      const o = out[ch.node] || (out[ch.node] = {});
      if (ch.path === 'rotation') {
        const A = ch.vals, i4 = i*4, j4 = Math.min(i4+4, A.length-4);
        let d = A[i4]*A[j4] + A[i4+1]*A[j4+1] + A[i4+2]*A[j4+2] + A[i4+3]*A[j4+3];
        const sg = d < 0 ? -1 : 1;
        const q = [A[i4] + (A[j4]*sg - A[i4])*f, A[i4+1] + (A[j4+1]*sg - A[i4+1])*f,
                   A[i4+2] + (A[j4+2]*sg - A[i4+2])*f, A[i4+3] + (A[j4+3]*sg - A[i4+3])*f];
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        o.r = [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
      } else {
        const V = ch.vals, i3 = i*3, j3 = Math.min(i3+3, V.length-3);
        // Clips merged from other FBX files can carry translations in a
        // different unit (cm vs m): rescale against the node's rest pose.
        if (ch._k === undefined) {
          const rest = this.skel.nodes[ch.node].t;
          const rl = Math.hypot(rest[0], rest[1], rest[2]);
          // peak over the first keys: robust when the clip starts near zero
          let v0 = 0;
          for (let s = 0; s < Math.min(V.length, 24); s += 3)
            v0 = Math.max(v0, Math.hypot(V[s], V[s+1], V[s+2]));
          const ratio = rl > 1e-6 && v0 > 1e-6 ? v0/rl : 1;
          ch._k = (ratio > 3 || ratio < 0.33) ? Math.min(1000, Math.max(0.001, rl/v0)) : 1;
        }
        const k = ch._k;
        o.t = [(V[i3] + (V[j3]-V[i3])*f)*k, (V[i3+1] + (V[j3+1]-V[i3+1])*f)*k,
               (V[i3+2] + (V[j3+2]-V[i3+2])*f)*k];
      }
    }
    return out;
  }

  // Musical beat clock: counts beats (with a free-running metronome between
  // and without detected beats) and exposes a smoothed phase inside the beat.
  _beatClock(t, beat) {
    // manual BPM: a pure metronome, immune to the beat detector
    if (this.manualBpm > 0) {
      const per = 60/this.manualBpm;
      const db = this._db || (this._db = { n: 0, last: t, period: per, prevBeat: 0 });
      db.period = per;
      if (t - db.last > 10) db.last = t;
      while (t - db.last >= per) { db.last += per; db.n++; }
      return { n: db.n, p: Math.max(0, (t - db.last)/per), period: per };
    }
    const db = this._db || (this._db = { n: 0, last: -1, period: 0.5, prevBeat: 0 });
    if (beat > 0.6 && db.prevBeat <= 0.6) {
      // refractory window: energetic tracks fire on kick AND snare/hats,
      // which doubled the tempo — ignore edges closer than 60% of a period
      if (db.last < 0 || t - db.last >= db.period*0.6) {
        if (db.last >= 0) {
          const iv = t - db.last;
          if (iv > 0.24 && iv < 1.3) db.period = iv;
        }
        db.last = t; db.n++;
      }
    } else if (db.last < 0 || t - db.last > db.period*1.6) {
      db.last = db.last < 0 ? t : db.last + db.period;
      db.n++;
    }
    db.prevBeat = beat;
    // linear phase, allowed to run past 1 while waiting for the next beat:
    // motion must never stall (the callers smooth any re-sync jumps)
    const p = db.last >= 0 ? Math.max(0, (t - db.last)/db.period) : 0;
    return { n: db.n, p, period: db.period };
  }

  // Dance director for multi-clip GLBs: the clip timeline is PHASE-LOCKED to
  // the music — one choreography count (0.5s of clip, ~120bpm authoring) per
  // detected beat — so the steps land on the kick regardless of the track's
  // BPM. Moves switch every 16 beats with a short pose crossfade.
  _danceDirector(t, speed, beat) {
    const bc = this._beatClock(t, beat);
    const d = this._dir || (this._dir = { clip: 0, prev: -1, n0: bc.n, p0: bc.p,
      pn0: 0, pp0: 0, lastSwitch: t, sb: 0, psb: 0, lastT: t });
    const dt = Math.min(0.1, Math.max(0.001, t - d.lastT));
    d.lastT = t;
    // repertoire: only the clips ticked in the panel (none ticked = all)
    const pool = [];
    this.anims.forEach((a, i) => {
      if (!this.clipFilter || !this.clipFilter.size || this.clipFilter.has(a.name)) pool.push(i);
    });
    if (!pool.length) this.anims.forEach((_, i) => pool.push(i));
    const outOfPool = pool.indexOf(d.clip) < 0;
    if ((pool.length > 1 || outOfPool) &&
        (outOfPool || (bc.n - d.n0) >= 16 || t - d.lastSwitch > 14)) {
      d.prev = outOfPool ? -1 : d.clip; d.pn0 = d.n0; d.pp0 = d.p0; d.psb = d.sb;
      let next = pool[Math.floor(Math.random()*pool.length)];
      if (next === d.clip && pool.length > 1) next = pool[(pool.indexOf(next) + 1) % pool.length];
      d.clip = next; d.n0 = bc.n; d.p0 = bc.p; d.sb = 0; d.lastSwitch = t;
    }
    const SPB = 0.5*speed;   // clip-seconds per music beat
    // Feed-forward + soft correction: the timeline advances by itself at the
    // metronome rate (zero structural lag — a pure follower trailed the beat
    // by its time constant), the follower only corrects the drift. LEAD
    // compensates beat-detection/display latency.
    const LEAD = 0.05;
    const rate = 1/bc.period;                  // beats per second
    const k = 1 - Math.exp(-dt*4);
    const tgt = Math.max(0, (bc.n - d.n0) + (bc.p - d.p0) + LEAD*rate);
    d.sb += dt*rate;
    d.sb += (tgt - d.sb)*k;
    if (Math.abs(tgt - d.sb) > 1.5) d.sb = tgt; // hard resync if way off
    const cur = this._sampleAnim(this.anims[d.clip],
      d.sb*SPB*(this.anims[d.clip].pace || 1));
    const FADE = 0.45;
    const f = (t - d.lastSwitch)/FADE;
    if (f >= 1 || d.prev < 0) return cur;
    // crossfade with the previous move (same beat-locked, chased timeline)
    const ptgt = Math.max(0, (bc.n - d.pn0) + (bc.p - d.pp0) + LEAD*rate);
    d.psb += dt*rate;
    d.psb += (ptgt - d.psb)*k;
    const old = this._sampleAnim(this.anims[d.prev],
      d.psb*SPB*(this.anims[d.prev].pace || 1));
    const w = f*f*(3 - 2*f);
    for (const ni in old) {
      const o = old[ni], c = cur[ni] || (cur[ni] = {});
      if (o.r) {
        if (!c.r) c.r = o.r;
        else {
          const sg = (o.r[0]*c.r[0] + o.r[1]*c.r[1] + o.r[2]*c.r[2] + o.r[3]*c.r[3]) < 0 ? -1 : 1;
          const q = [o.r[0] + (c.r[0]*sg - o.r[0])*w, o.r[1] + (c.r[1]*sg - o.r[1])*w,
                     o.r[2] + (c.r[2]*sg - o.r[2])*w, o.r[3] + (c.r[3]*sg - o.r[3])*w];
          const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
          c.r = [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
        }
      }
      if (o.t) {
        if (!c.t) c.t = o.t;
        else c.t = [o.t[0] + (c.t[0]-o.t[0])*w, o.t[1] + (c.t[1]-o.t[1])*w, o.t[2] + (c.t[2]-o.t[2])*w];
      }
    }
    return cur;
  }

  // Beat-locked procedural dance for rigged models without animation clips:
  // arms pump on alternate beats, hips sway, head nods, knees bounce. A
  // free-running metronome keeps the groove between detected beats.
  _danceTargets(t, beat, bass) {
    const bc = this._beatClock(t, beat);
    // the procedural sway DOES want the eased phase (it reads as groove)
    const pr = Math.min(1, bc.p);
    const ph = (bc.n + pr*pr*(3 - 2*pr))*Math.PI;
    const s = Math.sin(ph);
    const bounce = Math.abs(s);
    const amp = 0.65 + 0.6*bass;
    return {
      targets: {
        Spine: v3norm([s*0.16*amp, 1, 0.05]),
        Neck: v3norm([s*0.22*amp, 1, 0.16]),
        LeftArm: v3norm([0.75, -0.45 + 1.0*amp*Math.max(0, s), 0.25]),
        LeftForeArm: v3norm([0.30, 0.40 + 0.6*amp*Math.max(0, s), 0.5]),
        RightArm: v3norm([-0.75, -0.45 + 1.0*amp*Math.max(0, -s), 0.25]),
        RightForeArm: v3norm([-0.30, 0.40 + 0.6*amp*Math.max(0, -s), 0.5]),
        LeftUpLeg: v3norm([0.15, -1, 0.08*bounce]),
        RightUpLeg: v3norm([-0.15, -1, 0.08*bounce]),
        LeftLeg: v3norm([0.05, -1, -0.10*bounce]),
        RightLeg: v3norm([-0.05, -1, -0.10*bounce])
      },
      bounceY: (bounce - 0.5)*0.05
    };
  }

  _computeJoints(targets, anim) {
    const sk = this.skel;
    const worlds = new Array(sk.nodes.length);
    const base = (name) => name.split(':').pop().split('.').pop();
    const CHAIN = { LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand',
      RightArm: 'RightForeArm', RightForeArm: 'RightHand',
      LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot',
      RightUpLeg: 'RightLeg', RightLeg: 'RightFoot',
      Neck: 'Head', Spine: 'Spine1' };
    const visit = (ni, parentWorld) => {
      const n = sk.nodes[ni];
      let local;
      const ao = anim && anim[ni];
      if (n.matrix && !ao) {
        local = new Float32Array(n.matrix);
      } else {
        let r3 = m3FromQuat(ao && ao.r ? ao.r : n.r);
        const nt = ao && ao.t ? ao.t : n.t;
        if (targets) {
          const tgt = targets[base(n.name)];
          const childBase = CHAIN[base(n.name)];
          if (tgt && childBase) {
            let ci = -1;
            for (const c of n.children) if (base(sk.nodes[c].name) === childBase) { ci = c; break; }
            if (ci >= 0) {
              const cl = v3norm(sk.nodes[ci].t);
              const pr = parentWorld ? m4Rot3(parentWorld) : [1,0,0, 0,1,0, 0,0,1];
              const d = v3norm(m3ApplyT(m3Mul(pr, r3), tgt));
              r3 = m3Mul(r3, m3FromTo(cl, d));
            }
          }
        }
        const s = n.s;
        local = m4FromM3T([r3[0]*s[0], r3[1]*s[0], r3[2]*s[0],
          r3[3]*s[1], r3[4]*s[1], r3[5]*s[1],
          r3[6]*s[2], r3[7]*s[2], r3[8]*s[2]], nt);
      }
      const world = parentWorld ? m4mul(parentWorld, local) : local;
      worlds[ni] = world;
      if (base(n.name) === 'Hips') this._hipsW = [world[12], world[13], world[14]];
      n.children.forEach(c => visit(c, world));
    };
    sk.roots.forEach(r => visit(r, null));
    const J = sk.joints.length;
    const out = new Float32Array(J*16);
    for (let i = 0; i < J; i++)
      out.set(m4mul(worlds[sk.joints[i]], sk.ibm.subarray(i*16, i*16+16)), i*16);
    return out;
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
  // overlay = true: another engine (e.g. the fluid sim) already painted the
  // canvas this frame — draw only the model on top (clear depth, no backdrop).
  render(timeSec, audio, e, canvas, pose, overlay) {
    const gl = this.gl;
    const speed = Math.min(2.5, e.speed || 1);
    const mix = e.audioMix !== undefined ? e.audioMix : 1;
    const bass = (audio.bass || 0)*mix, beat = (audio.beat || 0)*mix;
    const ca = e.colorA || [0.05, 0, 0.2], cb = e.colorB || [0.2, 1, 1];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    if (overlay) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
    } else {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    // backdrop
    if (!overlay) {
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
    }

    // model
    const asp = canvas.width/Math.max(1, canvas.height);
    const dist = this.radius*2.6;
    // live body-driven skinning? else: animation clip or procedural dance
    const skinnedLive = this.skel && pose && pose.skinTargets;
    // Dancing follows the MUSIC, not the global visual-speed slider: use a
    // real-time clock (only the preset variant speed scales the moves).
    const rt = performance.now()/1000;
    let curJoints = null, danceX = 0, danceY = 0, danceZ = 0;
    if (this.skel) {
      if (skinnedLive) {
        curJoints = this._computeJoints(pose.skinTargets);
      } else if (this.anims) {
        curJoints = this._computeJoints(null, this._danceDirector(rt, speed, beat));
        // keep the dancer framed: cancel the clip's root motion horizontally,
        // keep a taste of the vertical bounce
        if (this._hipsRest && this._hipsW) {
          danceX = (this._hipsRest[0] - this._hipsW[0]);
          danceY = (this._hipsRest[1] - this._hipsW[1])*0.6;
          danceZ = (this._hipsRest[2] - this._hipsW[2]);
        }
      } else {
        const dance = this._danceTargets(rt, beat, bass);
        curJoints = this._computeJoints(dance.targets);
        danceY = dance.bounceY*this.radius;
      }
    }
    // With a live pose the auto-spin slows right down: the person drives it.
    const yaw = skinnedLive ? 0
      : timeSec*0.45*speed*(pose ? 0.12 : 1) + (pose ? pose.yaw : 0);
    const eye = [Math.sin(timeSec*0.13)*this.radius*(skinnedLive ? 0 : 0.35),
                 this.radius*(0.25 + (skinnedLive ? 0 : 0.15*Math.sin(timeSec*0.09))), dist];
    const proj = m4persp(0.72, asp, dist*0.05, dist*4.0);
    const view = m4lookAt(eye, [0, 0, 0]);
    const scale = 1 + 0.05*bass + 0.07*beat;
    const sq = pose && !skinnedLive ? Math.max(0.7, Math.min(1.3, pose.squash || 1)) : 1;
    const world = skinnedLive
      ? [(pose.track ? pose.track[0] : 0)*this.radius, (pose.track ? pose.track[1] : 0)*this.radius, 0]
      : (pose ? [pose.leanX*this.radius*1.6, (pose.hopY || 0)*this.radius, 0] : [danceX, danceY, danceZ]);
    const model = m4mul(m4mul(m4mul(m4trans(world), m4rotY(yaw)),
      m4scale3(scale/Math.sqrt(sq), scale*sq, scale/Math.sqrt(sq))),
      m4trans([-this.center[0], -this.center[1], -this.center[2]]));

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    for (const m of this.meshes) {
      const u = m.skinned ? this.us : this.um;
      const at = m.skinned ? this.aSkin : this.aMesh;
      gl.useProgram(m.skinned ? this.progSkin : this.progMesh);
      gl.uniformMatrix4fv(u.uProj, false, proj);
      gl.uniformMatrix4fv(u.uView, false, view);
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniform1f(u.uPulse, m.skinned ? 0 : this.radius*0.01*bass);
      gl.uniform3fv(u.uColA, ca);
      gl.uniform3fv(u.uColB, cb);
      gl.uniform3fv(u.uCam, eye);
      gl.uniform1f(u.uBeat, beat);
      gl.uniform1f(u.uLevel, (audio.level || 0)*mix);
      gl.uniform1f(u.uTreble, (audio.treble || 0)*mix);
      gl.uniform1f(u.uRim, pose ? (pose.rim || 0) : 0);
      if (m.skinned) gl.uniformMatrix4fv(u.uJoints, false, curJoints);
      const bind = (buf, loc, n) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      };
      bind(m.vboP, at.pos, 3);
      bind(m.vboN, at.nrm, 3);
      bind(m.vboU, at.uv, 2);
      if (m.skinned) { bind(m.vboJ, at.j, 4); bind(m.vboW, at.w, 4); }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.tex || null);
      gl.uniform1i(u.uTex, 0);
      gl.uniform1i(u.uHasTex, m.tex ? 1 : 0);
      gl.uniform3fv(u.uBase, m.baseColor);
      if (m.ibo) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.drawElements(gl.TRIANGLES, m.count, m.idxType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      }
      gl.disableVertexAttribArray(at.nrm);
      gl.disableVertexAttribArray(at.uv);
      if (m.skinned) { gl.disableVertexAttribArray(at.j); gl.disableVertexAttribArray(at.w); }
    }
    gl.disable(gl.DEPTH_TEST);
  }
}

window.ModelSim = ModelSim;

})();
