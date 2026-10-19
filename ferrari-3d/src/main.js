import 'lenis/dist/lenis.css';
import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { Experience, NullExperience, RIG_KEYS, RIG_DEFAULTS, webglAvailable } from './experience.js';
import { createHeroIntro, introMode } from './hero-intro.js';
import { EngineSound } from './engine-sound.js';
import { Anatomy } from './cinematic/anatomy.js';
import { stateAt, calloutsAt } from './cinematic/timeline.js';
import { conceptCar } from './cinematic/manifest.js';
import { viewRig, FRONT } from './scene/views.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

/* ------------------------------------------------------------------ */
/* Camera choreography                                                 */
/* One keyframe per chapter. The camera blends from one to the next    */
/* while the next chapter slides into view, then holds while its copy  */
/* is read. Beauty shots use the named views in src/scene/views.js,    */
/* whose distance is solved from the car's real bounds so the car      */
/* fills the space its chapter leaves for it at any aspect ratio.      */
/* `frame` = share of the viewport the car may occupy (NDC half-extent)*/
/* and `shift` slides it beside the copy.                              */
/* ------------------------------------------------------------------ */
const isPortrait = () => window.innerWidth / window.innerHeight < 0.9;

function keyframes() {
  const p = isPortrait();
  const aspect = window.innerWidth / window.innerHeight;
  const bounds = exp.bbox; // measured from the loaded model (undefined until then → defaults)
  const view = (name, width, height, shift = 0, extra = {}) => viewRig(name, { aspect, width, height, shift, bounds, ...extra });
  const top = { az: 0, el: 89.4, fov: 30, tx: 0, ty: 0, tz: 0, roll: 0, shift: 0 };
  return {
    // Top-down poster shots: a much gentler pointer response, since yaw rotates the whole image
    hero: { ...top, dist: p ? 15.5 : 9.6, rot: p ? 0 : 90, parallax: 0.3 },
    overture: p ? view('hero34', 0.98, 0.36, 0, { ty: 1.3 }) : view('hero34', 0.56, 0.64, 0.2),
    design: p ? view('profile', 0.92, 0.3, 0, { fov: 24 }) : view('profile', 0.64, 0.5),
    // Behind the Anatomy curtain: drift back into the dark, then hand over to Performance
    anatomy: { az: FRONT + 70, el: 4, dist: p ? 30 : 19, fov: p ? 24 : 20, tx: 0, ty: 0.55, tz: 0, rot: 0, shift: 0, roll: 0 },
    performance: p ? view('rear34', 0.95, 0.32, 0, { ty: 0.9 }) : view('rear34', 0.5, 0.48, -0.17),
    launch: { az: FRONT + 62, el: 3, dist: p ? 9.5 : 7.2, fov: 34, tx: 0, ty: 0.42, tz: 0, rot: 0, shift: 0, roll: -2.5 },
    configure: p ? view('atelier34', 0.98, 0.32, 0, { ty: -0.5 }) : view('atelier34', 0.52, 0.58, 0.19),
    finale: { ...top, dist: p ? 19 : 13, rot: p ? 0 : 90, tz: p ? 1.5 : 1.15, roll: 0, parallax: 0.3 },
  };
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
const loaderNum = $('.loader__num');
const loaderPct = $('.loader__pct');
const loaderBar = $('.loader__bar span');
const loadState = { shown: 0, real: 0 };

function renderLoader() {
  const v = Math.round(loadState.shown * 100);
  loaderNum.textContent = String(v).padStart(3, '0');
  loaderPct.textContent = `${v}%`;
  loaderBar.style.transform = `scaleX(${loadState.shown})`;
}

// `hasWebGL` becomes false if the visitor chooses to continue without 3D after a load failure
let hasWebGL = webglAvailable();
if (!hasWebGL) document.documentElement.classList.add('no-webgl');
const exp = hasWebGL
  ? new Experience($('.webgl'), {
      reducedMotion,
      onProgress: (p) => {
        loadState.real = p;
        gsap.to(loadState, { shown: p * 0.9, duration: 0.6, ease: 'power2.out', onUpdate: renderLoader });
      },
      onLoad: () => document.fonts.ready.then(start),
      onError: showLoadError,
    })
  : new NullExperience();
if (!hasWebGL) document.fonts.ready.then(start);

/* The main car failed to load: say why, offer a retry or the static site. */
function showLoadError(err) {
  const box = $('.loader__error');
  const reason = {
    'not-found': 'The 3D model file is missing from this deployment.',
    http: 'The server refused the 3D model.',
    network: 'The connection dropped while loading the 3D model.',
    parse: 'The 3D model could not be read.',
  }[err?.kind] ?? 'The 3D model could not be prepared.';
  box.querySelector('.loader__error-reason').textContent = reason;
  $('.loader').removeAttribute('aria-hidden');
  box.hidden = false;
}

$('.loader__retry')?.addEventListener('click', () => {
  $('.loader__error').hidden = true;
  exp.load();
});
$('.loader__static')?.addEventListener('click', () => {
  hasWebGL = false;
  document.documentElement.classList.add('no-webgl');
  exp.renderer?.setAnimationLoop(null);
  $('.loader__error').hidden = true;
  document.fonts.ready.then(start);
});
if (coarse || window.innerWidth < 860) exp.setPixelRatioCap(1.5);
window.__exp = exp;
exp.snap = new URLSearchParams(location.search).has('snap');

// A reload always starts cleanly at the hero (no restored mid-page scroll under the intro);
// a deep link (#configure …) skips the intro and opens at its section instead.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);

const chapters = $$('.chapter');
let tops = [];
let currentChapter = -1;

/* Theme: chapters set it while scrolling; the intro may hold it (carbon studio before the lights come up) */
let themeOverride = null;
function applyTheme() {
  document.documentElement.dataset.themeCurrent = themeOverride ?? chapters[Math.max(0, currentChapter)].dataset.theme;
}
function setTheme(theme) {
  themeOverride = theme;
  applyTheme();
}

const heroIntro = createHeroIntro({
  exp,
  heroRig: () => keyframes().hero,
  isPortrait,
  setTheme,
  mode: introMode({ reducedMotion, hasWebGL }),
});
heroIntro.prepare(); // first frame of the intro, behind the loader
window.__intro = heroIntro;

const sound = new EngineSound();

let lenis;
let introDone = false;

function start() {
  gsap
    .timeline()
    .to(loadState, { shown: 1, duration: 0.8, ease: 'power3.inOut', onUpdate: renderLoader })
    .to('.loader__count, .loader__top, .loader__bottom, .loader__bar, .loader__error', { yPercent: -40, opacity: 0, duration: 0.7, ease: 'power3.in', stagger: 0.05 })
    .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' }, '-=0.25')
    .add(() => {
      $('.loader').remove();
      document.body.classList.remove('is-loading');
      intro();
    }, '-=0.6');
}

function intro() {
  setupScroll();
  // Scrolling is held until the shot settles; any attempt to scroll skips straight to the end
  lenis.stop();
  heroIntro.play({
    onDone: () => {
      introDone = true;
      lenis.start();
      if (location.hash) {
        const target = document.querySelector(location.hash);
        if (target) lenis.scrollTo(target, { immediate: true, offset: 2 });
      }
      // The intro has just made the hero type visible. Scrubbed timelines that are already
      // past their start (a deep link lands mid-page) must re-apply their own state,
      // or the hero's ROSSO and signature would stay on screen over later chapters.
      for (const st of ScrollTrigger.getAll()) {
        if (!st.vars.scrub || !st.animation || st.progress <= 0) continue;
        st.animation.progress(0, true).progress(st.progress, true);
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/* Scroll                                                              */
/* ------------------------------------------------------------------ */


function measure() {
  tops = chapters.map((c) => c.offsetTop);
}

function setupScroll() {
  lenis = new Lenis({
    lerp: reducedMotion ? 1 : 0.085,
    wheelMultiplier: 0.9,
    touchMultiplier: 1.4,
    autoRaf: false, // driven by gsap.ticker below so Lenis and ScrollTrigger share one frame
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;

  measure();
  ScrollTrigger.addEventListener('refresh', measure);
  window.addEventListener('resize', () => ScrollTrigger.refresh());

  buildRail();
  heroScroll();
  textReveals();
  hotspots();
  anatomyChapter();
  performanceChapter();
  launch();
  configurator();
  finale();

  gsap.ticker.add(frame);
  ScrollTrigger.refresh();
}

function frame() {
  const y = lenis.scroll;
  const vh = window.innerHeight;
  const K = keyframes();

  // Camera rig target: blend between chapter keyframes
  let i = 0;
  for (let k = 1; k < chapters.length; k++) if (y > tops[k] - vh) i = k;
  let rig;
  if (i === 0) rig = K[chapters[0].id];
  else {
    const t = easeInOut(clamp((y - (tops[i] - vh)) / vh));
    const a = K[chapters[i - 1].id];
    const b = K[chapters[i].id];
    rig = {};
    for (const key of RIG_KEYS) {
      const from = a[key] ?? RIG_DEFAULTS[key];
      rig[key] = from + ((b[key] ?? RIG_DEFAULTS[key]) - from) * t;
    }
  }
  if (introDone || i > 0) exp.setRig(rig);

  anatomyFrame(y, vh);

  // Active chapter = the one covering the middle of the viewport
  let active = 0;
  for (let k = 0; k < chapters.length; k++) if (y + vh * 0.5 >= tops[k]) active = k;
  if (active !== currentChapter) setChapter(active);

  // Wheels roll with scroll velocity outside of the launch sequence
  if (!launchState.active) {
    exp.wheelSpeed = clamp(lenis.velocity * 0.35, -14, 14);
    sound.setRpm(1000 + Math.min(Math.abs(lenis.velocity) * 120, 3500) + perfState.rpm * 0.85 + anatomyState.rpm);
  }

  $('.rail__fill').style.transform = `scaleY(${clamp(y / (document.documentElement.scrollHeight - vh))})`;
}

function setChapter(index) {
  const prev = currentChapter;
  currentChapter = index;
  const c = chapters[index];
  applyTheme();
  $$('.rail li').forEach((li, k) => li.classList.toggle('is-active', k === index));

  const idx = $('.nav__idx');
  const name = $('.nav__name');
  const dir = index > prev ? 1 : -1;
  gsap.to([idx, name], {
    yPercent: -60 * dir,
    opacity: 0,
    duration: 0.25,
    ease: 'power2.in',
    onComplete: () => {
      idx.textContent = String(index + 1).padStart(2, '0');
      name.textContent = c.dataset.chapter;
      gsap.fromTo([idx, name], { yPercent: 60 * dir, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'expo.out', stagger: 0.04 });
    },
  });
}

function buildRail() {
  const ol = $('.rail ol');
  chapters.forEach((c, k) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#${c.id}" data-hover>${String(k + 1).padStart(2, '0')}<span>${c.dataset.chapter}</span></a>`;
    ol.appendChild(li);
  });
  $$('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      // land where the chapter's camera keyframe is fully settled
      lenis.scrollTo(target, { offset: target.id === 'hero' ? 0 : 2, duration: 2.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
    })
  );
}

function heroScroll() {
  const tl = gsap.timeline({
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
  });
  // Explicit start values: the intro may still be hiding these when the scrub is created,
  // and a lazily recorded start of opacity 0 would make them vanish on every return to the top
  tl.fromTo('.giant__word', { scale: 1, yPercent: 0, opacity: 1 }, { scale: 1.35, yPercent: -8, opacity: 0, ease: 'none', immediateRender: false }, 0)
    .fromTo('.signature', { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.1, ease: 'none', duration: 0.5, immediateRender: false }, 0)
    .fromTo('.hero', { opacity: 1 }, { opacity: 0, ease: 'none', duration: 0.45, immediateRender: false }, 0.1);

  // The giant word and signature come back for the finale (bookend)
  gsap.timeline({
    scrollTrigger: { trigger: '#finale', start: 'top 60%', end: 'top top', scrub: true, invalidateOnRefresh: true },
  })
    .fromTo(
      '.giant__word',
      { scale: 0.6, opacity: 0, yPercent: 0, y: 0 },
      { scale: 0.7, opacity: 1, y: () => -0.17 * window.innerHeight, ease: 'none', immediateRender: false }
    );
}

function textReveals() {
  $$('.split').forEach((el) => {
    const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'line' });
    gsap.from(split.lines, {
      yPercent: 105,
      duration: 1.2,
      ease: 'expo.out',
      stagger: 0.09,
      scrollTrigger: { trigger: el.closest('.chapter'), start: 'top 45%', toggleActions: 'play none none reverse' },
    });
  });
  $$('.split-lines').forEach((el) => {
    const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'line' });
    gsap.from(split.lines, {
      yPercent: 100,
      opacity: 0,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.05,
      delay: 0.25,
      scrollTrigger: { trigger: el.closest('.chapter'), start: 'top 45%', toggleActions: 'play none none reverse' },
    });
  });
  $$('.eyebrow').forEach((el) =>
    gsap.from(el, {
      opacity: 0,
      x: -20,
      duration: 1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el.closest('.chapter'), start: 'top 45%', toggleActions: 'play none none reverse' },
    })
  );
}

function hotspots() {
  const els = $$('.hotspot');
  els.forEach((el) => {
    const [fx, fy, fz] = el.dataset.f.split(',').map(Number);
    exp.addHotspot(el, fx, fy, fz);
  });
  ScrollTrigger.create({
    trigger: '#design',
    start: 'top -5%',
    end: 'bottom 85%',
    onToggle: ({ isActive }) =>
      gsap.to(els, { opacity: isActive ? 1 : 0, duration: isActive ? 0.8 : 0.3, stagger: isActive ? 0.12 : 0, overwrite: true }),
  });
}

/* ------------------------------------------------------------------ */
/* Anatomy: the exploded-view sequence                                 */
/* The section is tall and its content sticky, so the page itself does */
/* the pinning (no scroll hijack). Scroll progress and the state       */
/* buttons both drive ONE playhead (cinematic/controller.js), never    */
/* the parts directly; poses, lights and camera follow the playhead.   */
/* ------------------------------------------------------------------ */
const anatomyState = { rpm: 0, stage: null, state: '', requested: false, calloutSet: null };

function anatomySpan() {
  const section = $('#anatomy');
  const top = tops[chapters.indexOf(section)];
  return { top, span: section.offsetHeight - window.innerHeight };
}

/** Play to a state from a button: the playhead tweens, the page moves to the state's anchor. */
function goToAnatomyState(id) {
  const stage = anatomyState.stage;
  if (!stage?.ready) return;
  const seq = stage.sequence;
  // A second press on the state that is already playing skips to it
  if (seq.mode === 'manual' && seq.target.id === id) return seq.finish();
  const at = seq.goTo(id);
  const { top, span } = anatomySpan();
  lenis.scrollTo(top + at * span, { immediate: true, force: true });
}

function anatomyChapter() {
  const section = $('#anatomy');
  const loading = $('.anat__loading');
  if (!hasWebGL) return;

  const stage = new Anatomy(exp.renderer, {
    manifest: conceptCar,
    haze: exp.haze,
    environment: exp.scene.environment,
    reducedMotion,
    mobile: coarse || window.innerWidth < 860,
  });
  stage.snap = exp.snap;
  exp.setStage(stage);
  anatomyState.stage = stage;
  window.__anatomy = stage;

  // Annotations are generated from the manifest, one set per held state
  const layer = $('.callouts');
  anatomyState.callouts = Object.entries(conceptCar.callouts).flatMap(([set, list]) =>
    list.map((c, i) => {
      const el = document.createElement('div');
      el.className = c.key ? 'callout' : 'callout callout--minor';
      el.style.setProperty('--d', `${(i * 0.08).toFixed(2)}s`);
      el.innerHTML = `<i></i><p><b>${c.title}</b>${c.text}</p>`;
      layer.appendChild(el);
      return { ...c, set, el, pos: { x: 0, y: 0 } };
    })
  );

  // Lazy: fetch the model once the visitor is heading this way, or in idle time
  // unless the visitor asked to save data / is on a very slow connection.
  const request = () => {
    if (anatomyState.requested) return;
    anatomyState.requested = true;
    section.classList.remove('is-failed');
    stage
      .load()
      .then(() => section.classList.add('is-ready'))
      .catch((err) => {
        console.error('[anatomy] model failed to load —', err.message);
        section.classList.add('is-failed'); // the static exploded-view poster takes over
        setTimeout(() => (anatomyState.requested = false), 15000); // allow one later retry on approach
      });
  };
  anatomyState.request = request;
  const conn = navigator.connection;
  const constrained = conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '');
  if (!constrained) (window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(() => setTimeout(request, 1500));

  const pct = loading.querySelector('span');
  const tick = () => {
    pct.textContent = `${Math.round(stage.loadProgress * 100)}%`;
    if (stage.ready) gsap.ticker.remove(tick);
  };
  gsap.ticker.add(tick);

  // Release GPU memory when the page is torn down (bfcache, tab close)
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    stage.dispose();
    exp.haze.dispose();
    exp.exhaust.dispose();
  });

  // Manual control: state buttons; Esc completes a state that is playing
  $$('.anat__state').forEach((btn) => btn.addEventListener('click', () => goToAnatomyState(btn.dataset.state)));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage.sequence.mode === 'manual') stage.sequence.finish();
  });
  $('.anat__skip').addEventListener('click', () => {
    stage.sequence.finish();
    lenis.scrollTo('#performance', { duration: 1.6 });
  });
}

