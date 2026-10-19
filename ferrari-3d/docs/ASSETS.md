# Vehicle assets: inventory, component registry and replacement spec

Status of the 3D assets behind ROSSO, what each one can and cannot support, and
the exact asset needed for a true 458 exploded view. Facts here come from the
files themselves (`npm run check:assets`) and from rendering each mesh in
isolation. Anything not verified is marked **UNVERIFIED**.

## 1. Inventory

| | `public/models/ferrari.glb` | `public/models/concept-car.glb` |
|---|---|---|
| Used by | Every chapter except Anatomy | Anatomy (exploded-view chapter) |
| Origin | three.js example asset, credited "Ferrari 458 Italia by vicent091036" | Khronos glTF Sample Assets "CarConcept" |
| Generator | FBX2glTF | glTF-Transform 4.5.1 (our optimisation of the 11.8 MB original) |
| Size | 1.60 MB, Draco | 1.51 MB, Draco + WebP |
| Nodes / meshes / materials | 58 / 51 / 17 | 101 / 97 / 29 |
| Vertices (unique) | 337,834 | 163,601 |
| Textures | none (colour-only materials; the site supplies paint, rims, glass) | 14 WebP textures, ≤1024², ~24 MB GPU |
| Split | **by material** | **by component, with hinge pivots** |
| Axes in three.js | Y up, metres, nose −Z | Y up, metres, nose +Z |
| Material variants | — | Carmine Candy, Pearly Swirly, Torched Graphite (KHR_materials_variants) |

## 2. What each asset genuinely contains

| Capability | 458 (`ferrari.glb`) | Stand-in (`concept-car.glb`) |
|---|---|---|
| Body as separate panels | ✗ one `body` mesh: hood, doors, bumpers, wings and engine cover are fused | ✓ front clamshell, rear clamshell, both doors, roof panel |
| Hinge pivots | ✗ none | ✓ node origins at nose, tail and A-pillars |
| Wheels | ✓ 4 assemblies: tyre, spoke face, barrel/hub, brake disc, centre cap, nuts | ✓ 4 assemblies: tyre, rim, brake disc, caliper |
| Brake calipers | ✗ discs only | ✓ |
| Engine / powertrain | ✗ none | ⚠ `Engine` is an **89-vertex box with a normal map**: a volume, not an engine |
| Exhaust | ⚠ only the three chrome tips, fused into `chrome` | ✗ none |
| Chassis | ⚠ cabin tub, floor, underbody and arch liners are **one mesh** (`interior_dark`) | ⚠ underbody tray + `Axles` (212-vertex cylinders) |
| Suspension | ✗ | ✗ |
| Interior | ✓ but by material: leather (incl. seats), panels, carpet, carbon, stitching; steering wheel is its own group | ✓ seats, steering assembly, dash, pedals, tub |
| Glass | ✓ one mesh (windscreen + headlamp covers) | ✓ windscreen, rear, rear sides, door glass |
| Lights | ✓ head lenses, head LEDs, tail glass, tail inserts | ✓ headlamps, tail-lamps, housings, rear signals |

### Naming quirks found in `ferrari.glb` (handled by the registry)
- `brakes` is the **tail-lamp inserts**, not brake hardware.
- `interior_dark` uses the material `Interior_light` and vice versa (swapped). `interior_dark` is the tub and underbody; `interior_light` is door cards, cockpit frame and the front undertray lip.
- `rim_xx` is only the spoke face. `wheel` is the barrel and hub. `brake` is the disc.
- `tire`, `brake`, `centre`, `nuts` and `wheel` repeat in all four corners. three.js renames them `tire_1`, `tire_2`… in load order, so the old `getObjectByName('wheel_1')` style was fragile. The registry uses the original names plus their parent path.
- `trim` is red interior stitching (the original three.js example restyles it as "trim"; the site keeps that).

