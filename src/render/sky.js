import * as THREE from 'three';

/* ==================================================================
   sky.js — dusk sky dome + aerial perspective (height fog)
   ==================================================================

   Two things live here:

   1. `createSky()` — the sky dome shader. Same dusk identity as before
      (warm low sun, cool zenith, stars) but with a Rayleigh/Mie-ish
      gradient, a soft-limbed sun disc, a dithered horizon band, round
      twinkling stars and three slow cloud layers. It now renders into
      the composer's HDR buffer, so the sun disc is a real HDR value
      (~9.0) that the bloom and the tone mapper get to shape instead of
      a flat clipped white blob.

   2. `installAerialPerspective()` — a patch of three's built-in fog
      shader chunks that turns `FogExp2` into height-attenuated,
      sun-direction-aware aerial perspective. This is done as a *module
      side effect* (see the call at the bottom of this file) because
      three bakes `UniformsLib.fog` into every material at construction
      time: the patch has to be in place before the first material in
      the app is created. `src/render/sky.js` is therefore imported
      first in main.js.

      The sun direction / haze colours are constants (the sun never
      moves in this game), which is what makes the "set the uniform
      defaults once" approach safe.
   ================================================================== */

/** Direction *towards* the sun. Kept here so lighting/postfx agree. */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.34, -0.76).normalize();

/* ------------------------------------------------------------------ */
/* aerial perspective                                                 */
/* ------------------------------------------------------------------ */

/* Tuned against shots/post-street-masarykova.png and post-petrov-front.png,
 * the first captures that went through the real stack.
 *
 * Both were milky: density 0.0034 put visible haze on cobbles 30 m away, and
 * sunPower 3.2 is a very wide lobe — `pow(cos, 3.2)` is still ~0.35 at 45°
 * off-sun, so at strength 0.9 more than half the frame was being dragged
 * towards the warm tint. That reads as a pink wash over everything rather
 * than as aerial perspective.
 *
 * Now: about half the density, a much tighter sun lobe at lower strength,
 * and a shorter scale height so the haze sits in the streets and lets the
 * skyline and Špilberk rise out of it — which is the depth cue the fog is
 * actually there to provide. */
export const AERIAL = {
  /** Extinction per metre at `baseY`. */
  density: 0.0018,
  /** Haze scale height: density falls as exp(-falloff * (y - baseY)). */
  heightFalloff: 1 / 34,
  baseY: 0,
  /** Base haze colour (also `scene.fog.color`). */
  color: new THREE.Color(0x2e3242),
  /** Haze colour looking into the sun. */
  sunColor: new THREE.Color(0xffb379),
  /** Haze colour looking up (keeps distant roofs from going brown). */
  upColor: new THREE.Color(0x3b4363),
  /** How tightly the sun tint hugs the sun direction. Higher = tighter. */
  sunPower: 7.0,
  sunStrength: 0.55,
};

let aerialInstalled = false;
let aerialRevision = 0;

/**
 * Formats a JS number as a GLSL float literal. Everything baked into the
 * chunks goes through this — a bare `0` or `1` is an *int* in GLSL and will
 * not compile inside a float expression.
 */
function glslFloat(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error(`aerial perspective: ${n} is not a finite number`);
  let s = v.toFixed(8).replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return s;
}

/**
 * Bakes a Color or a Vector3 as a GLSL vec3 literal.
 *
 * Colors carry r/g/b and Vector3 carries x/y/z, so this has to branch —
 * reading the wrong triplet yields `undefined`, which glslFloat() throws on
 * rather than letting `vec3( undefined, ... )` reach the compiler.
 *
 * Color components are already linear-sRGB (three converts on setHex with
 * ColorManagement enabled), which is the same space `fogColor` arrives in,
 * so the baked tints and the uniform are directly comparable.
 */
const glslVec3 = (v) => {
  const [a, b, c] = v.isColor ? [v.r, v.g, v.b] : [v.x, v.y, v.z];
  return `vec3( ${glslFloat(a)}, ${glslFloat(b)}, ${glslFloat(c)} )`;
};

