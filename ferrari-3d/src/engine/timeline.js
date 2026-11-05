/**
 * The Engine chapter as ONE timeline, indexed by a playhead q (0..1) that
 * follows the section's scroll progress (same model as the Anatomy chapter:
 * see cinematic/timeline.js and cinematic/controller.js).
 *
 *   0.00 ─ 0.12  lights come up on the assembled engine            REVEAL    @0.08
 *   0.13 ─ 0.20  the castings turn to glass (x-ray)
 *   0.18 ─ 0.23  starter, then it catches and idles
 *   0.26 ─ 0.33  rev to 9,000; headers glow                        IGNITION  @0.35
 *   0.38 ─ 0.44  cut, spin down, castings solid again
 *   0.44 ─ 0.58  teardown: every part leaves on its own path
 *   0.53 ─ 0.62  the rotating assembly comes out
 *   0.58 ─ 0.68  hold: inspect any part                            TEARDOWN  @0.63
 *   0.68 ─ 0.74  crank, rods and pistons back into a glass block
 *   0.74 ─ 0.84  turned by hand: the flat-plane crank              ROTATING  @0.79
 *   0.84 ─ 0.93  everything goes back, in reverse order
 *   0.93 ─ 1.00  assembled, idling                                 ASSEMBLED @0.96
 *
 * Everything except the crank angle is a pure function of q. The crank angle
 * is integrated from a speed that is itself a function of q, so the engine
 * keeps turning while a state is held.
 */

export const STATES = [
  { id: 'reveal', label: 'Reveal', at: 0.08, from: 0, to: 0.125 },
  { id: 'running', label: 'Ignition', at: 0.35, from: 0.125, to: 0.43 },
  { id: 'teardown', label: 'Teardown', at: 0.63, from: 0.43, to: 0.68 },
  { id: 'rotating', label: 'Rotating assembly', at: 0.79, from: 0.68, to: 0.845 },
  { id: 'assembled', label: 'Assembled', at: 0.96, from: 0.845, to: 1.0001 },
];

