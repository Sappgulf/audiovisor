/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ratioAt, keyStep, bindDragTrack } from '../src/drag.js';

const RECT = { left: 100, width: 200 };

describe('ratioAt', () => {
  it('maps a point inside the track to 0..1', () => {
    expect(ratioAt(100, RECT)).toBe(0);
    expect(ratioAt(200, RECT)).toBe(0.5);
    expect(ratioAt(300, RECT)).toBe(1);
  });

  it('clamps a drag that leaves the track on either side', () => {
    expect(ratioAt(-500, RECT)).toBe(0);
    expect(ratioAt(9999, RECT)).toBe(1);
  });

  it('returns 0 for a zero-width or missing rect instead of NaN', () => {
    expect(ratioAt(50, { left: 0, width: 0 })).toBe(0);
    expect(ratioAt(50, null)).toBe(0);
  });

  it('returns 0 for a non-finite coordinate', () => {
    expect(ratioAt(NaN, RECT)).toBe(0);
    expect(ratioAt(Infinity, RECT)).toBe(1);
  });
});

describe('keyStep', () => {
  it('steps up and down and clamps at the ends', () => {
    expect(keyStep('ArrowRight', 0.5)).toBeCloseTo(0.55);
    expect(keyStep('ArrowLeft', 0.5)).toBeCloseTo(0.45);
    expect(keyStep('ArrowUp', 0.98)).toBe(1);
    expect(keyStep('ArrowDown', 0.02)).toBe(0);
  });

  it('jumps to the ends with Home and End', () => {
    expect(keyStep('Home', 0.7)).toBe(0);
    expect(keyStep('End', 0.2)).toBe(1);
  });

  it('honours a custom step', () => {
    expect(keyStep('ArrowRight', 0.5, 0.02)).toBeCloseTo(0.52);
  });

  it('returns null for keys it does not handle, so they still bubble', () => {
    for (const k of ['a', 'Enter', 'Tab', ' ', 'Escape']) {
      expect(keyStep(k, 0.5)).toBeNull();
    }
  });
});

describe('bindDragTrack', () => {
  let el, seen, captured;

  const pointer = (type, { x = 150, id = 1, pointerType = 'touch', button = 0 } = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, pointerId: id, pointerType, button });
    el.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 16 });
    captured = [];
    el.setPointerCapture = (id) => captured.push(id);
    el.releasePointerCapture = (id) => { captured = captured.filter((c) => c !== id); };
    seen = [];
    bindDragTrack(el, (ratio, phase) => seen.push([Number(ratio.toFixed(3)), phase]));
  });

  it('drives a full touch drag — the gesture that did nothing before', () => {
    pointer('pointerdown', { x: 100 });
    pointer('pointermove', { x: 200 });
    pointer('pointermove', { x: 260 });
    pointer('pointerup', { x: 260 });
    expect(seen).toEqual([[0, 'start'], [0.5, 'move'], [0.8, 'move'], [0.8, 'end']]);
  });

  it('captures the pointer so the drag survives leaving the track', () => {
    pointer('pointerdown');
    expect(captured).toEqual([1]);
    pointer('pointermove', { x: 5000 });
    expect(seen.at(-1)).toEqual([1, 'move']);
    pointer('pointerup', { x: 5000 });
    expect(captured).toEqual([]);
  });

  it('ignores moves that belong to a different finger', () => {
    pointer('pointerdown', { id: 1, x: 150 });
    seen.length = 0;
    pointer('pointermove', { id: 2, x: 300 });
    expect(seen).toEqual([]);
  });

  it('ignores a right-click but not a touch with button 0', () => {
    pointer('pointerdown', { pointerType: 'mouse', button: 2 });
    expect(seen).toEqual([]);
    pointer('pointerdown', { pointerType: 'touch', button: 0 });
    expect(seen).toEqual([[0.25, 'start']]);
  });

  it('treats pointercancel as an end, so an interrupted drag settles', () => {
    pointer('pointerdown', { x: 200 });
    pointer('pointercancel', { x: 200 });
    expect(seen.at(-1)).toEqual([0.5, 'end']);
    // and a later stray move is ignored
    seen.length = 0;
    pointer('pointermove', { x: 300 });
    expect(seen).toEqual([]);
  });

  it('preventDefaults the pointerdown so the page does not also scroll', () => {
    const e = pointer('pointerdown');
    expect(e.defaultPrevented).toBe(true);
  });

  it('survives an element that refuses pointer capture', () => {
    el.setPointerCapture = () => { throw new Error('NotSupportedError'); };
    expect(() => pointer('pointerdown')).not.toThrow();
    pointer('pointermove', { x: 250 });
    expect(seen.at(-1)).toEqual([0.75, 'move']);
  });

  it('unbinds cleanly', () => {
    const el2 = document.createElement('div');
    el2.getBoundingClientRect = () => ({ left: 0, width: 100 });
    el2.setPointerCapture = () => {};
    const hits = [];
    const off = bindDragTrack(el2, () => hits.push(1));
    off();
    const e = new window.Event('pointerdown', { bubbles: true });
    Object.assign(e, { clientX: 50, pointerId: 1, pointerType: 'touch', button: 0 });
    el2.dispatchEvent(e);
    expect(hits).toEqual([]);
  });

  it('is a no-op for a missing element', () => {
    expect(() => bindDragTrack(null, () => {})()).not.toThrow();
  });
});