function anatomyFrame(y, vh) {
  const stage = anatomyState.stage;
  const section = $('#anatomy');
  const idx = chapters.indexOf(section);
  const { top, span } = anatomySpan();
  const end = top + span;
  const p = clamp((y - top) / span);

  if (!stage) {
    section.style.setProperty('--anat-p', p);
    return;
  }
  if (y > tops[idx - 1] - vh) anatomyState.request();

  // Hand-over curtain: up before the cut into the stage, down once it is dark there;
  // the same on the way out, so neither scene is ever seen switching.
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const inside = y >= top - 0.08 * vh && y <= end + 0.06 * vh;
  let curtain = Math.max(
    smooth(top - 0.5 * vh, top - 0.08 * vh, y) * (1 - smooth(top + 0.02 * vh, top + 0.25 * vh, y)),
    smooth(end - 0.12 * vh, end, y) * (1 - smooth(end + 0.1 * vh, end + 0.6 * vh, y))
  );
  if (inside && !stage.ready) curtain = 1;
  $('.curtain').style.opacity = curtain.toFixed(3);
  section.classList.toggle('is-waiting', inside && !stage.ready);

  // Entering (from either end, or after a jump) happens under the curtain:
  // put the playhead on the scroll position instead of replaying the way there
  const wasActive = stage.active;
  stage.active = inside && stage.ready;
  if (stage.active && !wasActive) stage.sequence.jump(p);
  stage.setProgress(p);

  const q = stage.ready ? stage.sequence.q : p;
  section.style.setProperty('--anat-p', q.toFixed(4));

  // Copy and state buttons follow the playhead (or the state a button is playing to)
  const state = stage.ready ? stage.sequence.state.id : stateAt(p).id;
  if (state !== anatomyState.state) {
    anatomyState.state = state;
    $$('.anat__beat, .anat__timeline li').forEach((el) => el.classList.toggle('is-active', el.dataset.beat === state));
    $$('.anat__state').forEach((b) => (b.dataset.state === state ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  }

  // Annotations only while a state is held
  const set = stage.active ? calloutsAt(q) : null;
  if (set !== anatomyState.calloutSet) {
    anatomyState.calloutSet = set;
    $('.callouts').classList.toggle('is-on', !!set);
    for (const c of anatomyState.callouts) c.el.classList.toggle('is-shown', c.set === set);
  }
  if (set) layoutCallouts(anatomyState.callouts.filter((c) => c.set === set && getComputedStyle(c.el).display !== 'none' && stage.project(c.part, c.pos, c.at)));

  // A gentle idle-to-midrange rev while the powertrain is on stage (only if sound is on)
  anatomyState.rpm = stage.active ? (stage.focus ?? 0) * 2600 : 0;
}

/**
 * Place annotation labels beside their markers (right of the marker on the left
 * half of the screen, left of it on the right half). Where two labels would
 * overlap, the upper one is lifted clear on a leader line. Lifts ease, so labels
 * never jump as the camera drifts.
 */
function layoutCallouts(list) {
  const placed = [];
  const minTop = 84; // keep clear of the navigation
  for (const c of [...list].sort((a, b) => b.pos.y - a.pos.y)) {
    const label = c.el.querySelector('p');
    c.w ??= label.offsetWidth;
    c.h ??= label.offsetHeight;
    const flip = c.pos.x > window.innerWidth / 2;
    const x0 = flip ? c.pos.x - 14 - c.w : c.pos.x + 14;
    const x1 = x0 + c.w;
    let lift = 0;
    for (let guard = 0; guard < placed.length + 1; guard++) {
      const y1 = c.pos.y - 10 - lift;
      const hit = placed.find((r) => x0 < r.x1 && x1 > r.x0 && y1 - c.h < r.y1 + 6 && y1 > r.y0 - 6);
      if (!hit) break;
      lift = c.pos.y - 10 - (hit.y0 - 6);
    }
    lift = Math.max(0, Math.min(lift, c.pos.y - 10 - c.h - minTop));
    placed.push({ x0, x1, y0: c.pos.y - 10 - lift - c.h, y1: c.pos.y - 10 - lift });
    c.lift = c.lift === undefined ? lift : c.lift + (lift - c.lift) * 0.2;
    c.el.style.transform = `translate3d(${c.pos.x.toFixed(1)}px, ${c.pos.y.toFixed(1)}px, 0)`;
    c.el.style.setProperty('--lift', `${c.lift.toFixed(1)}px`);
    c.el.classList.toggle('flip', flip);
  }
}

const perfState = { rpm: 0, lastRpm: 0 };
function performanceChapter() {
  const C = 2 * Math.PI * 88;
  const ARC = C * 0.75;
  const fill = $('.tach__fill');
  const red = $('.tach__red');
  const rpmEl = $('.tach__rpm');
  red.style.strokeDasharray = `0 ${ARC * 0.9} ${ARC * 0.1} ${C}`;

  const ticks = $('.tach__ticks');
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * 270 * (Math.PI / 180);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const r1 = 78;
    const r2 = k % 5 === 0 ? 66 : 72;
    line.setAttribute('x1', 100 + Math.cos(a) * r1);
    line.setAttribute('y1', 100 + Math.sin(a) * r1);
    line.setAttribute('x2', 100 + Math.cos(a) * r2);
    line.setAttribute('y2', 100 + Math.sin(a) * r2);
    ticks.appendChild(line);
  }

  ScrollTrigger.create({
    trigger: '#performance',
    start: 'top 30%',
    end: 'bottom bottom',
    scrub: 0.6,
    onUpdate: (self) => {
      const p = self.progress;
      // Rev up, hold at the limiter, then settle
      const rpm = p < 0.7 ? easeInOut(p / 0.7) * 9000 : 9000 - (Math.sin(p * 90) * 0.5 + 0.5) * 250;
      perfState.rpm = self.isActive ? rpm : 0;
      // Exhaust follows the revs; each touch of the limiter fires a pulse from the tailpipes
      exp.exhaust.throttle = self.isActive ? (rpm / 9000) * 0.75 : 0;
      if (self.isActive && rpm > 8820 && perfState.lastRpm <= 8820) exp.exhaust.pulse(0.8);
      perfState.lastRpm = rpm;
      fill.style.strokeDasharray = `${(rpm / 10000) * ARC} ${C}`;
      rpmEl.textContent = Math.round(rpm / 10) * 10;
    },
    onLeave: () => {
      perfState.rpm = 0;
      exp.exhaust.throttle = 0;
    },
    onLeaveBack: () => {
      perfState.rpm = 0;
      exp.exhaust.throttle = 0;
    },
  });

  $$('[data-count]').forEach((el, k) => {
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const o = { v: 0 };
    gsap.to(o, {
      v: to,
      duration: 2.2,
      delay: k * 0.12,
      ease: 'expo.out',
      onUpdate: () => (el.textContent = o.v.toFixed(dec)),
      scrollTrigger: { trigger: '#performance', start: 'top 35%', toggleActions: 'play none none reset' },
    });
  });
  gsap.from('.stat', {
    y: 40,
    opacity: 0,
    duration: 1.1,
    ease: 'expo.out',
    stagger: 0.1,
    scrollTrigger: { trigger: '#performance', start: 'top 35%', toggleActions: 'play none none reverse' },
  });
}

const launchState = { active: false, gear: 0 };
function launch() {
  const kmhEl = $('.launch__kmh');
  const gearEl = $('.launch__gear');
  const timeEl = $('.launch__time');
  const rows = $$('.marquee__row');
  const shifts = [0, 62, 98, 138, 178, 218, 258, 330];

  ScrollTrigger.create({
    trigger: '#launch',
    start: 'top 40%',
    end: 'bottom bottom',
    scrub: 0.4,
    onToggle: ({ isActive }) => {
      launchState.active = isActive;
      if (!isActive) {
        exp.streaks = 0;
        exp.shake = 0;
        exp.exhaust.throttle = 0;
      }
    },
    onUpdate: ({ progress: p, isActive }) => {
      launchState.active = isActive;
      // v(t) = vmax(1 - e^(-t/tau)), tuned so 0-100 km/h lands at 3.4 s
      const t = p * 20;
      const v = 325 * (1 - Math.exp(-t / 9.25));
      let gear = 1;
      while (gear < 7 && v > shifts[gear]) gear++;
      const lo = shifts[gear - 1];
      const hi = shifts[gear];
      const rpm = 3800 + ((v - lo) / (hi - lo)) * 5200;

      kmhEl.textContent = String(Math.round(v)).padStart(3, '0');
      gearEl.textContent = gear;
      timeEl.textContent = t.toFixed(2);
      if (launchState.active) {
        exp.wheelSpeed = Math.min((v / 3.6 / 0.34) * 0.5, 38);
        exp.streaks = clamp(p * 1.6);
        exp.shake = clamp(p * 1.2) * 0.8;
        sound.setRpm(p > 0.002 ? rpm : 1000, 0.05);
        // Exhaust load tracks the revs; every upshift cuts and re-lights with a pulse
        exp.exhaust.throttle = p > 0.002 ? 0.3 + 0.7 * ((rpm - 3800) / 5200) : 0.1;
        if (launchState.gear && gear !== launchState.gear) exp.exhaust.pulse(1);
      }
      launchState.gear = gear;
      rows[0].style.transform = `translateX(${-p * 55}%)`;
      rows[1].style.transform = `translateX(${-50 + p * 45}%)`;
    },
  });
  gsap.from('.launch__hud > div', {
    y: 30,
    opacity: 0,
    stagger: 0.08,
    duration: 1,
    ease: 'expo.out',
    scrollTrigger: { trigger: '#launch', start: 'top 40%', toggleActions: 'play none none reverse' },
  });
}

function configurator() {
  const stage = $('.configure');
  const paintName = $('.config__paint-name');
  const rimName = $('.config__rim-name');

  const swapText = (el, text) =>
    gsap.to(el, {
      opacity: 0,
      y: -8,
      duration: 0.2,
      onComplete: () => {
        el.textContent = text;
        gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' });
      },
    });

  $$('.swatch').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.classList.contains('is-active')) return;
      $$('.swatch').forEach((s) => s.classList.toggle('is-active', s === b));
      exp.setPaint(b.dataset.paint, { metalness: parseFloat(b.dataset.metal ?? '0.75') });
      swapText(paintName, b.dataset.name);
    })
  );
  $$('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.chip').forEach((s) => s.classList.toggle('is-active', s === b));
      exp.setRims(b.dataset.rim, parseFloat(b.dataset.rough));
      swapText(rimName, b.textContent);
    })
  );

  // Drag to orbit (only inside the atelier)
  let dragging = false;
  let lastX = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.config__panel')) return;
    dragging = true;
    lastX = e.clientX;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    exp.dragAz -= (e.clientX - lastX) * 0.35;
    lastX = e.clientX;
  });
  const end = () => (dragging = false);
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.style.touchAction = 'pan-y';

  ScrollTrigger.create({
    trigger: '#configure',
    start: 'top top',
    end: 'bottom bottom',
    onToggle: ({ isActive }) => {
      cursorState.zone = isActive ? 'Drag' : '';
      if (!isActive) exp.dragAz = 0;
    },
  });
}

