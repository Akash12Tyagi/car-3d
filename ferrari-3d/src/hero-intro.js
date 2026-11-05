import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { fitDistance } from './scene/views.js';
import { sampleMonotone } from './scene/spline.js';

/* ==================================================================== */
/* Hero intro — the opening film, in five beats (≈ 9 s, settled by 10)    */
/*                                                                        */
/*  0.0  DARK    Black. Nothing on.                                       */
/*  0.75 LIGHT   The LED signature wakes, flickering like a real start-up */
/*               sequence: the only light in the room. Slow push-in.      */
/*  1.6  LINE    A raking light travels nose to tail down the flank and   */
/*               draws the shoulder line; the camera tracks over the arch */
/*               and along the side as the studio starts to glow.         */
/*  4.0  FIRE    A low rear three-quarter. Tail-lamps up. Ignition: a     */
/*               bang from the tailpipes (flame, flash, kick, haze), a    */
/*               blip, the overrun crackle, the idle smoke drifting.      */
/*  5.9  REVEAL  A rising arc over the car into the top-down poster as    */
/*               the room lights up (carbon → paper at 7.3); ROSSO at     */
/*               7.5, the signature at 8.1, then navigation and copy.     */
/*                                                                        */
/* One GSAP timeline owns everything, so the state at any moment is a     */
/* function of its time: skipping, seeking or reduced motion all land on  */
/* the same final frame, and that frame IS the hero keyframe the scroll   */
/* system uses next, so the hand-over can't jump. One-shot effects (bangs)*/
/* are guarded so a skip never fires them in a burst.                     */
/* ==================================================================== */

const DEG = Math.PI / 180;

/*
 * Camera keys in CAR space: az 180 = facing the nose, 270 = the car's left
 * flank, 360 = behind it; targets in car metres (nose towards −Z, left side
 * −X). The final key is the live hero keyframe, converted at run time.
 * Measured on the model: left projector lens (−0.68, 0.61, −1.85), LED strip
 * z −1.77 → −0.76, tailpipe tips (±0.105 / 0, 0.40, 2.27).
 */
const SHOTS = {
  landscape: [
    { t: 0.0, az: 204, el: 10, dist: 1.6, fov: 30, x: -0.78, y: 0.62, z: -1.55 },
    { t: 1.5, az: 207, el: 9, dist: 1.2, fov: 30, x: -0.78, y: 0.62, z: -1.5 },
    { t: 3.0, az: 236, el: 6, dist: 1.9, fov: 30, x: -0.86, y: 0.56, z: -0.9 },
    { t: 4.5, az: 302, el: 4, dist: 3.3, fov: 30, x: -0.4, y: 0.5, z: 1.6 },
    { t: 5.6, az: 324, el: 5, dist: 3.6, fov: 30, x: -0.05, y: 0.45, z: 2.35 },
    { t: 7.2, az: 300, el: 46, dist: 6.6, fov: 30, x: 0, y: 0.4, z: 0.4 },
  ],
  portrait: [
    { t: 0.0, az: 204, el: 10, dist: 2.3, fov: 36, x: -0.76, y: 0.62, z: -1.58 },
    { t: 1.5, az: 207, el: 9, dist: 1.9, fov: 36, x: -0.76, y: 0.62, z: -1.52 },
    { t: 3.0, az: 232, el: 7, dist: 2.6, fov: 36, x: -0.84, y: 0.55, z: -0.9 },
    { t: 4.5, az: 318, el: 6, dist: 5.4, fov: 36, x: -0.15, y: 0.5, z: 1.9 },
    { t: 5.6, az: 338, el: 7, dist: 5.8, fov: 36, x: 0.08, y: 0.45, z: 2.6 },
    { t: 7.2, az: 340, el: 46, dist: null, fov: 32, x: 0, y: 0.45, z: 0.2 }, // dist fitted to the screen
  ],
};
const T_FINAL = 9.0;
const T_SHORT = 4.3; // repeat visits start just before the ignition
// Everything the intro reveals; hidden behind the loader so nothing flashes during its wipe
const REVEALED = ['.giant__word', '.signature', '.nav > *', '.rail', '.hero__meta span', '.hero__title > span', '.hero__note', '.hero__scroll'];
const CHANNELS = ['az', 'el', 'dist', 'fov', 'x', 'y', 'z'];
const LAMPS_REST = { drl: 0.55, lens: 0, tail: 0.12 };

/** Camera position along the shot at time t (monotone spline, dolly in log space). */
const sample = (keys, t) => sampleMonotone(keys, t, CHANNELS, { log: ['dist'] });

