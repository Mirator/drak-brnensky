import * as THREE from 'three';

/* ==================================================================
   shaders.js — the hand-written passes
   ==================================================================

   Everything here is a plain `ShaderPass`-compatible shader definition
   so postfx.js can wrap them with the stock `ShaderPass`.

   These are written in the ES 1.00 dialect — `texture2D`, `gl_FragColor`,
   no dynamic loop bounds — because that is the spelling three's own chunks
   use and it keeps these passes consistent with them. The shader that
   reaches the driver is ES 3.00 either way (r185 always emits
   `#version 300 es` and a compatibility prologue that defines `texture2D`
   as `texture`), so ES 3.00 built-ins are available where they earn their
   keep: see `fetch()` below.

   Sampling
   --------
   Every texture these passes read is a non-mipmapped render target, so all
   of it goes through `fetch()`, which is `textureLod( ..., 0.0 )`.

   That is not a micro-optimisation. A plain `texture2D` is a *gradient*
   instruction: the driver computes derivatives to pick a mip level that
   cannot exist here. Inside a marching loop the D3D backend cannot prove
   the derivatives are well defined and warns for every such call
   ("X3595: gradient instruction used in a loop with varying iteration"),
   and on the loops here it also has to keep the derivative maths. Asking
   for LOD 0 explicitly says what we mean, is what the sampler would have
   clamped to anyway, and leaves the log clean.

   The depth-consuming passes read metres from LinearDepthPass rather than
   sampling a depth buffer directly — see render/depth.js for both reasons
   (feedback loops, and the fact that with near = 0.12 / far = 2400 every
   raw depth value in the scene sits in the top ~0.1% of the [0,1] range).
   ================================================================== */

const LUMA = 'const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );';

/**
 * The only texture read in this file. Explicit LOD 0 — see the header.
 */
const FETCH = /* glsl */`
vec4 fetch( sampler2D tex, vec2 uv ) {
  return textureLod( tex, uv, 0.0 );
}`;

/**
 * Depth comes from LinearDepthPass (see render/depth.js): already
 * linearised to metres, and in a texture that is never a render target of
 * any other pass — sampling the scene buffer's own depth attachment would
 * be a feedback loop, because the composer's buffers ping-pong.
 */
const LINEAR_DEPTH = /* glsl */`
float linearDistance( sampler2D depthTex, vec2 uv ) {
  return fetch( depthTex, uv ).x;
}`;

const HASH = /* glsl */`
float hash12( vec2 p ) {
  return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}`;

/* ------------------------------------------------------------------ */
/* god rays / light shafts                                            */
/* ------------------------------------------------------------------ */

/**
 * Screen-space radial light shafts.
 *
 * Masked two ways so the shafts only come from actual sky near the sun:
 * by distance (nothing closer than ~300 m emits) and by luminance (the
 * sample has to be bright). That combination is what keeps street lamps
 * and lit windows from smearing rays across the frame, and it does not
 * depend on knowing the sky dome's exact distance.
 */