function finale() {
  const split = SplitText.create('.finale__title > span', { type: 'chars', charsClass: 'char' });
  gsap.from(split.chars, {
    yPercent: 80,
    opacity: 0,
    rotate: 8,
    duration: 1.2,
    ease: 'expo.out',
    stagger: 0.03,
    scrollTrigger: { trigger: '#finale', start: 'top 30%', toggleActions: 'play none none reverse' },
  });
  gsap.from('.finale__cta, .footer', {
    y: 30,
    opacity: 0,
    duration: 1,
    ease: 'expo.out',
    stagger: 0.1,
    scrollTrigger: { trigger: '#finale', start: 'top 20%', toggleActions: 'play none none reverse' },
  });
}

/* ------------------------------------------------------------------ */
/* Sound toggle                                                        */
/* ------------------------------------------------------------------ */
$('.nav__sound').addEventListener('click', (e) => {
  const on = sound.toggle();
  e.currentTarget.setAttribute('aria-pressed', String(on));
  $('.nav__sound-label').textContent = on ? 'Sound on' : 'Sound off';
});

/* ------------------------------------------------------------------ */
/* Cursor + magnetic buttons                                           */
/* ------------------------------------------------------------------ */
const cursor = $('.cursor');
const cursorState = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2, zone: '' };
const dot = $('.cursor__dot');
const ring = $('.cursor__ring');
const ringLabel = $('.cursor__ring span');

window.addEventListener('pointermove', (e) => {
  cursorState.x = e.clientX;
  cursorState.y = e.clientY;
  const hover = e.target.closest('[data-hover]');
  cursor.classList.toggle('is-hover', !!hover);
  const label = !hover && cursorState.zone && !e.target.closest('.config__panel') ? cursorState.zone : '';
  cursor.classList.toggle('is-label', !!label);
  ringLabel.textContent = label;
});
gsap.ticker.add(() => {
  cursorState.rx += (cursorState.x - cursorState.rx) * 0.16;
  cursorState.ry += (cursorState.y - cursorState.ry) * 0.16;
  dot.style.transform = `translate3d(${cursorState.x}px, ${cursorState.y}px, 0)`;
  ring.style.transform = `translate3d(${cursorState.rx}px, ${cursorState.ry}px, 0)`;
});

$$('[data-magnetic]').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    gsap.to(el, { x: x * 0.3, y: y * 0.4, duration: 0.6, ease: 'power3.out' });
  });
  el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)' }));
});
