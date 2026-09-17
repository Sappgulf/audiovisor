// @ts-check
/**
 * About / keyboard-shortcuts dialog.
 *
 * Builds the panel, wires its open/close affordances and traps focus while
 * it is open. The copy needs the live mode count, so it is injected rather
 * than baked into a template that would silently drift from src/themes.js.
 */

const HIDE_MS = 340;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.shell     container the panel is appended to
 * @param {HTMLElement} opts.trigger   the nav button that toggles it
 * @param {number} opts.modeCount
 * @param {number} opts.themeCount
 * @param {Document} [opts.doc]
 */
export function createAboutPanel({ shell, trigger, modeCount, themeCount, doc = document }) {
  const panel = doc.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'about-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-labelledby', 'about-title');
  panel.setAttribute('aria-describedby', 'about-description');
  panel.tabIndex = -1;
  panel.innerHTML = `
  <div class="about-card">
    <button class="about-close" type="button" aria-label="Close About">×</button>
    <h2 id="about-title">AUDIOVISOR</h2>
    <div class="about-tag mono">Real-time audio visualizer</div>
    <p id="about-description">Drop in a track, stream a URL, capture any app's audio or connect your
    Spotify account — ${modeCount} stage modes, ${themeCount} theme moods, a full
    FX chain and a beat tracker, all rendered live.</p>
    <div class="about-keys">
      <div class="about-key"><kbd>SPACE</kbd><span>Play / Pause</span></div>
      <div class="about-key"><kbd>← →</kbd><span>Seek 10s</span></div>
      <div class="about-key"><kbd>↑ ↓</kbd><span>Volume ±5%</span></div>
      <div class="about-key"><kbd>M</kbd><span>Cycle Mode</span></div>
      <div class="about-key"><kbd>T</kbd><span>Cycle Theme</span></div>
      <div class="about-key"><kbd>R</kbd><span>Random Look</span></div>
      <div class="about-key"><kbd>1-9</kbd><span>Jump Mode</span></div>
      <div class="about-key"><kbd>Q</kbd><span>Queue Manager</span></div>
      <div class="about-key"><kbd>P</kbd><span>Share card (PNG)</span></div>
      <div class="about-key"><kbd>C</kbd><span>Chop N Screw</span></div>
      <div class="about-key"><kbd>L</kbd><span>Library</span></div>
      <div class="about-key"><kbd>F</kbd><span>Fullscreen</span></div>
    </div>
  </div>`;
  shell.appendChild(panel);
  panel.hidden = true;
  panel.inert = true;

  const closeBtn = panel.querySelector('.about-close');
  let returnFocus = null;
  let hideTimer = null;

  const isOpen = () => panel.classList.contains('is-open');

  function setOpen(open) {
    clearTimeout(hideTimer);
    if (open) panel.hidden = false;
    panel.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.inert = false;
      panel.setAttribute('aria-hidden', 'false');
      returnFocus = doc.activeElement;
      requestAnimationFrame(() => closeBtn?.focus());
    } else {
      const restore = returnFocus;
      returnFocus = null;
      if (panel.contains(doc.activeElement)) doc.activeElement.blur();
      panel.inert = true;
      panel.setAttribute('aria-hidden', 'true');
      restore?.focus?.();
      hideTimer = setTimeout(() => {
        if (!panel.classList.contains('is-open')) panel.hidden = true;
      }, HIDE_MS);
    }
  }

  trigger.addEventListener('click', () => setOpen(!isOpen()));
  panel.addEventListener('click', (e) => { if (e.target === panel) setOpen(false); });
  closeBtn?.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return { panel, setOpen, isOpen };
}
