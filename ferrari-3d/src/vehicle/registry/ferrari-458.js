/**
 * Component registry — ferrari.glb (the site's main car).
 *
 * Source: three.js example asset, credited by three.js as
 *   "Ferrari 458 Italia model by vicent091036" (Sketchfab 57bf6cc56931426e87494f554df1dab6).
 * Exported with FBX2glTF; 58 nodes, 51 meshes, 17 materials, no textures, Draco-compressed.
 *
 * IMPORTANT — what this asset is: it is split BY MATERIAL, not by component.
 * The whole exterior shell (hood, doors, bumpers, engine cover, wings) is ONE
 * mesh ("body"); cabin floor, tub, underbody and arch liners are ONE mesh.
 * There is no engine, gearbox, exhaust system, suspension or chassis frame.
 * Only components that genuinely exist are registered here; see `missing`.
 *
 * Coordinates: three.js space after import, Y up, metres, nose towards −Z.
 * Selectors use the ORIGINAL glTF node names (see ../selectors.js).
 */

const wheels = (part) => ['fl', 'fr', 'rl', 'rr'].map((c) => `wheel.${c}.${part}`);

const corner = (id, node, rimMesh, label) => [
  { id: `wheel.${id}`, group: 'wheel', label: `${label} wheel assembly`, select: [`RootNode/${node}`], required: true, movable: true,
    notes: 'Node origin is the hub centre; children rotate with the wheel about local X.' },
  { id: `wheel.${id}.tire`, group: 'wheel', label: `${label} tyre`, select: [`RootNode/${node}/tire`] },
  { id: `wheel.${id}.spokes`, group: 'wheel', label: `${label} spoke face`, select: [`RootNode/${node}/${rimMesh}`],
    notes: 'Named rim_* in the file; it is the five-spoke face only.' },
  { id: `wheel.${id}.barrel`, group: 'wheel', label: `${label} rim barrel and hub`, select: [`RootNode/${node}/wheel`] },
  { id: `wheel.${id}.disc`, group: 'wheel', label: `${label} brake disc`, select: [`RootNode/${node}/brake`],
    notes: 'Disc only; there is no separate caliper mesh.' },
  { id: `wheel.${id}.cap`, group: 'wheel', label: `${label} centre cap`, select: [`RootNode/${node}/centre`] },
  { id: `wheel.${id}.nuts`, group: 'wheel', label: `${label} wheel nuts`, select: [`RootNode/${node}/nuts`] },
];

