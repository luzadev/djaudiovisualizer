// GLSL ES 3.00 shaders for the visualizer. Stored as strings, compiled at runtime.

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Shared fragment-shader prelude: uniforms + helpers, prepended to every scene.
const FRAG_HEADER = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uBass;    // 0..1 smoothed low band
uniform float uMid;     // 0..1 smoothed mid band
uniform float uTreble;  // 0..1 smoothed high band
uniform float uLevel;   // 0..1 overall loudness
uniform float uBeat;    // 0..1 decaying pulse on detected beats

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}
`;

// ---- Scene 0: Julia / Mandelbrot-style fractal -------------------------
const FRAG_FRACTAL = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // Bass-driven zoom breathing + slow drift.
  float zoom = 1.3 + 0.55 * sin(uTime * 0.07) + uBass * 0.9;
  uv /= zoom;

  // Slowly wandering Julia constant; treble adds jitter on the path.
  float t = uTime * 0.15;
  vec2 c = vec2(0.7885 * cos(t), 0.7885 * sin(t * 1.13));
  c += (uTreble * 0.12) * vec2(sin(uTime * 6.0), cos(uTime * 5.0));

  vec2 z = uv * 1.4;
  float iter = 0.0;
  const float MAX = 160.0;
  for (float i = 0.0; i < MAX; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 16.0) break;
    iter++;
  }

  // Smooth iteration count for banding-free color.
  float sm = iter - log2(log2(dot(z, z))) + 4.0;
  float m = sm / MAX;

  vec3 col;
  if (iter >= MAX) {
    col = vec3(0.0);
  } else {
    float hue = fract(0.55 + m * 2.5 + uTime * 0.03 + uMid * 0.3);
    float sat = 0.65 + 0.35 * uTreble;
    float val = pow(m, 0.45) * (0.7 + 0.6 * uLevel);
    col = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.2)));
  }

  // Beat flash + soft vignette.
  col += uBeat * 0.25 * vec3(0.6, 0.7, 1.0);
  float vig = 1.0 - 0.35 * dot(uv * zoom, uv * zoom);
  col *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 1: Plasma / domain-warped flow ------------------------------
const FRAG_PLASMA = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * (0.15 + uMid * 0.4);

  // Domain warping: feed fbm into fbm for liquid motion.
  vec2 q = vec2(fbm(uv * 1.5 + t), fbm(uv * 1.5 - t + 5.2));
  vec2 r = vec2(
    fbm(uv * 2.0 + 1.7 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(uv * 2.0 + 1.7 * q + vec2(8.3, 2.8) - 0.12 * t)
  );
  float f = fbm(uv * 2.0 + 3.0 * r + uBass * 1.2);

  float hue = fract(0.6 + f * 0.6 + length(r) * 0.3 + uTime * 0.02);
  float val = 0.25 + 1.1 * f * (0.5 + uLevel);
  vec3 col = hsv2rgb(vec3(hue, 0.7 + 0.3 * uTreble, val));

  // Bright filaments where the warp field folds.
  col += vec3(0.9, 0.95, 1.0) * pow(length(r), 3.0) * (0.4 + uBeat);
  col *= 0.85 + 0.5 * uBass;

  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 2: Kaleidoscope tunnel --------------------------------------
const FRAG_TUNNEL = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  float a = atan(uv.y, uv.x);
  float rad = length(uv);

  // Kaleidoscope: fold angle into N reactive segments.
  float seg = 6.0 + floor(uMid * 8.0);
  a = abs(mod(a, 6.28318 / seg) - 3.14159 / seg);

  // Tunnel: travel inward, speed pulses with bass.
  float depth = 0.35 / (rad + 0.05) + uTime * (0.3 + uBass * 1.4);
  vec2 tuv = vec2(a * 2.0, depth);

  float pattern = fbm(tuv * 3.0) + 0.5 * sin(tuv.x * 8.0 + uTime);
  float rings = sin(depth * 10.0 - uTime * 2.0) * 0.5 + 0.5;

  float hue = fract(0.5 + depth * 0.05 + pattern * 0.3 + uTreble * 0.4);
  float val = (0.2 + 0.9 * pattern) * rings * (0.6 + uLevel);
  // Fade core to black so the tunnel reads as depth.
  val *= smoothstep(0.0, 0.5, rad);

  vec3 col = hsv2rgb(vec3(hue, 0.8, val));
  col += uBeat * 0.4 * vec3(1.0, 0.5, 0.9) * (1.0 - rad);

  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 3: Vortice (swirl) ------------------------------------------
const FRAG_VORTEX = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Spiral arms that twist harder near the centre and spin with the bass.
  float swirl = a + (1.2 + uBass * 3.0) / (r + 0.15) - uTime * (0.6 + uMid);
  float arms = sin(swirl * 5.0 + r * 12.0 - uTime * 2.0) * 0.5 + 0.5;
  float n = fbm(uv * 3.0 + vec2(cos(uTime * 0.2), sin(uTime * 0.2)));
  float v = arms * (0.4 + 0.8 * n);

  float hue = fract(0.72 + r * 0.35 + uTime * 0.04 + uTreble * 0.3);
  vec3 col = hsv2rgb(vec3(hue, 0.85, v * (0.5 + uLevel)));
  col += uBeat * 0.3 * vec3(1.0, 0.6, 0.9) * (1.0 - r);
  col *= smoothstep(0.0, 0.15, r); // dark eye in the middle
  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 4: Onde (reactive frequency rings) --------------------------
const FRAG_WAVES = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Energy mapped radially: bass at the core, treble at the edges.
  float energy = mix(uBass, mix(uMid, uTreble, smoothstep(0.4, 1.0, r)), smoothstep(0.0, 0.5, r));

  // Outgoing rings whose spacing breathes with the beat.
  float rings = sin(r * (24.0 + uBeat * 20.0) - uTime * 4.0);
  rings = smoothstep(0.0, 0.6, abs(rings));
  rings = 1.0 - rings;

  // Angular petals add structure to the rings.
  float petals = 0.5 + 0.5 * sin(a * (8.0 + floor(uMid * 10.0)) + uTime);

  float glow = rings * (0.3 + 1.4 * energy) * (0.5 + 0.7 * petals);
  float hue = fract(0.55 + r * 0.5 - uTime * 0.05 + energy * 0.4);
  vec3 col = hsv2rgb(vec3(hue, 0.8, glow));
  col += energy * uBeat * vec3(0.6, 0.8, 1.0) * (1.0 - r);
  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 5: Cellule (animated voronoi) -------------------------------
const FRAG_CELLS = FRAG_HEADER + `
vec2 cellPoint(vec2 ip, float t) {
  // A wandering feature point inside cell ip.
  vec2 o = vec2(hash(ip), hash(ip + 3.7));
  return 0.5 + 0.45 * sin(t * (0.4 + o * 0.8) + o * 6.283);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float scale = 4.0 - uBass * 1.5;        // cells swell on the bass
  vec2 p = uv * scale + 8.0;
  vec2 ip = floor(p), fp = fract(p);

  float d1 = 8.0, d2 = 8.0;               // nearest + second-nearest
  vec2 nearId = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 pt = g + cellPoint(ip + g, uTime * (0.6 + uMid));
      float d = length(pt - fp);
      if (d < d1) { d2 = d1; d1 = d; nearId = ip + g; }
      else if (d < d2) { d2 = d; }
    }
  }

  float edge = smoothstep(0.0, 0.08 + uTreble * 0.05, d2 - d1); // bright borders
  float cellHue = fract(hash(nearId) + uTime * 0.03 + uMid * 0.2);
  vec3 base = hsv2rgb(vec3(cellHue, 0.7, 0.25 + 0.6 * (1.0 - d1)));
  vec3 col = base * (0.4 + 0.6 * edge);
  col += (1.0 - edge) * uBeat * 0.5 * vec3(1.0, 0.9, 0.7);
  col *= 0.7 + 0.6 * uLevel;
  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 6: Iperspazio (starfield warp) ------------------------------
