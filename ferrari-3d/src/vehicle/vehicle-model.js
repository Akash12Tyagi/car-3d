import * as THREE from 'three';
import { indexTree, resolveRegistry, unclaimedMeshNodes, describeSelector } from './selectors.js';
import { selectVariant } from './materials-variants.js';

/**
 * A loaded vehicle, addressed by component ID instead of mesh names.
 *
 *   const car = new VehicleModel(gltf, ferrari458);
 *   car.ok                         // false if a required component is missing
 *   car.node('wheel.fl')           // the component's transform handle (Object3D)
 *   car.meshes('body.shell')       // its meshes (own, or whole subtree)
 *   car.setSlotMaterial('paint', material)
 *   car.restore('panel.door.left') // back to the transform it was exported with
 *
 * Nothing here animates. It resolves the registry once, tags every object with
 * `userData.componentId`, snapshots each component's exported (rest) transform
 * and exposes the hooks later phases build on: transform handles, hinge
 * metadata, material slots and authored material variants.
 */
export class VehicleModel {
  constructor(gltf, registry) {
    this.gltf = gltf;
    this.registry = registry;
    this.scene = gltf.scene;
    this.scene.updateMatrixWorld(true);

    const assoc = gltf.parser.associations;
    const index = indexTree(treeFromThree(gltf));
    const { resolved, problems, claimed } = resolveRegistry(index, registry);
    this.problems = problems;
    this.unclaimed = unclaimedMeshNodes(index, claimed).map((n) => n.path ?? n.ref.name);
    this.root = index.byPath.get(registry.root)?.ref ?? null;
    if (!this.root) problems.push({ id: '(root)', required: true, message: `root node "${registry.root}" not found` });
    this.ok = !problems.some((p) => p.required);

    // "Model space" = the frame the vehicle root sits in. Measuring against the
    // root's parent (not the glTF scene) keeps this valid after the site moves
    // the car under its own rig.
    const modelInverse = this.modelFrameInverse();
    this.components = new Map();
    for (const def of registry.components) {
      const nodes = resolved.get(def.id);
      if (!nodes) continue;
      const objects = nodes.map((n) => n.ref);
      const meshes = [];
      for (const o of objects) {
        if (def.scope === 'self') ownMeshes(o, assoc).forEach((m) => meshes.push(m));
        else o.traverse((m) => m.isMesh && meshes.push(m));
      }
      this.components.set(def.id, {
        id: def.id,
        def,
        objects,
        meshes,
        // exported transform, local to the parent, plus where it sits in model space
        rest: objects.map((o) => ({
          object: o,
          parent: o.parent,
          position: o.position.clone(),
          quaternion: o.quaternion.clone(),
          scale: o.scale.clone(),
          modelMatrix: o.matrixWorld.clone().premultiply(modelInverse),
        })),
        pivot: new THREE.Vector3().setFromMatrixPosition(objects[0].matrixWorld).applyMatrix4(modelInverse),
        depth: depthOf(objects[0]),
      });
    }

    // Tag objects with their component, most specific wins (a tyre is
    // "wheel.fl.tire", not the "wheel.fl" assembly that contains it).
    for (const c of [...this.components.values()].sort((a, b) => a.depth - b.depth)) {
      for (const o of c.objects) o.userData.componentId = c.id;
      for (const m of c.meshes) m.userData.componentId = c.id;
    }

    // Material slots resolve to concrete meshes now, so later material swaps
    // (variants, configurator) don't change which meshes a slot means.
    // A slot is a list of clauses:
    //   { components: [...] }                     every mesh of those components
    //   { components: [...], material: 'Name' }   only meshes whose original material is 'Name'
    //   { materials: [...] }                      every mesh in the asset using those materials
    this.slots = new Map();
    for (const [name, clauses] of Object.entries(registry.slots ?? {})) {
      const set = new Set();
      for (const clause of clauses) {
        const keep = clause.material ? (m) => materialsOf(m).some((x) => x.name === clause.material) : () => true;
        for (const id of clause.components ?? []) if (this.has(id)) this.meshes(id).filter(keep).forEach((m) => set.add(m));
        if (clause.materials) {
          const want = new Set(clause.materials);
          this.scene.traverse((m) => m.isMesh && materialsOf(m).some((x) => want.has(x.name)) && set.add(m));
        }
      }
      if (!set.size) this.problems.push({ id: `slot:${name}`, required: false, message: 'slot resolves to no meshes' });
      this.slots.set(name, [...set]);
    }

    this.checkHinges();
    this.applyVisibility();
  }

  /* ---------------------------- lookup ----------------------------- */

  has(id) {
    return this.components.has(id);
  }

  component(id) {
    const c = this.components.get(id);
    if (!c) throw new Error(`[vehicle:${this.registry.id}] unknown or unresolved component "${id}"`);
    return c;
  }

  /** The component's primary transform handle. */
  node(id) {
    return this.component(id).objects[0];
  }

  /** All transform handles of a component (multi-node components have several). */
  nodes(id) {
    return this.component(id).objects;
  }

  meshes(id) {
    return this.component(id).meshes;
  }

  ids({ group } = {}) {
    return [...this.components.values()].filter((c) => !group || c.def.group === group).map((c) => c.id);
  }

  anchor(name) {
    return (this.registry.anchors?.[name] ?? null);
  }

  modelFrameInverse() {
    const frame = this.root?.parent ?? this.scene;
    frame.updateMatrixWorld(true);
    return frame.matrixWorld.clone().invert();
  }

