import * as THREE from 'three';

/**
 * Named, reusable camera views of the car, composed like a stills shoot.
 *
 * A view fixes the angle and the lens; the DISTANCE is solved from the car's
 * real bounding box so that its projected silhouette fills a chosen share of
 * the frame. That keeps compositions correct at any aspect ratio (no tiny car
 * in a wide frame, no clipping on a phone) without per-device magic numbers.
 *
 * Orbit convention (same as the Experience rig): az 0 = camera on +Z (behind
 * this car), az 180 = in front of the nose, el = degrees above the ground.
 * Focal lengths are given for a 36 mm-high sensor equivalent.
 */
export const FRONT = 180;

export const VIEWS = {
  // Classic campaign three-quarter: low, ~60 mm, nose leading the frame
  hero34: { az: FRONT + 38, el: 6.5, fov: 24, ty: 0.5 },
  // Long-lens side elevation: perspective almost flattened, like a press profile
  profile: { az: FRONT + 90, el: 1.5, fov: 17, ty: 0.55 },
  // Rear three-quarter from slightly above: deck, louvres and tailpipes
  rear34: { az: FRONT - 145, el: 15, fov: 26, ty: 0.45 },
  // The opposite front three-quarter, a touch higher: used by the configurator
  atelier34: { az: FRONT - 40, el: 11, fov: 25, ty: 0.42 },
  // Straight-on front, for symmetry shots
  front: { az: FRONT, el: 4, fov: 22, ty: 0.5 },
};

// Car-space bounds of ferrari.glb, used until the real ones are measured at load
const DEFAULT_BOUNDS = new THREE.Box3(new THREE.Vector3(-1.13, 0, -2.27), new THREE.Vector3(1.13, 1.24, 2.27));

const camera = new THREE.PerspectiveCamera();
const corner = new THREE.Vector3();
const target = new THREE.Vector3();
const cache = new Map();

/**
 * Distance at which the car (bounds in car space, yawed by `rot` degrees)
 * fills `width` × `height` of the frame (fractions of the full NDC extent)
 * for the given view and aspect ratio.
 */
export function fitDistance(view, { aspect, width, height, rot = 0, bounds = DEFAULT_BOUNDS }) {
  const key = `${view.az}|${view.el}|${view.fov}|${view.ty}|${aspect.toFixed(3)}|${width}|${height}|${rot}|${bounds.max.x.toFixed(3)}|${bounds.max.z.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const yaw = THREE.MathUtils.degToRad(rot);
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));

  camera.fov = view.fov;
  camera.aspect = aspect;
  camera.near = 0.05;
  camera.far = 500;
  camera.updateProjectionMatrix();
  target.set(view.tx ?? 0, view.ty ?? 0.5, view.tz ?? 0);
  const a = THREE.MathUtils.degToRad(view.az);
  const e = THREE.MathUtils.degToRad(view.el);
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));

  let lo = 0.5;
  let hi = 200;
  for (let i = 0; i < 32; i++) {
    const d = (lo + hi) / 2;
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const fits = corners.every((c) => {
      corner.copy(c).project(camera);
      return corner.z < 1 && Math.abs(corner.x) <= width && Math.abs(corner.y) <= height;
    });
    if (fits) hi = d;
    else lo = d;
  }
  cache.set(key, hi);
  return hi;
}

/**
 * A rig keyframe (Experience format) for a named view.
 * @param {string} name   key of VIEWS
 * @param {object} frame  { aspect, width, height, shift?, rot?, bounds?, ...overrides }
 */
export function viewRig(name, { aspect, width, height, shift = 0, rot = 0, bounds, ...overrides }) {
  const view = { ...VIEWS[name], ...overrides };
  return {
    az: view.az,
    el: view.el,
    fov: view.fov,
    tx: view.tx ?? 0,
    ty: view.ty,
    tz: view.tz ?? 0,
    rot,
    shift,
    roll: view.roll ?? 0,
    dist: fitDistance(view, { aspect, width, height, rot, bounds }),
  };
}
