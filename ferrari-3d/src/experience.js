import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HeatHaze } from './fx/heat-haze.js';
import { Exhaust } from './fx/exhaust.js';

const BASE = import.meta.env.BASE_URL;
const DEG = Math.PI / 180;
const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

/**
 * Camera keyframes are authored in "orbit" space around a target:
 *   az   azimuth in degrees (0 = camera on +Z, 90 = camera on +X)
 *   el   elevation in degrees (0 = ground level, ~90 = top-down)
 *   dist distance from target, fov vertical field of view
 *   rot  car yaw in degrees, shift horizontal framing offset (-0.5..0.5 of viewport)
 */
export const RIG_KEYS = ['az', 'el', 'dist', 'fov', 'tx', 'ty', 'tz', 'rot', 'shift', 'roll'];

// The 458's three tailpipes, in car space (measured from the model's chrome tips)
const TAILPIPES = [-0.105, 0, 0.105].map((x) => new THREE.Vector3(x, 0.4, 2.27));

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
}

export class Experience {
  constructor(canvas, { onProgress, onLoad, reducedMotion = false } = {}) {
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

    this.rig = { az: 0, el: 89.5, dist: 20, fov: 30, tx: 0, ty: 0, tz: 0, rot: 90, shift: 0, roll: 0 };
    this.target = { ...this.rig };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
    this.loadCar().then(() => onLoad?.());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /* ------------------------------------------------------------------ */
  /* Studio lighting: a virtual photo studio of emissive softboxes that   */
  /* is baked into a PMREM env map. This is what gives the paint those    */
  /* long, clean "car commercial" reflection strips.                      */
  /* ------------------------------------------------------------------ */
  buildStudioEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x020202);
    const plane = new THREE.PlaneGeometry(1, 1);
    const light = (intensity, color = 0xffffff) =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });

    // Overhead strip softboxes running along the car's length
    [-2.4, -0.8, 0.8, 2.4].forEach((x) => {
      const m = new THREE.Mesh(plane, light(2.2));
      m.rotation.x = Math.PI / 2;
      m.position.set(x, 6, 0);
      m.scale.set(0.7, 14, 1);
      env.add(m);
    });
    // Tall side panels (give the flanks a crisp horizon line)
    [-1, 1].forEach((s) => {
      const m = new THREE.Mesh(plane, light(1.4));
      m.rotation.y = (s * Math.PI) / 2;
      m.position.set(s * 9, 2.2, 0);
      m.scale.set(18, 1.6, 1);
      env.add(m);
    });
    // Warm key from the front-left and cool rim from behind
    const key = new THREE.Mesh(plane, light(3.5, 0xffe2c4));
    key.position.set(-6, 3, -7);
    key.lookAt(0, 0.5, 0);
    key.scale.set(5, 3, 1);
    env.add(key);
    const rim = new THREE.Mesh(plane, light(2.5, 0xcfe0ff));
    rim.position.set(5, 3.5, 8);
    rim.lookAt(0, 0.5, 0);
    rim.scale.set(6, 2, 1);
    env.add(rim);
    // Soft ground bounce
    const floor = new THREE.Mesh(plane, light(0.12));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    floor.scale.set(40, 40, 1);
    env.add(floor);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.035).texture;
    pmrem.dispose();
  }

  buildMaterials() {
    this.paint = {
      from: new THREE.Color('#9c0a0e'),
      to: new THREE.Color('#9c0a0e'),
      sweep: { value: 1 },
    };

    this.bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: this.paint.to,
      metalness: 0.75,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
    });

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

    this.rimMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 1, roughness: 0.28 });
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.4 });
    this.glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x050505,
      metalness: 0.1,
      roughness: 0,
      transparent: true,
      opacity: 0.72,
      clearcoat: 1,
      envMapIntensity: 1.6,
    });
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

  async loadCar() {
    const draco = new DRACOLoader(this.manager);
    draco.setDecoderPath(`${BASE}draco/`);
    const loader = new GLTFLoader(this.manager);
    loader.setDRACOLoader(draco);

    const [gltf, aoTex] = await Promise.all([
      loader.loadAsync(`${BASE}models/ferrari.glb`),
      new THREE.TextureLoader(this.manager).loadAsync(`${BASE}models/ferrari_ao.png`),
    ]);

    const car = gltf.scene.children[0];
    this.bbox = new THREE.Box3().setFromObject(car, true);
    car.getObjectByName('body').material = this.bodyMaterial;
    ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl'].forEach((n) => (car.getObjectByName(n).material = this.rimMaterial));
    car.getObjectByName('trim').material = this.trimMaterial;
    car.getObjectByName('glass').material = this.glassMaterial;
    this.wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => car.getObjectByName(n));

    // Contact shadow: the baked AO texture is white with a dark footprint.
    // Invert it into alpha so it works on any page background colour.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { map: { value: aoTex }, uOpacity: { value: 0.9 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform sampler2D map; uniform float uOpacity; varying vec2 vUv; void main(){ float a = 1.0 - texture2D(map, vUv).r; gl_FragColor = vec4(0.0,0.0,0.0, a * uOpacity); }',
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    shadow.renderOrder = 2;
    this.shadowMaterial = shadow.material;
    car.add(shadow);

    for (const tip of TAILPIPES) {
      const emitter = new THREE.Object3D();
      emitter.position.copy(tip);
      car.add(emitter);
      this.exhaust.addEmitter(emitter, new THREE.Vector3(0, 0, 1));
    }

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

  setRig(values) {
    Object.assign(this.target, values);
  }

  setPaint(hex, { metalness = 0.75, duration = 1.6 } = {}) {
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
    for (const k of RIG_KEYS) this.rig[k] = this.snap ? this.target[k] : damp(this.rig[k], this.target[k], 4.2, dt);
    this.pointerDamped.x = damp(this.pointerDamped.x, this.pointer.x, 2.5, dt);
    this.pointerDamped.y = damp(this.pointerDamped.y, this.pointer.y, 2.5, dt);
    this.dragAzDamped = damp(this.dragAzDamped, this.dragAz, 6, dt);

    const r = this.rig;
    const az = (r.az + this.dragAzDamped + this.pointerDamped.x * 4) * DEG;
    const el = THREE.MathUtils.clamp(r.el + this.pointerDamped.y * 2.5, -2, 89.9) * DEG;
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