  /** Bounding box of a component in model space (current pose). */
  bounds(id, target = new THREE.Box3()) {
    target.makeEmpty();
    for (const o of this.nodes(id)) target.expandByObject(o, true);
    return target.applyMatrix4(this.modelFrameInverse());
  }

  /* --------------------------- transforms --------------------------- */

  /** Put a component (or every component) back to its exported transform and parent. */
  restore(id) {
    const list = id ? [this.component(id)] : this.components.values();
    for (const c of list)
      for (const r of c.rest) {
        if (r.object.parent !== r.parent) r.parent.add(r.object);
        r.object.position.copy(r.position);
        r.object.quaternion.copy(r.quaternion);
        r.object.scale.copy(r.scale);
      }
  }

  /**
   * Largest drift from the exported pose across all components, measured in
   * model space (so a part re-parented with its world transform kept still
   * counts as at rest). Returns the max of positional drift (m) and 1−|q·q₀|.
   */
  restDeviation() {
    const inv = this.modelFrameInverse();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3(), p0 = new THREE.Vector3();
    const q = new THREE.Quaternion(), q0 = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let max = 0;
    for (const c of this.components.values())
      for (const r of c.rest) {
        m.copy(r.object.matrixWorld).premultiply(inv).decompose(p, q, s);
        r.modelMatrix.decompose(p0, q0, s);
        max = Math.max(max, p.distanceTo(p0), 1 - Math.abs(q.dot(q0)));
      }
    return max;
  }

  /* ---------------------------- materials --------------------------- */

  slot(name) {
    const meshes = this.slots.get(name);
    if (!meshes) throw new Error(`[vehicle:${this.registry.id}] unknown material slot "${name}"`);
    return meshes;
  }

  /** Assign one material (or a per-mesh function) to every mesh in a slot. */
  setSlotMaterial(name, material) {
    for (const mesh of this.slot(name)) {
      mesh.material = typeof material === 'function' ? material(mesh) : material;
      mesh.userData.restyled = true;
    }
  }

  get variants() {
    return this.gltf.userData.variants ?? [];
  }

  selectVariant(name, options) {
    return selectVariant(this.gltf, name, options);
  }

  /* --------------------------- diagnostics -------------------------- */

  applyVisibility() {
    for (const c of this.components.values()) if (c.def.hidden) c.objects.forEach((o) => (o.visible = false));
  }

  /** Registry hinge positions are documentation; check they still match the file. */
  checkHinges() {
    for (const c of this.components.values()) {
      const at = c.def.hinge?.pivotAt;
      if (!at) continue;
      const d = c.pivot.distanceTo(new THREE.Vector3(...at));
      if (d > 0.03) this.problems.push({ id: c.id, required: false, message: `hinge pivot moved ${d.toFixed(3)} m from the registry (asset re-exported?)` });
    }
  }

  /**
   * Missing required components are always reported (console.error). The full
   * component table is printed when `verbose` (dev builds or ?debug=assets).
   */
  report({ verbose = false } = {}) {
    const tag = `[vehicle:${this.registry.id}]`;
    for (const p of this.problems) {
      if (p.required) console.error(`${tag} required component ${p.id}: ${p.message}`);
      else if (verbose) console.warn(`${tag} ${p.id}: ${p.message}`);
    }
    if (!verbose) return;
    console.groupCollapsed(`${tag} ${this.components.size}/${this.registry.components.length} components resolved`);
    console.table(
      [...this.components.values()].map((c) => ({
        id: c.id,
        group: c.def.group,
        meshes: c.meshes.length,
        select: c.def.select.map(describeSelector).join(' + '),
        flags: [c.def.placeholder && 'placeholder', c.def.hidden && 'hidden', c.def.hinge && 'hinged', c.def.movable && 'movable'].filter(Boolean).join(' '),
      }))
    );
    if (this.unclaimed.length) console.info(`${tag} meshes outside the registry:`, this.unclaimed);
    console.info(`${tag} not in this asset:`, this.registry.missing);
    console.groupEnd();
  }
}

/* ------------------------------------------------------------------ */
/* three.js scene → selector tree, using glTF node associations so     */
/* names are the original ones and primitives stay with their node.     */
/* ------------------------------------------------------------------ */
function treeFromThree(gltf) {
  const assoc = gltf.parser.associations;
  const isNode = (o) => assoc.get(o)?.nodes !== undefined;
  const build = (o) => {
    const node = { name: o.userData.name ?? null, ref: o, materials: [], children: [] };
    for (const m of ownMeshes(o, assoc)) node.materials.push(...materialsOf(m).map((x) => x.name));
    const visit = (child) => {
      if (isNode(child)) node.children.push(build(child));
      else if (!child.isMesh) child.children.forEach(visit); // pass through helper groups
    };
    o.children.forEach(visit);
    return node;
  };
  const roots = [];
  const findRoots = (o) => (isNode(o) ? roots.push(build(o)) : o.children.forEach(findRoots));
  gltf.scene.children.forEach(findRoots);
  return roots;
}

/**
 * The meshes that belong to this glTF node itself (its primitives), not to child
 * nodes. A multi-primitive node is a Group of primitive meshes; GLTFLoader's
 * associations tell primitives ({ meshes, primitives }) apart from child nodes ({ nodes }).
 */
function ownMeshes(o, assoc) {
  if (o.isMesh) return [o];
  return o.children.filter((c) => {
    const a = assoc.get(c);
    return c.isMesh && a?.primitives !== undefined && a.nodes === undefined;
  });
}

function depthOf(o) {
  let d = 0;
  for (let p = o.parent; p; p = p.parent) d++;
  return d;
}

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