/** Car-space shot → Experience rig (world space, car yawed by `rot`). */
function toRig(s, rot, extra) {
  const r = rot * DEG;
  return {
    az: s.az + rot,
    el: s.el,
    dist: s.dist,
    fov: s.fov,
    tx: s.x * Math.cos(r) + s.z * Math.sin(r),
    ty: s.y,
    tz: -s.x * Math.sin(r) + s.z * Math.cos(r),
    rot,
    shift: 0,
    roll: 0,
    parallax: 0,
    ...extra,
  };
}

/** Hero rig → car-space key, with azimuth unwrapped to sit next to `nearAz`. */
function fromRig(rig, nearAz) {
  const r = rig.rot * DEG;
  let az = rig.az - rig.rot;
  while (az - nearAz > 180) az -= 360;
  while (nearAz - az > 180) az += 360;
  return {
    t: T_FINAL,
    az,
    el: rig.el,
    dist: rig.dist,
    fov: rig.fov,
    x: rig.tx * Math.cos(r) - rig.tz * Math.sin(r),
    y: rig.ty,
    z: rig.tx * Math.sin(r) + rig.tz * Math.cos(r),
  };
}

/**
 * @param {object} o
 * @param {object} o.exp             the Experience (or NullExperience)
 * @param {() => object} o.heroRig   live hero keyframe (world rig)
 * @param {() => boolean} o.isPortrait
 * @param {(theme: string|null) => void} o.setTheme  null = follow the chapters
 * @param {'full'|'short'|'reduced'|'instant'} o.mode
 */
