import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { engineMaterials, xrayMaterial, highlightMaterial } from './materials.js';

/**
 * A procedural, component-separated 90° flat-plane V8 with its transaxle.
 *
 * Why procedural: neither model in this repo has an engine (the 458 is one
 * body mesh, split by material), and no licensed,
 * component-separated engine asset is available. So the engine is built here,
 * from its specification, as real separate parts with real pivots — and,
 * because it is built from the specification, its mechanism is exact:
 *
 *  - Slider-crank kinematics for every piston and rod (bore 94, stroke 81,
 *    rod 150 mm), banks at ±45°, two rods side by side on each crank pin.
 *  - Flat-plane crank (pins 0°/180°/180°/0°). Firing order 1-5-3-7-4-8-2-6 is
 *    checked at build time against the geometry: every cylinder fires exactly
 *    at its own top dead centre.
 *  - Four camshafts at half crank speed; every lobe is phased to its
 *    cylinder's firing angle, and its profile is the valve-lift curve, so a
 *    valve opens exactly while its lobe is on the tappet. Pent-roof
 *    chambers: valves inclined 12° either side of the bore axis.
 *
 * Proportions are representative, not factory CAD; the copy says so.
 *
 * Space: engine space, metres. Crank axis on Z (the front of the engine, cam
 * drive end, towards +Z), Y up, the right bank (cylinders 1–4) on −X.
 *
 * Posing is a pure function of three inputs — crank angle, `explode` and
 * `bottom` (0..1 each) — rebuilt from stored base transforms every call, so
 * nothing accumulates and any pose can be reached from any other.
 */

const DEG = Math.PI / 180;
const Z = new THREE.Vector3(0, 0, 1);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const SPEC = {
  bore: 0.094,
  stroke: 0.081,
  rod: 0.15,
  compressionHeight: 0.028,
  pitch: 0.106, // bore centres along a bank
  stagger: 0.0115, // bank offset along the crank: two rods per pin
  deck: 0.222, // crank axis to deck face, along the bore
  bankAngle: 90,
  crankPins: [0, 180, 180, 0],
  firingOrder: [1, 5, 3, 7, 4, 8, 2, 6],
  valveTilt: 12, // degrees either side of the bore axis
  liftMax: 0.0105,
  baseCircle: 0.017,
  exhaustPeak: 250, // crank degrees after combustion TDC
  intakePeak: 470,
  duration: 250,
  redline: 9000,
};
SPEC.displacement = 8 * (Math.PI / 4) * SPEC.bore ** 2 * SPEC.stroke * 1e6; // cc → 4497

/** Bill of materials, in teardown order. `qty` and `text` describe what this model shows. */
export const PART_INFO = [
  { id: 'plenum', title: 'Intake plenum', qty: '1', text: 'Carbon-fibre air box in the V, fed by twin throttle bodies at the rear.' },
  { id: 'coils', title: 'Ignition coils', qty: '×8', text: 'Coil-on-plug: each coil sits directly above its spark plug.' },
  { id: 'runners', title: 'Intake runners', qty: '×8', text: 'One polished runner per cylinder, from the plenum down to its intake port inside the V.' },
  { id: 'covers', title: 'Cam covers', qty: '×2', text: 'Crinkle-red covers, one per bank, sealing the valvetrain.' },
  { id: 'exhaust', title: 'Exhaust headers', qty: '×2', text: 'Four primaries per bank merge in a 4-into-1 collector. The heat tint runs from blue at the port to raw steel.' },
  { id: 'accessories', title: 'Accessory drive', qty: '1', text: 'Crank pulley, water pump, alternator and A/C compressor on one ribbed belt.' },
  { id: 'timing', title: 'Timing cover', qty: '1', text: 'Encloses the cam drive at the front of the engine.' },
  { id: 'cams', title: 'Camshafts', qty: '×4', text: 'Two per bank at half crank speed. Every lobe is phased to its cylinder’s place in the firing order.' },
  { id: 'plugs', title: 'Spark plugs', qty: '×8', text: 'Central in each pent-roof chamber, between the four valves.' },
  { id: 'valves', title: 'Valvetrain', qty: '×32', text: 'Four valves per cylinder with springs and bucket tappets: intakes on the V side, exhausts outboard.' },
  { id: 'heads', title: 'Cylinder heads', qty: '×2', text: 'Aluminium, pent-roof chambers. The cams run in bearing caps on top.' },
  { id: 'gaskets', title: 'Head gaskets', qty: '×2', text: 'Multi-layer steel, sealing the bores and the coolant passages.' },
  { id: 'shafts', title: 'Half-shafts', qty: '×2', text: 'Constant-velocity joints in boots at both ends, out to the hubs.' },
  { id: 'gearbox', title: 'Seven-speed transaxle', qty: '1', text: 'Dual-clutch gearbox and differential in one case, behind the engine.' },
  { id: 'bell', title: 'Bell housing', qty: '1', text: 'Joins the engine to the transaxle and encloses the clutches.' },
  { id: 'clutch', title: 'Dual clutch', qty: '1', text: 'Two concentric wet clutch packs: one for the odd gears, one for the even.' },
  { id: 'flywheel', title: 'Flywheel', qty: '1', text: 'Toothed ring for the starter, bolted to the crank flange.' },
  { id: 'sump', title: 'Dry sump', qty: '1', text: 'A shallow pan and a scavenge pump. Oil is pumped away, so the engine sits low and never starves in corners.' },
  { id: 'pistons', title: 'Pistons', qty: '×8', text: '94 mm bore, 81 mm stroke: 4,497 cc. Three rings each, coated skirts.' },
  { id: 'rods', title: 'Connecting rods', qty: '×8', text: 'Two rods share each crank pin, side by side. That is why one bank sits slightly ahead of the other.' },
  { id: 'crank', title: 'Flat-plane crankshaft', qty: '1', text: 'Throws at 0°, 180°, 180°, 0°. Firing alternates bank to bank, 1-5-3-7-4-8-2-6, every 90°.' },
  { id: 'block', title: 'Engine block', qty: '1', text: 'Aluminium, banks at 90°, with a liner for each of the eight bores.' },
];
export const PART_BY_ID = new Map(PART_INFO.map((p, i) => [p.id, { ...p, index: i }]));

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */
const O = new THREE.Object3D();
/** Rotate (XYZ, radians) then translate a geometry in place. */
function at(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  O.position.set(x, y, z);
  O.rotation.set(rx, ry, rz);
  O.scale.set(1, 1, 1);
  O.updateMatrix();
  return geo.applyMatrix4(O.matrix);
}
const rbox = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
/** Cylinder along Z. */
const cylZ = (r, len, seg = 32, rTop = r) => new THREE.CylinderGeometry(rTop, r, len, seg).rotateX(Math.PI / 2);
const cylX = (r, len, seg = 32) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const hexZ = (r, h) => cylZ(r, h, 6);
/** Lathe profile [[r, h], …] revolved, axis along Z (h → +Z). */
const latheZ = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg).rotateX(Math.PI / 2);
/** Flat annulus along Z, centred on z = 0. */
function annulus(rIn, rOut, depth, seg = 64) {
  const s = new THREE.Shape().absarc(0, 0, rOut, 0, Math.PI * 2, false);
  s.holes.push(new THREE.Path().absarc(0, 0, rIn, 0, Math.PI * 2, true));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: seg }).translate(0, 0, -depth / 2);
}
function gear(rOut, rRoot, teeth, depth, hole = 0) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 4 === 1 || i % 4 === 2 ? rOut : rRoot;
    i === 0 ? s.moveTo(Math.cos(a) * r, Math.sin(a) * r) : s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  if (hole) s.holes.push(new THREE.Path().absarc(0, 0, hole, 0, Math.PI * 2, true));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}
/** Pipe with a constant heat-tint coordinate (uv.x) — for the collector and tail of the exhaust. */
function tinted(geo, s) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, s);
  return geo;
}
/** Bring geometries to one layout (non-indexed; position, normal, uv) and merge. */
function merge(list) {
  const prepared = list.map((g) => {
    let geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.clearGroups();
    return geo;
  });
  const out = mergeGeometries(prepared, false);
  out.computeBoundingSphere();
  return out;
}

