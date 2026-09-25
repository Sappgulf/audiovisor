// @ts-check
import { MODES, THEMES } from './themes.js';

/**
 * Global keyboard shortcuts.
 *
 * One keydown listener drives transport, look switching, panels and the
 * escape-to-close chain. It defers to text fields and the mode picker so
 * typing and arrow-key navigation inside those never trigger a shortcut.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(v: number) => void} deps.setVolumeUI
 * @param {() => void} deps.transportToggle
 * @param {(id: string) => void} deps.setMode
 * @param {(id: string) => void} deps.setTheme
 * @param {() => void} deps.randomizeLook
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.snapshot
 * @param {any} deps.panels
 * @param {{ isOpen: () => boolean, setOpen: (v: boolean) => void }} deps.about
 * @param {(name: string) => HTMLElement | undefined} deps.getFxEl
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {() => string} deps.getModeId
 * @param {() => string} deps.getThemeId
 * @param {(el: EventTarget | null) => boolean} deps.isTypingTarget
 * @param {Document} [deps.doc]
 */
export function createKeyboardShortcuts({
  engine, setVolumeUI, transportToggle, setMode, setTheme, randomizeLook, toast,
  snapshot, panels, about, getFxEl, setFx, getModeId, getThemeId, isTypingTarget, doc = document,
}) {
  const $ = (id) => doc.getElementById(id);

  function isModePickerTarget(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.id === 'mode-filter') return true;
    return Boolean(el.closest?.('#mode-list'));
  }

  (doc.defaultView || window).addEventListener('keydown', (e) => {
    /* Escape closes panels even from a text field: the library focuses its
       search box on open, so with the typing guard first Escape could never
       close it — and every shortcut after that was swallowed by the focused
       input too. Leaving the field is part of closing the panel. */
    if (e.code === 'Escape' && (panels.isQueueOpen() || panels.isLibraryOpen() || about.isOpen())) {
      if (isTypingTarget(e.target) && e.target instanceof HTMLElement) e.target.blur();
      if (panels.isQueueOpen()) panels.toggleQueue(false);
      if (panels.isLibraryOpen()) panels.toggleLibrary(false);
      if (about.isOpen()) about.setOpen(false);
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (isModePickerTarget(e.target) || isModePickerTarget(doc.activeElement)) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        transportToggle();
        break;
      case 'ArrowLeft':
        engine.skip(e.shiftKey ? -3 : -10);
        break;
      case 'ArrowRight':
        engine.skip(e.shiftKey ? 3 : 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolumeUI(engine.volume + 0.05);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolumeUI(engine.volume - 0.05);
        break;
      case 'KeyM': {
        const i = (MODES.findIndex((m) => m.id === getModeId()) + 1) % MODES.length;
        setMode(MODES[i].id);
        break;
      }
      case 'KeyT': {
        const i = (THEMES.findIndex((t) => t.id === getThemeId()) + 1) % THEMES.length;
        setTheme(THEMES[i].id);
        break;
      }
      case 'KeyR':
        randomizeLook();
        toast('LOOK <b>RANDOMIZED</b>', { duration: 1200 });
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
        const idx = Number(e.code.slice(5)) - 1;
        if (MODES[idx]) setMode(MODES[idx].id);
        break;
      }
      case 'KeyP':
        snapshot();
        break;
      case 'KeyQ':
        panels.toggleQueue();
        break;
      case 'KeyF':
        $('fullscreen-btn').click();
        break;
      case 'KeyL':
        panels.toggleLibrary();
        break;
      case 'KeyC': {
        const btn = getFxEl('chop');
        if (btn) btn.click();
        else { const on = !engine.fx.chop; setFx('chop', on); toast(`FX <b>CHOP</b> ${on ? 'engaged — screwed' : 'bypassed'}`, { duration: 1400 }); }
        break;
      }
      case 'Escape': {
        if (panels.isQueueOpen()) panels.toggleQueue(false);
        if (panels.isLibraryOpen()) panels.toggleLibrary(false);
        if (about.isOpen()) about.setOpen(false);
        break;
      }
    }
  });
}
