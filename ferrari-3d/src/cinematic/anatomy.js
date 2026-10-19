import * as THREE from 'three';
import { Exploder } from './exploder.js';
import { assets, assetDebug } from '../vehicle/asset-loader.js';
import { VehicleModel } from '../vehicle/vehicle-model.js';

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ */
/* Story beats, as ranges of section progress (0..1)                    */
/* ------------------------------------------------------------------ */
export const BEATS = [
  { id: 'reveal', from: 0, to: 0.2 },
  { id: 'exploded', from: 0.2, to: 0.54 },
  { id: 'power', from: 0.54, to: 0.72 },
  { id: 'reassembly', from: 0.72, to: 0.88 },
  { id: 'hero', from: 0.88, to: 1 },
];

/** Explode timeline as a function of section progress. */
export function explodeAt(p) {
  if (p < 0.2) return 0;
  if (p < 0.46) return (p - 0.2) / 0.26;
  if (p < 0.72) return 1;
  if (p < 0.88) return 1 - (p - 0.72) / 0.16;
  return 0;
}

/*
 * Camera path. Orbit coordinates around a target (az 0 = in front of the nose,
 * az 90 = the car's left flank). Interpolated with Catmull-Rom tangents so the
 * camera keeps its momentum through each key instead of stopping on it.
 *    p     az   el   dist  tx   ty    tz    fov
 */
const PATH = [
  [0.0, 28, 5, 8.4, 0, 0.45, 0.2, 28],
  [0.1, 50, 6, 7.0, 0, 0.5, 0.2, 28],
  [0.19, 90, 3, 7.8, 0, 0.5, 0.2, 24],
  [0.3, 72, 15, 10.6, 0, 0.7, 0.2, 28],
  [0.44, 38, 25, 12.8, 0, 0.8, 0.3, 30],
  [0.53, -18, 23, 12.6, 0, 0.8, 0.3, 30],
  [0.61, -66, 38, 5.8, 0, 1.4, 2.15, 30],
  [0.7, -38, 31, 5.0, 0, 1.45, 2.15, 28],
  [0.8, 22, 16, 10.2, 0, 0.6, 0.2, 28],
  [0.89, 42, 4, 8.8, 0, 0.5, 0.2, 26],
  [1.0, 92, 6, 8.4, 0, 0.5, 0.2, 26],
];

