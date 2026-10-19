/**
 * Part manifest for the exploded-view cinematic.
 *
 * The cinematic never hard-codes geometry: every moving part is described here
 * by the registry component IDs it moves (see src/vehicle/registry/), the window
 * of the explode timeline it moves in, and a mechanically motivated motion:
 *
 *   hinge  { axis, angle, pivot? }  rotation (degrees) about an axis through the
 *                                   node's own origin (its real hinge/hub in this
 *                                   asset) or an explicit pivot [x, y, z]
 *   move   [x, y, z]                translation in metres, applied after the hinge
 *   window [start, end]             slice of the explode timeline (0..1)
 *
 * All vectors are in model space after import: Y up, nose towards +Z, metres.
 * Each listed component's nodes are detached from their parent at load (world
 * transform kept), so they move on their own path. Children that are not listed
 * ride along with their parent (door glass stays in the door, the rear window
 * stays in the clamshell).
 *
 * Asset facts (file, hidden logos, paint materials, licence) live in the
 * registry, not here. To use a different car, give it a registry with the same
 * component IDs and adjust only the motions below.
 */
import { conceptCar as registry } from '../vehicle/registry/concept-car.js';

export const conceptCar = {
  registry,
  // The part that the "power unit" scene focuses on
  focus: 'engine',
  // This asset has no tailpipes, so the cinematic shows no exhaust.
  exhaust: [],

  parts: [
    // 1. Lamps float clear of their housings first…
    { id: 'headlights', label: 'Headlamp units', components: ['lights.head'], window: [0.0, 0.16], move: [0, 0.08, 0.5] },
    {
      id: 'taillights',
      label: 'Tail-lamp units',
      components: ['lights.tail', 'lights.tail.housing', 'lights.tail.signals'],
      window: [0.02, 0.18],
      move: [0, 0.12, -0.55],
    },
    // 2. …then the clamshells open on their real hinges (front: at the nose, rear: at the tail)
    {
      id: 'hood',
      label: 'Front clamshell',
      components: ['panel.frontClamshell'],
      window: [0.06, 0.3],
      hinge: { axis: [1, 0, 0], angle: 64 },
      move: [0, 0.3, 0.45],
    },
    {
      id: 'rear',
      label: 'Rear clamshell',
      components: ['panel.rearClamshell'],
      window: [0.1, 0.32],
      hinge: { axis: [1, 0, 0], angle: -58 },
      move: [0, 0.3, -0.5],
    },
    // 3. Doors swing on their A-pillar hinges, then step outboard
    {
      id: 'door-l',
      label: 'Doors',
      components: ['panel.door.left'],
      window: [0.14, 0.36],
      hinge: { axis: [0, 1, 0], angle: -58 },
      move: [0.55, 0, 0.1],
    },
    {
      id: 'door-r',
      components: ['panel.door.right'],
      window: [0.16, 0.38],
      hinge: { axis: [0, 1, 0], angle: 58 },
      move: [-0.55, 0, 0.1],
    },
    // 4. Glasshouse lifts away
    { id: 'roof', label: 'Roof panel', components: ['body.roof'], window: [0.22, 0.4], move: [0, 0.95, 0] },
    {
      id: 'windshield',
      components: ['glass.windshield', 'glass.windshield.gasket', 'body.wipers'],
      window: [0.25, 0.43],
      move: [0, 0.62, 0.42],
    },
    // 5. Wheels slide off their hubs along the axle line, turning slightly;
    //    disc and caliper stop halfway, so the stack reads hub → brake → wheel
    ...wheel('fl', 1, 0.3),
    ...wheel('fr', -1, 0.32),
    ...wheel('rl', 1, 0.34),
    ...wheel('rr', -1, 0.36),
    // 6. Power unit lifts vertically out of the bay, then the axles drop
    {
      id: 'engine',
      label: 'Power unit',
      components: ['powertrain.engine'],
      window: [0.4, 0.64],
      hinge: { axis: [1, 0, 0], angle: -4 },
      move: [0, 1.1, 0.2],
    },
    { id: 'axles', label: 'Axles', components: ['chassis.axles'], window: [0.46, 0.62], move: [0, -0.22, 0] },
    // 7. Cockpit components rise in layers
    {
      id: 'seats',
      label: 'Seats',
      components: ['interior.seats'],
      window: [0.52, 0.74],
      move: [0, 0.85, -0.12],
    },
    {
      id: 'steering',
      label: 'Steering assembly',
      components: ['interior.steering'],
      window: [0.56, 0.78],
      move: [0, 0.78, 0.08],
    },
    { id: 'dash', label: 'Dashboard', components: ['interior.dash'], window: [0.6, 0.82], move: [0, 0.5, 0.35] },
    {
      id: 'pedals',
      components: ['interior.pedals'],
      window: [0.64, 0.86],
      move: [0, 0.3, 0.62],
    },
  ],

  /** Callouts shown on the exploded view: part id + short, factual label (key: kept on small screens). */
  callouts: [
    { part: 'hood', title: 'Front clamshell', text: 'Nose-hinged, carries the headlamps', key: true },
    { part: 'door-l', title: 'Doors', text: 'A-pillar hinge, glass and trim in one module' },
    { part: 'wheel-fl', title: 'Wheel · disc · caliper', text: 'Separated along the axle line', key: true },
    { part: 'engine', title: 'Power unit', text: 'Lifted out of the front bay', key: true },
    { part: 'seats', title: 'Cockpit', text: 'Seats, steering and dash in layers' },
    { part: 'rear', title: 'Rear clamshell', text: 'Tail-hinged, carries the tail-lamps' },
  ],
};

function wheel(corner, side, start) {
  return [
    {
      id: `wheel-${corner}`,
      label: 'Wheel',
      components: [`wheel.${corner}`],
      window: [start, start + 0.24],
      hinge: { axis: [1, 0, 0], angle: 35 * side },
      move: [1.0 * side, 0, 0],
    },
    {
      id: `brake-${corner}`,
      label: 'Disc and caliper',
      components: [`wheel.${corner}.disc`, `wheel.${corner}.caliper`],
      window: [start + 0.04, start + 0.24],
      move: [0.42 * side, 0, 0],
    },
  ];
}