### Notes on `concept-car.glb`
- The four tyres are **unnamed** nodes. The registry identifies them as "the child of `WheelFrontL` that uses `Tiretread`".
- `BodyWindshieldWipers` is **30,440 vertices** (19 % of the asset) for two wipers: decimate it in the next asset pass.
- The licence plate and steering emblem carry **Khronos / 3D Commerce logos** (trademarks, not covered by CC BY). They are registered as `marks.*` and hidden at load.
- The front wheels are exported with a small steer angle.

## 3. Licensing

| Asset | Terms | Verified? |
|---|---|---|
| concept-car.glb | CC BY 4.0, Eric Chadwick / Darmstadt Graphics Group GmbH, 2024 (base model CC0 by "Unity Fan"). Attribution required (given in the footer and in the Anatomy credit line) | ✓ from the file's `asset.copyright` field and Khronos metadata |
| ferrari.glb | Credited by three.js to vicent091036 (Sketchfab 57bf6cc56931426e87494f554df1dab6) | **UNVERIFIED.** Sketchfab could not be reached from the build environment. Confirm the licence before any public or commercial use |
| Both | Ferrari name, prancing horse and shield badges (visible on the 458 model) are Ferrari S.p.A. trademarks | — |

## 4. How the code addresses components

```
src/vehicle/
  registry/ferrari-458.js     pure data: every component that exists, slots, anchors, what's missing
  registry/concept-car.js     same for the stand-in
  selectors.js                path / material selectors, shared by browser and Node
  vehicle-model.js            VehicleModel: resolve, validate, tag, rest transforms, slots, variants
  asset-loader.js             one GLTFLoader + DRACOLoader for the page; cached, typed errors, progress
  materials-variants.js       KHR_materials_variants support (three r170 has none built in)
scripts/check-assets.mjs      validates both registries against the GLB JSON (no three.js, no deps)
```

**Selectors** use the original glTF names as a path from the scene root, for example
`RootNode/wheel_fl/tire`. They never use runtime names (`tire_2`) or array
indices. A node without a name is selected by its parent plus a material it
uses: `{ under: 'BodyUnderside/WheelFrontL', material: 'Tiretread' }`. Duplicate
sibling names are reported as ambiguous rather than guessed.

**Stable IDs** (shared vocabulary, so a better asset can replace either file):
`body.*`, `panel.*`, `glass.*`, `lights.*`, `wheel.{fl,fr,rl,rr}[.tire|.rim|.spokes|.barrel|.disc|.caliper|.cap|.nuts]`,
`powertrain.*`, `chassis.*`, `interior.*`, `marks.*`.

```js
import { assets } from './vehicle/asset-loader.js';
import { VehicleModel } from './vehicle/vehicle-model.js';
import { ferrari458 } from './vehicle/registry/ferrari-458.js';

const gltf = await assets.loadModel(ferrari458.url, { onProgress: (p) => … }); // loaded once per page
const car = new VehicleModel(gltf, ferrari458);
car.ok;                               // false if a required component is missing
car.node('wheel.fl');                 // transform handle (Object3D), exported transform untouched
car.meshes('body.shell');             // meshes of a component
car.component('panel.door.left').def.hinge;   // { axis, pivotAt } where the asset has one
car.setSlotMaterial('paint', material);       // paint / rims / glass / detail / calipers
car.selectVariant('Pearly Swirly');            // authored presets (concept car only)
car.restore('panel.door.left');               // back to the exported transform
car.restDeviation();                          // 0 when every component is at its exported pose
```

Every resolved object and mesh carries `userData.componentId`, and the most
specific component wins (`wheel.fl.tire`, not `wheel.fl`).

