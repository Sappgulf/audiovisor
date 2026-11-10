/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createModeTransition } from '../src/mode-transition.js';

function makeStage(width = 800, height = 450) {
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.borderRadius = '24px';
  stage.getBoundingClientRect = () => ({ width, height });
  document.body.appendChild(stage);
  return stage;
}

describe('createModeTransition', () => {
  let originalGetContext;
  let originalRaf;
  let originalCancelRaf;
  let originalDpr;
  let ctx;
  let stage;
  let frames;
  let nextFrameId;

  beforeEach(() => {
    document.body.innerHTML = '';
    stage = makeStage();

    ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type) {
      return type === '2d' ? ctx : null;
    };

    frames = new Map();
    nextFrameId = 0;
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id) => {
      frames.delete(id);
    });

    originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
    vi.restoreAllMocks();
  });

  const pendingFrame = () => [...frames.keys()][0];
  const runFrame = (time) => {
    const id = pendingFrame();
    const callback = frames.get(id);
    frames.delete(id);
    callback(time);
  };

  it('captures the live canvas and fades the overlay out', () => {
    const source = document.createElement('canvas');
    const transition = createModeTransition({ getStage: () => stage, getCanvas: () => source });

    expect(transition.capture()).toBe(true);

    const overlay = stage.querySelector('.mode-transition-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.style.position).toBe('absolute');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.style.zIndex).toBe('9');
    expect(overlay.style.borderRadius).toBe('24px');
    expect(overlay.width).toBe(1600);
    expect(overlay.height).toBe(900);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1600, 900);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 1600, 900);
    expect(overlay.style.visibility).toBe('hidden');

    expect(transition.play(200)).toBe(true);
    expect(overlay.style.visibility).toBe('visible');
    expect(overlay.style.opacity).toBe('1');
    expect(frames.size).toBe(1);

    runFrame(0);
    expect(overlay.style.opacity).toBe('1');
    runFrame(100);
    expect(Number(overlay.style.opacity)).toBeCloseTo(0.5, 5);
    runFrame(200);
    expect(stage.querySelector('.mode-transition-overlay')).toBeNull();
  });

  it('replaces the snapshot and cancels the previous fade on rapid captures', () => {
    const first = document.createElement('canvas');
    const second = document.createElement('canvas');
    let source = first;
    const transition = createModeTransition({ getStage: () => stage, getCanvas: () => source });

    expect(transition.capture()).toBe(true);
    const overlay = stage.querySelector('.mode-transition-overlay');
    expect(transition.play(200)).toBe(true);
    runFrame(0);
    const inFlight = pendingFrame();
    expect(inFlight).toBeTruthy();

    source = second;
    expect(transition.capture()).toBe(true);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(inFlight);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(second, 0, 0, 1600, 900);
    expect(stage.querySelectorAll('.mode-transition-overlay')).toHaveLength(1);
    expect(stage.querySelector('.mode-transition-overlay')).toBe(overlay);
    expect(overlay.style.visibility).toBe('hidden');

    expect(transition.play(200)).toBe(true);
    runFrame(0);
    runFrame(200);
    expect(stage.querySelector('.mode-transition-overlay')).toBeNull();
  });

  it('cancel stops the animation and removes the overlay', () => {
    const source = document.createElement('canvas');
    const transition = createModeTransition({ getStage: () => stage, getCanvas: () => source });

    expect(transition.capture()).toBe(true);
    expect(transition.play(200)).toBe(true);
    runFrame(0);
    runFrame(100);
    const overlay = stage.querySelector('.mode-transition-overlay');
    expect(Number(overlay.style.opacity)).toBeCloseTo(0.5, 5);
    const inFlight = pendingFrame();

    transition.cancel();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(inFlight);
    expect(stage.querySelector('.mode-transition-overlay')).toBeNull();
    expect(frames.size).toBe(0);
    expect(transition.play()).toBe(false);
  });

  it('fails safely when no 2D context is available', () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const source = document.createElement('canvas');
    const transition = createModeTransition({ getStage: () => stage, getCanvas: () => source });

    expect(() => transition.capture()).not.toThrow();
    expect(transition.capture()).toBe(false);
    expect(stage.querySelector('.mode-transition-overlay')).toBeNull();
    expect(() => transition.play()).not.toThrow();
    expect(transition.play()).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('fails safely when drawImage throws', () => {
    ctx.drawImage.mockImplementation(() => {
      throw new Error('tainted canvas');
    });
    const source = document.createElement('canvas');
    const transition = createModeTransition({ getStage: () => stage, getCanvas: () => source });

    expect(() => transition.capture()).not.toThrow();
    expect(transition.capture()).toBe(false);
    expect(stage.querySelector('.mode-transition-overlay')).toBeNull();
    expect(transition.play()).toBe(false);
  });
});
