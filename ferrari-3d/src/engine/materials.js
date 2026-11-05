import * as THREE from 'three';

/**
 * Materials for the procedural V8 (src/engine/v8.js).
 *
 * Every surface is a physically based material lit by the shared studio
 * environment, so the engine reads like the car: no baked lighting. Textures
 * are generated once on a canvas (no downloads): a cast-aluminium grain, a
 * crinkle finish for the cam covers, a 2×2 twill for carbon fibre and a
 * braid for the oil lines.
 *
 * Two shader hooks:
 *  - exhaust: heat tint along each pipe (blue/violet at the port, straw and
 *    bronze further down, raw steel at the collector) plus an emissive glow
 *    driven by `uniforms.heat` — the "headers glowing on the dyno" shot.
 *  - x-ray: an additive fresnel shell used to ghost the castings so the
 *    moving internals can be seen through them.
 */

const sets = new Map();
let textures = null;

function canvasTexture(size, draw, { repeat = 1, srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tileable value noise, a few octaves: the base of the cast and crinkle finishes. */
function noiseField(size, octaves, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o;
    const grid = Array.from({ length: cells * cells }, rand);
    const at = (x, y) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function grayTexture(size, field, { lo = 0, hi = 1, repeat = 1 } = {}) {
  return canvasTexture(
    size,
    (ctx) => {
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < field.length; i++) {
        const v = Math.round((lo + (hi - lo) * field[i]) * 255);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
    { repeat }
  );
}

/** Normal map from a height field (central differences). */
function normalTexture(size, field, strength, repeat) {
  return canvasTexture(
    size,
    (ctx) => {
      const img = ctx.createImageData(size, size);
      const h = (x, y) => field[((y + size) % size) * size + ((x + size) % size)];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
          const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
          const n = new THREE.Vector3(-dx, -dy, 1).normalize();
          const i = (y * size + x) * 4;
          img.data[i] = (n.x * 0.5 + 0.5) * 255;
          img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
          img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
    },
    { repeat }
  );
}

function carbonTexture() {
  // 2×2 twill: tows alternate direction on a diagonal stagger; each tow has a soft sheen across it
  return canvasTexture(
    256,
    (ctx, size) => {
      const n = 8;
      const cell = size / n;
      ctx.fillStyle = '#060606';
      ctx.fillRect(0, 0, size, size);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const horizontal = Math.floor((x + y) / 2) % 2 === 0;
          const g = horizontal ? ctx.createLinearGradient(0, y * cell, 0, (y + 1) * cell) : ctx.createLinearGradient(x * cell, 0, (x + 1) * cell, 0);
          g.addColorStop(0, '#0b0b0c');
          g.addColorStop(0.5, horizontal ? '#2a2a2e' : '#1b1b1e');
          g.addColorStop(1, '#0b0b0c');
          ctx.fillStyle = g;
          ctx.fillRect(x * cell + 0.6, y * cell + 0.6, cell - 1.2, cell - 1.2);
        }
    },
    { repeat: 3, srgb: true }
  );
}

function braidTexture() {
  return canvasTexture(
    128,
    (ctx, size) => {
      ctx.fillStyle = '#3a3a3c';
      ctx.fillRect(0, 0, size, size);
      ctx.lineWidth = 3;
      for (let i = -size; i < size * 2; i += 8) {
        ctx.strokeStyle = '#9a9ca0';
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size, size);
        ctx.stroke();
        ctx.strokeStyle = '#6b6d72';
        ctx.beginPath();
        ctx.moveTo(i + size, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
      }
    },
    { repeat: 1, srgb: true }
  );
}

/** Heat tint along a pipe (uv.x 0 = port → 1 = collector) and an emissive glow scaled by `heat`. */
function exhaustMaterial(uniforms) {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'v8/exhaust',
    color: 0xb9b4ad,
    metalness: 1,
    roughness: 0.32,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = uniforms.heat;
    shader.uniforms.uTime = uniforms.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPipeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPipeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPipeUv;\nuniform float uHeat;\nuniform float uTime;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float s = clamp(vPipeUv.x, 0.0, 1.0);
        vec3 blue = vec3(0.16, 0.2, 0.42);
        vec3 violet = vec3(0.36, 0.2, 0.42);
        vec3 straw = vec3(0.78, 0.6, 0.32);
        vec3 bronze = vec3(0.58, 0.4, 0.26);
        vec3 steel = vec3(0.74, 0.72, 0.69);
        vec3 tint = mix(blue, violet, smoothstep(0.0, 0.18, s));
        tint = mix(tint, straw, smoothstep(0.16, 0.4, s));
        tint = mix(tint, bronze, smoothstep(0.38, 0.62, s));
        tint = mix(tint, steel, smoothstep(0.6, 0.95, s));
        diffuseColor.rgb = tint;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float hot = uHeat * pow(1.0 - s, 1.6) * (0.9 + 0.1 * sin(uTime * 23.0 + s * 40.0));
        vec3 glow = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.18), smoothstep(0.55, 1.0, hot));
        totalEmissiveRadiance += glow * hot * 2.2;`
      );
  };
  m.customProgramCacheKey = () => 'v8-exhaust';
  return m;
}

/** Additive fresnel shell: the outline of a casting, its body transparent. */
export function xrayMaterial(color = 0xc9dcff) {
  return new THREE.ShaderMaterial({
    name: 'v8/xray',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = (instanceMatrix * vec4(position, 1.0)).xyz;
          n = mat3(instanceMatrix) * normal;
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * n);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmount;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float edge = pow(f, 2.6);
        gl_FragColor = vec4(uColor * (0.025 + edge * 0.42) * uAmount, 1.0);
      }`,
  });
}

