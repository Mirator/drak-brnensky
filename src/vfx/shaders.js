/**
 * Shared GLSL for the VFX stack.
 *
 * Everything here is procedural — no sampled noise textures, no sprite
 * sheets from disk. The chunks are concatenated into the per-system
 * shaders in this directory; keep them dependency-free and side-effect
 * free so they can be pasted in any order after the uniform block.
 */

/* ------------------------------------------------------------------ */
/* hashing + noise                                                     */
/* ------------------------------------------------------------------ */
export const GLSL_NOISE = /* glsl */ `
float vfxHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float vfxHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vfxHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
/* value noise, 3D, smoothstep interpolation */
float vfxNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = vfxHash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = vfxHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = vfxHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = vfxHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = vfxHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = vfxHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = vfxHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = vfxHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
float vfxFbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vfxNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s * 1.0666;
}
float vfxFbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * vfxNoise(p);
    p *= 2.11;
    a *= 0.5;
  }
  return s * 1.1428;
}
/* ridged turbulence — the "torn"/"burning" look. Use the 3-octave variant
   in anything that fills a lot of screen (flame, fireballs, the rift
   column): 4 octaves is ~32 hashes per fragment and this stack is
   fill-bound, not vertex-bound. */
float vfxRidge3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * (1.0 - abs(vfxNoise(p) * 2.0 - 1.0));
    p *= 2.11;
    a *= 0.5;
  }
  return s * 1.1428;
}
float vfxRidge(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * (1.0 - abs(vfxNoise(p) * 2.0 - 1.0));
    p *= 2.07;
    a *= 0.5;
  }
  return s * 1.0666;
}
/* cheap divergence-free-ish swirl used to advect flame and smoke */
vec3 vfxCurl(vec3 p, float t) {
  float a = vfxNoise(p * 0.7 + vec3(0.0, t * 0.6, 0.0));
  float b = vfxNoise(p * 0.7 + vec3(5.2, t * 0.6, 1.3));
  float c = vfxNoise(p * 0.7 + vec3(1.7, t * 0.6, 9.2));
  return vec3(b - c, c - a, a - b) * 2.0;
}
`;

/* ------------------------------------------------------------------ */
/* shared uniform block + soft-particle depth fade                     */
/* ------------------------------------------------------------------ */
export const GLSL_SHARED_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec2 uInvRes;     // 1 / size of the render target being drawn into
uniform float uNear;
uniform sampler2D uDepth; // LINEAR VIEW DISTANCE IN METRES in .x — not raw depth
uniform float uSoft;      // 1 only while the depth pass is actually running
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbCol;
`;

/**
 * Soft particles. Without this every smoke puff shows a hard intersection
 * line where the quad cuts the cobbles — the single biggest tell that a
 * particle system is cheap. `fragViewZ` is positive distance along the
 * view axis; `softness` is the fade distance in metres.
 *
 * The depth source is `src/render/depth.js` (LinearDepthPass), which stores
 * **positive linear view distance in metres** in `.x` of a half-float RGBA
 * target. So this does no un-projection and needs no far plane: the sample
 * and `fragViewZ` are already in the same units and can be subtracted
 * directly. Do not feed this raw [0,1] hardware depth.
 *
 * Degrades safely: that pass self-disables when nothing else reads it, so a
 * blank (never-rendered, zero-filled) target is a normal state, not an
 * error. A sample of zero means "no depth information" and must NOT be read
 * as "geometry at zero metres" — that would fade every particle to nothing
 * and look like the effects had vanished. NaN fails the same test, because
 * every comparison against NaN is false.
 *
 * Also fades out against the near plane so puffs do not clip open when the
 * camera walks into them; that part works with or without depth.
 */
export const GLSL_SOFT = /* glsl */ `
float vfxSceneZ(vec2 uv) {
  return texture2D(uDepth, uv).x;   // already linear metres
}
bool vfxHasDepth(float sceneZ) {
  return sceneZ > 0.001 && sceneZ < 1.0e7;
}
float vfxSoftFade(float fragViewZ, float softness) {
  float nearFade = clamp((fragViewZ - uNear * 4.0) / 1.2, 0.0, 1.0);
  if (uSoft < 0.5) return nearFade;
  float sceneZ = vfxSceneZ(gl_FragCoord.xy * uInvRes);
  if (!vfxHasDepth(sceneZ)) return nearFade;
  float f = clamp((sceneZ - fragViewZ) / max(0.05, softness), 0.0, 1.0);
  return f * nearFade;
}
`;

/* ------------------------------------------------------------------ */
/* atlas tiles                                                          */
/* ------------------------------------------------------------------ */
export const GLSL_ATLAS = /* glsl */ `
uniform sampler2D uAtlas;
/* 4x4 atlas; tile counts left-to-right, top-to-bottom. Inset slightly so
   bilinear filtering cannot bleed in the neighbouring tile. */
