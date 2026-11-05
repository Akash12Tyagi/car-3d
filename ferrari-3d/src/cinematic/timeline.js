/**
 * The Anatomy sequence as ONE timeline, indexed by a playhead q (0..1) that
 * matches the section's scroll progress.
 *
 * Everything on stage is a pure function of q: component poses, lights and
 * camera. Scroll and the state buttons only ever move q (see controller.js), so
 * they can't fight over transforms, any q can be reached from any other, and
 * scrolling backwards replays the same paths in reverse.
 *
 *   0.00 ─ 0.10  lights come up on the whole car                   WHOLE   @0.10
 *   0.14 ─ 0.40  explode: body opens, wheels off, cockpit lifts
 *   0.40 ─ 0.50  hold, annotated                                   EXPLODED @0.45
 *   0.50 ─ 0.62  the powertrain comes out; the camera moves in
 *   0.62 ─ 0.70  hold, annotated                                   POWER    @0.66
 *   0.70 ─ 0.77  powertrain back into its bay
 *   0.77 ─ 0.92  reassembly, reverse order                         REASSEMBLY @0.86
 *   0.92 ─ 1.00  the whole car in the final composition            WHOLE    @0.95
 */

export const STATES = [
  { id: 'whole', label: 'Whole', at: 0.1, from: 0, to: 0.14 },
  { id: 'exploded', label: 'Exploded', at: 0.45, from: 0.14, to: 0.5 },
  { id: 'power', label: 'Power unit', at: 0.66, from: 0.5, to: 0.72 },
  { id: 'reassembly', label: 'Reassembly', at: 0.86, from: 0.72, to: 0.9 },
  { id: 'hero', label: 'Whole', at: 0.95, from: 0.9, to: 1.0001 },
];

export const stateAt = (q) => STATES.find((s) => q >= s.from && q < s.to) ?? STATES[STATES.length - 1];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (a, b, v) => clamp01((v - a) / (b - a));
export const smooth = (a, b, v) => {
  const t = ramp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Explode channel: body, wheels, cockpit (each part has its own window inside 0..1). */
export function explodeAt(q) {
  if (q < 0.14) return 0;
  if (q < 0.4) return ramp(0.14, 0.4, q);
  if (q < 0.77) return 1;
  if (q < 0.92) return 1 - ramp(0.77, 0.92, q);
  return 0;
}

/** Power channel: the powertrain leaves its bay only once the body is open. */
export function powerAt(q) {
  if (q < 0.5) return 0;
  if (q < 0.62) return ramp(0.5, 0.62, q);
  if (q < 0.7) return 1;
  if (q < 0.77) return 1 - ramp(0.7, 0.77, q);
  return 0;
}

/** The tub and cabin turn to glass while the car is apart (the V8 is seen in its bay, then lifts out through it). */
export const ghostAt = (q) => smooth(0.3, 0.4, q) * (1 - smooth(0.74, 0.8, q));

/** Light levels as functions of q. */
export function lightsAt(q) {
  return {
    reveal: smooth(0, 0.09, q), // the room comes up
    fadeOut: 1 - smooth(0.975, 1, q), // dark again before the hand-over curtain
    study: smooth(0.3, 0.42, q) * (1 - smooth(0.5, 0.58, q)), // open, even light on the exploded drawing
    focus: smooth(0.54, 0.62, q) * (1 - smooth(0.7, 0.76, q)), // spot on the powertrain
    hero: smooth(0.9, 0.95, q),
    sweep: smooth(0, 0.12, q), // a low light travelling along the flank during the reveal
  };
}

/** Which callout set is on, if any (only while a state is held). */
export function calloutsAt(q) {
  if (q > 0.405 && q < 0.5) return 'exploded';
  if (q > 0.625 && q < 0.705) return 'power';
  return null;
}

/*
 * Camera keys. Orbit around a target (az 0 = in front of the nose, az 90 = the
 * car's left flank; el above the ground). Neither distances nor targets are
 * authored: each key names the point set it must frame — the assembled car,
 * the fully exploded set, or the lifted V8 — aims at its centre, and the
 * distance is solved per aspect ratio (scene/views.js fitDistance). Keys are
 * joined by a monotone spline, so the camera never overshoots a key.
 */
export const CAMERA_KEYS = [
  { t: 0.0, az: 22, el: 4, fov: 28, target: 'rest', frame: 'rest', fill: 0.8 },
  { t: 0.1, az: 46, el: 7, fov: 28, target: 'rest', frame: 'rest', fill: 0.96 },
  { t: 0.14, az: 50, el: 8, fov: 28, target: 'rest', frame: 'rest', fill: 0.96 },
  { t: 0.27, az: 54, el: 15, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.9 },
  { t: 0.4, az: 40, el: 20, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.9 },
  { t: 0.45, az: 35, el: 21, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.9 },
  { t: 0.5, az: 30, el: 21, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.9 },
  // Power unit: a low rear three-quarter, the V8 and transaxle lifted out of the bay
  { t: 0.62, az: 128, el: 16, fov: 24, target: 'power', frame: 'power', fill: 0.62 },
  { t: 0.66, az: 120, el: 15, fov: 24, target: 'power', frame: 'power', fill: 0.62 },
  { t: 0.7, az: 112, el: 15, fov: 24, target: 'power', frame: 'power', fill: 0.62 },
  { t: 0.77, az: 40, el: 19, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.94 },
  { t: 0.86, az: 24, el: 14, fov: 28, target: 'exploded', frame: 'exploded', fill: 0.92 },
  { t: 0.92, az: 38, el: 7, fov: 26, target: 'rest', frame: 'rest', fill: 0.96 },
  { t: 0.95, az: 52, el: 5, fov: 26, target: 'rest', frame: 'rest', fill: 0.96 },
  { t: 1.0, az: 74, el: 5, fov: 26, target: 'rest', frame: 'rest', fill: 0.92 },
];
