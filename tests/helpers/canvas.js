/**
 * Shared stub 2D canvas for renderer tests.
 *
 * Lifted out of tests/visualizers.test.js so the stage suites and the
 * lazy-mode suite all drive the Renderer through exactly the same fake —
 * a divergent stub is a silent way for one suite to stop testing what it
 * thinks it tests.
 */
export function makeFakeCtx() {
  const grad = () => ({ addColorStop: () => {} });
  return {
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    setTransform: () => {},
    clip: () => {},
    rect: () => {},
    arc: () => {},
    ellipse: () => {},
    roundRect: () => {},
    createLinearGradient: grad,
    createRadialGradient: grad,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    lineWidth: 1,
    lineJoin: 'miter',
  };
}

export function makeFakeCanvas(w = 800, h = 600) {
  const ctx = makeFakeCtx();
  return {
    getContext: (type) => (type === '2d' ? ctx : null),
    getBoundingClientRect: () => ({ width: w, height: h }),
    width: w,
    height: h,
    _ctx: ctx,
    captureStream: undefined,
  };
}

export function ensureGlobals() {
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      createElement: (tag) => (tag === 'canvas' ? makeFakeCanvas(100, 100) : {}),
    };
  } else if (!globalThis.document.createElement) {
    globalThis.document.createElement = (tag) => (tag === 'canvas' ? makeFakeCanvas(100, 100) : {});
  } else {
    const orig = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag === 'canvas') return makeFakeCanvas(100, 100);
      try { return orig(tag); } catch { return {}; }
    };
  }
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
}