**Diagnostics**
- `npm run check:assets` prints every component, its vertex count, its flags and the documented gaps. It exits 1 on any unresolved selector, ambiguous path, duplicate ID, unknown slot material or missing variant. The same check runs as `prebuild`, so a broken asset fails the deploy instead of shipping.
- At runtime, missing *required* components are always logged with `console.error`, and the page shows its load-error state. `?debug=assets` (or any dev build) prints the full component table, unclaimed meshes and the "missing" list.
- Load failures are `AssetLoadError`s with `kind`: `not-found`, `http`, `network` or `parse`. The main car's failure shows "Try again" and "Continue without 3D". The Anatomy model's failure falls back to the static exploded-view poster.

**Loading**
- `index.html` preloads `ferrari.glb` and the Draco decoder, so they download while the JS parses.
- `concept-car.glb` loads in idle time after the main car, or when the visitor reaches Design. With Save-Data or a 2G connection it loads only on approach.
- One Draco worker pool serves both models. Each URL is fetched and parsed once; a failed load is evicted so a retry refetches.

## 5. Replacement asset needed for a true 458 exploded view

The current 458 cannot be exploded truthfully, and the stand-in is not a 458.
The production asset should be a licensed 458 Italia model (ideally manufacturer
CAD via the client, or a commissioned model) delivered as follows.

**Format and space**
- glTF 2.0 binary (`.glb`). Y up, metres, nose towards −Z (matches the current car), origin at ground level under the wheelbase centre.
- One node per component listed below, named exactly with its registry ID's last segments (for example `PanelDoorLeft`, `WheelFL_Tire`). Names must be unique and ASCII, with no index suffixes.
- Every movable part's **node origin at its real hinge or axis**: door hinges on the A-pillar, frunk-lid hinge, engine-cover hinge, wheel hub centres, steering-column axis. Hinge axes should align with a local axis.
- Apply transforms only down to the component node. Keep component nodes un-baked so they can move.

**Components (minimum)**
| Group | Components |
|---|---|
| Body | shell (fixed structure), front bumper, rear bumper/diffuser, frunk lid, engine cover (glass + louvres), doors L/R (with glass, mirror, door card as children), side intakes |
| Wheels ×4 | tyre, rim, brake disc, caliper, centre cap (hub at origin) |
| Powertrain | V8 engine assembly (block, heads, intake plenum), gearbox, exhaust manifolds, silencer, **three tailpipes** |
| Chassis | aluminium spaceframe or tub, front and rear subframes, suspension arms, spring/damper units, steering rack |
| Interior | seats L/R, steering wheel + column, dashboard, centre console, pedal box |
| Glass and lights | windscreen, side glass, rear screen/engine-cover glass, headlamp units L/R, tail-lamp units L/R |

**Budgets and materials**
- Desktop ≤ 600k triangles total; provide a mobile LOD ≤ 250k (or decimation-safe topology). Interior and powertrain may be lower-poly where unseen in the assembled car.
- PBR metallic-roughness materials named by slot: `Paint`, `Rim`, `Caliper`, `Glass`, `Chrome`, `Rubber`, `Leather`, `Carbon`. Textures ≤ 2048² (KTX2 or WebP), packed occlusion/roughness/metalness.
- Optional: authored paint variants via `KHR_materials_variants` (already supported by the loader).

**Licence:** written permission for commercial web use, including trademark use, from the rights holder.

**Acceptance:** write `src/vehicle/registry/ferrari-458-production.js` with the IDs above, point the code at it, and `npm run check:assets` must pass with no unclaimed meshes and an empty `missing` list.

## 6. Ready for the next phase

- Stable component IDs for both assets, with exported transforms snapshotted and restorable.
- Hinge metadata (axis and pivot) for every panel that genuinely has one (concept car).
- Material slots for paint, rims, glass, calipers and detail; authored variants switchable on the concept car.
- Measured exhaust anchors on the 458's real tailpipe tips.
- One cached, failure-aware loader for every model on the page.

**Not available from current assets** (no animation should pretend otherwise): 458 body panels, any engine geometry beyond the stand-in's placeholder volume, exhaust systems, suspension and chassis frames.
