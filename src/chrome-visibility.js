// @ts-check

/**
 * Keep the stage unobstructed while audio plays. Cinema hides both bars;
 * ordinary playback only hides the transport. One timer owns both states so
 * leaving fullscreen, pausing, and switching sources cannot strand controls.
 *
 * @param {{engine: any, shell: HTMLElement, transport: HTMLElement, doc: Document}} deps
 */
export function createChromeVisibility({ engine, shell, transport, doc }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const reducedMotion = () => !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canAutoHide = () => engine.playing && engine.activeInput !== 'none' && !reducedMotion();

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function hide() {
    timer = null;
    if (reducedMotion() || shell.classList.contains('drawer-open')) return;
    if (transport.contains(doc.activeElement)) return;
    if (doc.defaultView?.matchMedia?.('(hover: hover)').matches && transport.matches(':hover')) return;
    if (shell.classList.contains('is-cinema')) shell.classList.add('is-chrome-hidden');
    else if (canAutoHide()) shell.classList.add('is-transport-hidden');
  }

  function reveal() {
    shell.classList.remove('is-chrome-hidden', 'is-transport-hidden');
    clearTimer();
    if (reducedMotion()) return;
    const cinema = shell.classList.contains('is-cinema');
    if (cinema || canAutoHide()) timer = setTimeout(hide, cinema ? 2200 : 3200);
  }

  function refresh() {
    shell.classList.toggle('is-auto-transport', !!canAutoHide());
    reveal();
  }

  shell.addEventListener('pointermove', reveal);
  shell.addEventListener('pointerdown', reveal);
  transport.addEventListener('pointerleave', reveal);
  doc.addEventListener('focusin', reveal);
  doc.addEventListener('keydown', reveal);
  engine.on('state', refresh);
  engine.on('source', refresh);
  refresh();

  return { refresh };
}
