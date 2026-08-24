/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldDismiss, dragOffset, bindSheetDrag,
  DISMISS_DISTANCE, DISMISS_VELOCITY,
} from '../src/sheet.js';

const H = 500;

describe('shouldDismiss', () => {
  it('ignores an upward drag', () => {
    expect(shouldDismiss(-200, 100, H)).toBe(false);
    expect(shouldDismiss(0, 100, H)).toBe(false);
  });

  it('dismisses a short fast flick', () => {
    // 40px in 40ms = 1 px/ms, well over the velocity threshold
    expect(shouldDismiss(40, 40, H)).toBe(true);
  });

  it('keeps a short slow drag open', () => {
    expect(shouldDismiss(40, 2000, H)).toBe(false);
  });

  it('dismisses a slow drag that travels far enough', () => {
    expect(shouldDismiss(DISMISS_DISTANCE, 5000, H)).toBe(true);
    expect(shouldDismiss(DISMISS_DISTANCE - 1, 5000, H)).toBe(false);
  });

  it('uses halfway as the threshold on a sheet shorter than the fixed one', () => {
    const short = 100;
    expect(shouldDismiss(50, 5000, short)).toBe(true);
    expect(shouldDismiss(49, 5000, short)).toBe(false);
  });

  it('treats exactly the velocity threshold as a dismiss', () => {
    expect(shouldDismiss(DISMISS_VELOCITY * 100, 100, H)).toBe(true);
  });

  it('does not divide by a zero duration', () => {
    expect(() => shouldDismiss(10, 0, H)).not.toThrow();
    expect(shouldDismiss(10, 0, H)).toBe(false);
  });

  it('handles a zero-height sheet', () => {
    expect(shouldDismiss(10, 5000, 0)).toBe(false);
  });
});

describe('dragOffset', () => {
  it('follows the finger downward one to one', () => {
    expect(dragOffset(120)).toBe(120);
  });

  it('resists an upward drag so the sheet feels attached', () => {
    expect(dragOffset(-100)).toBe(-25);
  });

  it('is zero at rest', () => {
    expect(dragOffset(0)).toBe(0);
  });
});

describe('bindSheetDrag', () => {
  let sheet, handle, dismissed, open;

  const ptr = (type, { y = 0, t = 0, id = 1 } = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientY: y, pointerId: id, pointerType: 'touch', button: 0 });
    Object.defineProperty(e, 'timeStamp', { value: t });
    handle.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    sheet = document.createElement('div');
    handle = document.createElement('div');
    sheet.appendChild(handle);
    document.body.appendChild(sheet);
    sheet.getBoundingClientRect = () => ({ height: H, top: 0, left: 0, width: 375 });
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    dismissed = 0;
    open = true;
    bindSheetDrag(sheet, {
      handle,
      isOpen: () => open,
      onDismiss: () => { dismissed++; },
    });
  });

  it('moves the sheet with the finger and dismisses past the threshold', () => {
    ptr('pointerdown', { y: 0, t: 0 });
    ptr('pointermove', { y: 60, t: 50 });
    expect(sheet.style.transform).toBe('translateY(60px)');
    ptr('pointerup', { y: 200, t: 4000 });
    expect(dismissed).toBe(1);
    expect(sheet.style.transform).toBe('');
  });

  it('measures travel from pointerup, which browsers do not coalesce', () => {
    // a flick can deliver one lagging pointermove and then lift far below it
    ptr('pointerdown', { y: 0, t: 0 });
    ptr('pointermove', { y: 20, t: 30 });
    ptr('pointerup', { y: 300, t: 4000 });
    expect(dismissed).toBe(1);
  });

  it('snaps back without dismissing on a small slow drag', () => {
    ptr('pointerdown', { y: 0, t: 0 });
    ptr('pointermove', { y: 20, t: 1000 });
    ptr('pointerup', { y: 20, t: 3000 });
    expect(dismissed).toBe(0);
    expect(sheet.style.transform).toBe('');
  });

  it('does nothing while the sheet is closed', () => {
    open = false;
    ptr('pointerdown', { y: 0, t: 0 });
    ptr('pointermove', { y: 300, t: 100 });
    expect(sheet.style.transform).toBe('');
    ptr('pointerup', { y: 300, t: 200 });
    expect(dismissed).toBe(0);
  });

  it('restores the transition after a drag so the close animates', () => {
    ptr('pointerdown', { y: 0, t: 0 });
    expect(sheet.style.transition).toBe('none');
    ptr('pointerup', { y: 10, t: 100 });
    expect(sheet.style.transition).toBe('');
  });

  it('ignores a second finger mid-drag', () => {
    ptr('pointerdown', { y: 0, t: 0, id: 1 });
    ptr('pointermove', { y: 300, t: 50, id: 2 });
    expect(sheet.style.transform).toBe('');
  });

  it('settles without dismissing when the gesture is cancelled', () => {
    ptr('pointerdown', { y: 0, t: 0 });
    ptr('pointermove', { y: 30, t: 200 });
    ptr('pointercancel', { y: 30, t: 3000 });
    expect(dismissed).toBe(0);
    expect(sheet.style.transform).toBe('');
  });

  it('is a no-op for a missing sheet', () => {
    expect(() => bindSheetDrag(null, { onDismiss() {}, isOpen: () => true })()).not.toThrow();
  });
});
