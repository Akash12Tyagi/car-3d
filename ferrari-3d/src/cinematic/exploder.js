import * as THREE from 'three';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Binds a part manifest to a loaded vehicle and poses it for any value of the
 * sequence channels (0 = assembled, 1 = fully apart):
 *   explode  body panels, glass, wheels and brakes, cockpit
 *   power    the powertrain (moves only once the body is open)
 *
 * Coordinates, deliberately:
 *  - Every motion is authored in MODEL space (the vehicle root's frame: Y up,
 *    nose +Z, metres), so it reads the same whatever the car's place in the scene.
 *  - At load each moving node is re-parented onto the vehicle root with its
 *    world transform kept (`attach`). Its rest transform is then local to the
 *    root, i.e. in model space, and its path no longer depends on a parent that
 *    may itself be moving (the brake disc is a child of the wheel in the file,
 *    but leaves on its own path). Children that are not listed stay with their
 *    parent (door glass in the door, headlamps in the front clamshell).
 *  - A pose is rest ∘ hinge ∘ translation, rebuilt from the stored rest
 *    transform every time: M = T(move·k) · T(pivot) · R(axis, angle·k) · T(−pivot) · Rest.
 *    Nothing accumulates between frames or runs, and k = 0 copies the stored
 *    rest values back exactly (bit-for-bit, not approximately).
 */
export class Exploder {
  constructor(root, manifest, vehicle) {
    this.root = root;
    this.parts = [];
    this.byId = new Map();
    this.missing = [];

    root.updateMatrixWorld(true);

    for (const def of manifest.parts) {
      const nodes = def.components.flatMap((id) => (vehicle.has(id) ? vehicle.nodes(id) : (this.missing.push(id), [])));
      if (!nodes.length) continue;

      const entries = nodes.map((node) => {
        root.attach(node);
        node.updateMatrixWorld(true);
        return {
          node,
          restPosition: node.position.clone(),
          restQuaternion: node.quaternion.clone(),
          restScale: node.scale.clone(),
          restLocal: node.matrix.clone(), // in root (model) space
          pivot: new THREE.Vector3().setFromMatrixPosition(node.matrix),
        };
      });

      // Anchor for annotations: centre of the part's bounds, stored in the first node's space
      const box = new THREE.Box3();
      nodes.forEach((n) => box.expandByObject(n, true));
      const anchorLocal = nodes[0].worldToLocal(box.getCenter(new THREE.Vector3()));

      const part = {
        def,
        channel: def.channel ?? 'explode',
        entries,
        anchorLocal,
        hinge: def.hinge
          ? {
              axis: new THREE.Vector3(...def.hinge.axis).normalize(),
              angle: THREE.MathUtils.degToRad(def.hinge.angle),
              pivot: def.hinge.pivot ? new THREE.Vector3(...def.hinge.pivot) : null,
            }
          : null,
        move: new THREE.Vector3(...(def.move ?? [0, 0, 0])),
        amount: 0,
      };
      this.parts.push(part);
      this.byId.set(def.id, part);
    }
    if (this.missing.length) console.warn('[exploder] components not available in this asset:', this.missing.join(', '));

    this._m = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._r = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.pose = { explode: -1, power: -1 };
  }

  /** Pose every part for the given channel values (0..1 each). */
  set({ explode = 0, power = 0 } = {}) {
    explode = clamp01(explode);
    power = clamp01(power);
    if (explode === this.pose.explode && power === this.pose.power) return;
    this.pose.explode = explode;
    this.pose.power = power;
    for (const part of this.parts) {
      const [w0, w1] = part.def.window;
      const k = easeInOut(clamp01(((part.channel === 'power' ? power : explode) - w0) / (w1 - w0)));
      if (k === part.amount && part.posed) continue;
      part.amount = k;
      part.posed = true;
      for (const en of part.entries) {
        if (k === 0) {
          en.node.position.copy(en.restPosition);
          en.node.quaternion.copy(en.restQuaternion);
          en.node.scale.copy(en.restScale);
          continue;
        }
        const m = this._m.copy(en.restLocal);
        if (part.hinge) {
          const pivot = part.hinge.pivot ?? part.entries[0].pivot;
          this._q.setFromAxisAngle(part.hinge.axis, part.hinge.angle * k);
          m.premultiply(this._t.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
          m.premultiply(this._r.makeRotationFromQuaternion(this._q));
          m.premultiply(this._t.makeTranslation(pivot.x, pivot.y, pivot.z));
        }
        m.premultiply(this._t.makeTranslation(part.move.x * k, part.move.y * k, part.move.z * k));
        m.decompose(en.node.position, en.node.quaternion, en.node.scale);
      }
    }
  }

  /**
   * World-space anchor of a part (follows its current pose): the centre of its
   * bounds, or `at`, a point given in rest model space — for a part whose
   * centre is not on the part (the axle set's centre lies between the axles).
   */
  anchor(id, target = new THREE.Vector3(), at = null) {
    const part = this.byId.get(id);
    if (!part) return null;
    const en = part.entries[0];
    let local = part.anchorLocal;
    if (at) {
      const key = at.join(',');
      part.anchors ??= new Map();
      local = part.anchors.get(key);
      if (!local) part.anchors.set(key, (local = new THREE.Vector3(...at).applyMatrix4(en.restLocal.clone().invert())));
    }
    return en.node.localToWorld(target.copy(local));
  }

  /** World bounds of the given parts (default: the whole model) at a pose, then back to the current pose. */
  boundsAt(pose, ids = null, target = new THREE.Box3()) {
    const current = { ...this.pose };
    this.set(pose);
    this.root.updateMatrixWorld(true);
    target.makeEmpty();
    if (ids) for (const id of ids) this.byId.get(id)?.entries.forEach((en) => target.expandByObject(en.node, true));
    else target.expandByObject(this.root, true);
    this.set(current);
    this.root.updateMatrixWorld(true);
    return target;
  }

  /**
   * Corners of every visible mesh's own world bounds at a pose (then back to the
   * current pose): a tight point set for camera framing.
   */
  pointsAt(pose) {
    const current = { ...this.pose };
    this.set(pose);
    this.root.updateMatrixWorld(true);
    const points = [];
    const box = new THREE.Box3();
    this.root.traverseVisible((o) => {
      if (!o.isMesh) return;
      box.setFromObject(o, true);
      if (box.isEmpty()) return;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
    });
    this.set(current);
    this.root.updateMatrixWorld(true);
    return points;
  }

  /**
   * Largest deviation from rest: max of positional drift (m) and 1−|q·q₀|.
   * 0 means every part is home. `exact` also requires identical numbers.
   */
  restError() {
    let max = 0;
    let exact = true;
    for (const p of this.parts)
      for (const en of p.entries) {
        const n = en.node;
        max = Math.max(max, n.position.distanceTo(en.restPosition), 1 - Math.abs(n.quaternion.dot(en.restQuaternion)), n.scale.distanceTo(en.restScale));
        exact &&= n.position.equals(en.restPosition) && n.quaternion.equals(en.restQuaternion) && n.scale.equals(en.restScale);
      }
    return { max, exact };
  }
}
