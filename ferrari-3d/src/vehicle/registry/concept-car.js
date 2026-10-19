/**
 * Component registry — concept-car.glb (stand-in for the Anatomy chapter).
 *
 * Source: Khronos glTF Sample Assets "CarConcept" — CC BY 4.0, Eric Chadwick,
 * Darmstadt Graphics Group GmbH (2024), from a CC0 base model by "Unity Fan".
 * The file embeds Khronos and 3D Commerce logos, which are trademarks, not
 * covered by the CC licence: their carriers are registered `hidden` below.
 * Optimised with glTF-Transform (Draco, WebP 1024) keeping the hierarchy.
 *
 * Unlike the 458, this asset is split BY COMPONENT and its panels carry their
 * real hinge pivots as node origins. Two caveats, stated plainly:
 *   - "Engine" is an 89-vertex box with a normal map: a placeholder volume.
 *   - "Axles" is 212 vertices of simple cylinders.
 * Neither is a mechanical model. There is no gearbox, exhaust or suspension.
 *
 * Coordinates: three.js space after import, Y up, metres, nose towards +Z.
 * Selectors use the ORIGINAL glTF node names (see ../selectors.js).
 */

const B = 'BodyUnderside';

const corner = (id, node, label) => [
  { id: `wheel.${id}`, group: 'wheel', label: `${label} wheel assembly`, select: [`${B}/${node}`], required: true, movable: true,
    notes: 'Node origin is the hub centre. Front wheels are exported with a small steer angle.' },
  { id: `wheel.${id}.rim`, group: 'wheel', label: `${label} rim`, select: [`${B}/${node}/${node}Rim`] },
  { id: `wheel.${id}.disc`, group: 'wheel', label: `${label} brake disc`, select: [`${B}/${node}/${node}BrakeDisc`] },
  { id: `wheel.${id}.caliper`, group: 'wheel', label: `${label} brake caliper`, select: [`${B}/${node}/${node}BrakePad`],
    notes: 'Named BrakePad in the file; it is the caliper body.' },
  // The tyre node is unnamed in the source asset; identify it by its tread material.
  { id: `wheel.${id}.tire`, group: 'wheel', label: `${label} tyre`, select: [{ under: `${B}/${node}`, material: 'Tiretread' }] },
];

const DOOR_L = `${B}/BodyDoorLColor1`;
const DOOR_R = `${B}/BodyDoorRColor1`;
const REAR = `${B}/BodyRearPanelsColor1`;
const HOOD = `${B}/BodyHood`;

