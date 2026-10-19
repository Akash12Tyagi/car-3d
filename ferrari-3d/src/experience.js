import * as THREE from 'three';
import { assets, assetDebug } from './vehicle/asset-loader.js';
import { VehicleModel } from './vehicle/vehicle-model.js';
import { ferrari458 } from './vehicle/registry/ferrari-458.js';
import { createStudioEnvironment, bakeContactShadow, createFloorPool } from './lookdev/studio.js';
import { createLookdevMaterials, PAINT } from './lookdev/materials.js';
import { HeatHaze } from './fx/heat-haze.js';
import { Exhaust } from './fx/exhaust.js';

const DEG = Math.PI / 180;
const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

/**
 * Camera keyframes are authored in "orbit" space around a target:
 *   az   azimuth in degrees (0 = camera on +Z, 90 = camera on +X)
 *   el   elevation in degrees (0 = ground level, ~90 = top-down)
 *   dist distance from target, fov vertical field of view
 *   rot  car yaw in degrees, shift horizontal framing offset (-0.5..0.5 of viewport)
 */
export const RIG_KEYS = ['az', 'el', 'dist', 'fov', 'tx', 'ty', 'tz', 'rot', 'shift', 'roll', 'parallax'];
/** Values for rig keys a keyframe may leave out. `parallax` scales the pointer response (0 = none). */
export const RIG_DEFAULTS = { shift: 0, roll: 0, parallax: 1 };

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/** Stand-in used when WebGL is unavailable: the page runs as a static, readable site. */
export class NullExperience {
  constructor() {
    this.rig = {};
    this.target = {};
    this.exhaust = { throttle: 0, pulse() {} };
    this.renderer = null;
    this.haze = null;
  }
  setRig() {}
  addHotspot() {}
  setPaint() {}
  setRims() {}
  setPixelRatioCap() {}
  setStage() {}
  setStudio() {}
}

