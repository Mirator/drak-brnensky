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

export const AERIAL = {
  /** Extinction per metre at `baseY`. */
  density: 0.0034,
  /** Haze scale height: density falls as exp(-falloff * (y - baseY)). */
  heightFalloff: 1 / 58,
  baseY: 0,
  /** Base haze colour (also `scene.fog.color`). */
  color: new THREE.Color(0x2e3242),
  /** Haze colour looking into the sun. */
  sunColor: new THREE.Color(0xffb379),
  /** Haze colour looking up (keeps distant roofs from going brown). */
  upColor: new THREE.Color(0x3b4363),
  /** How tightly the sun tint hugs the sun direction. */
  sunPower: 3.2,
  sunStrength: 0.9,
};

let aerialInstalled = false;

/**
 * Patches three's fog chunks in place. Idempotent. Must run before any
 * material is constructed — it is called at the bottom of this module.
 */
export function installAerialPerspective() {
  if (aerialInstalled) return;
  aerialInstalled = true;

  const C = THREE.ShaderChunk;

  /* extra uniforms — merged into every material that uses fog */
  Object.assign(THREE.UniformsLib.fog, {
    fogSunDirection: { value: SUN_DIR.clone() },
    fogSunColor: { value: AERIAL.sunColor.clone() },
    fogUpColor: { value: AERIAL.upColor.clone() },
    fogHeightFalloff: { value: AERIAL.heightFalloff },
    fogBaseY: { value: AERIAL.baseY },
    fogSunPower: { value: AERIAL.sunPower },
    fogSunStrength: { value: AERIAL.sunStrength },
  });

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
	uniform vec3 fogSunColor;
	uniform vec3 fogUpColor;
	uniform vec3 fogSunDirection;
	uniform float fogHeightFalloff;
	uniform float fogBaseY;
	uniform float fogSunPower;
	uniform float fogSunStrength;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

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

		float fogH0 = vFogWorldPos.y - fogBaseY;
		float fogH1 = cameraPosition.y - fogBaseY;
		float fogK = max( fogHeightFalloff, 1e-5 );
		float fogDH = fogH0 - fogH1;
		float fogTau;
		if ( abs( fogDH ) > 0.02 ) {
			fogTau = fogDensity * vFogDepth * ( exp( - fogK * fogH1 ) - exp( - fogK * fogH0 ) ) / ( fogK * fogDH );
		} else {
			fogTau = fogDensity * vFogDepth * exp( - fogK * fogH1 );
		}
		float fogFactor = 1.0 - exp( - max( fogTau, 0.0 ) );

		vec3 fogRay = normalize( vFogWorldPos - cameraPosition );
		float fogSunAmt = max( dot( fogRay, fogSunDirection ), 0.0 );
		vec3 fogTint = mix( fogColor, fogSunColor, pow( fogSunAmt, fogSunPower ) * fogSunStrength );
		fogTint = mix( fogTint, fogUpColor, clamp( fogRay.y * 1.7, 0.0, 1.0 ) * 0.65 );

		float fogDither = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
		fogFactor = clamp( fogFactor + fogDither * 0.006, 0.0, 1.0 );

		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

	#endif

#endif
`;
}

/**
 * Live re-tune of the aerial perspective. Cheap but not free (it walks
 * every material in the scene), so call it from settings changes, never
 * per frame.
 */
export function configureAerialPerspective(scene, opts = {}) {
  Object.assign(AERIAL, opts);
  if (opts.color) AERIAL.color = new THREE.Color(opts.color);
  if (opts.sunColor) AERIAL.sunColor = new THREE.Color(opts.sunColor);
  if (opts.upColor) AERIAL.upColor = new THREE.Color(opts.upColor);

  if (scene.fog) {
    scene.fog.color.copy(AERIAL.color);
    scene.fog.density = AERIAL.density;
  }

  const defaults = THREE.UniformsLib.fog;
  defaults.fogSunColor.value.copy(AERIAL.sunColor);
  defaults.fogUpColor.value.copy(AERIAL.upColor);
  defaults.fogHeightFalloff.value = AERIAL.heightFalloff;
  defaults.fogBaseY.value = AERIAL.baseY;
  defaults.fogSunPower.value = AERIAL.sunPower;
  defaults.fogSunStrength.value = AERIAL.sunStrength;

  // and push into materials that already exist
  const seen = new Set();
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const u = m.uniforms;
      if (!u || !u.fogSunColor) continue;
      u.fogSunColor.value.copy(AERIAL.sunColor);
      u.fogUpColor.value.copy(AERIAL.upColor);
      u.fogHeightFalloff.value = AERIAL.heightFalloff;
      u.fogBaseY.value = AERIAL.baseY;
      u.fogSunPower.value = AERIAL.sunPower;
      u.fogSunStrength.value = AERIAL.sunStrength;
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

  /* --- Rayleigh-ish vertical extinction: more air towards the horizon --- */
  float air = pow( 1.0 - hs, 5.0 );
  vec3 col = mix( uZenith, uHorizon, air );

  /* --- Mie forward scatter (tight) + broad hemispheric bias towards the sun --- */
  float mie = pow( max( cosT, 0.0 ), 8.0 );
  float wide = pow( max( cosT, 0.0 ) * 0.5 + 0.5, 3.0 );
  col += uSunTint * ( mie * 0.60 + wide * 0.13 ) * ( 0.32 + air * 0.90 );

  /* --- horizon glow. exp() band, so it never shows a hard edge --- */
  float band = exp( - abs( h + 0.006 ) * 13.0 );
  col += uHorizon * band * 0.60 * ( 0.30 + wide * 0.90 );

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
      uZenith: { value: new THREE.Color(0x0d1630) },
      uHorizon: { value: new THREE.Color(0xd88b4a) },
      uSunTint: { value: new THREE.Color(0xffd0a0) },
      uGround: { value: new THREE.Color(0x2a2119) },
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
