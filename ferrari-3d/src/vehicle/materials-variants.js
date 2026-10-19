/**
 * Minimal KHR_materials_variants support for GLTFLoader (three r170 ships none).
 * Records, per mesh primitive, which material index each named variant uses;
 * `selectVariant` then loads (once, cached by the parser) and assigns them.
 * Spec: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_variants
 */
export class MaterialsVariantsPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = 'KHR_materials_variants';
  }

  afterRoot(gltf) {
    const json = this.parser.json;
    const ext = json.extensions?.[this.name];
    if (!ext) return;
    const names = ext.variants.map((v) => v.name);
    gltf.userData.variants = names;
    gltf.scene.traverse((object) => {
      const assoc = this.parser.associations.get(object);
      if (!object.isMesh || assoc?.meshes === undefined || assoc.primitives === undefined) return;
      const mappings = json.meshes[assoc.meshes].primitives[assoc.primitives].extensions?.[this.name]?.mappings;
      if (!mappings) return;
      const byVariant = {};
      for (const m of mappings) for (const v of m.variants) byVariant[names[v]] = m.material;
      object.userData.variantMaterials = byVariant;
    });
  }
}

/**
 * Switch a loaded glTF to a named variant, or back to its authored materials
 * with `null`. Materials that a caller has restyled are left alone unless
 * `{ force: true }` is passed.
 */
export async function selectVariant(gltf, name, { force = false } = {}) {
  if (name && !gltf.userData.variants?.includes(name)) throw new Error(`Unknown material variant "${name}"`);
  const jobs = [];
  gltf.scene.traverse((object) => {
    const map = object.userData.variantMaterials;
    if (!map) return;
    object.userData.authoredMaterial ??= object.material;
    if (object.userData.restyled && !force) return;
    const index = name ? map[name] : undefined;
    if (index === undefined) {
      object.material = object.userData.authoredMaterial;
      return;
    }
    jobs.push(gltf.parser.getDependency('material', index).then((m) => (object.material = m)));
  });
  await Promise.all(jobs);
}
