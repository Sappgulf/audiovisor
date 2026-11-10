// @ts-check
/**
 * Crossfade between stage modes.
 *
 * A mode switch replaces whatever the live canvas is drawing, so the outgoing
 * frame is snapshotted into an overlay and faded out while the new mode
 * renders underneath. The overlay is a plain canvas driven by rAF instead of
 * a CSS transition: tests can step the fade deterministically, and rapid
 * switches can cancel the previous animation without waiting for transition
 * events.
 *
 * @param {object} deps
 * @param {Document} [deps.doc]
 * @param {() => HTMLElement | null} deps.getStage
 * @param {() => HTMLCanvasElement | null} deps.getCanvas
 * @returns {{
 *   capture: () => boolean,
 *   play: (duration?: number) => boolean,
 *   cancel: () => void,
 * }}
 */
export function createModeTransition({ doc = document, getStage, getCanvas }) {
  const DEFAULT_DURATION = 260;
  const OVERLAY_Z_INDEX = '9';

  /** @type {HTMLCanvasElement | null} */
  let overlay = null;
  let hasSnapshot = false;
  let animating = false;
  /** @type {number | ReturnType<typeof setTimeout> | null} */
  let frameHandle = null;
  let frameIsTimer = false;
  /** @type {number | null} */
  let animationStart = null;
  let animationDuration = 0;

  function now() {
    const win = doc.defaultView;
    if (win?.performance && typeof win.performance.now === 'function') return win.performance.now();
    return Date.now();
  }

  function requestFrame(callback) {
    const win = doc.defaultView;
    if (win && typeof win.requestAnimationFrame === 'function') {
      frameIsTimer = false;
      return win.requestAnimationFrame(callback);
    }
    if (typeof requestAnimationFrame === 'function') {
      frameIsTimer = false;
      return requestAnimationFrame(callback);
    }
    frameIsTimer = true;
    return setTimeout(() => callback(now()), 16);
  }

  function cancelFrame(handle) {
    if (frameIsTimer) {
      clearTimeout(handle);
      return;
    }
    const win = doc.defaultView;
    if (win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(/** @type {number} */ (handle));
    else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(/** @type {number} */ (handle));
    else clearTimeout(handle);
  }

  function stopAnimation() {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    frameIsTimer = false;
    animating = false;
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.style.visibility = 'hidden';
    overlay.style.opacity = '0';
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function finish() {
    stopAnimation();
    hasSnapshot = false;
    hideOverlay();
  }

  function animate(timestamp) {
    frameHandle = null;
    if (!animating || !overlay) return;
    const t = Number.isFinite(timestamp) ? timestamp : now();
    if (animationStart === null) animationStart = t;
    const progress = animationDuration > 0
      ? Math.min(1, Math.max(0, (t - animationStart) / animationDuration))
      : 1;
    overlay.style.opacity = String(1 - progress);
    if (progress >= 1) {
      finish();
      return;
    }
    frameHandle = requestFrame(animate);
  }

  function simpleRadius(stage, win) {
    let radius = stage.style ? stage.style.borderRadius : '';
    if (!radius && win && typeof win.getComputedStyle === 'function') {
      try {
        radius = win.getComputedStyle(stage).borderRadius || '';
      } catch {
        radius = '';
      }
    }
    radius = String(radius).trim();
    if (!radius || radius.includes('/')) return '';
    return radius.split(/\s+/).length === 1 ? radius : '';
  }

  function applyOverlayStyles(canvas, stage, win) {
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = OVERLAY_Z_INDEX;
    canvas.style.display = 'block';
    canvas.style.borderRadius = simpleRadius(stage, win) || 'inherit';
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = doc.createElement('canvas');
    overlay.className = 'mode-transition-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    return overlay;
  }

  function measure(stage, source) {
    let width;
    let height;
    try {
      const rect = stage.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    } catch {
      width = 0;
      height = 0;
    }
    if (!(width > 0 && height > 0)) {
      try {
        const rect = source.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
      } catch {
        width = 0;
        height = 0;
      }
    }
    if (!(width > 0 && height > 0)) {
      width = stage.clientWidth || source.clientWidth || source.width || 0;
      height = stage.clientHeight || source.clientHeight || source.height || 0;
    }
    return width > 0 && height > 0 ? { width, height } : null;
  }

  function capture() {
    stopAnimation();
    hideOverlay();
    hasSnapshot = false;

    const stage = getStage();
    const source = getCanvas();
    if (!stage || !source) return false;

    const size = measure(stage, source);
    if (!size) return false;

    const win = doc.defaultView;
    const ratioValue = win ? Number(win.devicePixelRatio) : 1;
    const ratio = Number.isFinite(ratioValue) && ratioValue > 0 ? ratioValue : 1;
    const width = Math.max(1, Math.round(size.width * ratio));
    const height = Math.max(1, Math.round(size.height * ratio));

    const canvas = ensureOverlay();
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    /** @type {CanvasRenderingContext2D | null} */
    let ctx;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return false;

    applyOverlayStyles(canvas, stage, win);
    canvas.style.visibility = 'hidden';
    canvas.style.opacity = '1';

    try {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
    } catch {
      return false;
    }

    if (canvas.parentNode !== stage) stage.appendChild(canvas);
    hasSnapshot = true;
    return true;
  }

  function play(duration = DEFAULT_DURATION) {
    if (!overlay || !hasSnapshot) return false;
    stopAnimation();

    const requested = Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_DURATION;
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
    if (requested === 0) {
      finish();
      return true;
    }

    animationDuration = requested;
    animationStart = null;
    animating = true;
    frameHandle = requestFrame(animate);
    return true;
  }

  function cancel() {
    finish();
  }

  return { capture, play, cancel };
}
