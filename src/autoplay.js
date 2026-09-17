// @ts-check
/**
 * Autoplay-policy safety net.
 *
 * Browsers only let an AudioContext run off a user gesture. If the gesture
 * that loaded the file doesn't carry (Safari is strict about this, and a
 * file-picker selection isn't always enough), the engine reports playing
 * while nothing is audible. Detect that and resume on the next interaction
 * instead of leaving the user with a silent stage.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.refreshStatus
 * @param {Document} [deps.doc]
 */
export function createAutoplayGuard({ engine, toast, refreshStatus, doc = document }) {
  const win = doc.defaultView || window;
  let armed = false;

  function ensureAudible() {
    const ctx = engine.ctx;
    if (!ctx || ctx.state !== 'suspended' || armed) return;
    armed = true;
    toast('Tap anywhere to <b>start audio</b>', { duration: 5000 });
    const kick = () => {
      ctx.resume().then(() => {
        armed = false;
        if (!engine.playing) engine.play();
        refreshStatus();
      }).catch(() => {});
      win.removeEventListener('pointerdown', kick, true);
      win.removeEventListener('keydown', kick, true);
    };
    win.addEventListener('pointerdown', kick, true);
    win.addEventListener('keydown', kick, true);
  }

  return { ensureAudible };
}
