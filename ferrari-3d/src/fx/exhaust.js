import * as THREE from 'three';

/**
 * Exhaust from real tailpipe positions: a pooled particle system drawn in one
 * Points call. Particles are simulated in world space (so they stay behind as
 * the car "moves" through the scene) and shaded procedurally: a short-lived hot
 * core that glows (additive) and a cooler, translucent haze that rises, slows
 * and spreads. A point light at the tips flashes on each pulse (gear shift,
 * limiter) so the bodywork around the pipes is actually lit by it.
 *
 * Premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA) lets one material be both
 * additive (rgb with ~0 alpha) and translucent (grey with alpha).
 */
export class Exhaust {
  constructor({ count = 700, reducedMotion = false } = {}) {
    this.count = reducedMotion ? Math.floor(count * 0.4) : count;
    this.reducedMotion = reducedMotion;
    this.emitters = []; // { object: Object3D (tip), dir: Vector3 local }
    this.throttle = 0; // 0..1, set from outside
    this.throttleDamped = 0;
    this.wind = new THREE.Vector3(); // world-space relative airflow
    this.flash = 0;
    this.cursor = 0;
    this.spawnCarry = 0;

    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.heat = new Float32Array(n);
    this.seed = new Float32Array(n).map(() => Math.random());
    this.size = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.aAge = new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage);
    this.aHeat = new THREE.BufferAttribute(this.heat, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAge', this.aAge);
    geo.setAttribute('aHeat', this.aHeat);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uPixelRatio: { value: 1 },
        uScale: { value: 1 },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aAge;
        attribute float aHeat;
        attribute float aSize;
        attribute float aSeed;
        uniform float uPixelRatio;
        uniform float uScale;
        varying float vAge;
        varying float vHeat;
        varying float vSeed;
        void main() {
          vAge = aAge; vHeat = aHeat; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float grow = mix(0.3, 2.6, sqrt(aAge));
          gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * grow * uScale * uPixelRatio / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vAge;
        varying float vHeat;
        varying float vSeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          // wispy, per-particle noise so the haze never reads as round blobs
          vec2 q = c * 3.0 + vSeed * 17.0 + vAge * 1.5;
          float wisp = noise(q) * 0.6 + noise(q * 2.3) * 0.4;
          float soft = (1.0 - r * r) * smoothstep(0.15, 0.85, wisp + (1.0 - r) * 0.35);
          float fadeIn = smoothstep(0.0, 0.06, vAge);
          float fadeOut = 1.0 - smoothstep(0.15, 0.85, vAge);
          float a = soft * fadeIn * fadeOut;

          // hot core: blue-white at the tip cooling to amber within a few centimetres;
          // emits light but adds no coverage
          float hot = vHeat * (1.0 - smoothstep(0.0, 0.12, vAge));
          vec3 flame = mix(vec3(1.0, 0.42, 0.1), vec3(0.6, 0.72, 1.0), smoothstep(0.7, 1.0, vHeat) * (1.0 - vAge * 8.0));
          vec3 glow = flame * hot * a * 1.5;

          // cool haze: barely-there blue-grey that thins as it spreads
          float hazeA = a * 0.07 * (1.0 - hot) * pow(1.0 - vAge, 1.5);
          vec3 haze = vec3(0.55, 0.59, 0.66) * hazeA;

          gl_FragColor = vec4((glow + haze) * uOpacity, hazeA * uOpacity);
        }`,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    this.light = new THREE.PointLight(0xff7a2e, 0, 2.2, 2);
  }

  /** Register a tailpipe tip (an Object3D placed at the outlet) and its local outflow direction. */
  addEmitter(object, dir = new THREE.Vector3(0, 0, 1)) {
    this.emitters.push({ object, dir: dir.clone().normalize() });
    if (this.emitters.length === 1) object.add(this.light);
  }

  /** A combustion pulse: flame flash + light flash (gear change, limiter). */
  pulse(strength = 1) {
    if (this.reducedMotion) return;
    this.flash = Math.max(this.flash, strength);
    this.burst = Math.max(this.burst ?? 0, strength);
  }

  /** Keeps gl_PointSize in world units for the current camera. */
  setView(pixelRatio, height, fovDeg) {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.material.uniforms.uScale.value = (height * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  update(dt) {
    if (!this.emitters.length) return;
    this.throttleDamped += (this.throttle - this.throttleDamped) * (1 - Math.exp(-4 * dt));
    const th = this.throttleDamped;
    this.flash *= Math.exp(-9 * dt);
    this.light.intensity = this.flash * 3.5 + th * 0.15;

    // Emission: idle trickle at low throttle, dense at high, plus a burst on pulses
    let rate = th > 0.01 ? 60 + th * 380 : 0;
    if (this.burst) {
      rate += 900 * this.burst;
      this.burst *= Math.exp(-14 * dt);
      if (this.burst < 0.02) this.burst = 0;
    }
    this.spawnCarry += rate * dt;
    const spawn = Math.floor(this.spawnCarry);
    this.spawnCarry -= spawn;

    const tip = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let s = 0; s < spawn; s++) {
      const e = this.emitters[(this.cursor + s) % this.emitters.length];
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      e.object.getWorldPosition(tip);
      e.object.getWorldQuaternion(q);
      dir.copy(e.dir).applyQuaternion(q);
      const speed = 1.6 + th * 4.5 + this.flash * 3;
      const spread = 0.18;
      const j = i * 3;
      this.pos[j] = tip.x + (Math.random() - 0.5) * 0.02;
      this.pos[j + 1] = tip.y + (Math.random() - 0.5) * 0.02;
      this.pos[j + 2] = tip.z + (Math.random() - 0.5) * 0.02;
      this.vel[j] = dir.x * speed + (Math.random() - 0.5) * spread * speed;
      this.vel[j + 1] = dir.y * speed + (Math.random() - 0.5) * spread * speed * 0.6;
      this.vel[j + 2] = dir.z * speed + (Math.random() - 0.5) * spread * speed;
      this.age[i] = 0;
      this.life[i] = 0.9 + Math.random() * 1.1;
      this.heat[i] = Math.min(1, this.flash * (0.6 + Math.random() * 0.4));
      this.size[i] = 0.06 + Math.random() * 0.05 + th * 0.03;
    }

    // Integrate: drag towards the relative airflow, buoyancy, gentle curl
    const drag = Math.exp(-2.6 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] >= 1) continue;
      const j = i * 3;
      this.age[i] = Math.min(1, this.age[i] + dt / this.life[i]);
      const a = this.age[i];
      this.vel[j] = this.wind.x + (this.vel[j] - this.wind.x) * drag + Math.sin(a * 9 + this.seed[i] * 40) * 0.25 * dt;
      this.vel[j + 1] = this.wind.y + (this.vel[j + 1] - this.wind.y) * drag + (0.35 + a * 0.5) * dt;
      this.vel[j + 2] = this.wind.z + (this.vel[j + 2] - this.wind.z) * drag + Math.cos(a * 7 + this.seed[i] * 31) * 0.25 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.aAge.needsUpdate = true;
    this.aHeat.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  /** Heat-haze plume behind the tips, for the HeatHaze pass. */
  hazeSources(out = []) {
    const strength = Math.min(1, this.throttleDamped * 0.9 + this.flash * 0.6);
    if (!this.emitters.length || strength < 0.01) return out;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = this.emitters[Math.floor(this.emitters.length / 2)];
    e.object.getWorldPosition(from);
    e.object.getWorldQuaternion(q);
    dir.copy(e.dir).applyQuaternion(q);
    to.copy(from).addScaledVector(dir, 0.9).addScaledVector(this.wind, 0.05);
    to.y += 0.12;
    out.push({ from, to, width: 0.06, strength: strength * 0.9 });
    return out;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.light.dispose?.();
  }
}