/** Collects geometry per material, then emits one mesh per material. */
class Batch {
  constructor() {
    this.lists = new Map();
  }
  add(material, ...geos) {
    if (!this.lists.has(material)) this.lists.set(material, []);
    this.lists.get(material).push(...geos);
    return this;
  }
  build(group) {
    for (const [material, list] of this.lists) {
      const mesh = new THREE.Mesh(merge(list), material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** Valve lift (m) at `d` crank degrees from the lobe peak. */
function bump(d) {
  const half = SPEC.duration / 2;
  if (Math.abs(d) >= half) return 0;
  return SPEC.liftMax * 0.5 * (1 + Math.cos((Math.PI * d) / half));
}
/** Signed distance in crank degrees from `peak` within the 720° cycle. */
const cycleDelta = (psi, peak) => ((((psi - peak) % 720) + 1080) % 720) - 360;

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */
export class V8Engine {
  /**
   * @param {object} [o]
   * @param {boolean} [o.transmission=true]  flywheel, clutch, bell housing, transaxle, half-shafts
   * @param {string}  [o.materials='main']   material set key (sets are independent: x-ray in one never shows in another)
   */
  constructor({ transmission = true, materials = 'main' } = {}) {
    this.M = engineMaterials(materials);
    this.transmission = transmission;
    this.root = new THREE.Group();
    this.root.name = 'v8';
    this.parts = [];
    this.byId = new Map();
    this.pickables = [];
    this.castMeshes = [];
    this.kinematic = [];
    this.state = { crank: 0, explode: 0, bottom: 0, spread: 1, vanish: 0 };
    this.xray = 0;

    this.setupGeometry();
    this.buildBlock();
    this.buildCrank();
    this.buildRodsAndPistons();
    this.buildHeads();
    this.buildValvetrain();
    this.buildCams();
    this.buildIgnition();
    this.buildIntake();
    this.buildExhaust();
    this.buildSump();
    this.buildFront();
    if (transmission) this.buildTransmission();
    this.buildCombustion();
    this.finish();
  }

  /* ----------------------------- layout ------------------------------ */

  setupGeometry() {
    const S = SPEC;
    const bank = (id, betaDeg, cyl, stagger) => {
      const b = betaDeg * DEG;
      return {
        id,
        beta: b,
        betaDeg,
        u: new THREE.Vector3(Math.sin(b), Math.cos(b), 0), // along the bores
        w: new THREE.Vector3(Math.cos(b), -Math.sin(b), 0), // across the bank (bank-local +X)
        inner: b < 0 ? 1 : -1, // sign of bank-local X that points into the V
        side: b < 0 ? -1 : 1, // which side of the engine (world X)
        q: new THREE.Quaternion().setFromAxisAngle(Z, -b),
        m: new THREE.Matrix4().makeRotationZ(-b),
        cyl,
        stagger,
      };
    };
    this.banks = [bank('R', -S.bankAngle / 2, [1, 2, 3, 4], S.stagger), bank('L', S.bankAngle / 2, [5, 6, 7, 8], -S.stagger)];

    this.cyls = [];
    for (const b of this.banks)
      b.cyl.forEach((n, i) => {
        const phi = S.crankPins[i];
        const k = S.firingOrder.indexOf(n);
        const fire = (315 + 90 * k) % 720;
        // Each cylinder must fire at its own TDC: pin pointing along its bank
        const tdc = (((b.betaDeg - phi) % 360) + 360) % 360;
        if ((fire - tdc + 720) % 360 !== 0) console.warn(`[v8] cylinder ${n} fires off TDC`);
        this.cyls.push({ n, bank: b, pin: i, phi: phi * DEG, z: (1.5 - i) * S.pitch + b.stagger, fire, flash: 0 });
      });
    this.cyls.sort((a, b) => a.n - b.n);

    // Valve geometry (pent roof): head face, axis, and where the cam sits
    const g = S.valveTilt * DEG;
    this.valveGeo = {
      face: S.deck + 0.0045, // valve face, just above the deck
      lat: 0.024, // head centre off the bore axis
      tappet: 0.0795, // face → tappet top, along the valve axis
      tilt: g,
    };
    const v = this.valveGeo;
    v.camLat = v.lat + (v.tappet + S.baseCircle) * Math.sin(g);
    v.camUp = v.face + (v.tappet + S.baseCircle) * Math.cos(g);
  }

  /** Bank-local point → engine space. */
  bankPoint(b, x, y, z, out = new THREE.Vector3()) {
    return out.copy(b.w).multiplyScalar(x).addScaledVector(b.u, y).setZ(z);
  }

  part(id, { channel = 'explode', window = [0, 1] } = {}) {
    const p = { id, channel, window, nodes: [], meshes: [], k: 0, anchor: 0 };
    this.parts.push(p);
    this.byId.set(id, p);
    return p;
  }

  /** Register a moving node of a part; `move` is its exploded offset (engine space). */
  node(part, obj, move = [0, 0, 0]) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.part = part.id;
      part.meshes.push(o);
      this.pickables.push(o);
      if (this.M.castings.has(o.material)) this.castMeshes.push(o);
    });
    const n = {
      obj,
      basePos: obj.position.clone(),
      baseQuat: obj.quaternion.clone(),
      baseScale: obj.scale.clone(),
      move: Array.isArray(move) ? new THREE.Vector3(...move) : move.clone(),
    };
    part.nodes.push(n);
    this.root.add(obj);
    return n;
  }

  /* ------------------------------ block ------------------------------ */

  /** Right half of a V cross-section (mirrored for the left): crankcase, bank towers to `up`, half-width `hw`. */
  vProfile(up, hw, side, bottom, inset = 0) {
    const R = this.banks[0];
    const P = (a, b) => new THREE.Vector2(R.u.x * a + R.w.x * b, R.u.y * a + R.w.y * b);
    const h = hw - inset;
    const d = up - inset;
    const sx = side - inset;
    const outerDeck = P(d, -h);
    const innerDeck = P(d, h);
    const valley = new THREE.Vector2(0, (R.u.y + R.w.y) * h); // inner wall meets the centreline
    const wallLow = P((sx - R.w.x * h) / -R.u.x, -h); // outer wall meets x = −side
    const right = [
      new THREE.Vector2(0, bottom + inset),
      new THREE.Vector2(-sx + 0.015, bottom + inset),
      new THREE.Vector2(-sx, bottom + inset + 0.015),
      new THREE.Vector2(-sx, wallLow.y),
      outerDeck,
      innerDeck,
      valley,
    ];
    const left = right
      .slice(1, -1)
      .reverse()
      .map((p) => new THREE.Vector2(-p.x, p.y));
    return [...right, ...left];
  }

  buildBlock() {
    const M = this.M;
    const S = SPEC;
    const part = this.part('block', { window: [0, 0] });
    const g = new THREE.Group();
    const batch = new Batch();

    const bevel = 0.005;
    const shape = new THREE.Shape(this.vProfile(S.deck, 0.075, 0.165, -0.11, bevel));
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.47, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
    body.translate(0, 0, -0.235);
    batch.add(M.cast, body);

    // Liners: visible through the casting in x-ray
    for (const c of this.cyls) {
      const b = c.bank;
      const liner = new THREE.CylinderGeometry(SPEC.bore / 2 + 0.003, SPEC.bore / 2 + 0.003, 0.175, 40, 1, true);
      at(liner, 0, S.deck - 0.0875, c.z);
      liner.applyMatrix4(b.m);
      batch.add(M.cast, liner);
    }
    // Crankcase ribs, engine mounts, rear seal flange
    for (const s of [-1, 1]) {
      for (const z of [-0.159, -0.053, 0.053, 0.159]) batch.add(M.cast, at(rbox(0.012, 0.15, 0.014, 0.003), s * 0.168, -0.03, z));
      batch.add(M.cast, at(cylX(0.032, 0.04), s * 0.18, -0.02, 0.0));
      batch.add(M.steelDark, at(hexZ(0.008, 0.012).rotateY(Math.PI / 2), s * 0.205, -0.02, 0.0));
      // bolts along the pan rail
      for (let i = 0; i < 7; i++) batch.add(M.steelDark, at(hexZ(0.0045, 0.006).rotateX(Math.PI / 2), s * 0.15, -0.111, -0.2 + i * 0.0667));
    }
    batch.add(M.steel, at(annulus(0.03, 0.06, 0.01), 0, 0, -0.243));
    // Machined valley plate with knock-sensor bosses
    batch.add(M.cast, at(rbox(0.07, 0.008, 0.42, 0.003), 0, 0.138, 0));
    batch.build(g);
    this.node(part, g);
  }

  /* ------------------------------ crank ------------------------------ */

  buildCrank() {
    const M = this.M;
    const S = SPEC;
    const r = S.stroke / 2;
    const part = this.part('crank', { channel: 'bottom', window: [0.35, 1] });
    const batch = new Batch();

    // Web: one profile per throw, built for a pin at +Y — a round boss around the pin, a
    // hub, and a broad counterweight opposite the pin
    const web = () => {
      const pts = [];
      const rho = 0.034;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const s = Math.sin(a);
        const c = Math.cos(a);
        let R = 0.042;
        if (rho * rho >= r * r * s * s) R = Math.max(R, r * c + Math.sqrt(rho * rho - r * r * s * s));
        const off = Math.abs(((a - Math.PI + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (off < 1.15) R = Math.max(R, 0.078 * (1 - Math.pow(off / 1.15, 6) * 0.45));
        pts.push(new THREE.Vector2(s * R, c * R));
      }
      return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.013, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 }).translate(0, 0, -0.0065);
    };

    const pinZ = [0.159, 0.053, -0.053, -0.159];
    pinZ.forEach((z, i) => {
      const phi = S.crankPins[i] * DEG;
      const px = r * Math.sin(phi);
      const py = r * Math.cos(phi);
      batch.add(M.steel, at(cylZ(0.024, 0.046, 32), px, py, z));
      for (const s of [-1, 1]) batch.add(M.steel, at(web(), 0, 0, z + s * 0.0315, 0, 0, -phi));
      // oil drillings on the pin
      batch.add(M.steelDark, at(cylZ(0.004, 0.047, 10), px * 0.6, py * 0.6, z));
    });
    for (const z of [0.212, 0.106, 0, -0.106, -0.212]) batch.add(M.steel, at(cylZ(0.03, 0.028, 40), 0, 0, z));
    batch.add(M.steel, at(cylZ(0.02, 0.09, 24), 0, 0, 0.27));
    batch.add(M.gold, at(gear(0.034, 0.03, 22, 0.012, 0.012), 0, 0, 0.262));
    batch.add(M.steel, at(cylZ(0.046, 0.016, 40), 0, 0, -0.232));

    const g = batch.build(new THREE.Group());
    const n = this.node(part, g, [0, -0.24, 0]);
    this.kinematic.push((theta) => n.baseQuat.setFromAxisAngle(Z, -theta));
  }

  /* -------------------------- rods & pistons ------------------------- */

  rodGeometry() {
    const L = SPEC.rod;
    const R1 = 0.033;
    const R2 = 0.0145;
    // Tangent lines between the big-end and small-end circles
    const s = new THREE.Shape();
    const a = Math.asin((R1 - R2) / L);
    s.absarc(0, 0, R1, Math.PI - a, Math.PI * 2 + a, false); // around the underside of the big end
    s.lineTo(R2 * Math.cos(a), L + R2 * Math.sin(a));
    s.absarc(0, L, R2, a, Math.PI - a, false);
    s.lineTo(-R1 * Math.cos(a), R1 * Math.sin(a));
    s.holes.push(new THREE.Path().absarc(0, 0, 0.0242, 0, Math.PI * 2, true));
    s.holes.push(new THREE.Path().absarc(0, L, 0.0106, 0, Math.PI * 2, true));
    const body = new THREE.ExtrudeGeometry(s, { depth: 0.017, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 24 });
    body.translate(0, 0, -0.0085);
    const bolts = [-1, 1].map((x) => at(new THREE.CylinderGeometry(0.0042, 0.0042, 0.034, 10), x * 0.027, -0.006, 0));
    const heads = [-1, 1].map((x) => at(new THREE.CylinderGeometry(0.0062, 0.0062, 0.006, 6), x * 0.027, -0.025, 0));
    return { body, bolts: merge([...bolts, ...heads]) };
  }

  pistonGeometry() {
    const r = SPEC.bore / 2 - 0.0002;
    const alloy = [];
    const coat = [];
    const rings = [];
    const seg = (r0, y0, y1) => at(new THREE.CylinderGeometry(r0, r0, y1 - y0, 48), 0, (y0 + y1) / 2, 0);
    alloy.push(at(new THREE.CylinderGeometry(0.03, r, 0.0028, 48), 0, 0.0299, 0)); // pent-roof crown
    alloy.push(seg(r, 0.0235, 0.0285), seg(r - 0.0018, 0.0215, 0.0235), seg(r, 0.0185, 0.0215), seg(r - 0.0018, 0.0168, 0.0185), seg(r, 0.014, 0.0168), seg(r - 0.0018, 0.0115, 0.014));
    coat.push(seg(r, -0.031, 0.0115));
    for (const y of [0.0225, 0.0176, 0.0128]) rings.push(seg(r + 0.0001, y - 0.0006, y + 0.0006));
    const pin = cylZ(0.0105, 0.072, 20);
    return { alloy: merge(alloy), coat: merge(coat), rings: merge(rings), pin };
  }

  buildRodsAndPistons() {
    const M = this.M;
    const rods = this.part('rods', { channel: 'bottom', window: [0, 0.75] });
    const pistons = this.part('pistons', { channel: 'bottom', window: [0, 0.75] });
    const rg = this.rodGeometry();
    const pg = this.pistonGeometry();
    this.rodNodes = [];
    this.pistonNodes = [];
    for (const c of this.cyls) {
      const rod = new THREE.Group();
      rod.add(new THREE.Mesh(rg.body, M.steel), new THREE.Mesh(rg.bolts, M.steelDark));
      rod.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
      this.rodNodes.push(this.node(rods, rod, c.bank.u.clone().multiplyScalar(0.28)));

      const piston = new THREE.Group();
      piston.add(new THREE.Mesh(pg.alloy, M.alloy), new THREE.Mesh(pg.coat, M.coating), new THREE.Mesh(pg.rings, M.steelDark), new THREE.Mesh(pg.pin, M.steel));
      piston.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
      this.pistonNodes.push(this.node(pistons, piston, c.bank.u.clone().multiplyScalar(0.28)));
    }
    // Callout anchors: a piston and rod on the left bank, which faces the side camera
    rods.anchor = 5;
    pistons.anchor = 5;

    const r = SPEC.stroke / 2;
    const L = SPEC.rod;
    const q = new THREE.Quaternion();
    this.kinematic.push((theta) => {
      this.cyls.forEach((c, i) => {
        const b = c.bank;
        const ang = theta + c.phi;
        const px = r * Math.sin(ang);
        const py = r * Math.cos(ang);
        const along = px * b.u.x + py * b.u.y;
        const across = px * b.w.x + py * b.w.y;
        const s = along + Math.sqrt(L * L - across * across);
        const wx = b.u.x * s;
        const wy = b.u.y * s;
        const pn = this.pistonNodes[i];
        pn.basePos.set(wx, wy, c.z);
        pn.baseQuat.copy(b.q);
        const rn = this.rodNodes[i];
        rn.basePos.set(px, py, c.z);
        rn.baseQuat.copy(q.setFromAxisAngle(Z, Math.atan2(-(wx - px), wy - py)));
        c.travel = s; // crank axis → wrist pin, along the bore
      });
    });
  }

  /* ------------------------------ heads ------------------------------ */

  buildHeads() {
    const M = this.M;
    const S = SPEC;
    const heads = this.part('heads', { window: [0.34, 0.64] });
    const gaskets = this.part('gaskets', { window: [0.4, 0.66] });
    const top = 0.325;
    const bottom = S.deck + 0.0016;
    this.headTop = top;

    for (const b of this.banks) {
      const cyls = this.cyls.filter((c) => c.bank === b);

      // Gasket: MLS plate with the four bores and coolant holes
      const s = new THREE.Shape();
      s.moveTo(-0.08, -(b.stagger - 0.236));
      s.lineTo(0.08, -(b.stagger - 0.236));
      s.lineTo(0.08, -(b.stagger + 0.236));
      s.lineTo(-0.08, -(b.stagger + 0.236));
      s.closePath();
      for (const c of cyls) {
        s.holes.push(new THREE.Path().absarc(0, -c.z, S.bore / 2 + 0.002, 0, Math.PI * 2, true));
        for (const x of [-0.064, 0.064]) s.holes.push(new THREE.Path().absarc(x, -c.z, 0.006, 0, Math.PI * 2, true));
      }
      const gasket = new THREE.ExtrudeGeometry(s, { depth: 0.0016, bevelEnabled: false, curveSegments: 20 }).rotateX(-Math.PI / 2).translate(0, S.deck, 0);
      const gg = new Batch().add(M.gasket, gasket).build(new THREE.Group());
      gg.quaternion.copy(b.q);
      this.node(gaskets, gg, b.u.clone().multiplyScalar(0.32));

      // Head casting, port flanges, cam bearing caps, front cam-drive housing
      const batch = new Batch();
      batch.add(M.cast, at(rbox(0.17, top - bottom, 0.47, 0.01), 0, (top + bottom) / 2, b.stagger));
      for (const c of cyls) {
        batch.add(M.alloy, at(rbox(0.012, 0.044, 0.05, 0.004), -b.inner * 0.0905, 0.27, c.z)); // exhaust port face
        batch.add(M.alloy, at(rbox(0.012, 0.046, 0.052, 0.004), b.inner * 0.0905, 0.27, c.z)); // intake port face
        batch.add(M.cast, at(new THREE.CylinderGeometry(0.013, 0.013, 0.07, 16, 1, true), 0, 0.285, c.z)); // plug well
      }
      const v = this.valveGeo;
      for (const lat of [-v.camLat, v.camLat])
        for (const dz of [-0.212, -0.106, 0, 0.106, 0.212]) {
          batch.add(M.cast, at(rbox(0.036, 0.014, 0.016, 0.003), lat, top + 0.004, b.stagger + dz));
          for (const sx of [-1, 1]) batch.add(M.steelDark, at(new THREE.CylinderGeometry(0.004, 0.004, 0.005, 6), lat + sx * 0.013, top + 0.0135, b.stagger + dz));
        }
      batch.add(M.cast, at(rbox(0.16, 0.06, 0.03, 0.008), 0, top - 0.02, b.stagger + 0.245));
      const hg = batch.build(new THREE.Group());
      hg.quaternion.copy(b.q);
      this.node(heads, hg, b.u.clone().multiplyScalar(0.4));
      if (b.id === 'L') heads.anchor = heads.nodes.length - 1;
    }
  }

  /* ---------------------------- valvetrain --------------------------- */

  buildValvetrain() {
    const M = this.M;
    const v = this.valveGeo;
    const part = this.part('valves', { window: [0.28, 0.58] });

    // One instance per valve: valve (+ collets/retainer), spring, bucket tappet
    const valveGeo = merge([
      new THREE.LatheGeometry(
        [
          [0, 0],
          [0.0162, 0],
          [0.0165, 0.0012],
          [0.0125, 0.0045],
          [0.0045, 0.014],
          [0.0031, 0.022],
          [0.0031, 0.075],
          [0, 0.075],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        28
      ),
      at(new THREE.CylinderGeometry(0.0085, 0.0095, 0.004, 20), 0, 0.0642, 0),
    ]);
    class Helix extends THREE.Curve {
      getPoint(t, out = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * 6.5;
        return out.set(Math.cos(a) * 0.0102, t * 0.0355, Math.sin(a) * 0.0102);
      }
    }
    const springGeo = new THREE.TubeGeometry(new Helix(), 160, 0.0017, 6, false);
    const tappetGeo = at(new THREE.CylinderGeometry(0.0145, 0.0145, 0.012, 28), 0, -0.006, 0);

    this.valves = [];
    for (const c of this.cyls)
      for (const kind of ['intake', 'exhaust']) {
        const sigma = kind === 'intake' ? c.bank.inner : -c.bank.inner;
        for (const dz of [-0.018, 0.018]) this.valves.push({ c, kind, sigma, z: c.z + dz, lift: 0 });
      }
    const make = (geo, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, this.valves.length);
      im.castShadow = im.receiveShadow = true;
      im.frustumCulled = false;
      im.userData.part = 'valves';
      return im;
    };
    this.valveMesh = make(valveGeo, M.steel);
    this.springMesh = make(springGeo, M.gold);
    this.tappetMesh = make(tappetGeo, M.steelDark);
    for (const im of [this.valveMesh, this.springMesh, this.tappetMesh]) {
      this.root.add(im);
      part.meshes.push(im);
      this.pickables.push(im);
    }
    // An empty node carries the part's explode offset (and the annotation anchor), on the left bank
    const L = this.banks[1];
    const anchor = new THREE.Object3D();
    this.bankPoint(L, 0, v.face + 0.05, 0, anchor.position);
    this.root.add(anchor);
    part.nodes.push({ obj: anchor, basePos: anchor.position.clone(), baseQuat: new THREE.Quaternion(), baseScale: new THREE.Vector3(1, 1, 1), move: L.u.clone().multiplyScalar(0.55), virtual: true });
    this.valvePart = part;
  }

  poseValves(theta) {
    const v = this.valveGeo;
    const deg = theta / DEG;
    const k = this.valvePart.reach;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tilt = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const d = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    this.valves.forEach((valve, i) => {
      const b = valve.c.bank;
      const psi = deg - valve.c.fire;
      valve.lift = bump(cycleDelta(psi, valve.kind === 'intake' ? SPEC.intakePeak : SPEC.exhaustPeak));
      tilt.setFromAxisAngle(Z, -valve.sigma * v.tilt);
      q.copy(b.q).multiply(tilt);
      // valve axis in engine space
      d.set(valve.sigma * Math.sin(v.tilt), Math.cos(v.tilt), 0).applyQuaternion(b.q);
      const head = this.bankPoint(b, valve.sigma * v.lat, v.face, valve.z, p).addScaledVector(b.u, 0.55 * k);
      s.set(1, 1, 1);
      m.compose(head.clone().addScaledVector(d, -valve.lift), q, s);
      this.valveMesh.setMatrixAt(i, m);
      m.compose(head.clone().addScaledVector(d, v.tappet - valve.lift), q, s);
      this.tappetMesh.setMatrixAt(i, m);
      s.set(1, (0.0355 - valve.lift) / 0.0355, 1);
      m.compose(head.clone().addScaledVector(d, 0.0285), q, s);
      this.springMesh.setMatrixAt(i, m);
    });
    this.valveMesh.instanceMatrix.needsUpdate = true;
    this.tappetMesh.instanceMatrix.needsUpdate = true;
    this.springMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------- cams ------------------------------ */

  buildCams() {
    const M = this.M;
    const v = this.valveGeo;
    const part = this.part('cams', { window: [0.24, 0.52] });
    const rb = SPEC.baseCircle;

    const lobe = (alphaDeg) => {
      const pts = [];
      for (let i = 0; i < 120; i++) {
        const dl = -180 + (i / 120) * 360; // cam degrees from the nose
        const R = rb + bump(2 * dl);
        const a = (alphaDeg + dl) * DEG;
        pts.push(new THREE.Vector2(R * Math.sin(a), R * Math.cos(a)));
      }
      return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.011, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1 }).translate(0, 0, -0.0055);
    };

    this.camNodes = [];
    for (const b of this.banks)
      for (const kind of ['intake', 'exhaust']) {
        const sigma = kind === 'intake' ? b.inner : -b.inner;
        const peak = kind === 'intake' ? SPEC.intakePeak : SPEC.exhaustPeak;
        // Lobe direction at peak lift: along the valve axis, towards the valve
        const toValve = new THREE.Vector3(-sigma * Math.sin(v.tilt), -Math.cos(v.tilt), 0).applyQuaternion(b.q);
        const peakAngle = Math.atan2(toValve.x, toValve.y) / DEG;
        const batch = new Batch();
        const zBack = b.stagger - 0.226;
        const zFront = 0.27;
        batch.add(M.steel, at(cylZ(0.0125, zFront - zBack, 20), 0, 0, (zFront + zBack) / 2));
        for (const dz of [-0.212, -0.106, 0, 0.106, 0.212]) batch.add(M.steel, at(cylZ(0.0152, 0.014, 28), 0, 0, b.stagger + dz));
        for (const c of this.cyls.filter((c) => c.bank === b)) {
          const alpha = peakAngle - (c.fire + peak) / 2;
          for (const dz of [-0.018, 0.018]) batch.add(M.steel, at(lobe(alpha), 0, 0, c.z + dz));
        }
        // Cam phaser and sprocket at the front
        batch.add(M.gold, at(cylZ(0.034, 0.022, 40), 0, 0, 0.255));
        batch.add(M.steelDark, at(gear(0.038, 0.034, 30, 0.008, 0.01), 0, 0, 0.271));
        const g = batch.build(new THREE.Group());
        this.bankPoint(b, sigma * v.camLat, v.camUp, 0, g.position);
        const n = this.node(part, g, b.u.clone().multiplyScalar(0.68));
        this.camNodes.push(n);
      }
    part.anchor = 2;
    this.kinematic.push((theta) => {
      for (const n of this.camNodes) n.baseQuat.setFromAxisAngle(Z, -theta / 2);
    });
  }

