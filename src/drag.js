/**
 * Pointer-driven drag tracks (seek bar, volume slider).
 *
 * These were bound to mousedown/mousemove/mouseup, which meant scrubbing
 * simply did not exist on a touch device: the events reach the element but
 * nothing was listening for touch or pointer input. Pointer Events cover
 * mouse, touch, and pen in one path, and setPointerCapture keeps the drag
 * alive when the finger slides off the track — which on a 40px-tall
 * control is most of the time.
 */

/** Where along a track a client x-coordinate falls, clamped to 0..1. */
export function ratioAt(clientX, rect) {
  if (!rect || !(rect.width > 0)) return 0;
  const r = (clientX - rect.left) / rect.width;
  if (Number.isNaN(r)) return 0;
  return r < 0 ? 0 : r > 1 ? 1 : r;   // ±Infinity clamps to the ends
}

/**
 * Step a 0..1 value by `step`, clamped, for keyboard control of a track.
 * @returns {number|null} null when the key is not an arrow/Home/End
 */
export function keyStep(key, value, step = 0.05) {
  const at = (v) => Math.max(0, Math.min(1, v));
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return at(value + step);
    case 'ArrowLeft': case 'ArrowDown': return at(value - step);
    case 'Home': return 0;
    case 'End': return 1;
    default: return null;
  }
}

/**
 * Bind a horizontal drag track.
 *
 * @param {HTMLElement} el
 * @param {(ratio:number, phase:'start'|'move'|'end') => void} onRatio
 * @returns {() => void} unbind
 */
export function bindDragTrack(el, onRatio) {
  if (!el) return () => {};
  let active = null;

  const emit = (e, phase) => onRatio(ratioAt(e.clientX, el.getBoundingClientRect()), phase);

  const down = (e) => {
    // ignore right/middle click, but never ignore touch (button is 0 there)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = e.pointerId;
    // keeps the drag attached to this element once the finger leaves it
    try { el.setPointerCapture(e.pointerId); } catch { /* not captured; move still works */ }
    e.preventDefault();
    emit(e, 'start');
  };
  const move = (e) => { if (active === e.pointerId) emit(e, 'move'); };
  const up = (e) => {
    if (active !== e.pointerId) return;
    active = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    emit(e, 'end');
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