export const conceptCar = {
  id: 'khronos-carconcept',
  url: 'models/concept-car.glb',
  root: B,
  licence: {
    author: 'Eric Chadwick, Darmstadt Graphics Group GmbH (Khronos glTF Sample Assets “CarConcept”)',
    terms: 'CC BY 4.0 — attribution required (verified from the asset copyright field and Khronos metadata)',
    trademarks: 'Khronos / 3D Commerce logos embedded (licence plate, steering emblem) — hidden in the experience',
  },

  components: [
    // ── Body ──────────────────────────────────────────────────────────────
    { id: 'body.underside', group: 'chassis', label: 'Underbody tray (root node)', select: [B], scope: 'self', required: true, movable: false,
      notes: 'Root of the hierarchy; scope "self" = its own mesh only. Never move it — everything is parented to it.' },
    { id: 'body.sides', group: 'body', label: 'Side sills and lower panels', select: [`${B}/BodyPanelsColor2`] },
    { id: 'body.pillars', group: 'body', label: 'Pillars and roof frame', select: [`${B}/BodyPillars`] },
    { id: 'body.roof', group: 'panel', label: 'Roof panel (removable)', select: [`${B}/BodyRoofPanel`], movable: true },

    // ── Panels with real hinges (pivot = node origin) ─────────────────────
    { id: 'panel.frontClamshell', group: 'panel', label: 'Front clamshell', select: [HOOD], required: true, movable: true,
      hinge: { axis: [1, 0, 0], pivot: 'node origin (nose, low)', pivotAt: [0, 0.18, 2.38] },
      notes: 'Includes bonnet inner, top grille and headlamps as children.' },
    { id: 'panel.rearClamshell', group: 'panel', label: 'Rear clamshell', select: [REAR], required: true, movable: true,
      hinge: { axis: [1, 0, 0], pivot: 'node origin (tail, low)', pivotAt: [0, 0.42, -1.93] },
      notes: 'Includes rear glass, rear hatch trim and tail-lamps as children.' },
    { id: 'panel.door.left', group: 'panel', label: 'Left door', select: [DOOR_L], required: true, movable: true,
      hinge: { axis: [0, 1, 0], pivot: 'node origin (A-pillar)', pivotAt: [1.09, 0.64, 1.0] },
      notes: 'Includes door glass, mirror, handle and door card as children.' },
    { id: 'panel.door.right', group: 'panel', label: 'Right door', select: [DOOR_R], required: true, movable: true,
      hinge: { axis: [0, 1, 0], pivot: 'node origin (A-pillar)', pivotAt: [-1.09, 0.64, 1.0] } },

    // ── Glass ────────────────────────────────────────────────────────────
    { id: 'glass.windshield', group: 'glass', label: 'Windscreen', select: [`${B}/BodyWindshield`], movable: true },
    { id: 'glass.windshield.gasket', group: 'glass', label: 'Windscreen gasket', select: [`${B}/BodyWindshieldGasket`], movable: true },
    { id: 'glass.rear', group: 'glass', label: 'Rear window', select: [`${REAR}/BodyRearwindow`] },
    { id: 'glass.rearSides', group: 'glass', label: 'Rear side windows', select: [`${REAR}/BodyWindowsRearSides`] },
    { id: 'glass.door.left', group: 'glass', label: 'Left door glass', select: [`${DOOR_L}/BodyDoorLWindow`] },
    { id: 'glass.door.right', group: 'glass', label: 'Right door glass', select: [`${DOOR_R}/BodyDoorRWindow`] },
    { id: 'body.wipers', group: 'body', label: 'Wipers and wiper base', select: [`${B}/BodyWindshieldWipers`, `${B}/BodyWindshieldWipersBase`], movable: true },

    // ── Lights ───────────────────────────────────────────────────────────
    { id: 'lights.head', group: 'lights', label: 'Headlamps', select: [`${HOOD}/BodyHeadlights`], movable: true },
    { id: 'lights.tail', group: 'lights', label: 'Tail-lamps', select: [`${REAR}/BodyTaillights`], movable: true },
    { id: 'lights.tail.housing', group: 'lights', label: 'Tail-lamp housings', select: [`${REAR}/BodyTaillightsPanels`], movable: true },
    { id: 'lights.tail.signals', group: 'lights', label: 'Rear turn signals', select: [`${REAR}/BodyTurnsignalsRear`], movable: true },

    // ── Wheels ───────────────────────────────────────────────────────────
    ...corner('fl', 'WheelFrontL', 'Front-left'),
    ...corner('fr', 'WheelFrontR', 'Front-right'),
    ...corner('rl', 'WheelRearL', 'Rear-left'),
    ...corner('rr', 'WheelRearR', 'Rear-right'),

    // ── Powertrain and chassis (placeholders, labelled as such) ───────────
    { id: 'powertrain.engine', group: 'powertrain', label: 'Power-unit volume', select: [`${B}/Engine`], movable: true,
      placeholder: '89-vertex box with a normal map — a volume, not an engine' },
    { id: 'chassis.axles', group: 'chassis', label: 'Axles', select: [`${B}/Axles`], movable: true,
      placeholder: '212-vertex cylinders' },

    // ── Interior ─────────────────────────────────────────────────────────
    { id: 'interior.seats', group: 'interior', label: 'Seats (shells and frames)', movable: true,
      select: [`${B}/InteriorSeatsColor1`, `${B}/InteriorSeatsColor2`, `${B}/InteriorSeatsFrame1`, `${B}/InteriorSeatsFrame2`] },
    { id: 'interior.steering', group: 'interior', label: 'Steering wheel, column and stalks', movable: true,
      select: [`${B}/InteriorSteeringCylinder`, `${B}/InteriorSteeringBase`, `${B}/InteriorSteeringDash`, `${B}/InteriorSteeringDashColumn`, `${B}/InteriorSteeringHandleL`, `${B}/InteriorSteeringHandleR`] },
    { id: 'interior.dash', group: 'interior', label: 'Dashboard', select: [`${B}/InteriorDashMid`, `${B}/InteriorDashSides`], movable: true },
    { id: 'interior.pedals', group: 'interior', label: 'Pedal box', movable: true,
      select: [`${B}/InteriorPedalAccel`, `${B}/InteriorPedalAccelArm`, `${B}/InteriorPedalBrake`, `${B}/InteriorPedalBrakeArm`] },
    { id: 'interior.tub', group: 'interior', label: 'Cabin floor, centre tunnel, cage and pillar trims', movable: false,
      select: [`${B}/InteriorFloor`, `${B}/InteriorFloormats`, `${B}/InteriorMid`, `${B}/InteriorCage`, `${B}/InteriorPillar`] },

    // ── Third-party marks (kept registered so they can be hidden reliably) ─
    { id: 'marks.licencePlate', group: 'marks', label: 'Licence plate (Khronos logo)', select: [`${B}/License Plate`],
      hidden: 'Khronos trademark' },
    { id: 'marks.steeringEmblem', group: 'marks', label: 'Steering emblem (logo)', select: [`${B}/InteriorSteeringCylinder/InteriorSteeringEmblem`],
      hidden: 'third-party logo' },
  ],

  slots: {
    // Paint is spread over many meshes, so the slot is defined by the asset's paint materials
    paint: { materials: ['Paint 1 Carmine', 'Paint 2 Carmine'] },
    glass: { materials: ['Glass'] },
    rims: { materials: ['Rim1', 'Rim2'] },
    calipers: { materials: ['Brake'] },
  },

  /** KHR_materials_variants presets authored into the asset. */
  variants: ['Carmine Candy', 'Pearly Swirly', 'Torched Graphite'],

  anchors: {},

  missing: [
    'A real engine / power unit (only an 89-vertex placeholder volume)',
    'Gearbox, exhaust system and tailpipes — so no exhaust can be emitted from this car',
    'Suspension arms, springs/dampers, steering rack',
    'Separate bumpers (they belong to the front/rear clamshells)',
  ],
};