const FRAG_HYPER = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = vec3(0.0);
  float warp = 0.4 + uBass * 2.2;          // travel speed pulses with the bass

  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    float ang = hash(vec2(fi, 1.0)) * 6.2831853;
    float spd = 0.25 + hash(vec2(fi, 2.0)) * 0.9;
    float z = fract(hash(vec2(fi, 3.0)) + uTime * spd * warp);
    float rad = z * z * 1.6;               // accelerate outward
    vec2 pos = vec2(cos(ang), sin(ang)) * rad;
    float d = length(uv - pos);
    // Stretch the star into a streak along its travel direction.
    float streak = smoothstep(0.06 * z + 0.004, 0.0, d) * z;
    float hue = fract(0.6 + hash(vec2(fi, 4.0)) * 0.3 + uTreble * 0.3);
    col += hsv2rgb(vec3(hue, 0.5 + 0.5 * uMid, 1.0)) * streak;
  }
  col *= 0.7 + 0.8 * uLevel;
  col += uBeat * 0.15;
  fragColor = vec4(col, 1.0);
}
`;

// ---- Scene 7: Specchi (kaleidoscope plasma) ----------------------------
const FRAG_MIRRORS = FRAG_HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // Fold space into a reactive number of mirrored wedges.
  float seg = 4.0 + 2.0 * floor(1.0 + uMid * 5.0);
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  a = mod(a, 6.2831853 / seg);
  a = abs(a - 3.1415926 / seg);
  vec2 muv = vec2(cos(a), sin(a)) * r;

  // Plasma inside the wedge, scrolling with the beat.
  float t = uTime * (0.2 + uBass * 0.5);
  vec2 q = vec2(fbm(muv * 2.5 + t), fbm(muv * 2.5 - t + 4.0));
  float f = fbm(muv * 3.0 + 2.0 * q + uBeat);

  float hue = fract(0.5 + f * 0.6 + r * 0.4 + uTime * 0.03);
  vec3 col = hsv2rgb(vec3(hue, 0.8 + 0.2 * uTreble, 0.2 + 1.1 * f * (0.5 + uLevel)));
  col += pow(length(q), 2.5) * vec3(0.9, 0.95, 1.0) * (0.4 + uBeat);
  fragColor = vec4(col, 1.0);
}
`;

window.SHADERS = {
  vert: VERT,
  names: ['Frattale', 'Plasma', 'Tunnel', 'Vortice', 'Onde', 'Cellule', 'Iperspazio', 'Specchi'],
  scenes: [FRAG_FRACTAL, FRAG_PLASMA, FRAG_TUNNEL, FRAG_VORTEX, FRAG_WAVES, FRAG_CELLS, FRAG_HYPER, FRAG_MIRRORS]
};
