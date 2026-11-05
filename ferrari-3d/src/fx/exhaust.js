import * as THREE from 'three';

/**
 * Exhaust from the 458's real tailpipe positions.
 *
 * Four layers, all driven by `throttle` (0..1, set from outside) and by
 * discrete combustion events:
 *
 *  - Smoke and heat: pooled particles in one Points draw call, simulated in
 *    world space (they stay behind as the car "moves"). A short-lived hot core
 *    glows (additive); a cool translucent haze rises, slows and spreads.
 *  - Flame: a flame body per pipe (one lathe mesh each, procedural shader).
 *    On every bang it licks out of the tip — blue at the nozzle, white-yellow,
 *    orange, red at the ragged tip — and dies in about a tenth of a second. At
 *    the limiter a small blue flame flickers continuously.
 *  - Light: a point light at the tips flashes with each bang (it lights the
 *    diffuser and bumper), plus an additive halo at each tip.
 *  - Events: `pulse()` is one bang (upshift, ignition, a touch of the limiter);
 *    `crackle()` is the overrun: a volley of irregular pops as the revs fall.
 *    Every bang is reported to `onPop` listeners (camera kick, sound).
 *
 * Premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA) lets the particle material
 * be both additive (rgb with ~0 alpha) and translucent (grey with alpha).
 */
