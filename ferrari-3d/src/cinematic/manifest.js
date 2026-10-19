/**
 * Part manifest for the exploded-view sequence (Anatomy chapter).
 *
 * Every moving part is a real, separately modelled component of the asset,
 * addressed by its registry ID (src/vehicle/registry/). Nothing is split or
 * invented: parts the asset doesn't have (engine internals, gearbox, exhaust,
 * suspension) are listed in the registry's `missing` and documented in
 * docs/EXPLODED-VIEW.md. For each part:
 *
 *   channel  'explode' (default) or 'power' — which sequence channel moves it
 *   window   [start, end] slice of that channel (0..1): the stagger
 *   hinge    { axis, angle, pivot? } rotation (degrees) about the node's own
 *            origin, which in this asset is the real hinge or hub, or an
 *            explicit pivot [x, y, z]
 *   move     [x, y, z] translation in metres, applied after the hinge
 *
 * Vectors are in model space: Y up, nose towards +Z, the car's left towards +X.
 * Targets were set from measured bounds, and checked by sampling every pair
 * of moving parts along both channels, so that no two moving parts share
 * space: the glass lifts, wheels and brakes leave along the axle line, the body
 * opens upwards and outwards, the cockpit rises through the opened roof in
 * layers, and the column above the front bay is kept clear for the power-unit
 * lift. Each window starts only after the parts in its way have left, and
 * reassembly is the same windows in reverse.
 */
import { conceptCar as registry } from '../vehicle/registry/concept-car.js';

export const conceptCar = {
  registry,
  // The part the power-unit state focuses on
  focus: 'engine',
  // This asset has no tailpipes, so the sequence shows no exhaust.
  exhaust: [],

  parts: [
    // 1. The glasshouse lifts first, clearing the way for the cockpit. The windscreen
    //    rises forward, over the dashboard and the power-unit column, like a canopy
    { id: 'roof', label: 'Roof panel', components: ['body.roof'], window: [0.0, 0.24], move: [0, 1.3, -0.05] },
    {
      id: 'windshield',
      label: 'Windscreen',
      components: ['glass.windshield', 'glass.windshield.gasket', 'body.wipers'],
      window: [0.04, 0.3],
      move: [0, 1.15, 0.8],
    },
    // 2. Wheels slide off their hubs along the axle line, turning; disc and caliper stop
    //    halfway, so each corner reads hub → brake → wheel. They go before the clamshells
    //    open, so no wheel arch sweeps through a tyre
    ...wheel('fl', 1, 0.08),
    ...wheel('fr', -1, 0.1),
    ...wheel('rl', 1, 0.12),
    ...wheel('rr', -1, 0.14),
    // 3. Doors swing on their A-pillar hinges, then step outboard and back, clear of the front wheels
    {
      id: 'door-l',
      label: 'Doors',
      components: ['panel.door.left'],
      window: [0.2, 0.46],
      hinge: { axis: [0, 1, 0], angle: -58 },
      move: [0.7, 0, -0.15],
    },
    {
      id: 'door-r',
      label: 'Doors',
      components: ['panel.door.right'],
      window: [0.22, 0.48],
      hinge: { axis: [0, 1, 0], angle: 58 },
      move: [-0.7, 0, -0.15],
    },
    // 4. The clamshells open on their real hinges (front at the nose, rear at the tail) and stand off
    {
      id: 'hood',
      label: 'Front clamshell',
      components: ['panel.frontClamshell'],
      window: [0.3, 0.58],
      hinge: { axis: [1, 0, 0], angle: 64 },
      move: [0, 0.3, 0.5],
    },
    {
      id: 'rear',
      label: 'Rear clamshell',
      components: ['panel.rearClamshell'],
      window: [0.34, 0.62],
      hinge: { axis: [1, 0, 0], angle: -58 },
      move: [0, 0.3, -0.5],
    },
    // 5. The cockpit rises through the open roof in layers: the steering assembly first (its
    //    column runs through the dashboard), then seats, dashboard and the pedal box
    { id: 'steering', label: 'Steering assembly', components: ['interior.steering'], window: [0.5, 0.76], move: [0, 0.98, -0.16] },
    { id: 'seats', label: 'Seats', components: ['interior.seats'], window: [0.54, 0.8], move: [0, 1.0, -0.38] },
    { id: 'dash', label: 'Dashboard', components: ['interior.dash'], window: [0.6, 0.86], move: [0, 0.42, -0.08] },
    { id: 'pedals', label: 'Pedal box', components: ['interior.pedals'], window: [0.66, 0.92], move: [0, 0.2, -0.42] },

    // 6. Power channel: the powertrain comes out once the body is open — the power-unit
    //    volume lifts straight up out of the front bay, the axle set drops below the floor line
    {
      id: 'engine',
      label: 'Power-unit volume',
      channel: 'power',
      components: ['powertrain.engine'],
      window: [0.0, 0.85],
      hinge: { axis: [1, 0, 0], angle: -6 },
      move: [0, 1.05, 0.22],
    },
    { id: 'axles', label: 'Axles', channel: 'power', components: ['chassis.axles'], window: [0.25, 1.0], move: [0, -0.2, 0] },
  ],

  /**
   * Annotations, per held state. Each names a real part of the model and says
   * only what the model shows (key: kept on small screens). The marker sits on
   * the part: the centre of its bounds, or `at`, a point on it in rest model space.
   */
  callouts: {
    exploded: [
      { part: 'hood', title: 'Front clamshell', text: 'Hinged at the nose, headlamps attached', key: true },
      { part: 'door-l', title: 'Doors', text: 'Hinged at the A-pillar, glass and mirror attached' },
      { part: 'wheel-fl', title: 'Wheel · disc · caliper', text: 'Separated along the axle line', key: true },
      { part: 'seats', title: 'Cockpit', text: 'Seats, steering and dashboard in layers', key: true },
      { part: 'rear', title: 'Rear clamshell', text: 'Hinged at the tail, tail-lamps attached' },
    ],
    power: [
      { part: 'engine', title: 'Power-unit volume', text: 'Envelope only in this model — no engine internals', key: true },
      // on the front axle shaft, between the hub (x 0.98) and the centreline
      { part: 'axles', at: [0.45, 0.384, 1.486], title: 'Axles', text: 'Front and rear, simple shafts in this model', key: true },
    ],
  },
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
