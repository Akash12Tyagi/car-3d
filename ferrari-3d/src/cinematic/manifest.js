/**
 * Part manifest for the exploded-view sequence (Anatomy chapter), on the SAME
 * Ferrari 458 the rest of the site shows.
 *
 * Only real, separately modelled components move (addressed by registry ID,
 * src/vehicle/registry/ferrari-458.js); nothing is cut or invented. The asset
 * is split by material, not by panel, so the body can't open on hinges: it
 * lifts off the tub as the one piece it is. What the 458 file does separate,
 * the wheels, comes apart fully: every corner leaves along its axle in six
 * real layers. The engine is the procedural V8 (src/engine/v8.js), mounted
 * where a 458's engine sits: behind the cabin, its half-shafts on the
 * measured rear hub centres. It is addressed as '@v8' (an Exploder extra).
 *
 *   channel  'explode' (default) or 'power'
 *   window   [start, end] slice of that channel (0..1): the stagger
 *   hinge    { axis, angle } rotation (degrees) about the node's own origin
 *   move     [x, y, z] translation in metres, applied after the hinge
 *
 * Vectors are in 458 model space: Y up, nose towards −Z, the car's left
 * towards −X. Measured: hubs at x ±0.82–0.84, y 0.358, z −1.155 (front) and
 * +1.495 (rear); body shell y 0.16–1.24; engine deck at y 0.92–1.0.
 *
 * Order keeps parts out of each other: the body is clear of the tyres before
 * any wheel moves; on each corner the outermost layer leaves first and every
 * layer travels further than the one inside it (cap → nuts → spokes → tyre →
 * rim → disc), so each passes through the bore of the next; the engine lifts
 * only once the body is high above it. Reassembly is the same windows in reverse.
 */
import { ferrari458 as registry } from '../vehicle/registry/ferrari-458.js';

/** Hub centre x of each corner (measured), for the outward direction. */
const HUB_X = { fl: -0.843, fr: 0.829, rl: -0.821, rr: 0.824 };

const BODY = [
  'body.shell',
  'body.trim.chrome',
  'body.trim.metal',
  'body.trim.plastic',
  'body.trim.grilles',
  'body.badges',
  'body.wipers',
  'glass.main',
  'lights.head.lenses',
  'lights.head.leds',
  'lights.tail.lenses',
  'lights.tail.units',
];

/** The model-space point the V8 is mounted at (engine-space origin = crank axis), see Anatomy.mountEngine. */
export const V8_MOUNT = {
  // diff (engine z −0.5) on the rear axle line; half-shafts at hub height
  position: [0, 0.408, 0.995],
  // engine front (+Z, accessory drive) towards the cabin (−Z)
  yaw: 180,
};

export const anatomy458 = {
  registry,
  focus: 'engine',
  // The tailpipe exhaust runs on the main car (Performance, Launch, the intro)
  exhaust: [],

  parts: [
    // 1. The body lifts off the tub in one piece, with its glass, lamps and trim
    { id: 'body', label: 'Body', components: BODY, window: [0.0, 0.36], move: [0, 2.0, 0] },
    // 2. The steering wheel rises out of the cockpit
    { id: 'steering', label: 'Steering wheel', components: ['interior.steering'], window: [0.28, 0.56], move: [0, 0.82, 0.05] },
    // 3. Wheels: each corner comes apart along its axle, outermost layer first
    ...corner('fl', 0.3),
    ...corner('fr', 0.33),
    ...corner('rl', 0.36),
    ...corner('rr', 0.39),
    // The tub stays (a part only so it can be annotated and ghosted)
    { id: 'tub', label: 'Tub and cabin', components: ['structure.tub'], window: [0, 1], move: [0, 0, 0] },
    // 4. Power channel: the V8 and transaxle lift out of the rear bay
    { id: 'engine', label: 'V8 and transaxle', channel: 'power', components: ['@v8'], window: [0.0, 0.85], hinge: { axis: [1, 0, 0], angle: -4 }, move: [0, 0.62, 0] },
  ],

  /**
   * Annotations, per held state. The marker sits on the part's centre, or on
   * `at`, a point on it in rest model space (it travels with the part).
   */
  callouts: {
    exploded: [
      { part: 'body', at: [0, 1.0, 0.6], title: 'Body', text: 'One piece, lifted off the tub', key: true },
      { part: 'tire-fl', title: 'Wheel, in six layers', text: 'Cap, nuts, spokes, tyre, rim, disc', key: true },
      { part: 'engine', title: 'Mid-mounted V8', text: 'Behind the cabin, ahead of the rear axle', key: true },
      { part: 'steering', title: 'Steering wheel', text: 'Lifted clear of the cockpit' },
      { part: 'tub', at: [0, 0.5, -0.5], title: 'Tub and cabin', text: 'The structure everything bolts to' },
    ],
    power: [
      { part: 'engine', at: [0, 0.86, 0.95], title: 'V8 · 4,497 cc', text: '570 CV at 9,000 rpm. Chapter 05 takes it apart', key: true },
      { part: 'engine', at: [0, 0.5, 1.72], title: 'Seven-speed transaxle', text: 'Dual clutch, behind the rear axle', key: true },
      { part: 'engine', at: [-0.6, 0.358, 1.495], title: 'Half-shafts', text: 'Out to the rear hubs' },
    ],
  },
};

/** One corner's six layers: how far out each travels, and when it starts within the corner's window. */
function corner(c, start) {
  const s = Math.sign(HUB_X[c]);
  const layer = (id, out, delay, spin = 0) => ({
    id: `${id}-${c}`,
    label: 'Wheel',
    components: [`wheel.${c}.${id === 'rim' ? 'barrel' : id}`],
    window: [start + delay, start + delay + 0.26],
    ...(spin ? { hinge: { axis: [1, 0, 0], angle: spin * s } } : {}),
    move: [out * s, 0, 0],
  });
  return [
    layer('cap', 1.58, 0),
    layer('nuts', 1.46, 0.015),
    layer('spokes', 1.3, 0.03, 30),
    layer('tire', 1.02, 0.05, 40),
    layer('rim', 0.72, 0.075),
    layer('disc', 0.36, 0.1),
  ];
}