vec2 vfxTileUv(vec2 uv, float tile) {
  float t = floor(tile + 0.5);
  float col = mod(t, 4.0);
  float row = floor(t / 4.0);
  vec2 local = clamp(uv, 0.002, 0.998) * 0.25;
  return vec2(local.x + col * 0.25, 1.0 - 0.25 - row * 0.25 + local.y);
}
`;

/* ------------------------------------------------------------------ */
/* colour                                                              */
/* ------------------------------------------------------------------ */
export const GLSL_FIRE = /* glsl */ `
/* Blackbody-ish fire ramp. h = 1 white hot core, 0 = cold soot.
   Values deliberately exceed 1.0 in the core so the HDR bloom pass has
   something to work with — brightness comes from intensity, not from
   washing the sprite out to white. */
vec3 vfxFireRamp(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 soot = vec3(0.055, 0.045, 0.042);
  vec3 dark = vec3(0.42, 0.10, 0.03);
  vec3 red = vec3(1.35, 0.30, 0.055);
  vec3 orange = vec3(2.60, 1.00, 0.20);
  vec3 yellow = vec3(4.20, 2.60, 0.80);
  vec3 white = vec3(6.50, 5.20, 3.60);
  vec3 c = mix(soot, dark, smoothstep(0.0, 0.22, h));
  c = mix(c, red, smoothstep(0.18, 0.42, h));
  c = mix(c, orange, smoothstep(0.38, 0.62, h));
  c = mix(c, yellow, smoothstep(0.58, 0.82, h));
  c = mix(c, white, smoothstep(0.80, 1.0, h));
  return c;
}
`;

/**
 * Screen-facing billboard with optional velocity stretch, shared by every
 * quad-based system. Expects `position.xy` in -0.5..0.5 (a PlaneGeometry).
 */
export const GLSL_BILLBOARD = /* glsl */ `
/* Rotate a quad corner and offset it in view space. viewVel is the
   view-space velocity; when stretch > 0 the quad elongates along its
   screen projection, which is what makes a spark read as motion rather
   than as a dot. */
vec3 vfxBillboard(vec3 viewCentre, vec2 corner, float size, float angle, vec3 viewVel, float stretch) {
  float s = sin(angle), c = cos(angle);
  vec2 q = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 offs = q * size;
  if (stretch > 0.0) {
    vec2 dir = viewVel.xy;
    float len = length(dir);
    if (len > 0.0001) {
      dir /= len;
      vec2 perp = vec2(-dir.y, dir.x);
      float along = size + stretch * len;
      offs = dir * (corner.y * along) + perp * (corner.x * size);
    }
  }
  return viewCentre + vec3(offs, 0.0);
}
`;

/**
 * Analytic ballistic integration with linear drag, evaluated at time t.
 * The CPU never touches a live particle: launch state in, world position
 * out, entirely in the vertex shader.
 *
 *   dv/dt = -drag * v + g   =>   v(t) = (v0 - g/d) e^(-dt) + g/d
 *   p(t) = p0 + (v0 - g/d)(1 - e^(-dt))/d + (g/d) t
 *
 * `grav` keeps the legacy vfx.js scaling (grav * 9 m/s²) so every existing
 * call site keeps its tuning.
 */
export const GLSL_BALLISTIC = /* glsl */ `
struct VfxState { vec3 pos; vec3 vel; };
VfxState vfxIntegrate(vec3 p0, vec3 v0, float drag, float grav, float ground, float t) {
  float d = max(drag, 0.0001);
  vec3 term = vec3(0.0, grav * 9.0 / d, 0.0);
  float e = 1.0 - exp(-d * t);
  VfxState s;
  s.pos = p0 + (v0 - term) * (e / d) + term * t;
  s.vel = (v0 - term) * (1.0 - e) + term;
  /* Damped mirror bounce off the local ground height — a real bounce needs
     state we do not keep, but mirroring the trajectory and letting it decay
     with depth gives one convincing hop and then settles flat. */
  float rel = s.pos.y - ground;
  if (rel < 0.0) {
    float below = -rel;
    s.pos.y = ground + below * 0.3 * exp(-1.6 * below);
    s.vel.y = -s.vel.y * 0.3 * exp(-1.6 * below);
  }
  return s;
}
`;
