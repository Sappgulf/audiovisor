// @ts-check
import { setIcon } from './icons.js';
import { modeArt } from './mode-art.js';

/**
 * Mode cards, theme swatches and the mode filter.
 *
 * The card list and the filter share one index and one set of focus rules,
 * so they belong to the same owner. The picker reports a choice through
 * `onPickMode`/`onPickTheme` rather than applying it, which keeps renderer
 * and persistence knowledge in main.js.
 *
 * @param {object} deps
 * @param {Array<{id: string, name: string, icon: string}>} deps.modes
 * @param {Array<{id: string, name: string, css: string}>} deps.themes
 * @param {() => string} deps.getModeId
 * @param {() => string} deps.getThemeId
 * @param {(id: string) => void} deps.onPickMode
 * @param {(id: string) => void} deps.onPickTheme
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {Document} [deps.doc]
 */
export function createModePicker({
  modes, themes, getModeId, getThemeId, onPickMode, onPickTheme, setToggle, doc = document,
}) {
  const modeList = doc.getElementById('mode-list');
  const modeCatalog = [];
  let modeFilterIndex = -1;

  function buildCard(m) {
    const btn = doc.createElement('button');
    const art = modeArt(m.id);
    const searchText = `${m.name} ${m.id} ${art.chapter} ${art.title} ${art.story}`.toLowerCase();
    const active = m.id === getModeId();
    btn.className = 'mode-card' + (active ? ' is-active' : '');
    btn.setAttribute('aria-label', `${m.name} mode`);
    btn.setAttribute('aria-pressed', String(active));
    btn.dataset.modeId = m.id;
    btn.dataset.story = art.story;
    btn.title = `${m.name} — ${art.story}`;
    /* The tile shows the mode. Every card used to carry a small line icon and
       nothing else, so the picker was 22 near-identical rectangles for a
       decision that is entirely visual — and two of the icons were reused
       across different modes. The icon stays underneath as the fallback: if
       the thumbnail is missing or fails to decode, the card looks exactly as
       it did before rather than showing a broken image. */
    btn.innerHTML = `
    <div class="mode-preview">
      <span class="ic" data-icon="${m.icon}"></span>
    <img class="mode-thumb" src="${art.image}" alt="" aria-hidden="true"
           loading="lazy" decoding="async" width="176" height="108">
    </div>
    <span class="mode-name">${m.name}</span>`;
    const thumb = btn.querySelector('.mode-thumb');
    thumb.addEventListener('load', () => btn.classList.add('has-thumb'));
    thumb.addEventListener('error', () => {
      /* drop the class too, or the card keeps hiding the fallback icon and
         renders an empty box where the thumbnail used to be */
      btn.classList.remove('has-thumb');
      thumb.remove();
    });
    btn.addEventListener('click', () => onPickMode(m.id));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation();
      const cards = getModeFilterCards();
      if (!cards.length) return;
      if (e.key === 'Home') {
        modeFilterIndex = 0;
        cards[0]?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'End') {
        modeFilterIndex = cards.length - 1;
        cards[modeFilterIndex]?.focus({ preventScroll: true });
        return;
      }
      focusModeFilterCard(e.key === 'ArrowDown' ? 1 : -1);
    });
    modeCatalog.push({ id: m.id, searchText, button: btn });
    modeList.appendChild(btn);
    setIcon(btn.querySelector('.ic'), m.icon);
    return btn;
  }

  modes.forEach(buildCard);

  const themeRow = doc.getElementById('theme-row');
  /* Auto leads the row: its palette comes from the current track's cover art
     (or, for artless local files, deterministically from the track name), so
     the swatch is a spectrum rather than any one colour. */
  const autoDot = doc.createElement('button');
  autoDot.className = 'theme-dot theme-dot-auto';
  autoDot.dataset.theme = 'auto';
  autoDot.title = 'Auto — from album art';
  autoDot.setAttribute('aria-label', 'Auto theme from album art');
  autoDot.setAttribute('aria-pressed', String(getThemeId() === 'auto'));
  autoDot.style.background = 'conic-gradient(from 210deg, #ff2bd6, #ff8a00, #ccff00, #00f0ff, #7b2bff, #ff2bd6)';
  autoDot.addEventListener('click', () => onPickTheme('auto'));
  themeRow.appendChild(autoDot);
  themes.forEach((t) => {
    const btn = doc.createElement('button');
    const active = t.id === getThemeId();
    btn.className = 'theme-dot' + (active ? ' is-active' : '');
    btn.dataset.theme = t.id;
    btn.style.background = t.css;
    btn.title = t.name;
    btn.setAttribute('aria-label', t.name);
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', () => onPickTheme(t.id));
    themeRow.appendChild(btn);
  });

  const modeFilter = doc.getElementById('mode-filter');
  const modeEmpty = doc.getElementById('mode-empty');

  function getModeFilterCards() {
    return modeCatalog.filter((entry) => !entry.button.classList.contains('is-filtered')).map((entry) => entry.button);
  }

  function syncModeFilterTabStops(cards) {
    const visibleCards = cards || getModeFilterCards();
    const selected = visibleCards.find((card) => card.dataset.modeId === getModeId());
    visibleCards.forEach((card) => { card.tabIndex = -1; });
    const primary = selected || visibleCards[0];
    if (primary) primary.tabIndex = 0;
    if (selected) {
      const idx = visibleCards.indexOf(selected);
      if (modeFilterIndex < 0 || modeFilterIndex >= visibleCards.length) {
        modeFilterIndex = idx >= 0 ? idx : (visibleCards.length ? 0 : -1);
      }
    }
  }

  function applyModeFilter() {
    if (!modeFilter) return [];
    const q = modeFilter.value.trim().toLowerCase();
    let shown = 0;
    modeCatalog.forEach((entry) => {
      const hit = !q || entry.searchText.includes(q);
      entry.button.classList.toggle('is-filtered', !hit);
      if (hit) shown++;
    });
    modeEmpty?.classList.toggle('is-hidden', shown > 0);
    const cards = getModeFilterCards();
    if (!cards.length) modeFilterIndex = -1;
    else if (modeFilterIndex < 0 || modeFilterIndex >= cards.length) modeFilterIndex = cards.findIndex((c) => c.dataset.modeId === getModeId());
    if (modeFilterIndex < 0) modeFilterIndex = 0;
    syncModeFilterTabStops(cards);
    return cards;
  }

  function focusModeFilterCard(step) {
    const cards = applyModeFilter();
    if (!cards.length) return;
    if (step > 0) {
      modeFilterIndex = (modeFilterIndex + 1) % cards.length;
    } else if (step < 0) {
      modeFilterIndex = (modeFilterIndex - 1 + cards.length) % cards.length;
    } else {
      modeFilterIndex = 0;
    }
    cards[modeFilterIndex]?.focus({ preventScroll: true });
  }

  function setActiveMode(id) {
    [...modeList.children].forEach((el) => {
      const c = /** @type {HTMLElement} */ (el);
      const on = c.dataset.modeId === id;
      setToggle(c, on, 'is-active');
      c.setAttribute('aria-pressed', String(on));
    });
    syncModeFilterTabStops();
  }

  function setActiveTheme(id) {
    [...themeRow.children].forEach((el) => setToggle(/** @type {HTMLElement} */ (el), el.dataset.theme === id, 'is-active'));
  }

  modeFilter?.addEventListener('input', () => {
    applyModeFilter();
    modeFilterIndex = -1;
  });
  modeFilter?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { modeFilter.value = ''; modeFilter.dispatchEvent(new Event('input')); modeFilter.blur(); return; }
    if (e.key === 'Enter') {
      const cards = getModeFilterCards();
      if (!cards.length) return;
      let idx = modeFilterIndex;
      if (idx < 0 || idx >= cards.length) {
        idx = cards.findIndex((c) => c.dataset.modeId === getModeId());
      }
      if (idx < 0) idx = 0;
      const target = cards[idx] || cards[0];
      if (target) target.click();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (modeFilterIndex < 0) modeFilterIndex = e.key === 'ArrowDown' ? -1 : 0;
      focusModeFilterCard(e.key === 'ArrowDown' ? 1 : -1);
    }
  });
  modeList?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return;
    const cards = getModeFilterCards();
    if (!cards.length) return;
    e.preventDefault();
    if (e.key === 'Home') modeFilterIndex = 0;
    else if (e.key === 'End') modeFilterIndex = cards.length - 1;
    else if (e.key === 'ArrowDown') focusModeFilterCard(1);
    else if (e.key === 'ArrowUp') focusModeFilterCard(-1);
    if (modeFilterIndex >= 0 && modeFilterIndex < cards.length) cards[modeFilterIndex]?.focus({ preventScroll: true });
  });

  /** Add a card for a mode registered after boot (plugin API). */
  function addMode(m) {
    buildCard(m);
    applyModeFilter();
  }

  return { modeCatalog, setActiveMode, setActiveTheme, getModeFilterCards, applyModeFilter, focusModeFilterCard, syncModeFilterTabStops, addMode };
}
