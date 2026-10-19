import * as THREE from 'three';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Binds a part manifest to a loaded vehicle and poses it for any value of
 * the explode timeline E (0 = assembled, 1 = fully exploded). Parts reference
 * registry component IDs; the VehicleModel supplies the actual objects.
 *
 * The pose is a pure function of E: nothing accumulates between frames, so
 * scrolling backwards replays the exact path in reverse, and E = 0 restores
 * every node to its stored rest transform (bit-for-bit, not approximately).
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
        // Detach onto the model root (world transform preserved) so this part's
        // path is independent of whichever parent it shipped under.
        root.attach(node);
        node.updateMatrixWorld(true);
        return {
          node,
          restPosition: node.position.clone(),
          restQuaternion: node.quaternion.clone(),
          restScale: node.scale.clone(),
          restLocal: node.matrix.clone(), // in root space
          pivot: new THREE.Vector3().setFromMatrixPosition(node.matrix),
        };
      });

      // Anchor for callouts: centre of the part's bounds, stored in the first node's space
      const box = new THREE.Box3();
      nodes.forEach((n) => box.expandByObject(n, true));
      const centerWorld = box.getCenter(new THREE.Vector3());
      const anchorLocal = nodes[0].worldToLocal(centerWorld.clone());

      const part = {
        def,
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
    this.E = -1;
  }

  /** Pose all parts for explode-timeline value E (0..1). */
  set(E) {
    E = clamp01(E);
    if (E === this.E) return;
    this.E = E;
    for (const part of this.parts) {
      const [w0, w1] = part.def.window;
      const k = easeInOut(clamp01((E - w0) / (w1 - w0)));
      part.amount = k;
      for (const en of part.entries) {
        if (k === 0) {
          en.node.position.copy(en.restPosition);
          en.node.quaternion.copy(en.restQuaternion);
          en.node.scale.copy(en.restScale);
          continue;
        }
        // M = T(move·k) · T(pivot) · R(axis, angle·k) · T(-pivot) · Rest
        const m = this._m.copy(en.restLocal);
        if (part.hinge) {
          const pivot = part.hinge.pivot ?? part.entries[0].pivot;
          this._q.setFromAxisAngle(part.hinge.axis, part.hinge.angle * k);
          this._t.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
          m.premultiply(this._t);
          m.premultiply(this._r.makeRotationFromQuaternion(this._q));
          m.premultiply(this._t.makeTranslation(pivot.x, pivot.y, pivot.z));
        }
        m.premultiply(this._t.makeTranslation(part.move.x * k, part.move.y * k, part.move.z * k));
        m.decompose(en.node.position, en.node.quaternion, en.node.scale);
      }
    }
  }

  /** World-space anchor of a part (follows its current pose). */
  anchor(id, target = new THREE.Vector3()) {
    const part = this.byId.get(id);
    if (!part) return null;
    return part.entries[0].node.localToWorld(target.copy(part.anchorLocal));
  }

  /** Largest deviation from rest, in metres; 0 means every part is home. */
  restError() {
    let max = 0;
    for (const p of this.parts)
      for (const en of p.entries) {
        max = Math.max(max, en.node.position.distanceTo(en.restPosition), 1 - Math.abs(en.node.quaternion.dot(en.restQuaternion)));
      }
    return max;
  }
}
