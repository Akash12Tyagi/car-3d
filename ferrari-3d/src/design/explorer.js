import * as THREE from 'three';
import gsap from 'gsap';
import { FEATURES } from './features.js';
import { ComponentHighlight } from './highlight.js';
import { fitDistance } from '../scene/views.js';
import { layoutLabels, insideAny } from '../ui/labels.js';

const DEG = Math.PI / 180;
const RIG_KEYS = ['az', 'el', 'dist', 'fov', 'tx', 'ty', 'tz', 'rot', 'shift', 'roll', 'parallax'];

/**
 * Design chapter: explore the real features of the main car.
 *
 * Reuses the main scene (no second car, no second camera): it only ever
 * proposes a camera rig to the frame loop (`apply`), lights a component with
 * a highlight shell, and lays screen-space markers over the canvas after each
 * frame (`exp.onFrame`), so markers follow the car through every camera move.
 *
 * States: overview (markers on the car, index in the copy) → open (camera at
 * the feature, component lit, editorial panel) → back to overview. One tween
 * (`k`) owns the camera blend at a time; the page is held still while a
 * feature is open, and any attempt to scroll returns to the car first.
 */
export class DesignExplorer {
  constructor({ exp, lenis, section, layer, index, panel, reducedMotion = false, onChange = () => {} }) {
    this.exp = exp;
    this.lenis = lenis;
    this.section = section;
    this.layer = layer;
    this.index = index;
    this.panel = panel;
    this.reducedMotion = reducedMotion;
    this.onChange = onChange;

    this.features = FEATURES.map((f, i) => ({ ...f, n: String(i + 1).padStart(2, '0') }));
    this.byId = new Map(this.features.map((f) => [f.id, f]));
    this.ready = false;
    this.inView = false;
    this.active = null; // id of the open feature
    this.mode = null; // null | 'open' | 'closing' (camera override)
    this.k = 0;
    this.from = null;
    this.base = null; // the chapter's own rig, live from the frame loop

    this.buildMarkers();
    this.bindControls();
  }

  /* ------------------------------ setup ------------------------------ */

  /** Measure each feature on the loaded car. Call once the main car is in the scene. */
  setup() {
    const exp = this.exp;
    const vehicle = exp.vehicle;
    const car = exp.car;
    car.updateMatrixWorld(true);
    const toCar = car.matrixWorld.clone().invert();

    // Vertices of a component (optionally only inside a car-space box), in car space
    const points = ({ component, region }) => {
      const out = [];
      if (!vehicle.has(component)) return out;
      const box = region ? new THREE.Box3(new THREE.Vector3(...region.min), new THREE.Vector3(...region.max)) : null;
      const v = new THREE.Vector3();
      for (const mesh of vehicle.meshes(component)) {
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld.clone().premultiply(toCar);
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          if (!box || box.containsPoint(v)) out.push(v.clone());
        }
      }
      return out;
    };
    const nearest = (pts, p) => pts.reduce((best, q) => (q.distanceToSquared(p) < best.distanceToSquared(p) ? q : best), pts[0]);

