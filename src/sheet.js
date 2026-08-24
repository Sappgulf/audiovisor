/**
 * Bottom-sheet drag-to-dismiss.
 *
 * On a phone the settings drawer is a bottom sheet, but the only way to
 * close it was the toggle button back up in the topbar — the one gesture
 * every native sheet supports did nothing. This adds the drag, and the
 * decision of whether a given drag should dismiss lives in a pure function
 * so the thresholds are testable.
 */

/** Past this far down, or this fast, a release dismisses rather than snaps back. */
export const DISMISS_DISTANCE = 96;      // px
export const DISMISS_VELOCITY = 0.5;     // px per ms

/**
 * @param {number} dy   total downward travel in px (negative = upward)
 * @param {number} dt   gesture duration in ms
 * @param {number} height sheet height, for the proportional fallback
 * @returns {boolean} true to dismiss, false to snap back
 */
export function shouldDismiss(dy, dt, height) {
  if (dy <= 0) return false;                       // dragged up, or not at all
  const velocity = dt > 0 ? dy / dt : 0;
  if (velocity >= DISMISS_VELOCITY) return true;   // a flick, however short
  if (dy >= DISMISS_DISTANCE) return true;
  // on a short sheet, past halfway counts even if under the fixed threshold
  return height > 0 && dy >= height / 2;
}

/**
 * How far the sheet should actually move for a given drag, with resistance
 * above the resting position so it feels attached rather than loose.
 */
export function dragOffset(dy) {
  return dy >= 0 ? dy : dy / 4;
}

/**
 * @param {HTMLElement} sheet
 * @param {{handle?:HTMLElement, onDismiss:()=>void, isOpen:()=>boolean,
 *          canDrag?:()=>boolean}} opts
 * @returns {() => void} unbind
 */
export function bindSheetDrag(sheet, opts) {
  if (!sheet) return () => {};
  const { handle = sheet, onDismiss, isOpen, canDrag = () => true } = opts;

  let id = null;
  let startY = 0;
  let startT = 0;
  let dy = 0;

  const setOffset = (px) => {
    sheet.style.transform = px ? `translateY(${px}px)` : '';
  };

  const down = (e) => {
    if (id !== null || !isOpen() || !canDrag()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId;
    startY = e.clientY;
    startT = e.timeStamp;
    dy = 0;
    sheet.style.transition = 'none';
    try { handle.setPointerCapture(e.pointerId); } catch { /* move still works */ }
  };

  const move = (e) => {
    if (id !== e.pointerId) return;
    dy = e.clientY - startY;
    setOffset(dragOffset(dy));
  };

  const up = (e) => {
    if (id !== e.pointerId) return;
    id = null;
    // pointerup carries its own position; browsers coalesce pointermove, so
    // the last move can lag well behind where the finger actually lifted
    if (Number.isFinite(e.clientY)) dy = e.clientY - startY;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    sheet.style.transition = '';
    setOffset(0);
    if (shouldDismiss(dy, e.timeStamp - startT, sheet.getBoundingClientRect().height)) {
      onDismiss();
    }
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
  };
}