export const GodRaysShader = {
  name: 'GodRaysShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uSunPos: { value: new THREE.Vector2(0.5, 0.7) },
    uSunColor: { value: new THREE.Color(0xffc890) },
    uIntensity: { value: 0.0 },
    uDensity: { value: 0.78 },
    uDecay: { value: 0.955 },
    uWeight: { value: 1.35 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uSunPos;
    uniform vec3 uSunColor;
    uniform float uIntensity;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uWeight;
    varying vec2 vUv;

    ${LUMA}
    ${HASH}
    ${FETCH}
    ${LINEAR_DEPTH}

    const int SAMPLES = 16;

    void main() {
      vec4 base = fetch( tDiffuse, vUv );

      if ( uIntensity <= 0.0005 ) {
        gl_FragColor = base;
        return;
      }

      vec2 delta = ( uSunPos - vUv ) * ( uDensity / float( SAMPLES ) );
      // jitter the march start, otherwise 16 steps show as concentric rings
      vec2 uv = vUv + delta * hash12( vUv * 731.0 );
      float illum = 1.0;
      float acc = 0.0;

      for ( int i = 0; i < SAMPLES; i ++ ) {
        uv += delta;
        vec2 c = clamp( uv, vec2( 0.0 ), vec2( 1.0 ) );
        float dist = linearDistance( tDepth, c );
        float farMask = smoothstep( 300.0, 800.0, dist );
        float lum = dot( fetch( tDiffuse, c ).rgb, LUMA );
        float brightMask = smoothstep( 0.30, 1.30, lum );
        acc += farMask * brightMask * illum;
        illum *= uDecay;
      }

      acc *= uWeight / float( SAMPLES );

      // keep the lift local to the sun rather than washing the whole frame
      float r = length( vUv - uSunPos );
      float falloff = exp( - r * 1.75 );

      gl_FragColor = vec4( base.rgb + uSunColor * acc * falloff * uIntensity, base.a );
    }`,
};

/* ------------------------------------------------------------------ */
/* depth of field                                                     */
/* ------------------------------------------------------------------ */

/**
 * Depth-based DOF, 16-tap golden-angle disc.
 *
 * Deliberately shallow: `uMaxCoC` is in pixels at 900p and the mix is
 * capped, because a strong circle of confusion on a third-person camera
 * at 5 m reads as a tilt-shift toy set, not as a rifle sight. Taps that
 * are sharper than the centre are down-weighted so a crisp foreground
 * does not bleed onto a blurred background.
 */
export const DofShader = {
  name: 'DofShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    uFocus: { value: 20 },
    uRange: { value: 9 },
    uMaxCoC: { value: 7 },
    uAmount: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uFocus;
    uniform float uRange;
    uniform float uMaxCoC;
    uniform float uAmount;
    varying vec2 vUv;

    ${FETCH}
    ${LINEAR_DEPTH}

    const int TAPS = 16;
    const float GOLDEN = 2.39996323;

    float cocAt( float dist ) {
      float s = abs( dist - uFocus ) / max( uRange, 0.001 );
      // the near field gets less blur than the far field
      float k = dist < uFocus ? 0.65 : 1.0;
      return clamp( s * k, 0.0, 1.0 );
    }

    void main() {
      vec4 base = fetch( tDiffuse, vUv );

      if ( uAmount <= 0.001 ) {
        gl_FragColor = base;
        return;
      }

      float centreDist = linearDistance( tDepth, vUv );
      float c = cocAt( centreDist ) * uAmount;

      if ( c < 0.02 ) {
        gl_FragColor = base;
        return;
      }

      float radius = c * uMaxCoC;
      vec3 sum = base.rgb;
      float wsum = 1.0;

      for ( int i = 0; i < TAPS; i ++ ) {
        float fi = float( i ) + 0.5;
        float ang = fi * GOLDEN;
        float r = sqrt( fi / float( TAPS ) ) * radius;
        vec2 uv = clamp( vUv + vec2( cos( ang ), sin( ang ) ) * r * uTexel, vec2( 0.0 ), vec2( 1.0 ) );

        float dTap = linearDistance( tDepth, uv );
        float w = dTap > centreDist ? 1.0 : clamp( cocAt( dTap ) * uAmount / max( c, 1e-3 ), 0.0, 1.0 );

        sum += fetch( tDiffuse, uv ).rgb * w;
        wsum += w;
      }

      vec3 blurred = sum / wsum;
      gl_FragColor = vec4( mix( base.rgb, blurred, clamp( c * 1.35, 0.0, 1.0 ) ), base.a );
    }`,
};

/* ------------------------------------------------------------------ */
/* colour grade                                                       */
/* ------------------------------------------------------------------ */

/**
 * The grade. Runs after OutputPass, so this is display-referred sRGB —
 * which is where lift/gamma/gain and split toning belong.
 *
 * The split toning is luminance-preserving (the tints are normalised by
 * their own luma before being multiplied in), so pushing blue into the
 * shadows cools them instead of just brightening them. That, plus the
 * shadow lift, is what stops the image being "brown and orange".
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    /* Lift halved and the contrast raised after the first real captures:
     * post-street-masarykova and post-petrov-front had no true blacks at
     * all. Most of that was fog density, but a 0.030 blue lift on top of it
     * meant even fully shadowed geometry sat well off zero. Pivot dropped
     * to 0.40 so more of the frame falls on the darkening side of the
     * S-curve. */
    uLift: { value: new THREE.Vector3(0.004, 0.008, 0.020) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.02) },
    uGain: { value: new THREE.Vector3(1.045, 1.005, 0.965) },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.22 },
    uPivot: { value: 0.40 },
    uShadowTint: { value: new THREE.Color(0x4d74c8) },
    uHighlightTint: { value: new THREE.Color(0xffd7a8) },
    uShadowWeight: { value: 0.22 },
    uHighlightWeight: { value: 0.16 },
    uVignette: { value: 0.30 },
    uVignetteRadius: { value: 0.55 },
    uAberration: { value: 0.9 },
    uKnee: { value: 0.92 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uPivot;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uShadowWeight;
    uniform float uHighlightWeight;
    uniform float uVignette;
    uniform float uVignetteRadius;
    uniform float uAberration;
    uniform float uKnee;
    varying vec2 vUv;

    ${LUMA}
    ${FETCH}

    void main() {
      vec2 dir = vUv - 0.5;
      float r2 = dot( dir, dir );

      /* --- lateral chromatic aberration: zero at the centre, r^2 to the
             corners. About 1.5 px at the corners of a 1600-wide frame. --- */
      vec2 ca = dir * r2 * uAberration * 0.004;
      vec3 col;
      col.r = fetch( tDiffuse, clamp( vUv - ca, vec2( 0.0 ), vec2( 1.0 ) ) ).r;
      col.g = fetch( tDiffuse, vUv ).g;
      col.b = fetch( tDiffuse, clamp( vUv + ca, vec2( 0.0 ), vec2( 1.0 ) ) ).b;
      col = max( col, 0.0 );

      /* --- lift / gamma / gain --- */
      col = pow( max( col * uGain + uLift, 0.0 ), vec3( 1.0 ) / max( uGamma, vec3( 0.01 ) ) );

      /* --- filmic S-curve: linear contrast around the pivot, blended with a
             smoothstep for the toe.
             lin deliberately keeps its headroom above 1.0 — clamping it
             here is what used to flatten the whole top of the range into
             pure white. The shoulder at the end rolls it off instead.
             soft still has to be clamped: x*x*(3-2x) turns over above 1
             and would make the curve non-monotonic. --- */
      vec3 cs = clamp( col, 0.0, 1.0 );
      vec3 lin = ( col - uPivot ) * uContrast + uPivot;
      vec3 soft = cs * cs * ( 3.0 - 2.0 * cs );
      col = max( mix( lin, soft, 0.24 ), 0.0 );

      /* --- saturation --- */
      float lum = dot( col, LUMA );
      col = mix( vec3( lum ), col, uSaturation );

      /* --- split toning, luminance preserving --- */
      vec3 st = uShadowTint / max( dot( uShadowTint, LUMA ), 1e-3 );
      vec3 ht = uHighlightTint / max( dot( uHighlightTint, LUMA ), 1e-3 );
      lum = dot( col, LUMA );
      float sw = uShadowWeight * ( 1.0 - lum ) * ( 1.0 - lum );
      float hw = uHighlightWeight * lum * lum;
      col *= mix( vec3( 1.0 ), st, sw );
      col *= mix( vec3( 1.0 ), ht, hw );

      /* --- highlight shoulder. Last stage that can exceed 1.0, so it catches
             the contrast line, the saturation boost and the split tone.
             Everything above uKnee is compressed and asymptotes to 1.0
             rather than clipping, and the derivative is 1 exactly where it
             takes over, so there is no visible kink.

             This is what keeps hot emissives readable: the VFX fire core and
             rift rim peak around 6.5 linear, which lands near 0.96 display
             after AgX — the contrast above then pushed it past 1.0 and the
             old clamp() made it the same flat white as the sun. Now the sun
             resolves around 0.99 and the fire core around 0.97, so they stay
             distinct and both keep their hue. --- */
      vec3 over = max( col - uKnee, 0.0 );
      col = min( col, uKnee ) + over / ( 1.0 + over / max( 1.0 - uKnee, 1e-3 ) );

      /* --- vignette --- */
      float d = length( dir ) * 1.41421;
      col *= 1.0 - uVignette * smoothstep( uVignetteRadius, 1.05, d );

      gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
    }`,
};

/* ------------------------------------------------------------------ */
/* contrast-adaptive sharpen + grain                                  */
/* ------------------------------------------------------------------ */

/**
 * The last colour stage. SMAA (and TAA accumulation) leave the image
 * soft; this is what puts the crispness back into roof lines and cobble
 * detail, which is most of what makes a still read as "next-gen".
 *
 * `amp` is the contrast-adaptive term: sharpening is scaled back where
 * the local neighbourhood is already near black or near white, so it
 * cannot ring against the sky or crush shadow detail.
 *
 * The grain is added *after* sharpening on purpose — sharpening grain
 * turns it into salt and pepper.
 */
export const SharpenShader = {
  name: 'SharpenShader',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    uAmount: { value: 0.45 },
    uGrain: { value: 0.024 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uAmount;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;

    ${LUMA}
    ${HASH}
    ${FETCH}

    void main() {
      vec3 c = fetch( tDiffuse, vUv ).rgb;
      vec3 n = fetch( tDiffuse, vUv + vec2( 0.0, -uTexel.y ) ).rgb;
      vec3 s = fetch( tDiffuse, vUv + vec2( 0.0,  uTexel.y ) ).rgb;
      vec3 w = fetch( tDiffuse, vUv + vec2( -uTexel.x, 0.0 ) ).rgb;
      vec3 e = fetch( tDiffuse, vUv + vec2(  uTexel.x, 0.0 ) ).rgb;

      vec3 mn = min( c, min( min( n, s ), min( w, e ) ) );
      vec3 mx = max( c, max( max( n, s ), max( w, e ) ) );

      vec3 amp = sqrt( clamp( min( mn, 1.0 - mx ) / max( mx, vec3( 1e-4 ) ), 0.0, 1.0 ) );
      vec3 sharp = c + ( c * 4.0 - ( n + s + w + e ) ) * ( uAmount * 0.25 ) * amp;
      vec3 col = clamp( sharp, mn * 0.85, mx * 1.15 );

      /* animated film grain, heavier in the shadows where real grain lives */
      if ( uGrain > 0.0001 ) {
        float g = hash12( vUv * 1024.0 + vec2( uTime * 37.13, uTime * 21.71 ) ) - 0.5;
        float lum = dot( col, LUMA );
        col += g * uGrain * ( 0.30 + 0.70 * ( 1.0 - lum ) );
      }

      gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
    }`,
};