/**
 * Builds the four fog chunks with the AERIAL settings baked in as GLSL
 * constants.
 *
 * WHY CONSTANTS AND NOT UNIFORMS — this was the bug that turned the whole
 * composited frame black, so it is worth spelling out.
 *
 * three builds `ShaderLib.<id>.uniforms` by calling
 * `mergeUniforms([ ..., UniformsLib.fog ])` at *three's own module-evaluation
 * time*, and mergeUniforms deep-clones. `WebGLRenderer` then clones per
 * material from that snapshot. So adding keys to `UniformsLib.fog`
 * afterwards — the only time we could, since three is imported before us —
 * reaches exactly zero materials. This chunk used to declare seven uniforms
 * that nothing ever uploaded; they all defaulted to 0, and
 * `pow( fogSunAmt, fogSunPower )` became `pow( 0.0, 0.0 )`, which GLSL
 * leaves undefined and which is NaN on any hardware evaluating it as
 * `exp2( y * log2( x ) )`.
 *
 * That NaN explained the direct-vs-composer split precisely. Rendering
 * straight to the canvas applies in-material tone mapping and AgX ends in
 * `clamp( color, 0.0, 1.0 )`, which launders NaN into something visible.
 * Rendering into a render target uses `NoToneMapping`, so raw NaN landed in
 * the HDR buffer and poisoned every downstream pass — which is also why
 * disabling any single pass changed nothing.
 *
 * Baking removes the failure mode outright: no uniform is left to go
 * missing, and `fog_pars_fragment` now declares only the uniforms three
 * genuinely provides. The cost is that retuning needs a recompile, which is
 * what `configureAerialPerspective()` handles — a fair trade, since the sun
 * never moves in this game and these are compile-time constants in fact as
 * well as in principle.
 */