function samplePath(p) {
  const n = PATH.length;
  let i = 0;
  while (i < n - 2 && p > PATH[i + 1][0]) i++;
  const k0 = PATH[Math.max(0, i - 1)];
  const k1 = PATH[i];
  const k2 = PATH[i + 1];
  const k3 = PATH[Math.min(n - 1, i + 2)];
  const span = k2[0] - k1[0];
  const t = clamp01((p - k1[0]) / span);
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [];
  for (let c = 1; c < 8; c++) {
    // non-uniform Catmull-Rom tangents, scaled to this segment's duration
    const m1 = ((k2[c] - k0[c]) / Math.max(k2[0] - k0[0], 1e-4)) * span;
    const m2 = ((k3[c] - k1[c]) / Math.max(k3[0] - k1[0], 1e-4)) * span;
    out.push(
      (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2
    );
  }
  return out; // az, el, dist, tx, ty, tz, fov
}

export class Anatomy {
  constructor(renderer, { manifest, haze, reducedMotion = false, mobile = false } = {}) {
    this.renderer = renderer;
    this.manifest = manifest;
    this.haze = haze;
    this.reducedMotion = reducedMotion;
    this.mobile = mobile;
    this.progress = 0;
    this.progressDamped = 0;
    this.ready = false;
    this.loadProgress = 0;
    this.active = false;
    this.jittered = false;
    this.snap = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030303);
    this.scene.fog = new THREE.FogExp2(0x030303, 0.06);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 120);

    this.buildEnvironment();
    this.buildStage();
  }

  /* -------------------------------- set -------------------------------- */

  buildEnvironment() {
    // A darker cousin of the studio used elsewhere: one long overhead softbox
    // and two low strip lights. Its intensity is animated for the reveal.
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x000000);
    const plane = new THREE.PlaneGeometry(1, 1);
    const box = (x, y, z, sx, sy, intensity, color = 0xffffff) => {
      const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, 1);
      m.lookAt(0, 0.5, 0);
      env.add(m);
    };
    box(0, 6, 0, 2.2, 12, 2.4);
    box(-7, 1.2, 0, 14, 0.6, 1.2, 0xdfe8ff);
    box(7, 1.2, 0, 14, 0.6, 1.2, 0xfff0e0);
    box(0, 2.5, 8, 6, 1.2, 0.8);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    plane.dispose();
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
    this.renderer.compile(this.scene, this.camera);
    this.ready = true;
  }

  /* ------------------------------- frame ------------------------------- */

  setProgress(p) {
    this.progress = clamp01(p);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, time) {
    const lambda = this.snap ? Infinity : 7;
    this.progressDamped += (this.progress - this.progressDamped) * (1 - Math.exp(-lambda * dt));
    if (Math.abs(this.progress - this.progressDamped) < 1e-5) this.progressDamped = this.progress;
    const p = this.progressDamped;

    // --- camera -------------------------------------------------------
    const [az, el, dist, tx, ty, tz, fov] = samplePath(p);
    const aspect = this.width / this.height;
    // keep the car and its exploded spread in frame on narrow screens
    // (portrait: the horizontal field of view is what limits framing, so pull back much further)
    const fit = aspect < 1 ? Math.pow(1 / aspect, 1.45) : aspect < 1.35 ? 1.12 : 1;
    const target = new THREE.Vector3(tx, ty, tz);
    const a = az * DEG;
    const e = el * DEG;
    const d = dist * fit;
    // pulling the camera back for narrow screens must not pull the car into the fog
    this.scene.fog.density = 0.06 / fit;
    this.camera.position.set(tx + d * Math.sin(a) * Math.cos(e), ty + d * Math.sin(e), tz + d * Math.cos(a) * Math.cos(e));
    this.camera.lookAt(target);
    this.camera.fov = fov;
    // Frame the subject away from the copy: right of centre on wide screens, high on tall ones
    const sx = aspect >= 1.2 ? -0.09 * this.width : 0;
    const sy = aspect < 1 ? 0.1 * this.height : 0;
    this.camera.setViewOffset(this.width, this.height, sx, sy, this.width, this.height);
    this.camera.updateProjectionMatrix();

    // --- lighting ------------------------------------------------------
    const reveal = smooth(0.0, 0.13, p);
    const fadeOut = 1 - smooth(0.955, 1.0, p);
    const focus = smooth(0.55, 0.61, p) * (1 - smooth(0.69, 0.75, p));
    const hero = smooth(0.86, 0.92, p);
    this.focus = focus;

    // the exploded view is a technical drawing: open the lights up while it holds
    const study = smooth(0.24, 0.36, p) * (1 - smooth(0.5, 0.58, p));
    this.scene.environmentIntensity = (0.04 + 0.7 * smooth(0.04, 0.18, p) + 0.45 * study) * (1 - focus * 0.45) * fadeOut;
    this.key.intensity = (260 + 120 * study) * reveal * (1 - focus * 0.55) * fadeOut;
    this.rim.intensity = (60 + 120 * hero) * smooth(0.0, 0.08, p) * fadeOut;
    const sweepT = smooth(0.0, 0.2, p);
    this.sweep.position.x = THREE.MathUtils.lerp(-7, 7, sweepT);
    this.sweep.intensity = 90 * Math.sin(Math.PI * sweepT) * (1 - smooth(0.16, 0.22, p)) + 70 * hero * fadeOut;
    this.beam.material.uniforms.uIntensity.value = 0.05 * reveal * fadeOut * (1 - focus * 0.6);

    if (!this.ready) return;

    // --- parts ---------------------------------------------------------
    const E = explodeAt(p);
    const vibrate = focus > 0.001 && !this.reducedMotion;
    // vibration is layered on top of the pose, so re-pose when it was applied last frame
    if (vibrate || this.jittered) this.exploder.E = -1;
    this.exploder.set(E);
    this.jittered = false;

    if (this.focusPart) {
      const engineAnchor = this.exploder.anchor(this.manifest.focus, new THREE.Vector3());
      // a firing-order-like rhythm: short, uneven pulses rather than a sine wave
      const beat = Math.pow(Math.max(0, Math.sin(time * 9.4)), 10) * 0.7 + Math.pow(Math.max(0, Math.sin(time * 9.4 + 2.2)), 14) * 0.5;
      // warm light from the empty bay below, breathing with the pulses
      this.bay.position.copy(engineAnchor).add(new THREE.Vector3(0, -0.75, 0.1));
      this.bay.intensity = focus * (0.9 + (this.reducedMotion ? 0 : beat * 1.6)) * 2.2;
      this.top.position.copy(engineAnchor).add(new THREE.Vector3(-1.2, 3.2, 0.8));
      this.top.target.position.copy(engineAnchor);
      this.top.intensity = focus * 55;
      if (vibrate) {
        const amp = focus * (0.0025 + beat * 0.003);
        for (const en of this.focusPart.entries) {
          en.node.position.x += Math.sin(time * 233) * amp;
          en.node.position.y += Math.sin(time * 197 + 1.7) * amp;
        }
        this.jittered = true;
      }
      this.engineAnchor = engineAnchor;
    }
  }

  render() {
    const sources = [];
    if (this.ready && this.focus > 0.01 && !this.reducedMotion && this.engineAnchor) {
      const from = this.engineAnchor.clone().add(new THREE.Vector3(0, 0.32, 0));
      sources.push({ from, to: from.clone().add(new THREE.Vector3(0, 1.4, 0)), width: 0.12, strength: this.focus * 0.75 });
    }
    if (this.haze) this.haze.render(this.scene, this.camera, sources, performance.now() / 1000);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (px) of a part's anchor, for DOM callouts. */
  project(partId, out = { x: 0, y: 0, behind: false }) {
    const v = this.exploder?.anchor(partId, new THREE.Vector3());
    if (!v) return null;
    v.project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.behind = v.z > 1;
    return out;
  }

  beat() {
    const p = this.progressDamped;
    return BEATS.find((b) => p >= b.from && p < b.to)?.id ?? 'hero';
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
    this.envMap.dispose();
    this.key.shadow.map?.dispose();
    this.ready = false;
  }
}