export class Exhaust {
  constructor({ count = 1300, reducedMotion = false } = {}) {
    this.count = reducedMotion ? Math.floor(count * 0.4) : count;
    this.reducedMotion = reducedMotion;
    this.emitters = []; // { object: Object3D (tip), dir: Vector3 local, flame: Mesh, halo: Sprite }
    this.throttle = 0; // 0..1, set from outside
    this.throttleDamped = 0;
    this.wind = new THREE.Vector3(); // world-space relative airflow
    this.flash = 0; // light + hot particles
    this.flame = 0; // flame length envelope
    this.burst = 0;
    this.crackleTime = 0;
    this.crackleAmount = 0;
    this.nextPop = 0;
    this.time = 0;
    this.cursor = 0;
    this.spawnCarry = 0;
    this.listeners = new Set();

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
          float grow = mix(0.3, 3.0, sqrt(aAge));
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
          vec2 q = c * 3.0 + vSeed * 17.0 + vAge * 1.5;
          float wisp = noise(q) * 0.6 + noise(q * 2.3) * 0.4;
          float soft = (1.0 - r * r) * smoothstep(0.15, 0.85, wisp + (1.0 - r) * 0.35);
          float fadeIn = smoothstep(0.0, 0.05, vAge);
          float fadeOut = 1.0 - smoothstep(0.15, 0.85, vAge);
          float a = soft * fadeIn * fadeOut;

          // hot core: white-blue at the tip cooling through amber to dull red
          // short-lived: the flame body does the fire, the gas just glows as it leaves
          float hot = vHeat * (1.0 - smoothstep(0.0, 0.07, vAge));
          vec3 flame = mix(vec3(1.0, 0.24, 0.02), vec3(1.0, 0.7, 0.3), smoothstep(0.6, 1.0, vHeat) * (1.0 - vAge * 12.0));
          vec3 glow = flame * hot * a * 1.3;

          // cool haze: a blue-grey veil that thins as it spreads
          float hazeA = a * 0.1 * (1.0 - hot) * pow(1.0 - vAge, 1.4);
          vec3 haze = vec3(0.55, 0.59, 0.66) * hazeA;

          gl_FragColor = vec4((glow + haze) * uOpacity, hazeA * uOpacity);
        }`,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    this.light = new THREE.PointLight(0xff7a2e, 0, 3.6, 2);
    this.flameMaterial = createFlameMaterial();
    this.flameGeometry = createFlameGeometry();
    this.haloTexture = createHaloTexture();
  }

  /** Register a tailpipe tip (an Object3D placed at the outlet) and its local outflow direction. */
  addEmitter(object, dir = new THREE.Vector3(0, 0, 1)) {
    const d = dir.clone().normalize();
    const flame = new THREE.Mesh(this.flameGeometry, this.flameMaterial);
    flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    flame.visible = false;
    flame.renderOrder = 6;
    flame.frustumCulled = false;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    halo.position.copy(d).multiplyScalar(0.05);
    halo.visible = false;
    halo.renderOrder = 7;
    object.add(flame, halo);
    this.emitters.push({ object, dir: d, flame, halo, jitter: Math.random() * 10 });
    if (this.emitters.length === 1) object.add(this.light);
  }

  /** Listen for bangs (strength 0..~1.5): camera kick, sound. Returns an unsubscribe. */
  onPop(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** One bang: flame, light, a burst of hot gas (ignition, upshift, the limiter). */
  pulse(strength = 1) {
    if (this.reducedMotion) {
      this.flash = Math.max(this.flash, strength * 0.3);
      return;
    }
    this.flash = Math.max(this.flash, strength);
    this.flame = Math.max(this.flame, Math.min(1.4, strength));
    this.burst = Math.max(this.burst, strength);
    for (const fn of this.listeners) fn(strength);
  }

  /** The overrun: irregular pops for `duration` seconds as the revs fall. */
  crackle(duration = 1.2, amount = 0.7) {
    if (this.reducedMotion) return;
    this.crackleTime = Math.max(this.crackleTime, duration);
    this.crackleAmount = Math.max(this.crackleAmount, amount);
    this.nextPop = Math.min(this.nextPop, 0.03);
  }

  /** Keeps gl_PointSize in world units for the current camera. */
  setView(pixelRatio, height, fovDeg) {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.material.uniforms.uScale.value = (height * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  update(dt) {
    if (!this.emitters.length) return;
    this.time += dt;
    this.throttleDamped += (this.throttle - this.throttleDamped) * (1 - Math.exp(-4 * dt));
    const th = this.throttleDamped;

    // Overrun crackle: pops at irregular intervals, each a little different
    if (this.crackleTime > 0) {
      this.crackleTime -= dt;
      this.nextPop -= dt;
      if (this.nextPop <= 0) {
        const fade = Math.min(1, this.crackleTime / 0.4);
        this.pulse(this.crackleAmount * (0.35 + Math.random() * 0.75) * (0.4 + 0.6 * fade));
        this.nextPop = 0.045 + Math.random() * Math.random() * 0.22;
      }
      if (this.crackleTime <= 0) this.crackleAmount = 0;
    }

    this.flash *= Math.exp(-11 * dt);
    this.flame *= Math.exp(-10 * dt); // a bang's flame lives ~0.15 s: long enough to register
    // At the limiter: a small blue flame that never quite goes out
    const lick = th > 0.82 ? (th - 0.82) * 0.9 * (0.6 + 0.4 * Math.sin(this.time * 61)) : 0;
    this.light.intensity = this.flash * 9 + th * 0.25 + lick * 1.5;

    // Flame bodies and halos
    const f = Math.max(this.flame, lick);
    const fm = this.flameMaterial.uniforms;
    fm.uTime.value = this.time;
    fm.uAmount.value = Math.min(1, f * 1.3);
    fm.uHot.value = Math.min(1, this.flame * 2.2); // hot until the very end; a limiter lick stays blue
    for (const e of this.emitters) {
      const on = f > 0.02;
      e.flame.visible = on;
      e.halo.visible = on;
      if (!on) continue;
      const flicker = 0.75 + 0.25 * Math.sin(this.time * 47 + e.jitter) * Math.sin(this.time * 31 + e.jitter * 2);
      const len = (0.2 + 1.35 * f) * flicker;
      const wide = 0.9 + 0.6 * Math.min(1, f);
      e.flame.scale.set(wide, wide, len);
      e.halo.material.opacity = Math.min(1, f * 1.4) * flicker;
      e.halo.scale.setScalar(0.18 + 0.35 * Math.min(1.2, f));
    }

    // Emission: a trickle at light throttle, dense at high, and a burst on every bang
    let rate = th > 0.01 ? 80 + th * 620 : 0;
    if (this.burst) {
      rate += 1500 * this.burst;
      this.burst *= Math.exp(-13 * dt);
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
      const speed = 2 + th * 5.5 + this.flash * 5;
      const spread = 0.2;
      const j = i * 3;
      this.pos[j] = tip.x + (Math.random() - 0.5) * 0.025;
      this.pos[j + 1] = tip.y + (Math.random() - 0.5) * 0.025;
      this.pos[j + 2] = tip.z + (Math.random() - 0.5) * 0.025;
      this.vel[j] = dir.x * speed + (Math.random() - 0.5) * spread * speed;
      this.vel[j + 1] = dir.y * speed + (Math.random() - 0.5) * spread * speed * 0.6;
      this.vel[j + 2] = dir.z * speed + (Math.random() - 0.5) * spread * speed;
      this.age[i] = 0;
      this.life[i] = 0.9 + Math.random() * 1.3;
      this.heat[i] = Math.min(1, this.flash * (0.6 + Math.random() * 0.5));
      this.size[i] = 0.07 + Math.random() * 0.06 + th * 0.04 + this.flash * 0.03;
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

  /** Heat-haze plume behind the tips, for the HeatHaze pass: stronger with load and with every bang. */
  hazeSources(out = []) {
    const strength = Math.min(1.4, this.throttleDamped * 0.9 + this.flash * 0.9 + this.flame * 0.5);
    if (!this.emitters.length || strength < 0.01) return out;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = this.emitters[Math.floor(this.emitters.length / 2)];
    e.object.getWorldPosition(from);
    e.object.getWorldQuaternion(q);
    dir.copy(e.dir).applyQuaternion(q);
    to.copy(from).addScaledVector(dir, 1.0 + this.flame * 0.5).addScaledVector(this.wind, 0.05);
    to.y += 0.14;
    out.push({ from, to, width: 0.07 + this.flame * 0.03, strength: strength * 0.9 });
    return out;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.flameGeometry.dispose();
    this.flameMaterial.dispose();
    this.haloTexture.dispose();
    for (const e of this.emitters) e.halo.material.dispose();
    this.light.dispose?.();
  }
}

/** A flame body one unit long along +Z: narrow at the nozzle, a bulb, a tapering ragged tip. */
function createFlameGeometry() {
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const r = (0.03 + 0.075 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.25)), 0.8)) * (1 - Math.pow(t, 3)) + 0.0005;
    pts.push(new THREE.Vector2(r, t));
  }
  // lathe around Y, then Y → Z: the flame points along the pipe's outflow
  return new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2);
}

function createFlameMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uHot: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAmount; uniform float uHot;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float t = vUv.y; // 0 at the nozzle → 1 at the tip
        // bright core, soft edges, but still a body when seen end-on (flames often point at the camera)
        float facing = mix(0.45, 1.0, pow(abs(dot(normalize(vN), normalize(vV))), 1.3));
        // turbulence travelling out of the pipe
        vec2 q = vec2(vUv.x * 7.0, t * 4.0 - uTime * 16.0);
        float n = noise(q) * 0.6 + noise(q * 2.7 + 3.1) * 0.4;
        float body = 1.0 - smoothstep(0.62, 1.0, t + (n - 0.5) * 0.5);
        vec3 blue = vec3(0.3, 0.45, 1.0);
        vec3 white = vec3(1.0, 0.76, 0.36);
        vec3 orange = vec3(1.0, 0.36, 0.05);
        vec3 red = vec3(0.75, 0.1, 0.02);
        vec3 col = mix(blue, white, smoothstep(0.0, 0.09, t));
        col = mix(col, orange, smoothstep(0.14, 0.42, t));
        col = mix(col, red, smoothstep(0.6, 0.95, t));
        // a cool flame (the limiter lick) stays blue
        col = mix(blue * 1.2, col, uHot);
        float a = facing * body * uAmount * (0.75 + 0.5 * n);
        // additive blending weights by alpha: carry the intensity there
        gl_FragColor = vec4(col * 1.45, a);
      }`,
  });
}

function createHaloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,236,210,1)');
  g.addColorStop(0.18, 'rgba(255,160,70,0.75)');
  g.addColorStop(0.5, 'rgba(255,70,20,0.18)');
  g.addColorStop(1, 'rgba(255,40,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
