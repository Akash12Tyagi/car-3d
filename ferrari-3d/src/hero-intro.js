import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { fitDistance } from './scene/views.js';
import { sampleMonotone } from './scene/spline.js';

/* ==================================================================== */
/* Hero intro — the opening shot                                          */
/*                                                                        */
/*  0.0s  Detail: the LED signature at the left headlamp, glowing in a    */
/*        dark studio (the DRL is the only light that is "on").           */
/*  1.8s  Contours: the camera follows the strip back over the wheel      */
/*        arch while the studio's reflections sweep across the panels.    */
/*  3.3s  Pull back down the flank, then rise over the car into the hero  */
/*        poster as the room lights up (carbon → paper).                  */
/*  4.3s  ROSSO rises behind the car; 4.9s the Italia signature writes.   */
/*  5.3s  Navigation and copy; 6.2s the scroll cue settles.               */
/*                                                                        */
/* One GSAP timeline owns everything, so the state at any moment is a     */
/* function of its time: skipping, seeking or reduced motion all land on  */
/* the same final frame, and that frame IS the hero keyframe the scroll   */
/* system uses next, so the hand-over can't jump.                         */
/* ==================================================================== */

const DEG = Math.PI / 180;

/*
 * Camera keys in CAR space: az 180 = facing the nose, 270 = the car's left
 * flank; targets in car metres (nose towards −Z, left side −X). The final key
 * is the live hero keyframe, converted into car space at run time.
 * Target points were measured from the model: left projector lens at
 * (−0.68, 0.61, −1.85), LED strip from z −1.77 back to −0.76.
 */
