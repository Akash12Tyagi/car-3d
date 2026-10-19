#!/usr/bin/env node
/**
 * Validates every vehicle registry against its GLB, without loading three.js
 * and without new dependencies: node names, hierarchy, material names and
 * vertex counts all live in the GLB's JSON chunk (Draco only compresses the
 * vertex data).
 *
 *   npm run check:assets            # summary, exits 1 on any selector problem
 *   npm run check:assets -- --verbose   # also list every component
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { indexTree, resolveRegistry, unclaimedMeshNodes, describeSelector } from '../src/vehicle/selectors.js';
import { ferrari458 } from '../src/vehicle/registry/ferrari-458.js';
import { conceptCar } from '../src/vehicle/registry/concept-car.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

function readGlbJson(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

function treeFromJson(json) {
  const matName = (i) => (i == null ? null : json.materials?.[i]?.name ?? `material#${i}`);
  const build = (i) => {
    const n = json.nodes[i];
    const prims = n.mesh != null ? json.meshes[n.mesh].primitives : [];
    return {
      name: n.name ?? null,
      ref: i,
      materials: prims.map((p) => matName(p.material)),
      vertices: prims.reduce((a, p) => a + (json.accessors[p.attributes.POSITION]?.count ?? 0), 0),
      children: (n.children ?? []).map(build),
    };
  };
  return json.scenes[json.scene ?? 0].nodes.map(build);
}

const subtreeVerts = (n) => n.vertices + n.children.reduce((a, c) => a + subtreeVerts(c), 0);

let failures = 0;
for (const registry of [ferrari458, conceptCar]) {
  const file = join(root, 'public', registry.url);
  const json = readGlbJson(file);
  const index = indexTree(treeFromJson(json));
  const { resolved, problems, claimed } = resolveRegistry(index, registry);

  console.log(`\n■ ${registry.id}  (${registry.url}, ${(statSync(file).size / 1024 / 1024).toFixed(2)} MB, ${json.nodes.length} nodes, generator: ${json.asset?.generator})`);
  if (!index.byPath.has(registry.root)) {
    console.log(`  ✗ root "${registry.root}" not found`);
    failures++;
  }
  for (const p of index.ambiguous) console.log(`  ! ambiguous path in asset: ${p}`);

  const groups = {};
  for (const def of registry.components) {
    const nodes = resolved.get(def.id) ?? [];
    (groups[def.group] ??= []).push(def.id);
    if (verbose) {
      const verts = nodes.reduce((a, n) => a + (def.scope === 'self' ? n.vertices : subtreeVerts(n)), 0);
      const flags = [def.required && 'required', def.placeholder && 'PLACEHOLDER', def.hidden && 'hidden', def.hinge && 'hinged'].filter(Boolean).join(', ');
      console.log(`  ${nodes.length ? '✓' : '✗'} ${def.id.padEnd(26)} ${String(verts).padStart(7)} v  ${def.select.map(describeSelector).join(' + ')}${flags ? `  [${flags}]` : ''}`);
    }
  }
  console.log(`  components: ${registry.components.length} — ` + Object.entries(groups).map(([g, ids]) => `${g} ${ids.length}`).join(', '));

  for (const s of Object.entries(registry.slots ?? {})) {
    const [name, slot] = s;
    if (slot.components) for (const id of slot.components) if (!resolved.has(id)) { console.log(`  ✗ slot "${name}" references unresolved component ${id}`); failures++; }
    if (slot.materials) {
      const used = new Set(index.all.flatMap((n) => n.materials));
      for (const m of slot.materials) if (!used.has(m)) { console.log(`  ✗ slot "${name}" material "${m}" is not used by any mesh`); failures++; }
    }
  }
  const variants = (json.extensions?.KHR_materials_variants?.variants ?? []).map((v) => v.name);
  for (const v of registry.variants ?? []) if (!variants.includes(v)) { console.log(`  ✗ variant "${v}" not in asset`); failures++; }

  for (const p of problems) {
    console.log(`  ✗ ${p.id}: ${p.message}${p.required ? ' (REQUIRED)' : ''}`);
    failures++;
  }
  const unclaimed = unclaimedMeshNodes(index, claimed);
  if (unclaimed.length) console.log(`  · ${unclaimed.length} mesh node(s) not in any component: ${unclaimed.map((n) => n.path ?? `#${n.ref}`).join(', ')}`);
  console.log(`  missing from this asset (documented): ${registry.missing.length} item(s)`);
  if (verbose) registry.missing.forEach((m) => console.log(`    – ${m}`));
}

console.log(failures ? `\n✗ ${failures} problem(s)` : '\n✓ all registries resolve against their assets');
process.exit(failures ? 1 : 0);
