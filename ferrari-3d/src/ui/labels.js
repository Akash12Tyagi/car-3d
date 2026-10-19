/**
 * Places DOM labels beside screen-space markers (right of the marker on the
 * left half of the screen, left of it on the right half) and resolves
 * collisions: where two labels would overlap, or a label would cover one of
 * the `exclude` rectangles (headlines, copy, panels), it is lifted clear on a
 * leader line. Lifts ease, so labels never jump as the camera drifts.
 *
 * Each item: { el, label, pos: { x, y } } — `el` is translated to the marker,
 * `label` is the element whose size is measured (it must be positioned from
 * `--lift` in CSS); width/height are cached on the item after the first frame.
 *
 * Returns nothing; writes transform, --lift and the `flip` class.
 */
export function layoutLabels(items, { exclude = [], minTop = 84, gap = 6, ease = 0.2 } = {}) {
  const placed = exclude.map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }));
  for (const c of [...items].sort((a, b) => b.pos.y - a.pos.y)) {
    if (!c.w) {
      c.w = c.label.offsetWidth;
      c.h = c.label.offsetHeight;
    }
    const flip = c.pos.x > window.innerWidth / 2;
    const x0 = flip ? c.pos.x - 14 - c.w : c.pos.x + 14;
    const x1 = x0 + c.w;
    let lift = 0;
    for (let guard = 0; guard < placed.length + 1; guard++) {
      const y1 = c.pos.y - 10 - lift;
      const hit = placed.find((r) => x0 < r.x1 && x1 > r.x0 && y1 - c.h < r.y1 + gap && y1 > r.y0 - gap);
      if (!hit) break;
      lift = c.pos.y - 10 - (hit.y0 - gap);
    }
    lift = Math.max(0, Math.min(lift, c.pos.y - 10 - c.h - minTop));
    placed.push({ x0, x1, y0: c.pos.y - 10 - lift - c.h, y1: c.pos.y - 10 - lift });
    c.lift = c.lift === undefined ? lift : c.lift + (lift - c.lift) * ease;
    c.el.style.transform = `translate3d(${c.pos.x.toFixed(1)}px, ${c.pos.y.toFixed(1)}px, 0)`;
    c.el.style.setProperty('--lift', `${c.lift.toFixed(1)}px`);
    c.el.classList.toggle('flip', flip);
  }
}

/** True if point (x, y) lies inside any of the rectangles (with a margin). */
export function insideAny(x, y, rects, margin = 12) {
  return rects.some((r) => x > r.left - margin && x < r.right + margin && y > r.top - margin && y < r.bottom + margin);
}
