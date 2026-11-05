# Vehicle assets: inventory, component registry and replacement spec

Status of the 3D assets behind ROSSO, what each one can and cannot support, and
the exact asset needed for a true 458 exploded view. Facts here come from the
files themselves (`npm run check:assets`) and from rendering each mesh in
isolation. Anything not verified is marked **UNVERIFIED**.

## 1. Inventory

One car, used in every chapter. (A Khronos "CarConcept" stand-in used to serve the
Anatomy chapter. It was retired so that the site shows the same car throughout;
see `docs/EXPLODED-VIEW.md`.)

| | `public/models/ferrari.glb` |
|---|---|
| Used by | Every chapter (Anatomy parses its own copy from the same download) |
| Origin | three.js example asset, credited "Ferrari 458 Italia by vicent091036" |
| Generator | FBX2glTF |
| Size | 1.60 MB, Draco |
| Nodes / meshes / materials | 58 / 51 / 17 |
| Vertices (unique) | 337,834 |
| Textures | none (colour-only materials; the site supplies paint, rims, glass) |
| Split | **by material** |
| Axes in three.js | Y up, metres, nose −Z |

The engine is not an asset: it is generated in code (`src/engine/v8.js`, see `docs/ENGINE.md`).

## 2. What the asset genuinely contains

| Capability | 458 (`ferrari.glb`) |
|---|---|
| Body as separate panels | ✗ one `body` mesh: hood, doors, bumpers, wings and engine cover are fused (Anatomy lifts it as one piece) |
| Hinge pivots | ✗ none |
| Wheels | ✓ 4 assemblies: tyre, spoke face, barrel/hub, brake disc, centre cap, nuts (Anatomy separates all six) |
| Brake calipers | ✗ discs only |
| Engine / powertrain | ✗ none (the procedural V8 is mounted in its place) |
| Exhaust | ⚠ only the three chrome tips, fused into `chrome` (their centres are measured anchors) |
| Chassis | ⚠ cabin tub, floor, underbody, arch liners and some suspension detail are **one mesh** (`interior_dark`) |
| Suspension | ⚠ coil springs are visible inside the tub mesh, not separable |
| Interior | ✓ but by material: leather (incl. seats), panels, carpet, carbon, stitching; steering wheel is its own group |
| Glass | ✓ one mesh (windscreen + headlamp covers) |
| Lights | ✓ head lenses, head LEDs, tail glass, tail inserts |

### Naming quirks found in `ferrari.glb` (handled by the registry)
- `brakes` is the **tail-lamp inserts**, not brake hardware.
- `interior_dark` uses the material `Interior_light` and vice versa (swapped). `interior_dark` is the tub and underbody; `interior_light` is door cards, cockpit frame and the front undertray lip.
- `rim_xx` is only the spoke face. `wheel` is the barrel and hub. `brake` is the disc.
- `tire`, `brake`, `centre`, `nuts` and `wheel` repeat in all four corners. three.js renames them `tire_1`, `tire_2`… in load order, so the old `getObjectByName('wheel_1')` style was fragile. The registry uses the original names plus their parent path.
- `trim` is red interior stitching (the original three.js example restyles it as "trim"; the site keeps that).

## 3. Licensing

| Asset | Terms | Verified? |
|---|---|---|
| ferrari.glb | Credited by three.js to vicent091036 (Sketchfab 57bf6cc56931426e87494f554df1dab6) | **UNVERIFIED.** Sketchfab could not be reached from the build environment. Confirm the licence before any public or commercial use |
| — | Ferrari name, prancing horse and shield badges (visible on the 458 model) are Ferrari S.p.A. trademarks | — |

## 4. How the code addresses components

```
src/vehicle/
  registry/ferrari-458.js     pure data: every component that exists, slots, anchors, what's missing
  selectors.js                path / material selectors, shared by browser and Node
  vehicle-model.js            VehicleModel: resolve, validate, tag, rest transforms, slots, variants
  asset-loader.js             one GLTFLoader + DRACOLoader for the page; cached, typed errors, progress
  materials-variants.js       KHR_materials_variants support (three r170 has none built in)
scripts/check-assets.mjs      validates the registry against the GLB JSON (no three.js, no deps)
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
- Load failures are `AssetLoadError`s with `kind`: `not-found`, `http`, `network` or `parse`. The main car's failure shows "Try again" and "Continue without 3D". Anatomy's failure falls back to the static exploded-view poster.

**Loading**
- `index.html` preloads `ferrari.glb` and the Draco decoder, so they download while the JS parses.
- Anatomy needs its own scene graph of the same car. `assets.loadModelCopy()` re-parses the bytes already fetched, so there is one download. It runs in idle time after the main car, or when the visitor reaches Design.
- One Draco worker pool serves every parse. Each URL is fetched once; a failed load is evicted so a retry refetches.

## 5. Replacement asset needed for a true 458 exploded view

The current 458 can only be taken apart where it is split (body as one piece, wheels in layers).
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

- Stable component IDs, with exported transforms snapshotted and restorable.
- Material slots for paint, rims, glass and detail; `KHR_materials_variants` support in the loader for a future asset.
- Measured exhaust anchors on the 458's real tailpipe tips.
- One cached, failure-aware loader for every model on the page.

**Not available from current assets** (no animation should pretend otherwise): 458 body panels, engine geometry (the V8 is procedural), exhaust systems, suspension and chassis frames.