/** Hover / focus highlight: a Rosso fresnel shell over the part. */
export function highlightMaterial() {
  const m = xrayMaterial(0xff2a2a);
  m.uniforms.uAmount.value = 0;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  return m;
}

/**
 * The shared material set. `uniforms.heat` (0..1) and `uniforms.time` drive
 * the exhaust glow; castings are the materials the x-ray mode fades.
 */
export function engineMaterials(key = 'main') {
  if (sets.has(key)) return sets.get(key);
  // Textures are shared between sets; materials are not (each scene ghosts its own castings)
  if (!textures) {
    const castField = noiseField(256, 5, 7);
    const crinkleField = noiseField(256, 4, 3);
    textures = {
      castRough: grayTexture(256, castField, { lo: 0.42, hi: 0.78, repeat: 2 }),
      castNormal: normalTexture(256, castField, 2.2, 2),
      crinkleNormal: normalTexture(256, crinkleField, 9, 6),
      carbon: carbonTexture(),
      braid: braidTexture(),
    };
    textures.braid.repeat.set(30, 1);
  }
  const { castRough, castNormal, crinkleNormal, carbon, braid } = textures;

  const uniforms = { heat: { value: 0 }, time: { value: 0 } };

  const M = {
    // Sand-cast aluminium: block, heads, sump, timing cover, transmission case
    cast: new THREE.MeshPhysicalMaterial({
      name: 'v8/cast',
      color: 0x9da1a6,
      metalness: 1,
      roughness: 1,
      roughnessMap: castRough,
      normalMap: castNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    }),
    // Darker anodised/painted casting for the transmission
    castDark: new THREE.MeshPhysicalMaterial({
      name: 'v8/cast-dark',
      color: 0x3b3d41,
      metalness: 0.85,
      roughness: 1,
      roughnessMap: castRough,
      normalMap: castNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
    }),
    // Machined faces and forged steel: crank, rods, cams, valves
    steel: new THREE.MeshPhysicalMaterial({ name: 'v8/steel', color: 0xc9ccd0, metalness: 1, roughness: 0.3 }),
    steelDark: new THREE.MeshPhysicalMaterial({ name: 'v8/steel-dark', color: 0x55585e, metalness: 1, roughness: 0.34 }),
    // Polished aluminium (pistons, pulleys) with a low-friction skirt coating
    alloy: new THREE.MeshPhysicalMaterial({ name: 'v8/alloy', color: 0xd8d9da, metalness: 1, roughness: 0.3 }),
    coating: new THREE.MeshPhysicalMaterial({ name: 'v8/coating', color: 0x2a2a2c, metalness: 0.3, roughness: 0.55 }),
    // The red crinkle-finish cam covers
    crinkle: new THREE.MeshPhysicalMaterial({
      name: 'v8/crinkle-red',
      color: 0xa30d16,
      metalness: 0.15,
      roughness: 0.48,
      normalMap: crinkleNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    }),
    carbon: new THREE.MeshPhysicalMaterial({
      name: 'v8/carbon',
      color: 0xffffff,
      map: carbon,
      metalness: 0.2,
      roughness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
    rubber: new THREE.MeshPhysicalMaterial({ name: 'v8/rubber', color: 0x0d0d0e, metalness: 0, roughness: 0.78 }),
    plastic: new THREE.MeshPhysicalMaterial({ name: 'v8/plastic', color: 0x161618, metalness: 0, roughness: 0.42, clearcoat: 0.4 }),
    ceramic: new THREE.MeshPhysicalMaterial({ name: 'v8/ceramic', color: 0xf1ede6, metalness: 0, roughness: 0.25, clearcoat: 0.6 }),
    gasket: new THREE.MeshPhysicalMaterial({ name: 'v8/mls-gasket', color: 0x6f6a62, metalness: 0.9, roughness: 0.38 }),
    copper: new THREE.MeshPhysicalMaterial({ name: 'v8/copper', color: 0xc77b4a, metalness: 1, roughness: 0.28 }),
    gold: new THREE.MeshPhysicalMaterial({ name: 'v8/gold-anodised', color: 0xc9a25a, metalness: 1, roughness: 0.3 }),
    braid: new THREE.MeshPhysicalMaterial({ name: 'v8/braid', map: braid, metalness: 0.9, roughness: 0.4 }),
    exhaust: exhaustMaterial(uniforms),
  };
  // Castings are ghosted in x-ray mode; everything else (and the dark transmission case) stays solid
  const castings = new Set([M.cast, M.crinkle, M.gasket, M.carbon]);
  const set = { ...M, uniforms, castings };
  sets.set(key, set);
  return set;
}
