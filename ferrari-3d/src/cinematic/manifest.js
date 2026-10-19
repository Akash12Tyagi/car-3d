/**
 * Part manifest for the exploded-view cinematic.
 *
 * The cinematic never hard-codes geometry: every moving component is described
 * here by the node names it owns in the glTF, the window of the explode timeline
 * it moves in, and a mechanically motivated motion:
 *
 *   hinge  { axis, angle, pivot? }  rotation (degrees) about an axis through the
 *                                   node's own origin (its real hinge/hub in this
 *                                   asset) or an explicit pivot [x, y, z]
 *   move   [x, y, z]                translation in metres, applied after the hinge
 *   window [start, end]             slice of the explode timeline (0..1)
 *
 * All vectors are in model space after import: Y up, nose towards +Z, metres.
 * Each listed node is detached from its parent at load (world transform kept),
 * so it moves on its own path. Unlisted children ride along with their parent
 * (door glass and trim stay in the door, the rear window stays in the clamshell).
 *
 * To use a different car (e.g. a licensed, component-separated 458 CAD model),
 * write a new manifest with that file's node names and hinge directions. The
 * cinematic, camera path and callouts all read from it.
 */
export const conceptCar = {
  id: 'khronos-carconcept',
  url: 'models/concept-car.glb',
  credit:
    'Stand-in asset: “CarConcept” by Eric Chadwick, Darmstadt Graphics Group (CC BY 4.0), from the Khronos glTF Sample Assets.',
  // Trademarked logos in the sample asset are not ours to show
  hide: ['License_Plate', 'InteriorSteeringEmblem'],
  // Paint materials, re-tinted to the site's Rosso
  paintMaterials: ['Paint 1 Carmine', 'Paint 2 Carmine'],
  // The node that the "power unit" scene focuses on
  focus: 'engine',
  // This asset has no tailpipes, so the cinematic shows no exhaust.
  exhaust: [],

  parts: [
    // 1. Lamps float clear of their housings first…
    { id: 'headlights', label: 'Headlamp units', nodes: ['BodyHeadlights'], window: [0.0, 0.16], move: [0, 0.08, 0.5] },
    {
      id: 'taillights',
      label: 'Tail-lamp units',
      nodes: ['BodyTaillights', 'BodyTaillightsPanels', 'BodyTurnsignalsRear'],
      window: [0.02, 0.18],
      move: [0, 0.12, -0.55],
    },
    // 2. …then the clamshells open on their real hinges (front: at the nose, rear: at the tail)
    {
      id: 'hood',
      label: 'Front clamshell',
      nodes: ['BodyHood'],
      window: [0.06, 0.3],
      hinge: { axis: [1, 0, 0], angle: 64 },
      move: [0, 0.3, 0.45],
    },
    {
      id: 'rear',
      label: 'Rear clamshell',
      nodes: ['BodyRearPanelsColor1'],
      window: [0.1, 0.32],
      hinge: { axis: [1, 0, 0], angle: -58 },
      move: [0, 0.3, -0.5],
    },
    // 3. Doors swing on their A-pillar hinges, then step outboard
    {
      id: 'door-l',
      label: 'Doors',
      nodes: ['BodyDoorLColor1'],
      window: [0.14, 0.36],
      hinge: { axis: [0, 1, 0], angle: -58 },
      move: [0.55, 0, 0.1],
    },
    {
      id: 'door-r',
      nodes: ['BodyDoorRColor1'],
      window: [0.16, 0.38],
      hinge: { axis: [0, 1, 0], angle: 58 },
      move: [-0.55, 0, 0.1],
    },
    // 4. Glasshouse lifts away
    { id: 'roof', label: 'Roof panel', nodes: ['BodyRoofPanel'], window: [0.22, 0.4], move: [0, 0.95, 0] },
    {
      id: 'windshield',
      nodes: ['BodyWindshield', 'BodyWindshieldGasket', 'BodyWindshieldWipers', 'BodyWindshieldWipersBase'],
      window: [0.25, 0.43],
      move: [0, 0.62, 0.42],
    },
    // 5. Wheels slide off their hubs along the axle line, turning slightly;
    //    disc and caliper stop halfway, so the stack reads hub → brake → wheel
    ...wheel('WheelFrontL', 1, 0.3),
    ...wheel('WheelFrontR', -1, 0.32),
    ...wheel('WheelRearL', 1, 0.34),
    ...wheel('WheelRearR', -1, 0.36),
    // 6. Power unit lifts vertically out of the bay, then the axles drop
    {
      id: 'engine',
      label: 'Power unit',
      nodes: ['Engine'],
      window: [0.4, 0.64],
      hinge: { axis: [1, 0, 0], angle: -4 },
      move: [0, 1.1, 0.2],
    },
    { id: 'axles', label: 'Axles', nodes: ['Axles'], window: [0.46, 0.62], move: [0, -0.22, 0] },
    // 7. Cockpit components rise in layers
    {
      id: 'seats',
      label: 'Seats',
      nodes: ['InteriorSeatsColor1', 'InteriorSeatsColor2', 'InteriorSeatsFrame1', 'InteriorSeatsFrame2'],
      window: [0.52, 0.74],
      move: [0, 0.85, -0.12],
    },
    {
      id: 'steering',
      label: 'Steering assembly',
      nodes: [
        'InteriorSteeringCylinder',
        'InteriorSteeringBase',
        'InteriorSteeringDash',
        'InteriorSteeringDashColumn',
        'InteriorSteeringHandleL',
        'InteriorSteeringHandleR',
      ],
      window: [0.56, 0.78],
      move: [0, 0.78, 0.08],
    },
    { id: 'dash', label: 'Dashboard', nodes: ['InteriorDashMid', 'InteriorDashSides'], window: [0.6, 0.82], move: [0, 0.5, 0.35] },
    {
      id: 'pedals',
      nodes: ['InteriorPedalAccel', 'InteriorPedalAccelArm', 'InteriorPedalBrake', 'InteriorPedalBrakeArm'],
      window: [0.64, 0.86],
      move: [0, 0.3, 0.62],
    },
  ],

  /** Callouts shown on the exploded view: part id + short, factual label (key: kept on small screens). */
  callouts: [
    { part: 'hood', title: 'Front clamshell', text: 'Nose-hinged, carries the headlamps', key: true },
    { part: 'door-l', title: 'Doors', text: 'A-pillar hinge, glass and trim in one module' },
    { part: 'wheel-WheelFrontL', title: 'Wheel · disc · caliper', text: 'Separated along the axle line', key: true },
    { part: 'engine', title: 'Power unit', text: 'Lifted out of the front bay', key: true },
    { part: 'seats', title: 'Cockpit', text: 'Seats, steering and dash in layers' },
    { part: 'rear', title: 'Rear clamshell', text: 'Tail-hinged, carries the tail-lamps' },
  ],
};

function wheel(name, side, start) {
  return [
    {
      id: `wheel-${name}`,
      label: 'Wheel',
      nodes: [name],
      window: [start, start + 0.24],
      hinge: { axis: [1, 0, 0], angle: 35 * side },
      move: [1.0 * side, 0, 0],
    },
    {
      id: `brake-${name}`,
      label: 'Disc and caliper',
      nodes: [`${name}BrakeDisc`, `${name}BrakePad`],
      window: [start + 0.04, start + 0.24],
      move: [0.42 * side, 0, 0],
    },
  ];
}