export function createHeroIntro({ exp, heroRig, isPortrait, setTheme, mode }) {
  const portrait = isPortrait();
  const shots = SHOTS[portrait ? 'portrait' : 'landscape'].map((k) => ({ ...k }));
  const camera = { t: 0 };
  const studio = { intensity: 0, rotation: 1.5 };
  const lamps = { drl: 0, lens: 0, tail: 0.05 };
  const rake = { intensity: 0, z: -3.2 };
  let done = false;
  let skipping = false;
  let tl;
  let skipFn = null;
  const listeners = [];

  const keys = () => {
    const hero = heroRig();
    if (portrait) {
      const k = shots[shots.length - 1];
      k.dist = fitDistance({ az: k.az + hero.rot, el: k.el, fov: k.fov, ty: k.y }, { aspect: innerWidth / innerHeight, width: 0.9, height: 0.5, bounds: exp.bbox }) * 1.15;
    }
    return [...shots, fromRig(hero, shots[shots.length - 1].az)];
  };
  const applyCamera = () => {
    const hero = heroRig();
    exp.setRig(toRig(sample(keys(), camera.t), hero.rot, {}));
  };
  const applyStudio = () => exp.setStudio(studio);
  const applyLamps = () => exp.setLamps(lamps);
  const applyRake = () => exp.setRake(rake);
  /** A one-shot effect at a moment of the film; never fired by a skip or a seek. */
  const fire = (fn) => () => {
    if (!skipping && !done) fn();
  };

  /** Put the scene in the intro's first frame (called behind the loader). */
  function prepare() {
    if (mode !== 'instant') gsap.set(REVEALED, { autoAlpha: 0 });
    if (mode === 'full' || mode === 'short') {
      exp.rigLambda = Infinity; // the timeline drives the camera exactly
      camera.t = mode === 'short' ? T_SHORT : 0;
      applyCamera();
      Object.assign(exp.rig, exp.target);
      if (mode === 'short') {
        Object.assign(studio, { intensity: 0.28, rotation: 0.35 });
        Object.assign(lamps, { drl: 1.4, tail: 0.9 });
      }
      applyStudio();
      applyLamps();
      applyRake();
      setTheme('ink');
    } else {
      exp.setRig(heroRig());
      Object.assign(exp.rig, exp.target);
      exp.setStudio({ intensity: 1, rotation: 0 });
      exp.setLamps(LAMPS_REST);
      setTheme(null);
    }
  }

  /** Build and start the timeline. Resolves when the hero has settled. */
  function play({ onDone } = {}) {
    const giant = SplitText.create('.giant__word', { type: 'chars', charsClass: 'char' });
    const skipBtn = document.querySelector('.intro-skip');
    const backdrop = document.querySelector('.backdrop');
    const caption = document.querySelector('.intro-caption');
    const copy = ['.hero__meta span', '.hero__title > span', '.hero__note'];

    const finish = () => {
      if (done) return;
      done = true;
      // Land exactly on the hero keyframe, azimuth unwrapped to its canonical value
      const hero = heroRig();
      exp.setRig(hero);
      Object.assign(exp.rig, exp.target);
      exp.rigLambda = 4.2;
      exp.setStudio({ intensity: 1, rotation: 0 });
      exp.setLamps(LAMPS_REST);
      exp.setRake({ intensity: 0 });
      exp.exhaust.throttle = 0;
      setTheme(null);
      backdrop.style.transition = '';
      skipBtn.hidden = true;
      if (caption) gsap.set(caption, { autoAlpha: 0 });
      listeners.forEach(([t, e, fn]) => t.removeEventListener(e, fn));
      try {
        sessionStorage.setItem('rosso:intro-seen', '1');
      } catch {}
      onDone?.();
    };

    if (mode === 'reduced' || mode === 'instant') {
      // No camera flight, no fire: the final composition, with short opacity fades only
      prepare();
      const d = mode === 'instant' ? 0 : 0.6;
      tl = gsap.timeline({ onComplete: finish });
      tl.set('.giant__word', { autoAlpha: 1 }, 0)
        .fromTo(giant.chars, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, stagger: d ? 0.04 : 0 }, 0)
        .fromTo('.signature', { clipPath: 'inset(0 0% 0 0)', autoAlpha: 0 }, { autoAlpha: 1, duration: d }, d ? 0.2 : 0)
        .fromTo(['.nav > *', '.rail', ...copy, '.hero__scroll'], { autoAlpha: 0 }, { autoAlpha: 1, duration: d }, d ? 0.3 : 0);
      if (!d) tl.progress(1);
      return tl;
    }

    // A film caption: index and word, low left, in and out
    const captionAt = (time, n, word, hold) => {
      if (!caption) return;
      tl.call(() => {
        caption.querySelector('[data-n]').textContent = n;
        caption.querySelector('[data-word]').textContent = word;
      }, null, time - 0.01)
        .fromTo(caption, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'expo.out' }, time)
        .to(caption, { autoAlpha: 0, y: -6, duration: 0.45, ease: 'power2.in' }, time + hold);
    };

    backdrop.style.transition = 'background-color 1.4s cubic-bezier(0.45, 0, 0.2, 1)';
    tl = gsap.timeline({ onComplete: finish });
    tl.addLabel('dark', 0)
      .fromTo(camera, { t: 0 }, { t: T_FINAL, duration: T_FINAL, ease: 'none', onUpdate: applyCamera }, 0)

      // LIGHT — the LED signature wakes in steps, like a real start-up, then settles bright
      .addLabel('light', 0.75)
      .to(lamps, { drl: 2.6, duration: 0.05, ease: 'none', onUpdate: applyLamps }, 0.75)
      .to(lamps, { drl: 0.12, duration: 0.06, ease: 'none', onUpdate: applyLamps }, 0.81)
      .to(lamps, { drl: 2.9, duration: 0.05, ease: 'none', onUpdate: applyLamps }, 0.9)
      .to(lamps, { drl: 0.35, duration: 0.08, ease: 'none', onUpdate: applyLamps }, 0.96)
      .to(lamps, { drl: 3.3, duration: 0.12, ease: 'power2.out', onUpdate: applyLamps }, 1.08)
      .to(lamps, { drl: 1.6, duration: 1.4, ease: 'sine.inOut', onUpdate: applyLamps }, 1.4)

      // LINE — the raking light draws the flank, nose to tail; the studio starts to glow
      .addLabel('line', 1.6)
      .fromTo(rake, { z: -3.2 }, { z: 3.4, duration: 3.4, ease: 'sine.inOut', onUpdate: applyRake }, 1.5)
      .fromTo(rake, { intensity: 0 }, { intensity: 46, duration: 0.7, ease: 'sine.out', onUpdate: applyRake }, 1.5)
      .to(rake, { intensity: 0, duration: 0.9, ease: 'sine.in', onUpdate: applyRake }, 4.0)
      .fromTo(studio, { intensity: 0 }, { intensity: 0.05, duration: 1.2, ease: 'sine.inOut', onUpdate: applyStudio }, 0.4)
      .to(studio, { intensity: 0.2, duration: 2.4, ease: 'sine.inOut', onUpdate: applyStudio }, 1.6)
      .fromTo(studio, { rotation: 1.5 }, { rotation: 0, duration: 6.2, ease: 'sine.inOut', onUpdate: applyStudio }, 0)

      // FIRE — tail-lamps up, ignition, a blip, the overrun; idle smoke until the rise
      .addLabel('fire', 4.0)
      .to(lamps, { tail: 1.5, duration: 0.5, ease: 'power2.out', onUpdate: applyLamps }, 4.1)
      .call(fire(() => (exp.exhaust.throttle = 0.22)), null, 4.62)
      .call(fire(() => exp.exhaust.pulse(1.5)), null, 4.65)
      .to(studio, { intensity: 0.3, duration: 0.12, ease: 'power3.out', onUpdate: applyStudio }, 4.65)
      .to(studio, { intensity: 0.24, duration: 0.6, ease: 'sine.out', onUpdate: applyStudio }, 4.8)
      .call(fire(() => (exp.exhaust.throttle = 0.55)), null, 5.05)
      .call(fire(() => exp.exhaust.pulse(0.9)), null, 5.15)
      .call(fire(() => (exp.exhaust.throttle = 0.25)), null, 5.4)
      .call(fire(() => exp.exhaust.crackle(0.9, 0.75)), null, 5.42)
      .call(fire(() => (exp.exhaust.throttle = 0)), null, 6.6)

      // REVEAL — rise into the poster as the room lights up
      .addLabel('reveal', 5.9)
      .to(studio, { intensity: 0.55, duration: 1.2, ease: 'sine.inOut', onUpdate: applyStudio }, 5.9)
      .to(studio, { intensity: 1, duration: 1.2, ease: 'power2.inOut', onUpdate: applyStudio }, 7.0)
      .to(lamps, { ...LAMPS_REST, duration: 1.6, ease: 'sine.inOut', onUpdate: applyLamps }, 6.4)
      .call(() => setTheme('paper'), null, 7.3)
      // Type only once the camera is decelerating into place
      .set('.giant__word', { autoAlpha: 1 }, 7.5)
      .fromTo(giant.chars, { yPercent: 22, clipPath: 'inset(100% 0% 0% 0%)' }, { yPercent: 0, clipPath: 'inset(-10% 0% -10% 0%)', duration: 1.4, ease: 'expo.out', stagger: 0.07 }, 7.5)
      .fromTo('.signature', { clipPath: 'inset(0 100% 0 0)', autoAlpha: 1 }, { clipPath: 'inset(0 0% 0 0)', duration: 1.6, ease: 'power2.inOut' }, 8.1)
      .fromTo('.nav > *', { y: -14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out', stagger: 0.06 }, 8.5)
      .fromTo(copy, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: 'expo.out', stagger: 0.05 }, 8.6)
      .fromTo('.rail', { x: 16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 1, ease: 'expo.out' }, 8.8)
      .fromTo('.hero__scroll', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: 'sine.out' }, 9.4)
      // Skip control: available from the first moment, gone once type arrives
      .fromTo(skipBtn, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, onStart: () => (skipBtn.hidden = false) }, 0.4)
      .to(skipBtn, { autoAlpha: 0, duration: 0.4 }, 7.7);

    captionAt(0.95, '01', 'Light', 1.5);
    captionAt(2.45, '02', 'Line', 1.5);
    captionAt(4.6, '03', 'Fire', 1.3);

    if (mode === 'short') tl.seek(T_SHORT, false).timeScale(1.15); // repeat visit: from the ignition, ~4.5 s

    // Skip = a quick cut through the dark veil to the settled frame (never a fast-forward fly-through)
    const skip = () => {
      if (done || tl.progress() > 0.93) return;
      const veil = document.querySelector('.intro-veil');
      gsap.timeline()
        .to(veil, { autoAlpha: 1, duration: 0.25, ease: 'power1.in' })
        .add(() => {
          skipping = true;
          tl.progress(1);
        })
        .to(veil, { autoAlpha: 0, duration: 0.6, ease: 'power1.out' });
    };
    skipFn = skip;
    skipBtn.onclick = skip;
    const on = (target, event, fn, opts) => {
      target.addEventListener(event, fn, opts);
      listeners.push([target, event, fn]);
    };
    // Any attempt to scroll, or Esc, also skips: nobody is held hostage by the intro
    on(window, 'wheel', skip, { passive: true });
    on(window, 'touchmove', skip, { passive: true });
    on(window, 'keydown', (e) => {
      if (['Escape', ' ', 'ArrowDown', 'PageDown', 'End'].includes(e.key) && document.activeElement !== skipBtn) skip();
    });
    // An orientation change mid-intro would change the whole shot: settle instead
    const wasPortrait = portrait;
    on(window, 'resize', () => isPortrait() !== wasPortrait && skip());

    return tl;
  }

  return {
    prepare,
    play,
    skip: () => skipFn?.(),
    get done() {
      return done;
    },
    get timeline() {
      return tl;
    },
  };
}

/** Which version of the intro this visit gets. */
export function introMode({ reducedMotion, hasWebGL }) {
  if (location.hash && document.querySelector(location.hash)) return 'instant';
  if (reducedMotion || !hasWebGL) return 'reduced';
  try {
    if (sessionStorage.getItem('rosso:intro-seen')) return 'short';
  } catch {}
  return 'full';
}