const SHOTS = {
  landscape: [
    { t: 0.0, az: 205, el: 10, dist: 1.25, fov: 30, x: -0.78, y: 0.62, z: -1.55 },
    { t: 1.8, az: 228, el: 7, dist: 1.75, fov: 30, x: -0.84, y: 0.55, z: -1.2 },
    { t: 3.3, az: 258, el: 7, dist: 6.0, fov: 30, x: -0.2, y: 0.55, z: -0.3 },
  ],
  portrait: [
    { t: 0.0, az: 205, el: 10, dist: 1.95, fov: 36, x: -0.76, y: 0.62, z: -1.58 },
    { t: 1.8, az: 226, el: 8, dist: 2.3, fov: 36, x: -0.84, y: 0.55, z: -1.2 },
    { t: 3.3, az: 236, el: 14, dist: null, fov: 32, x: 0, y: 0.5, z: 0 }, // dist fitted to the screen
  ],
};
const T_FINAL = 5.2;
// Everything the intro reveals; hidden behind the loader so nothing flashes during its wipe
const REVEALED = ['.giant__word', '.signature', '.nav > *', '.rail', '.hero__meta span', '.hero__title > span', '.hero__note', '.hero__scroll'];
const CHANNELS = ['az', 'el', 'dist', 'fov', 'x', 'y', 'z'];

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
  const studio = { intensity: 0.1, rotation: 1.5 };
  let done = false;
  let tl;
  let skipFn = null;
  const listeners = [];

  const keys = () => {
    const hero = heroRig();
    if (portrait) {
      const k = shots[2];
      k.dist = fitDistance({ az: k.az + hero.rot, el: k.el, fov: k.fov, ty: k.y }, { aspect: innerWidth / innerHeight, width: 0.9, height: 0.42, bounds: exp.bbox });
    }
    return [...shots, fromRig(hero, shots[shots.length - 1].az)];
  };
  const applyCamera = () => {
    const hero = heroRig();
    exp.setRig(toRig(sample(keys(), camera.t), hero.rot, {}));
  };
  const applyStudio = () => exp.setStudio(studio);

  /** Put the scene in the intro's first frame (called behind the loader). */
  function prepare() {
    if (mode !== 'instant') gsap.set(REVEALED, { autoAlpha: 0 });
    if (mode === 'full' || mode === 'short') {
      exp.rigLambda = Infinity; // the timeline drives the camera exactly
      camera.t = mode === 'short' ? 3.0 : 0;
      applyCamera();
      Object.assign(exp.rig, exp.target);
      if (mode === 'short') Object.assign(studio, { intensity: 0.45, rotation: 0.25 });
      applyStudio();
      setTheme('ink');
    } else {
      exp.setRig(heroRig());
      Object.assign(exp.rig, exp.target);
      exp.setStudio({ intensity: 1, rotation: 0 });
      setTheme(null);
    }
  }

  /** Build and start the timeline. Resolves when the hero has settled. */
  function play({ onDone } = {}) {
    const giant = SplitText.create('.giant__word', { type: 'chars', charsClass: 'char' });
    const skipBtn = document.querySelector('.intro-skip');
    const backdrop = document.querySelector('.backdrop');
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
      setTheme(null);
      backdrop.style.transition = '';
      skipBtn.hidden = true;
      listeners.forEach(([t, e, fn]) => t.removeEventListener(e, fn));
      try {
        sessionStorage.setItem('rosso:intro-seen', '1');
      } catch {}
      onDone?.();
    };

    if (mode === 'reduced' || mode === 'instant') {
      // No camera flight: the final composition, with short opacity fades only
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

    backdrop.style.transition = 'background-color 1.4s cubic-bezier(0.45, 0, 0.2, 1)';
    tl = gsap.timeline({ onComplete: finish });
    tl.addLabel('detail', 0)
      .fromTo(camera, { t: 0 }, { t: T_FINAL, duration: T_FINAL, ease: 'none', onUpdate: applyCamera }, 0)
      // Lights: the studio comes up in three steps while its reflections sweep across the body
      .fromTo(studio, { intensity: 0.1 }, { intensity: 0.24, duration: 1.8, ease: 'sine.inOut', onUpdate: applyStudio }, 0)
      .to(studio, { intensity: 0.55, duration: 1.5, ease: 'sine.inOut', onUpdate: applyStudio }, 1.8)
      .to(studio, { intensity: 1, duration: 1.3, ease: 'power2.inOut', onUpdate: applyStudio }, 3.3)
      .fromTo(studio, { rotation: 1.5 }, { rotation: 0, duration: 3.6, ease: 'sine.inOut', onUpdate: applyStudio }, 0)
      .addLabel('rise', 3.3)
      .call(() => setTheme('paper'), null, 3.9)
      // Type only once the camera is decelerating into place
      .set('.giant__word', { autoAlpha: 1 }, 4.3)
      .fromTo(giant.chars, { yPercent: 22, clipPath: 'inset(100% 0% 0% 0%)' }, { yPercent: 0, clipPath: 'inset(-10% 0% -10% 0%)', duration: 1.4, ease: 'expo.out', stagger: 0.07 }, 4.3)
      .fromTo('.signature', { clipPath: 'inset(0 100% 0 0)', autoAlpha: 1 }, { clipPath: 'inset(0 0% 0 0)', duration: 1.6, ease: 'power2.inOut' }, 4.9)
      .fromTo('.nav > *', { y: -14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out', stagger: 0.06 }, 5.3)
      .fromTo(copy, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: 'expo.out', stagger: 0.05 }, 5.4)
      .fromTo('.rail', { x: 16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 1, ease: 'expo.out' }, 5.6)
      .fromTo('.hero__scroll', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: 'sine.out' }, 6.2)
      // Skip control: available from the first moment, gone once type arrives
      .fromTo(skipBtn, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, onStart: () => (skipBtn.hidden = false) }, 0.4)
      .to(skipBtn, { autoAlpha: 0, duration: 0.4 }, 4.6);

    if (mode === 'short') tl.seek(3.0, false).timeScale(1.15); // repeat visit: start wide, ~3 s

    // Skip = a quick cut through the dark veil to the settled frame (never a fast-forward fly-through)
    const skip = () => {
      if (done || tl.progress() > 0.92) return;
      const veil = document.querySelector('.intro-veil');
      gsap.timeline()
        .to(veil, { autoAlpha: 1, duration: 0.25, ease: 'power1.in' })
        .add(() => tl.progress(1))
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