function buildFogChunks() {
  const f = glslFloat;
  const C = {};

  /* world position varying. GLSL ES 1.00 has no inverse(), but viewMatrix
   * is rigid, so worldPos = Rᵀ·viewPos + cameraPosition. */
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG

	varying float vFogDepth;
	varying vec3 vFogWorldPos;

#endif
`;

  C.fog_vertex = /* glsl */`
#ifdef USE_FOG

	vFogDepth = - mvPosition.z;
	{
		// NOTE: no mat3( mat4 ) and no inverse() — neither is legal in
		// GLSL ES 1.00, which is what three compiles built-in materials as.
		vec3 fogVP = mvPosition.xyz;
		vFogWorldPos = cameraPosition + vec3(
			dot( viewMatrix[ 0 ].xyz, fogVP ),
			dot( viewMatrix[ 1 ].xyz, fogVP ),
			dot( viewMatrix[ 2 ].xyz, fogVP )
		);
	}

#endif
`;

  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

	/* Baked, NOT uniforms — see buildFogChunks(). Only fogColor and
	 * fogDensity/fogNear/fogFar above are real uniforms, because those are
	 * the only ones three actually provides and uploads. */
	const vec3 FOG_SUN_DIR = ${glslVec3(SUN_DIR)};
	const vec3 FOG_SUN_COLOR = ${glslVec3(AERIAL.sunColor)};
	const vec3 FOG_UP_COLOR = ${glslVec3(AERIAL.upColor)};
	const float FOG_HEIGHT_FALLOFF = ${f(AERIAL.heightFalloff)};
	const float FOG_BASE_Y = ${f(AERIAL.baseY)};
	const float FOG_SUN_POWER = ${f(AERIAL.sunPower)};
	const float FOG_SUN_STRENGTH = ${f(AERIAL.sunStrength)};

#endif
`;

  /* Analytic exponential-height fog:
   *   ∫₀ᴰ ρ₀·exp(-k·h(t)) dt  with h linear from the eye to the fragment
   *   = ρ₀·D·(exp(-k·h₀) - exp(-k·h₁)) / (k·(h₁-h₀))
   * The result is optical depth, turned into coverage by 1-exp(-τ).
   * A tiny screen-space dither kills the gradient banding that a plain
   * exponential shows on a 8-bit-ish display. */
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogH0 = vFogWorldPos.y - FOG_BASE_Y;
		float fogH1 = cameraPosition.y - FOG_BASE_Y;
		float fogK = max( FOG_HEIGHT_FALLOFF, 1e-5 );
		float fogDH = fogH0 - fogH1;
		float fogTau;
		if ( abs( fogDH ) > 0.02 ) {
			fogTau = fogDensity * vFogDepth * ( exp( - fogK * fogH1 ) - exp( - fogK * fogH0 ) ) / ( fogK * fogDH );
		} else {
			fogTau = fogDensity * vFogDepth * exp( - fogK * fogH1 );
		}
		float fogFactor = 1.0 - exp( - max( fogTau, 0.0 ) );

		vec3 fogRay = normalize( vFogWorldPos - cameraPosition );
		/* The base is clamped off zero on purpose: pow( 0.0, 0.0 ) is
		 * undefined in GLSL and NaN on most hardware, and a NaN here
		 * propagates through the entire HDR buffer and every pass after it.
		 * FOG_SUN_POWER is a literal now, so this can only bite if someone
		 * retunes sunPower to 0 — cheap insurance against that. */
		float fogSunAmt = max( dot( fogRay, FOG_SUN_DIR ), 1e-5 );
		vec3 fogTint = mix( fogColor, FOG_SUN_COLOR, pow( fogSunAmt, FOG_SUN_POWER ) * FOG_SUN_STRENGTH );
		fogTint = mix( fogTint, FOG_UP_COLOR, clamp( fogRay.y * 1.7, 0.0, 1.0 ) * 0.65 );

		float fogDither = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
		fogFactor = clamp( fogFactor + fogDither * 0.006, 0.0, 1.0 );

		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

	#endif

#endif
`;

  return C;
}

/** Writes the generated chunks into three's ShaderChunk registry. */
function writeFogChunks() {
  Object.assign(THREE.ShaderChunk, buildFogChunks());
}

/**
 * Patches three's fog chunks in place. Idempotent. Must run before any
 * material is constructed — it is called at the bottom of this module.
 */
export function installAerialPerspective() {
  if (aerialInstalled) return;
  aerialInstalled = true;
  writeFogChunks();
}

/**
 * The uniforms three itself declares in the fog chunks and uploads every
 * frame. Anything else the chunk references must be baked as a constant —
 * see buildFogChunks(). Exported so the invariant can be checked headlessly.
 */
export const PROVIDED_FOG_UNIFORMS = ['fogColor', 'fogDensity', 'fogNear', 'fogFar'];

/**
 * Live re-tune. Regenerates the chunks and forces the affected materials to
 * recompile.
 *
 * The revision define is load-bearing: three's program cache is keyed on
 * material parameters and defines, *not* on chunk contents, so
 * `needsUpdate` on its own would hand back the previously cached program
 * built from the old chunk text. Bumping a define changes the cache key.
 *
 * Recompiles every fog material, so this is a settings-time call, never
 * per frame.
 */
export function configureAerialPerspective(scene, opts = {}) {
  Object.assign(AERIAL, opts);
  if (opts.color) AERIAL.color = new THREE.Color(opts.color);
  if (opts.sunColor) AERIAL.sunColor = new THREE.Color(opts.sunColor);
  if (opts.upColor) AERIAL.upColor = new THREE.Color(opts.upColor);

  /* density and base colour stay real uniforms: three uploads them from the
   * fog object every frame, so changing those two needs no recompile. */
  if (scene && scene.fog) {
    scene.fog.color.copy(AERIAL.color);
    scene.fog.density = AERIAL.density;
  }

  writeFogChunks();
  aerialRevision++;

  if (!scene) return;
  const seen = new Set();
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || seen.has(m) || m.fog !== true) continue;
      seen.add(m);
      m.defines = m.defines || {};
      m.defines.AERIAL_REV = aerialRevision;
      m.needsUpdate = true;
    }
  });
}

/* ------------------------------------------------------------------ */
/* sky dome                                                           */
/* ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSun;
uniform vec3 uZenith;
uniform vec3 uSkyMid;
uniform vec3 uHorizon;
uniform vec3 uSunTint;
uniform vec3 uGround;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uTime;
uniform float uSunSize;
uniform float uSunIntensity;
uniform float uStars;
uniform float uCloud;
varying vec3 vDir;

float hash21( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float hash31( vec3 p ) {
  return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453123 );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( hash21( i ),                  hash21( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y );
}
float fbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    v += a * vnoise( p );
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

/* one dome-projected cloud sheet */
float sheet( vec3 d, float height, float scale, vec2 drift, float t ) {
  float ray = height / max( d.y, 0.035 );
  vec2 uv = d.xz * ray * scale + drift * t;
  return fbm( uv );
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float hs = max( h, 0.0 );
  float cosT = dot( d, uSun );

  /* --- Rayleigh: a gentle brightening of the WHOLE dome towards the
         horizon.
         This exponent used to be 5.0, and that was the reason the IBL bake
         carried no usable irradiance. pow(1-h, 5) is 0.031 at 30 degrees
         elevation, so the dome was 97% zenith colour and the bright band
         was confined to the bottom few degrees — measured as 0.017 at +Y
         against 0.348 at the horizon, a 20:1 ring with nothing above it.
         A thin bright ring gives rim light and no ambient fill, which is
         exactly what the shaded facades looked like.
         1.7 spreads it the way a real twilight sky does: the eye reads the
         zenith as dark because it sits next to a bright horizon, not
         because it is emitting nothing. --- */
  float air = pow( 1.0 - hs, 1.7 );
  vec3 col = mix( uZenith, uSkyMid, air );

  /* --- Mie: the warm band keeps its own, much tighter falloff, so
         widening the Rayleigh term above does not turn the sky orange. --- */
  float warm = pow( 1.0 - hs, 6.0 );
  col = mix( col, uHorizon, warm * 0.80 );

  /* --- forward scatter (tight) + broad hemispheric bias towards the sun --- */
  float mie = pow( max( cosT, 0.0 ), 8.0 );
  float wide = pow( max( cosT, 0.0 ) * 0.5 + 0.5, 3.0 );
  col += uSunTint * ( mie * 0.60 + wide * 0.13 ) * ( 0.30 + air * 0.55 );

  /* --- horizon glow. exp() band, so it never shows a hard edge --- */
  float band = exp( - abs( h + 0.006 ) * 13.0 );
  col += uHorizon * band * 0.55 * ( 0.30 + wide * 0.90 );

  /* --- cloud sheets, slow drift, lit from the sun side --- */
  float above = smoothstep( 0.015, 0.20, h );
  if ( uCloud > 0.001 && above > 0.001 ) {
    vec3 lit = mix( uCloudDark, uCloudLit, clamp( pow( max( cosT, 0.0 ), 2.0 ) * 0.95 + 0.08, 0.0, 1.0 ) );
    float c0 = smoothstep( 0.50, 0.86, sheet( d, 1.0, 0.85, vec2(  0.0035, 0.0012 ), uTime ) );
    float c1 = smoothstep( 0.54, 0.90, sheet( d, 1.9, 0.42, vec2( -0.0021, 0.0026 ), uTime ) );
    float c2 = smoothstep( 0.58, 0.94, sheet( d, 3.4, 0.19, vec2(  0.0012, -0.0009 ), uTime ) );
    float cov = c0 * 0.34 + c1 * 0.26 + c2 * 0.18;
    col = mix( col, lit, clamp( cov * above * uCloud, 0.0, 1.0 ) );
  }

  /* --- stars: round, twinkling, fading in with altitude --- */
  if ( uStars > 0.001 ) {
    vec3 sp = d * 300.0;
    vec3 cell = floor( sp );
    float r = hash31( cell );
    vec3 f = fract( sp ) - 0.5;
    float star = smoothstep( 0.9980, 0.9999, r ) * exp( - dot( f, f ) * 24.0 );
    float tw = 0.60 + 0.40 * sin( uTime * 1.7 + r * 91.0 );
    float vis = smoothstep( 0.06, 0.55, h ) * ( 1.0 - band ) * ( 1.0 - clamp( mie * 4.0, 0.0, 1.0 ) );
    col += vec3( 0.72, 0.80, 1.0 ) * star * tw * vis * uStars;
  }

  /* --- sun disc with limb softening --- */
  float ang = acos( clamp( cosT, -1.0, 1.0 ) );
  float disc = 1.0 - smoothstep( uSunSize * 0.80, uSunSize * 1.18, ang );
  float limbT = clamp( ang / max( uSunSize, 1e-4 ), 0.0, 1.0 );
  float limb = sqrt( max( 0.0, 1.0 - limbT * limbT ) );
  col += uSunTint * disc * ( 0.30 + 0.70 * limb ) * uSunIntensity;

  /* --- below the horizon: ground bounce. This is also what the IBL
         capture uses for downward-facing normals, so keep it a plausible
         dusk cobble/plaster colour rather than neutral grey. --- */
  col = mix( col, uGround, smoothstep( 0.0, -0.13, h ) );

  /* dither: an 8-bit gradient across a 90-degree sky bands badly */
  float dith = hash21( gl_FragCoord.xy + fract( uTime ) ) - 0.5;
  gl_FragColor = vec4( max( col + dith * 0.0035, 0.0 ), 1.0 );
}`;

/**
 * Builds the sky dome. Returns the mesh plus a `update(dt)` for the
 * cloud/star animation and a `makeCaptureMesh()` used by the IBL bake.
 */
export function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      /* Zenith lifted ~2.7x in linear luminance (0.008 -> 0.022). The old
       * 0x0d1630 was ~0.008, which is near-black and contributed no
       * irradiance overhead. */
      uZenith: { value: new THREE.Color(0x1b2748) },
      /* NEW: the pale blue the Rayleigh term now reaches towards over the
       * dome. Previously the gradient ran straight from a near-black zenith
       * to the warm horizon, so there was no bright *blue* sky anywhere for
       * the IBL to pick up. This is what should light the shadowed walls. */
      uSkyMid: { value: new THREE.Color(0x6d82a8) },
      uHorizon: { value: new THREE.Color(0xd88b4a) },
      uSunTint: { value: new THREE.Color(0xffd0a0) },
      /* Below the horizon: warm cobble/plaster bounce, and what the IBL uses
       * for downward-facing normals.
       * This is the single most effective lever for lifting a shadowed
       * facade, and it was the one I had underweighted. Integrating the
       * cosine-weighted hemisphere about a *vertical* normal shows 49.8% of
       * it lies below the horizon — so half a wall's ambient light comes
       * from here, not from the sky. And it is nearly free visually: the
       * ground plane covers the dome below the horizon in essentially every
       * view, so this brightens shading without brightening the picture.
       * At 0.074 linear luminance against a 0.38 horizon it is ~19% of sky
       * brightness, which is conservative for cobbles at dusk. */
      uGround: { value: new THREE.Color(0x5a4a38) },
      uCloudLit: { value: new THREE.Color(0xffc39a) },
      uCloudDark: { value: new THREE.Color(0x2f3348) },
      uTime: { value: 0 },
      uSunSize: { value: 0.021 },
      uSunIntensity: { value: 9.0 },
      uStars: { value: 0.85 },
      uCloud: { value: 1.0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 64, 40), material);
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  scene.add(mesh);

  /* Density and base colour are real uniforms sourced from scene.fog, so
   * AERIAL cannot drive them by itself — sync them here to keep AERIAL the
   * single source of truth. (Everything else in AERIAL is baked into the
   * chunk instead; see buildFogChunks.) */
  if (scene.fog) {
    scene.fog.color.copy(AERIAL.color);
    if (scene.fog.isFogExp2) scene.fog.density = AERIAL.density;
  }

  let t = 0;
  return {
    mesh,
    material,
    /** A small copy of the dome for the cube capture (radius 10). */
    makeCaptureMesh() {
      const m = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), material);
      m.frustumCulled = false;
      return m;
    },
    update(dt, camera) {
      t += dt;
      material.uniforms.uTime.value = t;
      // the dome follows the camera horizontally so it never clips
      if (camera) mesh.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/* Patch the fog chunks the moment this module is evaluated. main.js
 * imports this file first, before city.js / materials.js, so every
 * material in the app picks the extra uniforms up. */
installAerialPerspective();
