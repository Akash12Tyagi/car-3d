/**
 * Design chapter: the features a visitor can explore on the main car.
 *
 * Every feature is a real component of ferrari.glb, addressed by registry ID
 * (src/vehicle/registry/ferrari-458.js). Where a registry component covers more
 * than the feature (one mesh holds every grille of the car, or the tailpipe tips
 * together with all other chrome), `region` limits it to a box in car space.
 *
 * Car space: Y up, nose towards −Z, the car's left towards −X, metres.
 * Views are orbit angles in car space (az 180 = in front of the nose, 270 = the
 * left flank, 360 = behind); the distance is solved from the feature's measured
 * bounds for the screen, like every other view on the site.
 *
 *   marker   the component (and region) the marker sits on, `pick` choosing the
 *            point: 'center' of its bounds, or 'outer' (centre of the face that
 *            looks along `normal`)
 *   normal   which way the feature faces; the marker fades out when it turns
 *            away from the camera (occlusion without per-frame raycasts)
 *   highlight components (and region) that light up when the feature is open
 *   note     what the model does and doesn't contain, said plainly
 */
export const FEATURES = [
  {
    id: 'headlamps',
    title: 'Headlamps',
    text: 'A blade of LEDs runs along the top of each lamp, above the projector. The car is recognisable by that one line, even before it is in the light.',
    note: 'Shown: the LED strips and projector lenses of the model.',
    marker: { component: 'lights.head.leds', region: { min: [-1.2, 0.5, -2.1], max: [0, 0.9, -1.3] }, pick: 'center' },
    normal: [-0.55, 0.15, -0.82],
    highlight: [
      { component: 'lights.head.leds', region: { min: [-1.2, 0.4, -2.1], max: [1.2, 0.9, -1.3] } },
      { component: 'lights.head.lenses' },
    ],
    view: { az: 214, el: 9, fov: 26, frame: 'marker', pad: 0.32 },
    drl: true,
  },
  {
    id: 'intakes',
    title: 'Front intakes',
    text: 'Two intakes feed the radiators in the nose. On the 458, small winglets inside them bend back at speed, narrowing the openings to cut drag when less cooling is needed.',
    note: 'Shown: the intake grilles. The winglets are not separate parts in this model.',
    marker: { component: 'body.trim.grilles', region: { min: [-1.2, 0.2, -2.3], max: [0, 0.8, -1.7] }, pick: 'center' },
    normal: [-0.2, 0, -1],
    highlight: [{ component: 'body.trim.grilles', region: { min: [-1.2, 0.2, -2.3], max: [1.2, 0.8, -1.7] } }],
    view: { az: 200, el: 7, fov: 26, frame: 'highlight', pad: 0.18 },
  },
  {
    id: 'wheels',
    title: 'Wheels',
    text: 'Twenty-inch forged wheels: five spokes, kept as open as the structure allows, so the brakes stay in view and in the air.',
    note: 'Shown: spokes and rim barrel of the rear-left wheel.',
    marker: { component: 'wheel.rl.spokes', pick: 'outer' },
    normal: [-1, 0, 0],
    highlight: [{ component: 'wheel.rl.spokes' }, { component: 'wheel.rl.barrel' }],
    view: { az: 258, el: 5, fov: 24, frame: 'highlight', pad: 0.22 },
  },
  {
    id: 'brakes',
    title: 'Brakes',
    text: 'Carbon-ceramic discs, standard on the 458: lighter than iron, and consistent stop after stop. The open spokes put them on show.',
    note: 'Shown: the brake disc. There is no caliper in this model.',
    marker: { component: 'wheel.fl.disc', region: { min: [-1.2, 0.36, -1.6], max: [0, 0.8, -1.16] }, pick: 'center' },
    normal: [-1, 0, 0],
    highlight: [{ component: 'wheel.fl.disc' }],
    view: { az: 266, el: 3, fov: 22, frame: 'highlight', pad: 0.2 },
  },
  {
    id: 'exhaust',
    title: 'Exhaust',
    text: 'Three tailpipes, grouped at the centre of the rear where the diffuser ends. The sound leaves exactly where the eye lands.',
    note: 'Shown: the three chrome tailpipe tips. The exhaust system behind them is not in this model.',
    marker: { anchor: 'exhaustTips' },
    normal: [0, 0, 1],
    highlight: [{ component: 'body.trim.chrome', region: { min: [-0.3, 0.25, 2.1], max: [0.3, 0.6, 2.4] } }],
    view: { az: 336, el: 10, fov: 24, frame: 'highlight', pad: 0.38 },
  },
];
