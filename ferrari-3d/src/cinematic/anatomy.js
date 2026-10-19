import * as THREE from 'three';
import { Exploder } from './exploder.js';
import { SequenceController } from './controller.js';
import { CAMERA_KEYS, explodeAt, powerAt, lightsAt } from './timeline.js';
import { assets, assetDebug } from '../vehicle/asset-loader.js';
import { VehicleModel } from '../vehicle/vehicle-model.js';
import { createStudioEnvironment } from '../lookdev/studio.js';
import { fitDistance, boxCorners } from '../scene/views.js';
import { sampleMonotone } from '../scene/spline.js';

const DEG = Math.PI / 180;
const smoothOn = (q) => Math.min(1, q / 0.06);
const CAMERA_CHANNELS = ['az', 'el', 'dist', 'fov', 'x', 'y', 'z'];

/**
 * The Anatomy stage: the stand-in engineering model in its own dark studio.
 * It renders whatever the playhead says (this.sequence.q, see timeline.js and
 * controller.js): part poses, lights and camera are all pure functions of q.
 */
export class Anatomy {
  constructor(renderer, { manifest, haze, environment = null, reducedMotion = false, mobile = false } = {}) {
    this.renderer = renderer;
    this.sharedEnvironment = environment;
    this.manifest = manifest;
    this.haze = haze;
    this.reducedMotion = reducedMotion;
    this.mobile = mobile;
    this.ready = false;
    this.loadProgress = 0;
    this.active = false;
    this.sequence = new SequenceController({ reducedMotion });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030303);
    this.scene.fog = new THREE.FogExp2(0x030303, 0.06);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 120);
    this.cameraCache = new Map();

    this.buildEnvironment();
    this.buildStage();
  }

  set snap(v) {
    this.sequence.snap = v;
  }

  /* -------------------------------- set -------------------------------- */

  buildEnvironment() {
    // The same studio as the main car (lookdev/studio.js), so reflections read
    // alike in both scenes; here it is held much lower and brought up with the lights.
    // Shared with the main scene when given (no second capture, no second ~25 MB texture).
    this.envMap = this.sharedEnvironment ?? createStudioEnvironment(this.renderer, { size: this.mobile ? 256 : 512 });
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0;
  }

  buildStage() {
    const shadowSize = this.mobile ? 1024 : 2048;

    // Key: overhead spot, the only shadow caster
    this.key = new THREE.SpotLight(0xfff3e8, 0, 0, 0.48, 0.9, 2);
    this.key.position.set(0.4, 7.5, 1.2);
    this.key.target.position.set(0, 0, 0.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(shadowSize, shadowSize);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.camera.near = 3;
    this.key.shadow.camera.far = 12;
    this.scene.add(this.key, this.key.target);

    // Sweep: a low side light that travels along the car during the reveal
    this.sweep = new THREE.SpotLight(0xffffff, 0, 0, 0.32, 0.95, 2);
    this.sweep.position.set(-6, 1.1, 6.5);
    this.sweep.target.position.set(0, 0.75, 0);
    this.scene.add(this.sweep, this.sweep.target);

    // Rim: cool, from behind and low, separates the silhouette from the dark
    this.rim = new THREE.SpotLight(0xcfdcff, 0, 0, 0.55, 0.9, 2);
    this.rim.position.set(-1.5, 2.4, -7.5);
    this.rim.target.position.set(0, 0.6, 0);
    this.scene.add(this.rim, this.rim.target);

    // Power-unit scene: warm glow from the empty bay below, cool top light for the metal
    this.bay = new THREE.PointLight(0xff8a42, 0, 3.2, 2);
    this.top = new THREE.SpotLight(0xe8eeff, 0, 0, 0.28, 0.8, 2);
    this.scene.add(this.bay, this.top, this.top.target);

    // Floor: dark satin, receives the key's shadow, dissolves into the fog
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.72, metalness: 0 })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Light beam: a soft cone under the key, the "volume" of a dusty studio
    const beamGeo = new THREE.ConeGeometry(2.9, 7.5, 64, 1, true);
    beamGeo.translate(0, -3.75, 0);
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
            float fade = smoothstep(0.0, 1.6, vY) * (1.0 - smoothstep(5.0, 7.4, vY));
            gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * facing * fade * uIntensity, 1.0);
          }`,
      })
    );
    this.beam.position.copy(this.key.position);
    this.beam.lookAt(this.key.target.position);
    this.beam.rotateX(-Math.PI / 2); // cone's −Y (towards its base) → the object's +Z (at the target)
    this.beam.renderOrder = 3;
    this.scene.add(this.beam);
  }

  /* -------------------------------- load ------------------------------- */

  /** Load through the shared asset loader (one fetch, one Draco worker pool). Retries after a failure. */
  load() {
    if (this.loading) return this.loading;
    const registry = this.manifest.registry;
    this.loading = assets
      .loadModel(registry.url, { onProgress: (p) => (this.loadProgress = p) })
      .then((gltf) => {
        this.setup(gltf);
        return this;
      })
      .catch((err) => {
        this.loading = null;
        throw err;
      });
    return this.loading;
  }

  setup(gltf) {
    const vehicle = new VehicleModel(gltf, this.manifest.registry); // also hides registry-flagged marks
    vehicle.report({ verbose: assetDebug });
    if (!vehicle.ok) throw new Error(`[vehicle:${vehicle.registry.id}] required components are missing (see console)`);
    this.vehicle = vehicle;

    const model = gltf.scene;
    model.traverse((o) => o.isMesh && (o.castShadow = true));
    // Re-tint the asset's own paint materials to the site's Rosso
    const paints = new Set(vehicle.slot('paint').flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
    for (const m of paints) {
      m.color.set('#b0121b');
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.04;
    }
    this.model = model;
    this.scene.add(model);
    this.exploder = new Exploder(model, this.manifest, vehicle);
    this.focusPart = this.exploder.byId.get(this.manifest.focus);

    // What each camera key frames, measured from the model in each pose
    const ex = this.exploder;
    const power = ex.boundsAt({ explode: 1, power: 1 }, [this.manifest.focus]);
    this.frames = {
      rest: ex.pointsAt({ explode: 0, power: 0 }),
      exploded: ex.pointsAt({ explode: 1, power: 0 }),
      power: boxCorners(power.clone().expandByScalar(0.25)),
    };
    this.powerCenter = power.getCenter(new THREE.Vector3());
    this.bayCenter = ex.boundsAt({ explode: 0, power: 0 }, [this.manifest.focus]).getCenter(new THREE.Vector3());
    this.cameraCache.clear();

    this.renderer.compile(this.scene, this.camera);
    this.ready = true;
  }

  /* ------------------------------- frame ------------------------------- */

  /** Section scroll progress (0..1). The playhead follows it unless a state button is playing. */
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
    if (aspect >= 1) return { width: 0.78 * fill, height: 0.62 * fill };
    return { width: 0.94 * fill, height: 0.4 * fill };
  }

  /** Camera keys with distances solved for this aspect ratio (cached). */
  cameraKeys(aspect) {
    const key = aspect.toFixed(3);
    let keys = this.cameraCache.get(key);
    if (keys) return keys;
    keys = CAMERA_KEYS.map((k) => {
      const [x, y, z] = k.target === 'power' ? this.powerCenter.toArray() : k.target;
      const view = { az: k.az, el: k.el, fov: k.fov, tx: x, ty: y, tz: z };
      const dist = fitDistance(view, { aspect, ...this.frameShare(aspect, k.fill), points: this.frames[k.frame], pointsKey: `anatomy:${k.frame}` });
      return { t: k.t, az: k.az, el: k.el, fov: k.fov, dist, x, y, z };
    });
    this.cameraCache.set(key, keys);
    return keys;
  }

  update(dt) {
    this.sequence.update(dt);
    const q = this.sequence.q;
    this.q = q;
    if (!this.ready) return;

    // --- camera -------------------------------------------------------
    const aspect = this.width / this.height;
    const c = sampleMonotone(this.cameraKeys(aspect), q, CAMERA_CHANNELS, { log: ['dist'] });
    const a = c.az * DEG;
    const e = c.el * DEG;
    this.camera.position.set(c.x + c.dist * Math.sin(a) * Math.cos(e), c.y + c.dist * Math.sin(e), c.z + c.dist * Math.cos(a) * Math.cos(e));
    this.camera.lookAt(c.x, c.y, c.z);
    this.camera.fov = c.fov;
    // Subject away from the copy: right of centre on wide screens, high on tall ones
    const sx = aspect >= 1.2 ? -0.09 * this.width : 0;
    const sy = aspect < 1 ? 0.1 * this.height : 0;
    this.camera.setViewOffset(this.width, this.height, sx, sy, this.width, this.height);
    this.camera.updateProjectionMatrix();
    // A wide shot on a narrow screen must not push the car into the fog
    this.scene.fog.density = 0.5 / Math.max(c.dist, 7);
    this.cameraState = c;

    // --- parts ---------------------------------------------------------
    this.exploder.set({ explode: explodeAt(q), power: powerAt(q) });

    // --- lights --------------------------------------------------------
    const L = lightsAt(q);
    this.focus = L.focus;
    const on = L.reveal * L.fadeOut;
    this.scene.environmentIntensity = (0.03 + 0.32 * L.reveal + 0.2 * L.study + 0.12 * L.hero) * (1 - L.focus * 0.5) * L.fadeOut;
    this.key.intensity = (260 + 120 * L.study) * on * (1 - L.focus * 0.55);
    this.rim.intensity = (60 + 120 * L.hero) * smoothOn(q) * L.fadeOut;
    this.sweep.position.x = THREE.MathUtils.lerp(-7, 7, L.sweep);
    this.sweep.intensity = 90 * Math.sin(Math.PI * L.sweep) * (1 - L.study) + 70 * L.hero * L.fadeOut;
    this.beam.material.uniforms.uIntensity.value = 0.05 * on * (1 - L.focus * 0.6);

    // The power-unit state: a cool top light on the lifted volume, a warm glow in the empty bay
    const engine = this.exploder.anchor(this.manifest.focus, this.engineAnchor ?? new THREE.Vector3());
    this.engineAnchor = engine;
    this.bay.position.copy(this.bayCenter).add(new THREE.Vector3(0, 0.15, 0));
    this.bay.intensity = L.focus * 2.4;
    this.top.position.copy(engine).add(new THREE.Vector3(-1.2, 3.2, 0.8));
    this.top.target.position.copy(engine);
    this.top.intensity = L.focus * 80;
  }

  render() {
    if (this.haze) this.haze.render(this.scene, this.camera, [], performance.now() / 1000);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (px) of a part's anchor (or of a point on it, in rest model space), for DOM annotations. */
  project(partId, out = { x: 0, y: 0, behind: false }, at = null) {
    const v = this.exploder?.anchor(partId, new THREE.Vector3(), at);
    if (!v) return null;
    v.project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.behind = v.z > 1;
    return out;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        }
      }
    });
    if (!this.sharedEnvironment) this.envMap.dispose();
    this.key.shadow.map?.dispose();
    this.ready = false;
  }
}