  /* ---------------------- covers, coils, plugs ----------------------- */

  buildIgnition() {
    const M = this.M;
    const top = this.headTop;
    const covers = this.part('covers', { window: [0.1, 0.4] });
    const coils = this.part('coils', { window: [0.04, 0.3] });
    const plugs = this.part('plugs', { window: [0.22, 0.5] });

    for (const b of this.banks) {
      const cyls = this.cyls.filter((c) => c.bank === b);

      const cover = new Batch();
      cover.add(M.crinkle, at(rbox(0.166, 0.055, 0.47, 0.016), 0, top + 0.0275, b.stagger));
      for (const x of [-0.05, 0.05]) cover.add(M.crinkle, at(rbox(0.008, 0.008, 0.4, 0.003), x, top + 0.056, b.stagger));
      for (const c of cyls) cover.add(M.crinkle, at(new THREE.CylinderGeometry(0.021, 0.024, 0.008, 28), 0, top + 0.058, c.z));
      for (let i = 0; i < 6; i++)
        for (const x of [-0.072, 0.072]) cover.add(M.steelDark, at(new THREE.CylinderGeometry(0.0048, 0.0048, 0.005, 6), x, top + 0.0565, b.stagger - 0.2 + i * 0.08));
      cover.add(M.rubber, at(rbox(0.168, 0.003, 0.472, 0.0014), 0, top + 0.0015, b.stagger));
      cover.add(M.alloy, at(rbox(0.06, 0.003, 0.11, 0.0014), 0, top + 0.0565, b.stagger + 0.0));
      const cg = cover.build(new THREE.Group());
      cg.quaternion.copy(b.q);
      this.node(covers, cg, b.u.clone().multiplyScalar(0.8));

      const coil = new Batch();
      for (const c of cyls) {
        coil.add(M.plastic, at(rbox(0.032, 0.046, 0.05, 0.006), 0, top + 0.085, c.z));
        coil.add(M.plastic, at(rbox(0.018, 0.014, 0.022, 0.003), b.inner * 0.024, top + 0.096, c.z));
        coil.add(M.rubber, at(new THREE.CylinderGeometry(0.0095, 0.0095, 0.08, 16), 0, top + 0.022, c.z));
      }
      coil.add(M.rubber, at(cylZ(0.006, 0.42, 12), b.inner * 0.034, top + 0.096, b.stagger));
      const kg = coil.build(new THREE.Group());
      kg.quaternion.copy(b.q);
      this.node(coils, kg, b.u.clone().multiplyScalar(0.92));

      const plug = new Batch();
      for (const c of cyls) {
        plug.add(M.steel, at(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 16), 0, SPEC.deck + 0.034, c.z));
        plug.add(M.steel, at(new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 6), 0, SPEC.deck + 0.05, c.z));
        plug.add(M.ceramic, at(new THREE.CylinderGeometry(0.0048, 0.0062, 0.042, 16), 0, SPEC.deck + 0.077, c.z));
        plug.add(M.steel, at(new THREE.CylinderGeometry(0.0022, 0.0022, 0.01, 8), 0, SPEC.deck + 0.102, c.z));
      }
      const pg = plug.build(new THREE.Group());
      pg.quaternion.copy(b.q);
      this.node(plugs, pg, b.u.clone().multiplyScalar(0.62));
    }
    covers.anchor = 1;
    coils.anchor = 1;
    plugs.anchor = 1;
  }

  /* ------------------------------ intake ----------------------------- */

  buildIntake() {
    const M = this.M;
    const plenum = this.part('plenum', { window: [0, 0.24] });
    const runners = this.part('runners', { window: [0.08, 0.34] });

    const pb = new Batch();
    pb.add(M.carbon, at(rbox(0.22, 0.08, 0.42, 0.032), 0, 0.445, -0.01));
    pb.add(M.alloy, at(rbox(0.026, 0.01, 0.4, 0.004), 0, 0.488, -0.01));
    for (const x of [-0.055, 0.055]) {
      pb.add(M.alloy, at(cylZ(0.036, 0.06, 40), x, 0.445, -0.245));
      pb.add(M.steelDark, at(new THREE.TorusGeometry(0.036, 0.004, 10, 40), x, 0.445, -0.272));
      pb.add(M.steelDark, at(cylZ(0.031, 0.003, 32), x, 0.445, -0.262, 0.35, 0, 0)); // butterfly
      pb.add(M.plastic, at(rbox(0.03, 0.035, 0.03, 0.005), x + Math.sign(x) * 0.042, 0.445, -0.245)); // throttle motor
    }
    // A plate on top: the displacement, as cast (ghosted with the castings in x-ray)
    const badge = this.badgeMaterial();
    this.M.castings.add(badge);
    pb.add(badge, at(new THREE.PlaneGeometry(0.15, 0.05), 0, 0.4855, 0.11, -Math.PI / 2, 0, 0));
    this.node(plenum, pb.build(new THREE.Group()), [0, 0.65, 0]);

    const rb = new Batch();
    const p = new THREE.Vector3();
    for (const c of this.cyls) {
      const b = c.bank;
      const port = this.bankPoint(b, b.inner * 0.0965, 0.27, c.z, p).clone();
      const innerDir = b.w.clone().multiplyScalar(b.inner);
      const curve = new THREE.CatmullRomCurve3(
        [new THREE.Vector3(b.side * 0.055, 0.425, c.z), new THREE.Vector3(b.side * 0.066, 0.345, c.z), port.clone().addScaledVector(innerDir, 0.045), port],
        false,
        'centripetal'
      );
      rb.add(M.alloy, new THREE.TubeGeometry(curve, 40, 0.0185, 18, false));
      const flange = at(rbox(0.01, 0.05, 0.05, 0.003), b.inner * 0.0995, 0.27, c.z).applyMatrix4(b.m);
      rb.add(M.alloy, flange);
      // injector between runner and port
      rb.add(M.plastic, at(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 12), 0, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(-b.beta + b.inner * 0.9)).translate(...port.clone().addScaledVector(innerDir, 0.03).addScaledVector(b.u, 0.025).toArray()));
    }
    this.node(runners, rb.build(new THREE.Group()), [0, 0.42, 0]);
  }

  badgeMaterial() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 170;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b9bcc0';
    ctx.fillRect(0, 0, 512, 170);
    ctx.strokeStyle = '#6d7075';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 492, 150);
    ctx.fillStyle = '#9b0e16';
    ctx.font = '700 92px Anton, Impact, "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`V8 · ${Math.round(SPEC.displacement)}`, 256, 92);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.75, roughness: 0.35, clearcoat: 0.6 });
  }

  /* ------------------------------ exhaust ---------------------------- */

  buildExhaust() {
    const M = this.M;
    const part = this.part('exhaust', { window: [0.08, 0.4] });
    const bundle = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    const tail = this.transmission ? -0.92 : -0.52;
    this.collectors = [];
    for (const b of this.banks) {
      const batch = new Batch();
      const outer = b.w.clone().multiplyScalar(-b.inner);
      const cx = b.side * 0.29;
      const cy = -0.14;
      this.cyls
        .filter((c) => c.bank === b)
        .forEach((c, i) => {
          const port = this.bankPoint(b, -b.inner * 0.0965, 0.27, c.z);
          const [ox, oy] = bundle[i];
          const pts = [
            port,
            port.clone().addScaledVector(outer, 0.07).add(new THREE.Vector3(0, -0.02, 0)),
            new THREE.Vector3(b.side * 0.338, 0.0, c.z * 0.55 - 0.1),
            new THREE.Vector3(cx + ox * 0.019, cy + oy * 0.019, -0.3),
            new THREE.Vector3(cx + ox * 0.014, cy + oy * 0.014, -0.345),
          ];
          batch.add(M.exhaust, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 90, 0.0185, 14, false));
          batch.add(M.alloy, at(rbox(0.012, 0.046, 0.054, 0.003), -b.inner * 0.0985, 0.27, c.z).applyMatrix4(b.m));
          for (const dz of [-0.02, 0.02]) batch.add(M.steelDark, at(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 6).rotateZ(Math.PI / 2), -b.inner * 0.106, 0.27 + 0.014, c.z + dz).applyMatrix4(b.m));
        });
      // Collector, tail pipe, catalyst
      batch.add(M.exhaust, tinted(at(new THREE.CylinderGeometry(0.031, 0.048, 0.08, 32, 1, true).rotateX(-Math.PI / 2), cx, cy, -0.38), 0.9));
      batch.add(M.exhaust, tinted(at(cylZ(0.031, -0.42 - tail, 28), cx, cy, (-0.42 + tail) / 2), 0.98));
      if (this.transmission) {
        batch.add(M.exhaust, tinted(at(latheZ([[0.031, 0], [0.06, 0.03], [0.062, 0.09], [0.06, 0.15], [0.031, 0.18]], 36), cx, cy, -0.8), 1));
        batch.add(M.steelDark, at(new THREE.TorusGeometry(0.06, 0.004, 8, 36), cx, cy, -0.71));
      }
      const g = batch.build(new THREE.Group());
      this.node(part, g, [b.side * 0.36, -0.06, 0]);
      this.collectors.push({ bank: b, point: new THREE.Vector3(cx, cy, -0.36), node: part.nodes[part.nodes.length - 1] });
    }
    part.anchor = 1;
  }

  /* ------------------------------- sump ------------------------------ */

  buildSump() {
    const M = this.M;
    const part = this.part('sump', { window: [0.5, 0.8] });
    const batch = new Batch();
    batch.add(M.cast, at(rbox(0.3, 0.045, 0.46, 0.012), 0, -0.1335, 0));
    for (let i = 0; i < 7; i++) batch.add(M.cast, at(rbox(0.006, 0.014, 0.42, 0.002), -0.12 + i * 0.04, -0.158, 0));
    // Scavenge pump: three stages on one shaft
    batch.add(M.castDark, at(cylZ(0.034, 0.26, 32), 0.175, -0.11, 0.04));
    for (let i = 0; i < 4; i++) batch.add(M.alloy, at(cylZ(0.037, 0.008, 32), 0.175, -0.11, -0.08 + i * 0.075));
    // Oil filter and braided lines
    batch.add(M.plastic, at(cylX(0.038, 0.09, 32), 0.215, -0.04, 0.15));
    batch.add(M.alloy, at(cylX(0.028, 0.012, 32), 0.176, -0.04, 0.15));
    const line = (pts) => batch.add(M.braid, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 50, 0.0065, 10, false));
    line([[0.175, -0.11, 0.17], [0.2, -0.09, 0.22], [0.2, -0.05, 0.2], [0.215, -0.04, 0.2]]);
    line([[0.19, -0.11, -0.09], [0.24, -0.08, -0.1], [0.25, 0.0, -0.05], [0.25, -0.02, 0.1], [0.26, -0.04, 0.15]]);
    for (const p of [[0.175, -0.11, 0.17], [0.19, -0.11, -0.09]]) batch.add(M.gold, at(hexZ(0.009, 0.014), ...p));
    this.node(part, batch.build(new THREE.Group()), [0, -0.38, 0]);
  }

  /* ------------------------- front: cover + belts --------------------- */

  buildFront() {
    const M = this.M;
    const timing = this.part('timing', { window: [0.14, 0.4] });
    const acc = this.part('accessories', { window: [0.04, 0.3] });

    // Timing cover: the engine's front silhouette, head height, with a hole for the crank nose
    const bevel = 0.006;
    const shape = new THREE.Shape(this.vProfile(0.38, 0.085, 0.165, -0.105, bevel));
    shape.holes.push(new THREE.Path().absarc(0, 0, 0.024, 0, Math.PI * 2, true));
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 }).translate(0, 0, 0.254);
    const tb = new Batch().add(M.cast, body);
    const v = this.valveGeo;
    for (const b of this.banks)
      for (const s of [-1, 1]) {
        const p = this.bankPoint(b, s * v.camLat, v.camUp, 0);
        tb.add(M.cast, at(cylZ(0.042, 0.014, 40), p.x, p.y, 0.305));
        tb.add(M.alloy, at(cylZ(0.016, 0.004, 24), p.x, p.y, 0.313));
      }
    const outline = this.vProfile(0.38, 0.085, 0.165, -0.105, 0.0);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const c = outline[(i + 1) % outline.length];
      const n = Math.max(1, Math.round(a.distanceTo(c) / 0.07));
      for (let j = 0; j < n; j++) {
        const p = a.clone().lerp(c, j / n);
        const inward = new THREE.Vector2(0, 0.06).sub(p).normalize().multiplyScalar(0.012);
        tb.add(M.steelDark, at(hexZ(0.0045, 0.005), p.x + inward.x, p.y + inward.y, 0.3005));
      }
    }
    this.node(timing, tb.build(new THREE.Group()), [0, 0, 0.34]);

    // Accessory drive: pulleys on one ribbed belt
    const zp = 0.322;
    const pulleys = [
      { name: 'crank', x: 0, y: 0, r: 0.075 },
      { name: 'compressor', x: -0.24, y: -0.04, r: 0.05 },
      { name: 'tensioner', x: -0.1, y: 0.13, r: 0.026 },
      { name: 'pump', x: 0, y: 0.155, r: 0.042 },
      { name: 'idler', x: 0.1, y: 0.13, r: 0.026 },
      { name: 'alternator', x: 0.24, y: -0.04, r: 0.032 },
    ];
    const g = new THREE.Group();
    const fixed = new Batch();
    this.pulleyNodes = [];
    for (const p of pulleys) {
      const pb = new Batch();
      pb.add(M.alloy, cylZ(p.r, 0.024, 48));
      for (let i = 0; i < 5; i++) pb.add(M.steelDark, at(new THREE.TorusGeometry(p.r + 0.0004, 0.0016, 6, 48), 0, 0, -0.008 + i * 0.004));
      pb.add(M.steelDark, at(annulus(p.r * 0.35, p.r * 0.82, 0.004), 0, 0, 0.0125));
      pb.add(M.steel, at(hexZ(Math.max(0.006, p.r * 0.18), 0.008), 0, 0, 0.016));
      if (p.name === 'crank') pb.add(M.rubber, at(annulus(p.r * 0.84, p.r * 0.96, 0.02), 0, 0, -0.002));
      const node = pb.build(new THREE.Group());
      node.position.set(p.x, p.y, zp);
      g.add(node);
      this.pulleyNodes.push({ obj: node, ratio: 0.075 / p.r });
    }
    // Alternator and compressor bodies behind their pulleys; water pump housing; tensioner arm
    fixed.add(M.alloy, at(cylZ(0.062, 0.13, 40), 0.24, -0.04, zp - 0.08));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      fixed.add(M.steelDark, at(rbox(0.012, 0.006, 0.1, 0.002), 0.24 + Math.cos(a) * 0.064, -0.04 + Math.sin(a) * 0.064, zp - 0.08, 0, 0, a));
    }
    fixed.add(M.castDark, at(cylZ(0.06, 0.2, 40), -0.24, -0.04, zp - 0.12));
    fixed.add(M.gold, at(cylX(0.012, 0.03), -0.3, -0.01, zp - 0.15), at(cylX(0.012, 0.03), -0.3, -0.01, zp - 0.09));
    fixed.add(M.cast, at(cylZ(0.032, 0.03, 32), 0, 0.155, zp - 0.025));
    fixed.add(M.castDark, at(rbox(0.012, 0.06, 0.01, 0.003), -0.1, 0.1, zp - 0.01, 0, 0, 0.5));
    // Belt: follows the outside of the pulleys (their convex hull)
    const rim = [];
    for (const p of pulleys) for (let i = 0; i < 48; i++) rim.push(new THREE.Vector2(p.x + Math.cos((i / 48) * Math.PI * 2) * (p.r + 0.003), p.y + Math.sin((i / 48) * Math.PI * 2) * (p.r + 0.003)));
    const hull = convexHull(rim).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const belt = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hull, true, 'centripetal'), 360, 0.0035, 6, true);
    belt.scale(1, 1, 3.2).translate(0, 0, zp);
    fixed.add(M.rubber, belt);
    fixed.build(g);
    this.node(acc, g, [0, 0, 0.62]);
    this.kinematic.push((theta) => {
      for (const p of this.pulleyNodes) p.obj.rotation.z = -theta * p.ratio;
    });
  }

  /* --------------------------- transmission -------------------------- */

  buildTransmission() {
    const M = this.M;
    const flywheel = this.part('flywheel', { window: [0.46, 0.74] });
    const clutch = this.part('clutch', { window: [0.38, 0.66] });
    const bell = this.part('bell', { window: [0.3, 0.58] });
    const gearbox = this.part('gearbox', { window: [0.2, 0.5] });
    const shafts = this.part('shafts', { window: [0.12, 0.42] });

    const fb = new Batch();
    fb.add(M.steelDark, gear(0.14, 0.135, 96, 0.012, 0.03));
    fb.add(M.alloy, at(annulus(0.06, 0.125, 0.006), 0, 0, -0.008));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fb.add(M.steel, at(hexZ(0.006, 0.006), Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0.008));
    }
    const fg = fb.build(new THREE.Group());
    fg.position.set(0, 0, -0.247);
    const fn = this.node(flywheel, fg, [0, 0, -0.17]);

    const cb = new Batch();
    for (let i = 0; i < 6; i++) {
      cb.add(i % 2 ? M.copper : M.steel, at(annulus(0.078, 0.12, 0.0035), 0, 0, -0.012 + i * 0.005));
      cb.add(i % 2 ? M.steel : M.copper, at(annulus(0.034, 0.068, 0.0035), 0, 0, -0.018 + i * 0.005));
    }
    cb.add(M.alloy, at(annulus(0.12, 0.127, 0.04), 0, 0, 0));
    cb.add(M.steel, cylZ(0.028, 0.07, 28));
    const cg = cb.build(new THREE.Group());
    cg.position.set(0, 0, -0.3);
    const cn = this.node(clutch, cg, [0, 0, -0.3]);
    this.kinematic.push((theta) => {
      fn.baseQuat.setFromAxisAngle(Z, -theta);
      cn.baseQuat.setFromAxisAngle(Z, -theta);
    });

    const bb = new Batch();
    bb.add(
      M.castDark,
      latheZ(
        [
          [0.2, 0.0],
          [0.214, 0.0],
          [0.214, 0.014],
          [0.205, 0.04],
          [0.17, 0.13],
          [0.15, 0.158],
          [0.142, 0.158],
          [0.162, 0.13],
          [0.197, 0.04],
          [0.2, 0.0],
        ],
        64
      ).rotateY(Math.PI) // open towards the engine
    );
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      bb.add(M.steelDark, at(hexZ(0.0055, 0.006), Math.cos(a) * 0.207, Math.sin(a) * 0.207, -0.017));
    }
    const bg = bb.build(new THREE.Group());
    bg.position.set(0, 0, -0.244);
    this.node(bell, bg, [0, 0, -0.5]);

    const gb = new Batch();
    gb.add(M.castDark, at(rbox(0.27, 0.26, 0.4, 0.03), 0, -0.02, -0.605));
    gb.add(M.castDark, at(cylX(0.115, 0.42, 48), 0, -0.05, -0.5));
    for (const s of [-1, 1]) {
      gb.add(M.alloy, at(cylX(0.06, 0.02, 40), s * 0.22, -0.05, -0.5));
      for (const z of [-0.66, -0.73]) gb.add(M.castDark, at(rbox(0.012, 0.22, 0.012, 0.003), s * 0.138, -0.02, z));
    }
    gb.add(M.castDark, at(rbox(0.25, 0.24, 0.02, 0.006), 0, -0.02, -0.812));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      gb.add(M.steelDark, at(hexZ(0.006, 0.006), Math.cos(a) * 0.105, -0.02 + Math.sin(a) * 0.1, -0.825));
    }
    // Hydraulic control unit and shift actuators on top
    gb.add(M.plastic, at(rbox(0.16, 0.05, 0.16, 0.01), 0, 0.135, -0.63));
    for (const x of [-0.045, 0, 0.045]) gb.add(M.gold, at(cylZ(0.012, 0.08, 16), x, 0.17, -0.63));
    gb.add(M.braid, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.08, 0.13, -0.56), new THREE.Vector3(0.12, 0.08, -0.48), new THREE.Vector3(0.1, 0.03, -0.43)]), 30, 0.006, 8));
    this.node(gearbox, gb.build(new THREE.Group()), [0, 0, -0.75]);

    for (const s of [-1, 1]) {
      const sb = new Batch();
      const bellows = (x0, len, r0, r1) => {
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          pts.push([THREE.MathUtils.lerp(r0, r1, t) + 0.006 * Math.sin(t * Math.PI * 10) ** 2, t * len]);
        }
        return at(latheZ(pts, 28).rotateY(Math.PI / 2), x0, 0, 0);
      };
      sb.add(M.steel, at(latheZ([[0.03, 0], [0.046, 0.012], [0.046, 0.05], [0.03, 0.068]], 36).rotateY(Math.PI / 2), 0.232, 0, 0));
      sb.add(M.rubber, bellows(0.3, 0.09, 0.036, 0.018));
      sb.add(M.steel, at(cylX(0.0145, 0.36, 20), 0.53, 0, 0));
      sb.add(M.rubber, bellows(0.62, 0.08, 0.018, 0.034));
      sb.add(M.steel, at(new THREE.SphereGeometry(0.042, 28, 18), 0.735, 0, 0));
      sb.add(M.alloy, at(cylX(0.062, 0.014, 40), 0.785, 0, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        sb.add(M.steel, at(cylX(0.005, 0.035, 10), 0.805, Math.cos(a) * 0.042, Math.sin(a) * 0.042));
      }
      const sg = sb.build(new THREE.Group());
      sg.position.set(0, -0.05, -0.5);
      sg.scale.x = s;
      this.node(shafts, sg, [s * 0.32, 0, -0.75]);
    }
  }

  /* ---------------------------- combustion --------------------------- */

  buildCombustion() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,220,1)');
    g.addColorStop(0.25, 'rgba(255,170,70,0.8)');
    g.addColorStop(0.6, 'rgba(255,70,20,0.25)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.flashes = this.cyls.map((cyl) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      this.bankPoint(cyl.bank, 0, SPEC.deck + 0.012, cyl.z, s.position);
      s.scale.setScalar(0.11);
      s.visible = false;
      s.renderOrder = 5;
      this.root.add(s);
      return s;
    });
  }

  /* ------------------------------ finish ----------------------------- */

  finish() {
    // X-ray shells over every casting, shown only while x-ray is on
    this.xrayMat = xrayMaterial();
    for (const mesh of this.castMeshes) {
      const shell = new THREE.Mesh(mesh.geometry, this.xrayMat);
      shell.visible = false;
      shell.renderOrder = 4;
      shell.userData.overlay = true;
      mesh.add(shell);
      mesh.userData.shell = shell;
    }
    this.highlightMat = highlightMaterial();
    this.highlighted = null;
    this.pose({ crank: 0, explode: 0, bottom: 0 });
    this.root.updateMatrixWorld(true);
    // Annotation anchors: the centre of each part's anchor node, in that node's own space
    const box = new THREE.Box3();
    for (const p of this.parts) {
      const n = p.nodes[p.anchor] ?? p.nodes[0];
      if (n.virtual) {
        p.anchorLocal = new THREE.Vector3();
        continue;
      }
      box.makeEmpty();
      n.obj.traverse((o) => o.isMesh && !o.userData.overlay && box.expandByObject(o, true));
      p.anchorLocal = n.obj.worldToLocal(box.getCenter(new THREE.Vector3()));
    }
  }

  /* ------------------------------ posing ----------------------------- */

  /**
   * Pose the whole engine. `crank` in radians; `explode`, `bottom` 0..1.
   * Every node is rebuilt from its base transform: nothing accumulates.
   */
  pose({ crank = this.state.crank, explode = this.state.explode, bottom = this.state.bottom, spread = this.state.spread, vanish = this.state.vanish } = {}) {
    this.state.crank = crank;
    this.state.spread = spread;
    this.state.vanish = vanish = clamp01(vanish);
    this.state.explode = clamp01(explode);
    this.state.bottom = clamp01(bottom);
    for (const fn of this.kinematic) fn(crank);
    for (const p of this.parts) {
      const [w0, w1] = p.window;
      const ch = p.channel === 'bottom' ? this.state.bottom : this.state.explode;
      p.k = w1 > w0 ? easeInOut(clamp01((ch - w0) / (w1 - w0))) : 0;
      // `spread` pushes the torn-down parts further out (clearing the stage around the block)
      p.reach = p.k * (p.channel === 'bottom' ? 1 : spread);
      // `vanish` shrinks the torn-down parts away to nothing as they retreat (never the rotating assembly)
      const size = p.channel === 'bottom' || p.window[1] <= p.window[0] ? 1 : 1 - vanish; // the block stays
      for (const n of p.nodes) {
        n.obj.position.copy(n.basePos).addScaledVector(n.move, p.reach);
        n.obj.quaternion.copy(n.baseQuat);
        n.obj.scale.copy(n.baseScale).multiplyScalar(Math.max(size, 1e-4));
        n.obj.visible = size > 0.002;
      }
    }
    for (const im of [this.valveMesh, this.springMesh, this.tappetMesh]) im.visible = vanish < 0.5;
    this.poseValves(crank);
    // Combustion: a flash in each cylinder for the first ~70° after it fires
    const deg = crank / DEG;
    for (const c of this.cyls) {
      const psi = ((((deg - c.fire) % 720) + 720) % 720);
      c.flash = psi < 80 ? Math.exp(-psi / 16) * Math.min(1, psi / 3 + 0.4) : 0;
    }
  }

  /** Index (0-based in firing order) of the cylinder that fired most recently, and its flash. */
  firing() {
    let best = null;
    for (const c of this.cyls) if (!best || c.flash > best.flash) best = c;
    return best;
  }

  setCombustion(amount) {
    this.cyls.forEach((c, i) => {
      const s = this.flashes[i];
      const o = c.flash * amount;
      s.visible = o > 0.01;
      s.material.opacity = o;
      s.scale.setScalar(0.07 + 0.07 * c.flash);
      s.position.z = c.z;
    });
  }

  /** Ghost the castings (0 = solid, 1 = x-ray) so the internals show. */
  setXray(x) {
    x = clamp01(x);
    if (x === this.xray) return;
    const was = this.xray;
    this.xray = x;
    const on = x > 0.001;
    for (const m of this.M.castings) {
      m.transparent = on;
      m.opacity = 1 - 0.93 * x;
      m.depthWrite = x < 0.4;
      if (on !== was > 0.001) m.needsUpdate = true;
    }
    this.xrayMat.uniforms.uAmount.value = x;
    for (const mesh of this.castMeshes) {
      mesh.userData.shell.visible = on;
      mesh.castShadow = x < 0.5;
    }
  }

  setHeat(h, time) {
    this.M.uniforms.heat.value = h;
    this.M.uniforms.time.value = time;
  }

  /** Rosso fresnel highlight on one part (or none). `amount` 0..1. */
  highlight(id, amount = 1) {
    if (this.highlighted && this.highlighted !== id) for (const s of this.byId.get(this.highlighted).shells ?? []) s.visible = false;
    this.highlighted = id;
    this.highlightMat.uniforms.uAmount.value = amount;
    if (!id) return;
    const part = this.byId.get(id);
    if (!part.shells) {
      part.shells = part.meshes.map((mesh) => {
        let shell;
        if (mesh.isInstancedMesh) {
          shell = new THREE.InstancedMesh(mesh.geometry, this.highlightMat, mesh.count);
          shell.instanceMatrix = mesh.instanceMatrix;
          shell.frustumCulled = false;
          this.root.add(shell);
        } else {
          shell = new THREE.Mesh(mesh.geometry, this.highlightMat);
          mesh.add(shell);
        }
        shell.renderOrder = 6;
        shell.userData.overlay = true;
        return shell;
      });
    }
    for (const s of part.shells) s.visible = amount > 0.001;
  }

  /** The part under a ray, or null. */
  pick(raycaster) {
    // Instances move with the pose: their bounds must be recomputed before a ray test
    for (const im of [this.valveMesh, this.springMesh, this.tappetMesh]) im.boundingSphere = null;
    for (const hit of raycaster.intersectObjects(this.pickables, false)) {
      // In x-ray the castings are glass: look through them to the parts inside
      if (this.xray > 0.5 && this.M.castings.has(hit.object.material)) continue;
      return hit.object.userData.part;
    }
    return null;
  }

  /** World position of a part's annotation anchor (or of `at`, a point in engine space that travels with the part). */
  anchor(id, out = new THREE.Vector3(), at = null) {
    const p = this.byId.get(id);
    if (!p) return null;
    const n = p.nodes[p.anchor] ?? p.nodes[0];
    if (at) return this.root.localToWorld(out.set(...at).addScaledVector(n.move, p.reach));
    return n.obj.localToWorld(out.copy(p.anchorLocal));
  }

  /** Corners of every visible mesh's world bounds at a pose (then back): a point set for camera framing. */
  pointsAt(pose, ids = null) {
    const saved = { ...this.state };
    this.pose({ spread: 1, vanish: 0, ...pose });
    this.root.updateMatrixWorld(true);
    const points = [];
    const box = new THREE.Box3();
    const parts = ids ? ids.map((id) => this.byId.get(id)).filter(Boolean) : this.parts;
    for (const p of parts)
      for (const mesh of p.meshes) {
        if (mesh.isInstancedMesh) continue;
        box.setFromObject(mesh, true);
        if (box.isEmpty()) continue;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
      }
    this.pose(saved);
    this.root.updateMatrixWorld(true);
    return points;
  }

  /** Engine-space bounds of the assembled engine. */
  restBounds() {
    const pts = this.pointsAt({ explode: 0, bottom: 0 });
    const inv = this.root.matrixWorld.clone().invert();
    return new THREE.Box3().setFromPoints(pts.map((p) => p.applyMatrix4(inv)));
  }

  dispose() {
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
    });
  }
}

/** Monotone-chain convex hull (counter-clockwise). */
function convexHull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