    for (const f of this.features) {
      f.normal = new THREE.Vector3(...f.normal).normalize();
      // Marker point: on the geometry itself
      if (f.marker.anchor) {
        const tips = vehicle.anchor(f.marker.anchor).map((a) => new THREE.Vector3(...a));
        f.point = tips.reduce((s, t) => s.add(t), new THREE.Vector3()).divideScalar(tips.length);
        f.markerPoints = tips;
      } else {
        const pts = points(f.marker);
        const b = new THREE.Box3().setFromPoints(pts);
        const c = b.getCenter(new THREE.Vector3());
        if (f.marker.pick === 'outer') c.addScaledVector(f.normal, b.getSize(new THREE.Vector3()).dot(new THREE.Vector3(Math.abs(f.normal.x), Math.abs(f.normal.y), Math.abs(f.normal.z))) / 2);
        f.point = nearest(pts, c).clone();
        f.markerPoints = pts;
      }
      // Highlight shells on the real meshes, and the points the camera frames
      f.highlights = f.highlight
        .filter((h) => vehicle.has(h.component))
        .map((h) => new ComponentHighlight(car, vehicle.meshes(h.component), { region: h.region }));
      const highlightPoints = f.highlight.flatMap(points);
      const framePts = f.view.frame === 'marker' ? f.markerPoints : highlightPoints;
      const fb = new THREE.Box3().setFromPoints(framePts).expandByScalar(f.view.pad ?? 0.2);
      f.frameBox = fb;
      f.focus = fb.getCenter(new THREE.Vector3());
      f.glow = 0;
      f.sweep = 1;
      f.vis = 0;
    }
    this.ready = true;
    this.section.classList.add('is-explorable');
    exp.onFrame(() => this.frame());
  }

  buildMarkers() {
    this.markers = this.features.map((f) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot';
      el.dataset.feature = f.id;
      el.tabIndex = -1; // the index in the copy is the keyboard route; markers are the pointer/touch route
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<i></i><span class="hotspot__label mono"><b>${f.n}</b>${f.title}</span>`;
      this.layer.appendChild(el);
      return { f, el, label: el.querySelector('.hotspot__label'), pos: { x: 0, y: 0 } };
    });
  }

  bindControls() {
    const open = (id) => (this.active === id ? this.close() : this.open(id));
    for (const m of this.markers) {
      m.el.addEventListener('click', (e) => {
        e.stopPropagation();
        open(m.f.id);
      });
      m.el.addEventListener('pointerenter', () => this.preview(m.f.id, true));
      m.el.addEventListener('pointerleave', () => this.preview(m.f.id, false));
    }
    for (const b of this.index.querySelectorAll('[data-feature]')) {
      b.addEventListener('click', () => open(b.dataset.feature));
      b.addEventListener('pointerenter', () => this.preview(b.dataset.feature, true));
      b.addEventListener('pointerleave', () => this.preview(b.dataset.feature, false));
      b.addEventListener('focus', () => this.preview(b.dataset.feature, true));
      b.addEventListener('blur', () => this.preview(b.dataset.feature, false));
    }
    this.panel.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
    this.panel.querySelector('[data-action="prev"]').addEventListener('click', () => this.step(-1));
    this.panel.querySelector('[data-action="next"]').addEventListener('click', () => this.step(1));

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'ArrowLeft') this.step(-1);
      else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key) && !e.target.closest?.('button')) {
        e.preventDefault();
        this.close();
      }
    });
    // Scrolling while a feature is open returns to the car (the page is held still meanwhile)
    const scrollIntent = () => this.active && this.mode === 'open' && this.k > 0.6 && this.close();
    window.addEventListener('wheel', scrollIntent, { passive: true });
    window.addEventListener('touchmove', scrollIntent, { passive: true });
    // A click or tap anywhere outside the panel, markers and index also returns
    window.addEventListener('pointerdown', (e) => {
      if (!this.active || this.mode !== 'open') return;
      if (e.target.closest('.design__panel, .hotspot, .design__index, .nav')) return;
      this.close();
    });
  }

  /** The chapter is (not) on screen; markers only exist while it is. */
  setInView(on) {
    this.inView = on;
    this.layer.classList.toggle('is-on', on && this.ready);
    if (!on && this.active) this.close({ immediate: true });
  }

  /* ----------------------------- states ------------------------------ */

  preview(id, on) {
    if (!this.ready || this.active) return;
    const f = this.byId.get(id);
    gsap.to(f, { glow: on ? 0.38 : 0, duration: on ? 0.35 : 0.5, overwrite: true });
    this.markers.find((m) => m.f.id === id)?.el.classList.toggle('is-hover', on);
    this.index.querySelector(`[data-feature="${id}"]`)?.classList.toggle('is-hover', on);
  }

  open(id) {
    if (!this.ready || !this.inView) return;
    const f = this.byId.get(id);
    const prev = this.active ? this.byId.get(this.active) : null;
    this.active = id;
    this.lenis.stop();
    this.exp.rigLambda = Infinity; // the tween below drives the camera exactly

    // Camera: from wherever it is now to the feature's view
    this.from = { ...this.exp.rig };
    this.mode = 'open';
    this.k = 0;
    gsap.killTweensOf(this, 'k');
    gsap.to(this, { k: 1, duration: this.reducedMotion ? 0 : prev ? 1.1 : 1.35, ease: 'power3.inOut' });

    // Light: this feature on (with one sweep of light across it), every other off
    for (const g of this.features) {
      if (g === f) continue;
      gsap.to(g, { glow: 0, duration: 0.4, overwrite: true });
    }
    gsap.fromTo(f, { glow: f.glow }, { glow: 1, duration: 0.6, delay: this.reducedMotion ? 0 : 0.5, overwrite: true });
    if (!this.reducedMotion) gsap.fromTo(f, { sweep: 0 }, { sweep: 1, duration: 1.1, delay: 0.75, ease: 'power1.inOut' });
    this.setDRL(!!f.drl);
    if (id === 'exhaust' && !this.reducedMotion) gsap.delayedCall(1.3, () => this.active === 'exhaust' && this.exp.exhaust.pulse(0.7));

    this.showPanel(f);
    this.section.classList.add('is-exploring');
    this.onChange(id);
  }

  close({ immediate = false } = {}) {
    if (!this.active) return;
    const f = this.byId.get(this.active);
    const opener = this.index.querySelector(`[data-feature="${this.active}"]`);
    this.active = null;
    gsap.to(f, { glow: 0, duration: 0.45, overwrite: true });
    this.setDRL(false);
    this.hidePanel();
    this.section.classList.remove('is-exploring');

    this.from = { ...this.exp.rig };
    this.mode = 'closing';
    this.k = 0;
    gsap.killTweensOf(this, 'k');
    const done = () => {
      this.mode = null;
      this.exp.rigLambda = 4.2;
      this.lenis.start();
    };
    if (immediate || this.reducedMotion) {
      this.k = 1;
      done();
    } else gsap.to(this, { k: 1, duration: 1.1, ease: 'power3.inOut', onComplete: done });
    // Keyboard users go back to where they came from
    // (next frame: the index is still `visibility: hidden` until the class change is applied)
    if (this.panel.contains(document.activeElement)) requestAnimationFrame(() => opener?.focus({ preventScroll: true }));
    this.onChange(null);
  }

  step(dir) {
    if (!this.active) return;
    const i = this.features.findIndex((f) => f.id === this.active);
    this.open(this.features[(i + dir + this.features.length) % this.features.length].id);
  }

  setDRL(on) {
    const drl = this.exp.lookdev?.drl;
    if (drl) gsap.to(drl, { emissiveIntensity: on ? 2.4 : 0.55, duration: 0.8, overwrite: true });
  }

  showPanel(f) {
    const p = this.panel;
    p.querySelector('[data-field="n"]').textContent = `${f.n} / ${String(this.features.length).padStart(2, '0')}`;
    p.querySelector('[data-field="title"]').textContent = f.title;
    p.querySelector('[data-field="text"]').textContent = f.text;
    p.querySelector('[data-field="note"]').textContent = f.note;
    p.hidden = false;
    requestAnimationFrame(() => p.classList.add('is-open'));
    this.index.querySelectorAll('[data-feature]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.feature === f.id)));
    // Move keyboard focus into the panel only when the panel was reached by keyboard
    if (this.index.contains(document.activeElement) || p.contains(document.activeElement)) p.querySelector('[data-field="title"]').focus({ preventScroll: true });
  }

  hidePanel() {
    this.panel.classList.remove('is-open');
    this.index.querySelectorAll('[data-feature]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => !this.active && (this.panel.hidden = true), 450);
  }

  /* ----------------------------- camera ------------------------------ */

  /** Layout of the open state: share of the frame for the subject, and where it sits. */
  layout() {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect >= 1) return { aspect, width: 0.44, height: 0.5, shift: 0.14, lift: 0 }; // panel bottom-left, subject right
    return { aspect, width: 0.84, height: 0.3, shift: 0, lift: 0.34 }; // panel as a bottom sheet, subject high
  }

  /** Experience rig that looks at a feature (car space → world via the chapter's car yaw). */
  rigFor(f, base) {
    const rot = base?.rot ?? 0;
    const r = rot * DEG;
    const L = this.layout();
    const { x, y, z } = f.focus;
    const view = { az: f.view.az + rot, el: f.view.el, fov: f.view.fov, tx: x * Math.cos(r) + z * Math.sin(r), ty: y, tz: -x * Math.sin(r) + z * Math.cos(r) };
    const points = [];
    const b = f.frameBox;
    for (const px of [b.min.x, b.max.x]) for (const py of [b.min.y, b.max.y]) for (const pz of [b.min.z, b.max.z]) points.push(new THREE.Vector3(px, py, pz));
    const dist = Math.max(0.9, fitDistance(view, { aspect: L.aspect, width: L.width, height: L.height, rot, points, pointsKey: `design:${f.id}` }));
    // On tall screens aim below the feature so it sits in the upper part of the frame, above the sheet
    const ty = view.ty - L.lift * dist * Math.tan((f.view.fov * DEG) / 2);
    return { az: view.az, el: f.view.el, dist, fov: f.view.fov, tx: view.tx, ty, tz: view.tz, rot, shift: L.shift, roll: 0, parallax: 0.15 };
  }

  /** Called by the frame loop with the chapter's rig; returns the rig to use. */
  apply(base) {
    this.base = base;
    if (!this.mode) return base;
    const to = this.mode === 'open' ? this.rigFor(this.byId.get(this.active), base) : base;
    return mixRig(this.from, to, this.k);
  }

  /* ---------------------------- overlays ----------------------------- */

  frame() {
    if (!this.ready) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    const fade = 1 - Math.exp(-12 * dt); // markers ease in/out over ~0.25 s, whatever the frame rate
    for (const f of this.features) {
      for (const h of f.highlights) {
        h.intensity = f.glow;
        h.sweep = f.sweep;
        h.update();
      }
    }
    if (!this.inView) return;

    const exp = this.exp;
    const cam = exp.camera;
    const car = exp.car;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Typography and controls that markers and labels must keep clear of
    // (in a detail view the headline and copy step aside, so only what stays on screen counts)
    const exclude = ['.design__head .eyebrow', '.nav', ...(this.active ? [] : ['.design__head .headline', '.design__foot'])]
      .map((s) => this.section.ownerDocument.querySelector(s))
      .filter((el) => el && el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect());
    if (!this.panel.hidden) exclude.push(this.panel.getBoundingClientRect());

    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const showLabels = !this.active && W >= 860 && matchMedia('(hover: hover)').matches;
    const labelled = [];
    for (const m of this.markers) {
      const f = m.f;
      v.copy(f.point).applyMatrix4(car.matrixWorld);
      n.copy(f.normal).transformDirection(car.matrixWorld);
      toCam.copy(cam.position).sub(v).normalize();
      // Facing the camera? A feature turned away is hidden by the car's own body. Markers are
      // either shown (and clickable) or not — never half-visible — with hysteresis against flicker.
      const dot = n.dot(toCam);
      f.facing = f.facing ? dot > 0.18 : dot > 0.25;
      const facing = f.facing ? 1 : 0;
      v.project(cam);
      const onScreen = v.z < 1 && Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.94;
      m.pos.x = (v.x * 0.5 + 0.5) * W;
      m.pos.y = (-v.y * 0.5 + 0.5) * H;
      const isActive = this.active === f.id;
      const others = this.active && !isActive;
      const clear = !insideAny(m.pos.x, m.pos.y, exclude);
      const target = onScreen && clear && !others && !(this.mode === 'closing' && this.k < 0.7) ? facing : 0;
      f.vis += (target - f.vis) * fade;
      const shown = f.vis > 0.05;
      m.el.style.opacity = f.vis.toFixed(3);
      m.el.style.pointerEvents = target > 0 && f.vis > 0.3 ? 'auto' : 'none';
      m.el.classList.toggle('is-active', isActive);
      m.el.classList.toggle('has-label', showLabels && shown);
      if (shown && showLabels) labelled.push(m);
      else m.el.style.transform = `translate3d(${m.pos.x.toFixed(1)}px, ${m.pos.y.toFixed(1)}px, 0)`;
    }
    if (labelled.length) layoutLabels(labelled, { exclude });
  }

  /** For tests: screen position, visibility and state of every marker. */
  debug() {
    return this.markers.map((m) => ({ id: m.f.id, x: Math.round(m.pos.x), y: Math.round(m.pos.y), vis: +m.f.vis.toFixed(2), glow: +m.f.glow.toFixed(2), clickable: m.el.style.pointerEvents === 'auto' }));
  }
}

/** Blend two Experience rigs; azimuth along the shorter way round, distance in log space. */
function mixRig(a, b, k) {
  // End exactly on b (not 360° away from it), so normal damping can take over without a spin
  if (k >= 1) return { ...b };
  const out = {};
  for (const key of RIG_KEYS) {
    const x = a[key] ?? (key === 'parallax' ? 1 : 0);
    const y = b[key] ?? (key === 'parallax' ? 1 : 0);
    if (key === 'az') out.az = x + ((((y - x) % 360) + 540) % 360 - 180) * k;
    else if (key === 'dist') out.dist = Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * k);
    else out[key] = x + (y - x) * k;
  }
  return out;
}