export const ferrari458 = {
  id: 'ferrari-458',
  url: 'models/ferrari.glb',
  /** The node the site treats as "the car" (parent of everything). */
  root: 'RootNode',
  licence: {
    author: 'vicent091036 (Sketchfab), distributed with the three.js examples',
    terms: 'UNVERIFIED — check the Sketchfab listing before any public or commercial use',
    trademarks: 'Ferrari name, prancing-horse and shield badges are Ferrari S.p.A. trademarks (visible on this model)',
  },

  components: [
    // ── Body ──────────────────────────────────────────────────────────────
    { id: 'body.shell', group: 'body', label: 'Exterior shell (single mesh)', select: ['RootNode/main/body'], required: true,
      notes: 'Hood, doors, bumpers, wings and engine cover are fused; cannot be animated separately.' },
    { id: 'body.trim.chrome', group: 'body', label: 'Chrome details incl. tailpipe tips', select: ['RootNode/main/chrome'] },
    { id: 'body.trim.metal', group: 'body', label: 'Metal details (vents, sills)', select: ['RootNode/main/metal'] },
    { id: 'body.trim.plastic', group: 'body', label: 'Grey plastics (mirror bases, lamp housings)', select: ['RootNode/main/plastic_gray'] },
    { id: 'body.trim.grilles', group: 'body', label: 'Intake grilles', select: ['RootNode/main/grills'] },
    { id: 'body.badges', group: 'body', label: 'Yellow shield badges (trademark)', select: ['RootNode/main/yellow_trim'] },
    { id: 'body.wipers', group: 'body', label: 'Wipers', select: ['RootNode/main/wipers'] },

    // ── Glass and lights ─────────────────────────────────────────────────
    { id: 'glass.main', group: 'glass', label: 'Windscreen and headlamp covers (single mesh)', select: ['RootNode/main/glass'], required: true },
    { id: 'lights.head.lenses', group: 'lights', label: 'Headlamp projector lenses', select: ['RootNode/main/lights'] },
    { id: 'lights.head.leds', group: 'lights', label: 'Headlamp LED strips', select: ['RootNode/main/leds'] },
    { id: 'lights.tail.lenses', group: 'lights', label: 'Tail-lamp glass', select: ['RootNode/main/lights_red'] },
    { id: 'lights.tail.units', group: 'lights', label: 'Tail-lamp inserts', select: ['RootNode/main/brakes'],
      notes: 'Named "brakes" in the file; it is the round tail-lamp inserts, not brake hardware.' },

    // ── Wheels (4 assemblies; tyre, spokes, barrel, disc, cap, nuts each) ─
    ...corner('fl', 'wheel_fl', 'rim_fl', 'Front-left'),
    ...corner('fr', 'wheel_fr', 'rim_fr', 'Front-right'),
    ...corner('rl', 'wheel_rl', 'rim_rl', 'Rear-left'),
    ...corner('rr', 'wheel_rr', 'rim_rr', 'Rear-right'),

    // ── Interior ─────────────────────────────────────────────────────────
    { id: 'interior.steering', group: 'interior', label: 'Steering wheel assembly', select: ['RootNode/steering_wheel'], movable: true },
    { id: 'interior.leather', group: 'interior', label: 'Leather (seats, dash covering)', select: ['RootNode/main/leather'],
      notes: 'Seats are part of this mesh; they are not separate objects.' },
    { id: 'interior.stitching', group: 'interior', label: 'Red stitching', select: ['RootNode/main/trim'] },
    { id: 'interior.panels', group: 'interior', label: 'Door cards, cockpit frame, front undertray lip', select: ['RootNode/main/interior_light'],
      notes: 'Mixed interior/underbody surfaces in one mesh. Its material is named Interior_dark (names are swapped in the file).' },
    { id: 'interior.carpet', group: 'interior', label: 'Carpet', select: ['RootNode/main/carpet'] },
    { id: 'interior.carbon', group: 'interior', label: 'Carbon trim (console, door inserts)', select: ['RootNode/main/carbon_fibre_trim'] },
    { id: 'interior.carbon.detail', group: 'interior', label: 'Carbon detail near the wheel', select: ['RootNode/main/carbon fibre'] },
    { id: 'interior.indicator', group: 'interior', label: 'Blue dash indicator', select: ['RootNode/main/blue'] },

    // ── Structure ────────────────────────────────────────────────────────
    { id: 'structure.tub', group: 'chassis', label: 'Cabin tub, floor, underbody and arch liners (single mesh)', select: ['RootNode/main/interior_dark'],
      notes: 'The closest thing to a chassis in this asset. Not separable. Material named Interior_light (swapped).' },
  ],

  /**
   * Material slots: what look-dev and the configurator may restyle. Each slot is
   * a list of clauses; a clause takes a component's meshes, optionally only those
   * whose ORIGINAL material is `material` (the steering wheel mixes several).
   * Slots resolve to fixed meshes at load, so restyling one slot never touches
   * another, even where the source file shares one material between them.
   */
  slots: {
    paint: [{ components: ['body.shell'] }],
    rims: [{ components: wheels('spokes') }, { components: wheels('barrel') }],
    rubber: [{ components: wheels('tire') }],
    brakeDiscs: [{ components: wheels('disc') }],
    wheelNuts: [{ components: wheels('nuts') }],
    badges: [{ components: ['body.badges', ...wheels('cap')] }, { components: ['interior.steering'], material: 'Ferrari_Yellow' }],
    chrome: [{ components: ['body.trim.chrome'] }],
    metalTrim: [{ components: ['body.trim.metal'] }, { components: ['interior.steering'], material: 'metal_gray' }],
    plastic: [{ components: ['body.trim.plastic'] }],
    blackTrim: [{ components: ['body.trim.grilles', 'body.wipers'] }],
    glass: [{ components: ['glass.main'] }],
    headLenses: [{ components: ['lights.head.lenses'] }],
    drl: [{ components: ['lights.head.leds'] }],
    tailLenses: [{ components: ['lights.tail.lenses'] }],
    tailUnits: [{ components: ['lights.tail.units'] }, { components: ['interior.steering'], material: 'Taillight_Glass' }],
    leather: [{ components: ['interior.leather'] }, { components: ['interior.steering'], material: 'Leather' }],
    stitching: [{ components: ['interior.stitching'] }, { components: ['interior.steering'], material: 'Leather_red' }],
    interiorPanels: [{ components: ['interior.panels'] }, { components: ['interior.steering'], material: 'Interior_dark' }],
    tub: [{ components: ['structure.tub'] }],
    carpet: [{ components: ['interior.carpet'] }],
    carbon: [{ components: ['interior.carbon', 'interior.carbon.detail'] }, { components: ['interior.steering'], material: 'Carbon_Fiber' }],
  },

  /** Points on existing geometry, measured from the model (car space, metres). */
  anchors: {
    // Centres of the three chrome tailpipe tips (in body.trim.chrome), outflow towards +Z
    exhaustTips: [[-0.105, 0.4, 2.27], [0, 0.4, 2.27], [0.105, 0.4, 2.27]],
    exhaustDirection: [0, 0, 1],
  },

  /** Required by later phases but NOT present in this file. */
  missing: [
    'Separate body panels: hood (frunk lid), engine cover, doors, front and rear bumpers, wings',
    'Powertrain: engine, gearbox, intake, exhaust system (only the chrome tips exist, fused into body.trim.chrome)',
    'Chassis frame, suspension arms, springs/dampers, axles/half-shafts',
    'Brake calipers (only discs exist)',
    'Separate seats (fused into interior.leather), dashboard as its own object',
    'Hinge pivots of any kind',
  ],
};
