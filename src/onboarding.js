// @ts-check
import { writeText, readText } from './storage.js';

/**
 * First-run desktop tour: four staggered toasts introduce the core shortcuts.
 * Touch screens use the visible audio card instead, with a short manual hint
 * available from the About panel. The desktop tour is replayable there too.
 *
 * @param {object} deps
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {number} deps.modeCount
 * @param {number} deps.themeCount
 * @param {Document} [deps.doc]
 */
export function createOnboarding({ toast, modeCount, themeCount, doc = document }) {
  const coarsePointer = doc.defaultView?.matchMedia?.('(pointer: coarse)')?.matches ?? false;

  function runTour() {
    if (coarsePointer) {
      toast('Tap <b>Browse files</b> or <b>Explore modes</b> to begin', { duration: 3000 });
      return;
    }
    /** @type {Array<[string, number]>} */
    const steps = [
      ['Drop <b>audio</b> or press <b>Space</b> to begin', 800],
      [`<b>M</b> cycles ${modeCount} modes · <b>T</b> cycles ${themeCount} themes`, 3800],
      ['<b>C</b> Chop N Screwed · <b>L</b> Library · <b>F</b> Cinema', 6800],
      ['<b>R</b> random look · right-click P1-P3 to save looks', 9800],
    ];
    steps.forEach(([msg, at]) => setTimeout(() => toast(msg, { duration: 3000 }), at));
    writeText('audiovisor.tour', '1');
  }

  // The first-run card already explains the touch actions, and the shortcut
  // toasts would cover it on a phone. Keep the desktop tour available later.
  if (!coarsePointer && !readText('audiovisor.tour')) runTour();
  doc.getElementById('tour-replay')?.addEventListener('click', () => {
    if (!coarsePointer) toast('TOUR <b>restarted</b>');
    runTour();
  });

  return { runTour };
}