export const stateAt = (q) => STATES.find((s) => q >= s.from && q < s.to) ?? STATES[STATES.length - 1];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (a, b, v) => clamp01((v - a) / (b - a));
export const smooth = (a, b, v) => {
  const t = ramp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Everything but the external parts' body: block, heads, covers, plenum turn to glass. */
export const xrayAt = (q) => smooth(0.13, 0.2, q) * (1 - smooth(0.385, 0.44, q)) + smooth(0.68, 0.74, q) * (1 - smooth(0.84, 0.875, q));

/** Teardown channel: every part except the rotating assembly. */
export function explodeAt(q) {
  if (q < 0.44) return 0;
  if (q < 0.58) return ramp(0.44, 0.58, q);
  if (q < 0.84) return 1;
  if (q < 0.93) return 1 - ramp(0.84, 0.93, q);
  return 0;
}

/** While the rotating assembly is shown, the other parts retreat into the dark (a multiplier on their teardown paths). */
export const vanishAt = (q) => smooth(0.68, 0.745, q) * (1 - smooth(0.82, 0.865, q));
export const spreadAt = (q) => 1 + 2.2 * vanishAt(q);

/** Rotating-assembly channel: pistons and rods up out of the bores, crank down out of the block. */
export const bottomAt = (q) => ramp(0.53, 0.62, q) * (1 - ramp(0.68, 0.74, q));

/** Engine speed (rpm) the timeline asks for. */
export function rpmAt(q) {
  if (q < 0.18) return 0;
  if (q < 0.2) return 250 * smooth(0.18, 0.2, q); // starter
  if (q < 0.23) return 250 + 750 * smooth(0.2, 0.23, q); // catches
  if (q < 0.26) return 1000;
  if (q < 0.33) return 1000 + 8000 * smooth(0.26, 0.33, q);
  if (q < 0.38) return 9000;
  if (q < 0.43) return 9000 * (1 - smooth(0.38, 0.43, q));
  if (q < 0.93) return 0;
  return 1000 * smooth(0.93, 0.96, q);
}

/** Combustion is on once the engine has caught. */
export const firingAt = (q) => smooth(0.2, 0.22, q) * (1 - smooth(0.38, 0.4, q)) + smooth(0.935, 0.95, q);

/** Exhaust heat: builds with load, then the headers cool. */
export const heatAt = (q) => smooth(0.27, 0.35, q) * (1 - smooth(0.4, 0.52, q)) + 0.12 * smooth(0.95, 1, q);

/**
 * Crank speed on screen (rev/s). Real speed is far too fast to read (150 rev/s
 * at 9,000 rpm), so the mechanism plays in slow motion, like a high-speed
 * camera; the HUD prints the ratio. Rotating state: turned slowly by hand.
 */
export function visualSpeedAt(q) {
  const rpm = rpmAt(q);
  const running = rpm > 0 ? 0.06 + 1.25 * Math.pow(rpm / 9000, 0.8) : 0;
  const byHand = 0.11 * smooth(0.72, 0.75, q) * (1 - smooth(0.83, 0.845, q));
  return running + byHand;
}

/** Light levels as functions of q. */
export function lightsAt(q) {
  return {
    reveal: smooth(0, 0.09, q),
    fadeOut: 1 - smooth(0.985, 1, q),
    xray: xrayAt(q),
    study: smooth(0.5, 0.58, q) * (1 - smooth(0.66, 0.7, q)) + 0.6 * smooth(0.84, 0.9, q) * (1 - smooth(0.93, 0.97, q)),
    focus: smooth(0.7, 0.75, q) * (1 - smooth(0.83, 0.86, q)),
    hero: smooth(0.92, 0.97, q),
    sweep: smooth(0, 0.11, q),
  };
}

/** Which annotation set is on, if any (only while a state is held). */
export function calloutsAt(q) {
  if (q > 0.27 && q < 0.385) return 'running';
  if (q > 0.585 && q < 0.68) return 'teardown';
  if (q > 0.75 && q < 0.835) return 'rotating';
  return null;
}

/**
 * Annotations per held state. `part` names a part of v8.js; the marker sits on
 * the part's anchor, or on `at` (engine space, travelling with the part). Running
 * markers use fixed points, so they don't bob with the pistons. `key`: kept on
 * small screens.
 */
export const ENGINE_CALLOUTS = {
  running: [
    { part: 'crank', title: 'Flat-plane crank', text: 'Four throws in one plane', key: true },
    { part: 'pistons', at: [0.113, 0.113, 0.042], title: 'Pistons and rods', text: 'Real slider-crank motion, 81 mm stroke', key: true },
    { part: 'valves', at: [0.2, 0.215, -0.06], title: 'Valvetrain', text: '32 valves, cams at half crank speed', key: true },
    { part: 'exhaust', title: 'Headers', text: 'Glowing at the limiter' },
  ],
  teardown: [
    { part: 'plenum', title: 'Intake plenum', text: 'Carbon fibre, twin throttles', key: true },
    { part: 'coils', title: 'Coil-on-plug', text: 'Eight ignition coils' },
    { part: 'cams', title: 'Camshafts ×4', text: 'Lobes phased to the firing order', key: true },
    { part: 'heads', title: 'Cylinder heads', text: 'Pent-roof, four valves a cylinder' },
    { part: 'pistons', title: 'Pistons ×8', text: '94 mm bore', key: true },
    { part: 'crank', title: 'Crankshaft', text: 'Flat plane: 0° / 180°', key: true },
    { part: 'gearbox', title: 'Transaxle', text: 'Seven-speed, dual clutch', key: true },
    { part: 'exhaust', title: 'Headers', text: '4-into-1 per bank' },
  ],
  rotating: [
    { part: 'crank', title: 'Throws at 0° and 180°', text: 'All four in one plane', key: true },
    { part: 'rods', title: 'Two rods per pin', text: 'So the banks sit 23 mm apart', key: true },
    { part: 'pistons', title: 'Banks alternate', text: 'Firing order 1-5-3-7-4-8-2-6', key: true },
  ],
};

/** Is the visitor free to inspect parts by pointing at them? */
export const inspectableAt = (q) => (q > 0.585 && q < 0.68) || (q > 0.75 && q < 0.835) || q > 0.965 || (q > 0.06 && q < 0.125);

/*
 * Camera keys: orbit around a target (az 0 = in front of the engine, i.e. the
 * cam-drive end; az 90 = the left bank; el above the floor). Each key names the
 * point set it must frame — the assembled engine, the teardown, or the
 * rotating assembly in its glass block — and the distance is solved per
 * aspect ratio. Joined by a monotone spline: no overshoot.
 */
export const CAMERA_KEYS = [
  { t: 0.0, az: 26, el: 6, fov: 26, frame: 'rest', fill: 0.62 },
  { t: 0.08, az: 38, el: 13, fov: 26, frame: 'rest', fill: 0.92 },
  { t: 0.13, az: 50, el: 16, fov: 26, frame: 'rest', fill: 0.92 },
  { t: 0.22, az: 66, el: 17, fov: 26, frame: 'rest', fill: 0.84 },
  { t: 0.3, az: 80, el: 14, fov: 26, frame: 'rest', fill: 0.84 },
  { t: 0.35, az: 86, el: 13, fov: 26, frame: 'rest', fill: 0.84 },
  { t: 0.41, az: 98, el: 16, fov: 26, frame: 'rest', fill: 0.84 },
  { t: 0.5, az: 72, el: 22, fov: 28, frame: 'teardown', fill: 0.92 },
  { t: 0.58, az: 52, el: 23, fov: 28, frame: 'teardown', fill: 0.9 },
  { t: 0.63, az: 44, el: 22, fov: 28, frame: 'teardown', fill: 0.9 },
  { t: 0.68, az: 38, el: 20, fov: 28, frame: 'teardown', fill: 0.9 },
  { t: 0.745, az: 20, el: 12, fov: 24, frame: 'rotating', fill: 0.66 },
  { t: 0.79, az: 14, el: 10, fov: 24, frame: 'rotating', fill: 0.66 },
  { t: 0.84, az: 26, el: 17, fov: 26, frame: 'teardown', fill: 0.9 },
  { t: 0.92, az: 42, el: 13, fov: 26, frame: 'rest', fill: 0.92 },
  { t: 0.96, az: 50, el: 11, fov: 26, frame: 'rest', fill: 0.9 },
  { t: 1.0, az: 62, el: 9, fov: 26, frame: 'rest', fill: 0.86 },
];
