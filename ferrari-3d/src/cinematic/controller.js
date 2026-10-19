import gsap from 'gsap';
import { STATES, stateAt } from './timeline.js';

/**
 * The single owner of the Anatomy playhead q (see timeline.js).
 *
 * Two inputs, never active at the same time:
 *   scroll  q follows the section's scroll progress with a little damping
 *   manual  a state button: one tween plays the authored sequence from q to the
 *           state's anchor, at a deliberate speed, forward or in reverse
 *
 * The page is scrolled to the chosen state's anchor when the tween starts, so
 * when it ends scroll and playhead agree and control passes back to scroll with
 * no jump. Any scroll away from that anchor mid-tween releases it: the tween
 * stops where it is and q eases towards the new scroll position (interruption
 * recovery). Because poses are a pure function of q, nothing accumulates, however
 * often the sequence runs, in either direction.
 */
export class SequenceController {
  constructor({ lambda = 7, reducedMotion = false } = {}) {
    this.lambda = lambda;
    this.reducedMotion = reducedMotion;
    this.p = 0; // scroll progress (input)
    this.q = 0; // playhead (output)
    this.mode = 'scroll';
    this.snap = false;
    this.tween = null;
    this.target = null;
    this.listeners = new Set();
  }

  /** Scroll progress of the section, every frame. */
  setScroll(p) {
    this.p = p;
    if (this.mode === 'manual' && Math.abs(p - this.target.at) > 0.004) this.release();
  }

  /**
   * Play to a state. Returns the state's anchor (section progress) so the
   * caller can move the page there.
   */
  goTo(id) {
    const state = STATES.find((s) => s.id === id);
    if (!state) throw new Error(`[anatomy] unknown state "${id}"`);
    this.tween?.kill();
    this.mode = 'manual';
    this.target = state;
    const distance = Math.abs(state.at - this.q);
    // ~1 s between neighbouring states, never a crawl across the whole sequence
    const duration = this.reducedMotion ? 0 : Math.min(3.2, 0.7 + distance * 3.6);
    this.tween = gsap.to(this, {
      q: state.at,
      duration,
      ease: 'power2.inOut',
      onComplete: () => this.settle(),
    });
    if (!duration) this.settle();
    this.emit();
    return state.at;
  }

  /**
   * Put the playhead straight on a scroll position, cancelling any tween. Used
   * when the stage is re-entered (under the hand-over curtain), so a stale
   * playhead never replays the sequence on the way in.
   */
  jump(p) {
    this.tween?.kill();
    this.tween = null;
    this.target = null;
    this.mode = 'scroll';
    this.p = this.q = p;
    this.emit();
  }

  /** Jump to the end of a running state tween (skip). */
  finish() {
    if (this.mode === 'manual') this.tween.progress(1);
  }

  /** Stop a running tween where it is and hand control back to scroll. */
  release() {
    this.tween?.kill();
    this.tween = null;
    this.mode = 'scroll';
    this.target = null;
    this.emit();
  }

  settle() {
    if (!this.target) return;
    this.tween = null;
    this.q = this.target.at;
    this.mode = 'scroll';
    this.target = null;
    this.emit();
  }

  update(dt) {
    if (this.mode !== 'scroll') return;
    if (this.snap) this.q = this.p;
    else {
      this.q += (this.p - this.q) * (1 - Math.exp(-this.lambda * dt));
      if (Math.abs(this.p - this.q) < 1e-5) this.q = this.p;
    }
  }

  /** The state the playhead is in, or the one a button is playing to. */
  get state() {
    return this.target ?? stateAt(this.q);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }
}
