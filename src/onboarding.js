// @ts-check
import { writeText, readText } from './storage.js';

/**
 * First-run onboarding tour: four staggered toasts that introduce the core
 * shortcuts. Shown once (a flag is written on completion) and replayable
 * from the About panel.
 *
 * @param {object} deps
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {number} deps.modeCount
 * @param {number} deps.themeCount
 * @param {Document} [deps.doc]
 */
export function createOnboarding({ toast, modeCount, themeCount, doc = document }) {
  function runTour() {
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

  if (!readText('audiovisor.tour')) runTour();
  doc.getElementById('tour-replay')?.addEventListener('click', () => { toast('TOUR <b>restarted</b>'); runTour(); });

  return { runTour };
}
