/**
 * Component selectors, shared by the runtime (three.js scene) and the
 * asset check script (raw glTF JSON). Pure JavaScript — no three.js import.
 *
 * Both sides are first converted into the same tree of glTF *nodes*:
 *   { name, children, materials, ref }
 * where `name` is the ORIGINAL glTF node name (not three.js' de-duplicated
 * runtime name such as "tire_2"), `materials` are the material names of the
 * node's own mesh primitives, and `ref` is the source object.
 *
 * Selector forms (all relative to the scene root, '/'-separated):
 *   'RootNode/wheel_fl/tire'                 a node by its path of original names
 *   { under: 'Body/WheelFrontL', material: 'Tiretread' }
 *                                            the child node(s) of a path that own a
 *                                            primitive with that material — used for
 *                                            nodes the asset leaves unnamed
 *
 * Paths never use array indices, and a path whose segment is shared by two
 * siblings is reported as ambiguous instead of silently picking one.
 */

export function indexTree(roots) {
  const byPath = new Map();
  const ambiguous = new Set();
  const all = [];
  const visit = (node, parentPath) => {
    node.path = node.name == null ? null : parentPath ? `${parentPath}/${node.name}` : node.name;
    node.parentPath = parentPath;
    all.push(node);
    if (node.path) {
      if (byPath.has(node.path)) ambiguous.add(node.path);
      else byPath.set(node.path, node);
    }
    // children of an unnamed node can't be addressed by path, only via `under`
    for (const child of node.children) visit(child, node.path ?? `${parentPath}/?`);
  };
  roots.forEach((r) => visit(r, ''));
  return { byPath, ambiguous, all };
}

/**
 * Resolve one selector against an index.
 * @returns {{ nodes: object[], error?: string }}
 */
export function resolveSelector(index, selector) {
  if (typeof selector === 'string') {
    if (index.ambiguous.has(selector)) return { nodes: [], error: `ambiguous path "${selector}" (duplicate sibling names)` };
    const node = index.byPath.get(selector);
    return node ? { nodes: [node] } : { nodes: [], error: `no node at path "${selector}"` };
  }
  if (selector && selector.under && selector.material) {
    const parent = index.byPath.get(selector.under);
    if (!parent) return { nodes: [], error: `no node at path "${selector.under}"` };
    const nodes = parent.children.filter((c) => c.materials.includes(selector.material));
    if (!nodes.length) return { nodes: [], error: `no child of "${selector.under}" uses material "${selector.material}"` };
    if (nodes.length > 1 && !selector.many) return { nodes: [], error: `${nodes.length} children of "${selector.under}" use material "${selector.material}"` };
    return { nodes };
  }
  return { nodes: [], error: `unsupported selector ${JSON.stringify(selector)}` };
}

export function describeSelector(selector) {
  return typeof selector === 'string' ? selector : `${selector.under} › [material=${selector.material}]`;
}

/**
 * Resolve every component in a registry.
 * @returns {{ resolved: Map<string, object[]>, problems: {id, required, message}[], claimed: Set<object> }}
 */
export function resolveRegistry(index, registry) {
  const resolved = new Map();
  const problems = [];
  const claimed = new Set();
  const ids = new Set();
  for (const def of registry.components) {
    if (ids.has(def.id)) problems.push({ id: def.id, required: true, message: 'duplicate component id' });
    ids.add(def.id);
    const nodes = [];
    for (const sel of def.select) {
      const r = resolveSelector(index, sel);
      if (r.error) problems.push({ id: def.id, required: !!def.required, message: r.error });
      nodes.push(...r.nodes);
    }
    if (nodes.length) resolved.set(def.id, nodes);
    const claim = (n) => {
      claimed.add(n);
      if (def.scope !== 'self') n.children.forEach(claim);
    };
    nodes.forEach(claim);
  }
  return { resolved, problems, claimed };
}

/** Mesh-bearing nodes that no component claims — candidates for the registry. */
export function unclaimedMeshNodes(index, claimed) {
  return index.all.filter((n) => n.materials.length && !claimed.has(n));
}