export class Experience {
  constructor(canvas, { onProgress, onLoad, onError, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.pointerDamped = new THREE.Vector2();
    this.dragAz = 0;
    this.dragAzDamped = 0;
    this.wheelSpeed = 0; // rad/s target, set from outside
    this.wheelSpeedDamped = 0;
    this.streaks = 0; // 0..1 speed-line intensity
    this.shake = 0;
    this.hotspots = [];
    this.stage = null; // an alternate scene (the Anatomy cinematic) that takes over the canvas while active

    this.rig = { az: 0, el: 89.5, dist: 20, fov: 30, tx: 0, ty: 0, tz: 0, rot: 90, shift: 0, roll: 0, parallax: 1 };
    this.target = { ...this.rig };
    // How quickly the camera chases its target (1/s). Infinity = follow exactly (timeline-driven shots).
    this.rigLambda = 4.2;
    // Pointer parallax only where there is a real hovering pointer; touch "pointers" would make it jump on tap
    this.pointerEnabled = matchMedia('(hover: hover) and (pointer: fine)').matches;
    // Studio light level and reflection rotation, animated by the hero intro
    this.studio = { intensity: 1, rotation: 0 };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    // Khronos PBR Neutral keeps the Rosso a true red (ACES pushes saturated reds towards orange/pink)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // MSAA on the haze target only where the GPU budget allows it
    this.haze = new HeatHaze(this.renderer, { samples: matchMedia('(pointer: coarse)').matches ? 0 : 4 });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.carRoot = new THREE.Group();
    this.scene.add(this.carRoot);

    this.buildStudioEnvironment();
    this.buildMaterials();
    this.buildStreaks();
    this.exhaust = new Exhaust({ reducedMotion });
    this.scene.add(this.exhaust.points);

    this.callbacks = { onProgress, onLoad, onError };
    this.load();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Studio lighting: see src/lookdev/studio.js. Image-based only — no per-frame light cost. */
  buildStudioEnvironment() {
    // 512 px reflections on desktop; 256 px (a quarter of the GPU memory) on touch devices
    const compact = matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;
    this.scene.environment = createStudioEnvironment(this.renderer, { size: compact ? 256 : 512 });
  }

  buildMaterials() {
    this.paint = {
      from: new THREE.Color(PAINT.color),
      to: new THREE.Color(PAINT.color),
      sweep: { value: 1 },
    };

    this.bodyMaterial = new THREE.MeshPhysicalMaterial({ ...PAINT, name: 'lookdev/paint', color: this.paint.to });

    // Paint "sweep": a world-space wipe from the old colour to the new one
    // with a glowing leading edge, injected into the stock physical shader.
    const uniforms = {
      uFrom: { value: this.paint.from },
      uTo: { value: this.paint.to },
      uSweep: this.paint.sweep,
    };
    this.bodyMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSweepPos;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvSweepPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vSweepPos;\nuniform vec3 uFrom;\nuniform vec3 uTo;\nuniform float uSweep;'
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float sweepCoord = (vSweepPos.x + vSweepPos.z * 0.35) / 6.0 + 0.5;
          float edge = uSweep * 1.3 - 0.15;
          float m = smoothstep(edge - 0.02, edge + 0.02, sweepCoord);
          diffuseColor.rgb = mix(uTo, uFrom, m);
          float sweepGlow = (1.0 - smoothstep(0.0, 0.05, abs(sweepCoord - edge))) * step(uSweep, 0.999);`
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.75, 0.55) * sweepGlow * 2.5;'
        );
    };

    // One material per registry slot (src/lookdev/materials.js); the configurator restyles `rims`
    this.lookdev = createLookdevMaterials();
    this.rimMaterial = this.lookdev.rims;
    this.glassMaterial = this.lookdev.glass;
  }

  buildStreaks() {
    const count = 140;
    const geo = new THREE.BoxGeometry(0.012, 0.012, 1);
    this.streakMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.streakMesh = new THREE.InstancedMesh(geo, this.streakMaterial, count);
    this.streakData = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const d = {
        x: side * (1.6 + Math.random() * 7),
        y: 0.05 + Math.random() * 3.2,
        z: (Math.random() - 0.5) * 60,
        len: 1.5 + Math.random() * 6,
        speed: 0.6 + Math.random() * 0.8,
      };
      this.streakData.push(d);
      m.makeScale(1, 1, d.len).setPosition(d.x, d.y, d.z);
      this.streakMesh.setMatrixAt(i, m);
    }
    this.streakMesh.frustumCulled = false;
    this.scene.add(this.streakMesh);
  }

  /** Load (or retry loading) the car; reports through the constructor callbacks. */
  load() {
    if (this.loading) return this.loading;
    const { onLoad, onError } = this.callbacks;
    this.loading = this.loadCar().then(
      () => onLoad?.(),
      (err) => {
        this.loading = null; // allow a retry
        console.error(err);
        onError?.(err);
      }
    );
    return this.loading;
  }

  async loadCar() {
    const report = (p) => this.callbacks.onProgress?.(p);
    const gltf = await assets.loadModel(ferrari458.url, { onProgress: (p) => report(p * 0.95) });

    // Components are addressed by registry ID, never by mesh name or index
    const vehicle = new VehicleModel(gltf, ferrari458);
    vehicle.report({ verbose: assetDebug });
    if (!vehicle.ok) throw new Error(`[vehicle:${ferrari458.id}] required components are missing (see console)`);
    this.vehicle = vehicle;

    const car = vehicle.root;
    this.bbox = new THREE.Box3().setFromObject(car, true);
    vehicle.setSlotMaterial('paint', this.bodyMaterial);
    for (const [slot, material] of Object.entries(this.lookdev)) vehicle.setSlotMaterial(slot, material);
    this.wheels = ['wheel.fl', 'wheel.fr', 'wheel.rl', 'wheel.rr'].map((id) => vehicle.node(id));

    // Ground contact: a shadow baked once from the real geometry, plus a soft
    // floor light pool. Both are parented to the car so they follow its yaw.
    this.contactShadow = bakeContactShadow(this.renderer, car, { width: 3.6, depth: 6.2 });
    car.add(this.contactShadow);
    this.floorPool = createFloorPool();
    this.floorPoolBase = this.floorPool.material.uniforms.uIntensity.value;
    car.add(this.floorPool);
    this.setStudio(this.studio);

    // Exhaust emitters sit on the measured tailpipe tips from the registry
    const outflow = new THREE.Vector3(...vehicle.anchor('exhaustDirection'));
    for (const tip of vehicle.anchor('exhaustTips')) {
      const emitter = new THREE.Object3D();
      emitter.position.set(...tip);
      car.add(emitter);
      this.exhaust.addEmitter(emitter, outflow);
    }
    report(1);

    this.car = car;
    this.carRoot.add(car);
    this.compileAll();
  }

  compileAll() {
    // Upload shaders up-front so the first scroll frame never stutters.
    this.renderer.compile(this.scene, this.camera);
  }

  /** Point in car-local space from normalised bbox coordinates (0..1). */
  carPoint(fx, fy, fz) {
    const b = this.bbox;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(b.min.x, b.max.x, fx),
      THREE.MathUtils.lerp(b.min.y, b.max.y, fy),
      THREE.MathUtils.lerp(b.min.z, b.max.z, fz)
    );
  }

  addHotspot(el, fx, fy, fz) {
    this.hotspots.push({ el, local: null, f: [fx, fy, fz] });
  }

  /** Studio light level (0..1) and rotation of the reflections (radians about Y). */
  setStudio({ intensity = this.studio.intensity, rotation = this.studio.rotation } = {}) {
    this.studio.intensity = intensity;
    this.studio.rotation = rotation;
    this.scene.environmentIntensity = intensity;
    this.scene.environmentRotation.y = rotation;
    if (this.floorPool) this.floorPool.material.uniforms.uIntensity.value = this.floorPoolBase * intensity;
  }

  setRig(values) {
    Object.assign(this.target, values);
  }

  setPaint(hex, { metalness = PAINT.metalness, duration = 1.6 } = {}) {
    this.paint.from.copy(this.paint.to);
    this.paint.to.set(hex);
    this.metalTarget = metalness;
    this.paint.sweep.value = 0;
    this.paintTween = { t: 0, duration };
  }

  setRims(hex, roughness = 0.28) {
    this.rimTarget = { color: new THREE.Color(hex), roughness };
  }

  setPixelRatioCap(cap) {
    this.pixelRatioCap = cap;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap ?? 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.haze.setSize(w, h, this.renderer.getPixelRatio());
    this.stage?.resize(w, h);
  }

  setStage(stage) {
    this.stage = stage;
    stage.resize(this.width, this.height);
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const t = this.clock.elapsedTime;

    // While the cinematic is on screen it owns the canvas; the main scene sleeps
    if (this.stage?.active) {
      this.stage.update(dt, t);
      this.stage.render();
      return;
    }

    // Smoothly chase the scroll-driven rig target (gives the camera mass)
    const lambda = this.snap ? Infinity : this.rigLambda;
    for (const k of RIG_KEYS) {
      const to = this.target[k] ?? RIG_DEFAULTS[k];
      this.rig[k] = lambda === Infinity ? to : damp(this.rig[k] ?? to, to, lambda, dt);
    }
    const px = this.pointerEnabled ? this.pointer.x : 0;
    const py = this.pointerEnabled ? this.pointer.y : 0;
    this.pointerDamped.x = damp(this.pointerDamped.x, px, 2.5, dt);
    this.pointerDamped.y = damp(this.pointerDamped.y, py, 2.5, dt);
    this.dragAzDamped = damp(this.dragAzDamped, this.dragAz, 6, dt);

    const r = this.rig;
    const az = (r.az + this.dragAzDamped + this.pointerDamped.x * 4 * r.parallax) * DEG;
    const el = THREE.MathUtils.clamp(r.el + this.pointerDamped.y * 2.5 * r.parallax, -2, 89.9) * DEG;
    const target = new THREE.Vector3(r.tx, r.ty, r.tz);
    this.camera.position.set(
      target.x + r.dist * Math.sin(az) * Math.cos(el),
      target.y + r.dist * Math.sin(el),
      target.z + r.dist * Math.cos(az) * Math.cos(el)
    );
    if (this.shake > 0.001) {
      const s = this.shake * 0.025;
      this.camera.position.x += Math.sin(t * 47) * s;
      this.camera.position.y += Math.sin(t * 61 + 1.3) * s;
    }
    this.camera.up.set(Math.sin(r.roll * DEG), Math.cos(r.roll * DEG), 0);
    this.camera.lookAt(target);
    this.camera.fov = r.fov;
    const shiftPx = -r.shift * this.width;
    this.camera.setViewOffset(this.width, this.height, shiftPx, 0, this.width, this.height);
    this.camera.updateProjectionMatrix();

    this.carRoot.rotation.y = r.rot * DEG;

    // Wheels
    this.wheelSpeedDamped = damp(this.wheelSpeedDamped, this.wheelSpeed, 3, dt);
    if (this.wheels) for (const w of this.wheels) w.rotation.x -= this.wheelSpeedDamped * dt;

    // Speed streaks
    const sOpacity = this.streaks * 0.55;
    this.streakMaterial.opacity = damp(this.streakMaterial.opacity, sOpacity, 5, dt);
    this.streakMesh.visible = this.streakMaterial.opacity > 0.01;
    if (this.streakMesh.visible) {
      const m = new THREE.Matrix4();
      const travel = (8 + this.wheelSpeedDamped * 0.9) * dt;
      this.streakData.forEach((d, i) => {
        d.z += travel * d.speed * 4;
        if (d.z > 30) d.z -= 60;
        m.makeScale(1, 1, d.len * (0.3 + this.streaks)).setPosition(d.x, d.y, d.z);
        this.streakMesh.setMatrixAt(i, m);
      });
      this.streakMesh.instanceMatrix.needsUpdate = true;
    }

    // Paint sweep
    if (this.paintTween) {
      this.paintTween.t += dt / this.paintTween.duration;
      const p = Math.min(this.paintTween.t, 1);
      this.paint.sweep.value = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      if (p >= 1) {
        this.paint.from.copy(this.paint.to);
        this.paintTween = null;
      }
    }
    if (this.metalTarget !== undefined) {
      this.bodyMaterial.metalness = damp(this.bodyMaterial.metalness, this.metalTarget, 3, dt);
    }
    if (this.rimTarget) {
      this.rimMaterial.color.lerp(this.rimTarget.color, 1 - Math.exp(-6 * dt));
      this.rimMaterial.roughness = damp(this.rimMaterial.roughness, this.rimTarget.roughness, 6, dt);
    }

    // Exhaust: relative airflow follows the launch sequence's speed streaks
    this.exhaust.wind.set(0, 0, this.streaks * (8 + this.wheelSpeedDamped * 0.9) * 0.9);
    this.exhaust.update(dt);
    this.exhaust.setView(this.renderer.getPixelRatio(), this.height, this.camera.fov);

    this.haze.render(this.scene, this.camera, this.exhaust.hazeSources(), t);
    this.updateHotspots();
  }

  updateHotspots() {
    if (!this.car || !this.hotspots.length) return;
    const v = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (const h of this.hotspots) {
      if (!h.local) h.local = this.carPoint(...h.f);
      v.copy(h.local).applyMatrix4(this.car.matrixWorld);
      toCam.copy(this.camera.position).sub(v).normalize();
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.width;
      const y = (-v.y * 0.5 + 0.5) * this.height;
      h.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
