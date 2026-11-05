import * as THREE from 'three';
import { SequenceController } from '../cinematic/controller.js';
import { STATES, CAMERA_KEYS, explodeAt, bottomAt, spreadAt, vanishAt, xrayAt, rpmAt, firingAt, heatAt, visualSpeedAt, lightsAt, inspectableAt } from './timeline.js';
import { V8Engine, SPEC } from './v8.js';
import { createStudioEnvironment } from '../lookdev/studio.js';
import { fitDistance } from '../scene/views.js';
import { sampleMonotone } from '../scene/spline.js';

const DEG = Math.PI / 180;
const CAMERA_CHANNELS = ['az', 'el', 'dist', 'fov', 'x', 'y', 'z'];
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/**
 * The Engine chapter's stage: the procedural V8 (v8.js) in its own dark
 * studio. Like the Anatomy stage it renders whatever the playhead says
 * (this.sequence.q): pose, x-ray, heat, lights and camera are functions of q.
 * The crank angle alone is integrated, so a held state keeps running.
 */
export class EngineStage {
  constructor(renderer, { haze = null, environment = null, reducedMotion = false, mobile = false } = {}) {
    this.renderer = renderer;
    this.haze = haze;
    this.sharedEnvironment = environment;
    this.reducedMotion = reducedMotion;
    this.mobile = mobile;
    this.ready = false;
    this.loadProgress = 0;
    this.active = false;
    this.sequence = new SequenceController({ reducedMotion, states: STATES });
    this.crank = 0;
    this.rpm = 0;
    this.hover = null; // part under the pointer
    this.focusPart = null; // part chosen from the parts list (wins over hover)
    this.hl = { id: null, amount: 0 };
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030303);
    this.scene.fog = new THREE.FogExp2(0x030303, 0.06);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 120);
    this.cameraCache = new Map();
    this.envMap = this.sharedEnvironment ?? createStudioEnvironment(renderer, { size: mobile ? 256 : 512 });
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0;
    this.buildStage();
  }

  set snap(v) {
    this.sequence.snap = v;
  }

  /* -------------------------------- set -------------------------------- */

  buildStage() {
    const shadowSize = this.mobile ? 1024 : 2048;
    this.key = new THREE.SpotLight(0xfff3e8, 0, 0, 0.42, 0.85, 2);
    this.key.position.set(0.5, 6.5, 1.4);
    this.key.target.position.set(0, 0.7, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(shadowSize, shadowSize);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.camera.near = 2.5;
    this.key.shadow.camera.far = 10;
    this.scene.add(this.key, this.key.target);

    this.sweep = new THREE.SpotLight(0xffffff, 0, 0, 0.35, 0.95, 2);
    this.sweep.position.set(-5, 1.2, 5);
    this.sweep.target.position.set(0, 0.8, 0);
    this.scene.add(this.sweep, this.sweep.target);

    this.rim = new THREE.SpotLight(0xcfdcff, 0, 0, 0.5, 0.9, 2);
    this.rim.position.set(-1.6, 2.6, -6.5);
    this.rim.target.position.set(0, 0.8, 0);
    this.scene.add(this.rim, this.rim.target);

    // Rotating assembly: a cool top light on the crank in its glass block
    this.top = new THREE.SpotLight(0xe8eeff, 0, 0, 0.3, 0.8, 2);
    this.scene.add(this.top, this.top.target);

    // Combustion and hot headers
    this.flashLight = new THREE.PointLight(0xff9a4a, 0, 1.4, 2);
    this.glow = [0, 1].map(() => new THREE.PointLight(0xff5a1c, 0, 1.6, 2));
    this.scene.add(this.flashLight, ...this.glow);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.7, metalness: 0 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // The dusty beam under the key, as in the Anatomy studio
    const beamGeo = new THREE.ConeGeometry(2.4, 6.5, 64, 1, true);
    beamGeo.translate(0, -3.25, 0);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uIntensity: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vNormalV; varying vec3 vViewDir; varying float vY;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vY = wp.y;
            vec4 mv = viewMatrix * wp;
            vNormalV = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uIntensity;
          varying vec3 vNormalV; varying vec3 vViewDir; varying float vY;
          void main() {
            float facing = pow(abs(dot(vNormalV, vViewDir)), 2.0);
            float fade = smoothstep(0.0, 1.6, vY) * (1.0 - smoothstep(4.4, 6.4, vY));
            gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * facing * fade * uIntensity, 1.0);
          }`,
      })
    );
    this.beam.position.copy(this.key.position);
    this.beam.lookAt(this.key.target.position);
    this.beam.rotateX(-Math.PI / 2);
    this.beam.renderOrder = 3;
    this.scene.add(this.beam);
  }

  /* -------------------------------- load ------------------------------- */

  /**
   * Build the engine in idle time, then compile every shader variant it will
   * need (castings solid and glass, the highlight shell) without blocking.
   */
  load() {
    if (this.loading) return this.loading;
    const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 60));
    this.loading = new Promise((resolve) => idle(resolve))
      .then(() => {
        this.setup();
        this.loadProgress = 0.6;
        return this.prewarm();
      })
      .then(() => {
        this.loadProgress = 1;
        this.ready = true;
        return this;
      })
      .catch((err) => {
        this.loading = null;
        throw err;
      });
    return this.loading;
  }

  setup() {
    const engine = new V8Engine({ transmission: true, materials: 'engine-chapter' });
    this.engine = engine;
    // Crank 0.62 m off the floor; the powertrain centred front to back
    engine.root.position.set(0, 0.62, 0.25);
    this.scene.add(engine.root);
    engine.root.updateMatrixWorld(true);

    const box = (pts) => new THREE.Box3().setFromPoints(pts);
    const rest = engine.pointsAt({ explode: 0, bottom: 0 });
    const teardown = engine.pointsAt({ explode: 1, bottom: 1 });
    const rotating = engine.pointsAt({ explode: 1, bottom: 0 }, ['block', 'crank', 'rods', 'pistons']);
    this.frames = { rest, teardown, rotating };
    this.centers = Object.fromEntries(Object.entries(this.frames).map(([k, pts]) => [k, box(pts).getCenter(new THREE.Vector3())]));
    // The rotating assembly sits a little low in its box (the pan rail): aim at the crank
    this.centers.rotating.y = engine.root.position.y + 0.04;
    this.cameraCache.clear();

    const c = this.centers.rotating;
    this.top.position.set(c.x - 1.0, c.y + 3.2, c.z + 1.2);
    this.top.target.position.copy(c);
  }

  async prewarm() {
    const compile = () => (this.renderer.compileAsync ? this.renderer.compileAsync(this.scene, this.camera) : Promise.resolve(this.renderer.compile(this.scene, this.camera)));
    const e = this.engine;
    e.highlight('crank', 1);
    e.setXray(1);
    e.setCombustion(1);
    for (const f of e.flashes) f.visible = true;
    await compile();
    e.setXray(0);
    e.highlight(null);
    e.setCombustion(0);
    await compile();
  }

  /* ------------------------------- frame ------------------------------- */

  setProgress(p) {
    this.sequence.setScroll(Math.min(1, Math.max(0, p)));
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Share of the frame the subject may fill, by layout (copy left on wide screens, below on tall ones). */
  frameShare(aspect, fill) {
    if (aspect >= 1.2) return { width: 0.6 * fill, height: 0.78 * fill };
    if (aspect >= 1) return { width: 0.78 * fill, height: 0.6 * fill };
    return { width: 0.94 * fill, height: 0.4 * fill };
  }

  cameraKeys(aspect) {
    const key = aspect.toFixed(3);
    let keys = this.cameraCache.get(key);
    if (keys) return keys;
    keys = CAMERA_KEYS.map((k) => {
      const { x, y, z } = this.centers[k.frame];
      const view = { az: k.az, el: k.el, fov: k.fov, tx: x, ty: y, tz: z };
      const dist = fitDistance(view, { aspect, ...this.frameShare(aspect, k.fill), points: this.frames[k.frame], pointsKey: `engine:${k.frame}` });
      return { t: k.t, az: k.az, el: k.el, fov: k.fov, dist, x, y, z };
    });
    this.cameraCache.set(key, keys);
    return keys;
  }

  get inspectable() {
    return this.ready && this.active && inspectableAt(this.sequence.q) && this.sequence.mode === 'scroll';
  }

  update(dt, t) {
    this.sequence.update(dt);
    const q = this.sequence.q;
    this.q = q;
    if (!this.ready) return;
    const e = this.engine;

    // --- camera -------------------------------------------------------
    const aspect = this.width / this.height;
    const c = sampleMonotone(this.cameraKeys(aspect), q, CAMERA_CHANNELS, { log: ['dist'] });
    const a = c.az * DEG;
    const el = c.el * DEG;
    this.camera.position.set(c.x + c.dist * Math.sin(a) * Math.cos(el), c.y + c.dist * Math.sin(el), c.z + c.dist * Math.cos(a) * Math.cos(el));
    this.camera.lookAt(c.x, c.y, c.z);
    this.camera.fov = c.fov;
    const sx = aspect >= 1.2 ? -0.09 * this.width : 0;
    const sy = aspect < 1 ? 0.1 * this.height : 0;
    this.camera.setViewOffset(this.width, this.height, sx, sy, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.scene.fog.density = 0.45 / Math.max(c.dist, 6);

    // --- mechanism ----------------------------------------------------
    const speed = visualSpeedAt(q) * (this.reducedMotion ? 0.5 : 1);
    this.crank = (this.crank + speed * Math.PI * 2 * dt) % (Math.PI * 4); // one 720° cycle
    e.pose({ crank: this.crank, explode: explodeAt(q), bottom: bottomAt(q), spread: spreadAt(q), vanish: vanishAt(q) });
    e.setXray(xrayAt(q));
    const heat = heatAt(q);
    e.setHeat(heat, t);
    const firing = firingAt(q);
    e.setCombustion(firing * (this.reducedMotion ? 0.35 : 1));

    let rpm = rpmAt(q);
    if (rpm >= 8999) rpm = 9000 - (Math.sin(t * 31) * 0.5 + 0.5) * 240; // bouncing off the limiter
    this.rpm = rpm;
    this.slowmo = rpm > 0 && speed > 0 ? rpm / 60 / speed : 0;
    this.byHand = rpm === 0 && speed > 0;
    const fired = e.firing();
    this.firingCyl = firing > 0.2 && fired.flash > 0.05 ? fired.n : null;
    this.crankDeg = (this.crank / DEG) % 720;

    // --- highlight ----------------------------------------------------
    const want = this.focusPart ?? (this.inspectable ? this.hover : null);
    if (want !== this.hl.id && want) {
      this.hl.id = want;
      this.hl.amount = Math.min(this.hl.amount, 0.35);
    }
    this.hl.amount = damp(this.hl.amount, want ? 1 : 0, 10, dt);
    if (!want && this.hl.amount < 0.01) this.hl.id = null;
    e.highlight(this.hl.id, this.hl.amount);

    // --- lights -------------------------------------------------------
    const L = lightsAt(q);
    const on = L.reveal * L.fadeOut;
    // Glass castings show the internals only if the polished parts have studio light to reflect
    const dim = 1 - 0.3 * L.xray;
    this.scene.environmentIntensity = (0.04 + 0.42 * L.reveal + 0.2 * L.study + 0.16 * L.hero) * dim * L.fadeOut + 0.25 * L.focus;
    this.key.intensity = (230 + 120 * L.study) * on * (1 - 0.35 * L.xray);
    this.rim.intensity = (70 + 120 * L.hero + 80 * L.xray) * Math.min(1, q / 0.06) * L.fadeOut;
    this.sweep.position.x = THREE.MathUtils.lerp(-6, 6, L.sweep);
    this.sweep.intensity = 80 * Math.sin(Math.PI * L.sweep) * (1 - L.study) + 60 * L.hero * L.fadeOut;
    this.beam.material.uniforms.uIntensity.value = 0.05 * on * (1 - 0.7 * L.xray);
    this.top.intensity = 115 * L.focus * L.fadeOut;

    // Combustion light in the cylinder that just fired; glow light under each collector
    if (fired && firing > 0) {
      e.flashes[fired.n - 1].getWorldPosition(this.flashLight.position);
      this.flashLight.intensity = fired.flash * firing * 2.2 * (this.reducedMotion ? 0.3 : 1);
    } else this.flashLight.intensity = 0;
    this.hazeSources = [];
    e.collectors.forEach((col, i) => {
      const p = e.root.localToWorld(col.point.clone().addScaledVector(col.node.move, e.byId.get('exhaust').reach));
      this.glow[i].position.copy(p);
      this.glow[i].intensity = heat * 0.9 * L.fadeOut;
      if (heat > 0.04 && !this.reducedMotion) this.hazeSources.push({ from: p.clone(), to: p.clone().add(new THREE.Vector3(0, 0.55, 0)), width: 0.05, strength: heat * 0.7 });
    });
  }

  render(t = performance.now() / 1000) {
    if (this.haze) this.haze.render(this.scene, this.camera, this.hazeSources ?? [], t);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (px) of a part's annotation anchor, or of `at` (engine space, travels with the part). */
  project(partId, out = { x: 0, y: 0, behind: false }, at = null) {
    const v = this.engine?.anchor(partId, new THREE.Vector3(), at);
    if (!v) return null;
    v.project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.behind = v.z > 1;
    return out;
  }

  /** The part under a screen point (px), or null. */
  pick(x, y) {
    if (!this.ready) return null;
    this.ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.engine.pick(this.raycaster);
  }

  dispose() {
    this.engine?.dispose();
    this.key.shadow.map?.dispose();
    if (!this.sharedEnvironment) this.envMap.dispose();
    this.ready = false;
  }
}

export { SPEC };
