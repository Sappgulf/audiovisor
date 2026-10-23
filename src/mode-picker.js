// @ts-check
import { setIcon } from './icons.js';
import { modeArt } from './mode-art.js';

export function modeAssetPath(id, animated = false) {
  // Public previews have a long HTTP cache. A new artwork revision must
  // change their URLs so returning listeners see the upgraded scenes.
  return `/modes/${id}${animated ? '-anim' : ''}.webp?v=8.24`;
}

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
    const image = art.image || modeAssetPath(m.id);
    const animation = art.animation || modeAssetPath(m.id, true);
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
    <img class="mode-thumb" src="${image}" alt="" aria-hidden="true"
           loading="lazy" decoding="async" width="176" height="108">
      <span class="mode-thumb-anim" aria-hidden="true"></span>
    </div>
    <span class="mode-name">${m.name}</span>`;
    const thumb = btn.querySelector('.mode-thumb');
    const anim = /** @type {HTMLElement | null} */ (btn.querySelector('.mode-thumb-anim'));
    thumb.addEventListener('load', () => btn.classList.add('has-thumb'));
    thumb.addEventListener('error', () => {
      /* drop the class too, or the card keeps hiding the fallback icon and
         renders an empty box where the thumbnail used to be */
      btn.classList.remove('has-thumb');
      thumb.remove();
    });
    const activateAnimation = () => {
      if (doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      if (anim && !btn.dataset.animLoaded) {
        anim.style.backgroundImage = `url("${animation}")`;
        btn.dataset.animLoaded = 'true';
      }
      btn.classList.add('is-anim');
    };
    const deactivateAnimation = () => btn.classList.remove('is-anim');
    btn.addEventListener('pointerenter', activateAnimation);
    btn.addEventListener('pointerleave', deactivateAnimation);
    btn.addEventListener('focus', activateAnimation);
    btn.addEventListener('blur', deactivateAnimation);
    btn.addEventListener('click', () => onPickMode(m.id));
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
    const focused = visibleCards.find((card) => card === doc.activeElement);
    visibleCards.forEach((card) => { card.tabIndex = -1; });
    const primary = focused || selected || visibleCards[0];
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
    const count = doc.getElementById('mode-count');
    if (count) count.textContent = q ? `${shown} / ${modeCatalog.length}` : `${modeCatalog.length} modes`;
    const cards = getModeFilterCards();
    if (!cards.length) modeFilterIndex = -1;
    else if (modeFilterIndex < 0 || modeFilterIndex >= cards.length) modeFilterIndex = cards.findIndex((c) => c.dataset.modeId === getModeId());
    if (modeFilterIndex < 0) modeFilterIndex = 0;
    syncModeFilterTabStops(cards);
    return cards;
  }

  function focusChoice(elements, index) {
    elements.forEach((el, i) => { el.tabIndex = i === index ? 0 : -1; });
    elements[index].focus({ preventScroll: true });
    elements[index].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function focusModeAt(cards, index) {
    if (!cards.length) return;
    modeFilterIndex = (index + cards.length) % cards.length;
    focusChoice(cards, modeFilterIndex);
  }
  function focusModeFilterCard(step) {
    focusModeAt(getModeFilterCards(), step ? modeFilterIndex + step : 0);
  }

  // Match the rendered rows, including filtered grids and wrapped swatches.
  function navigateGrid(e, elements, focus) {
    if (!elements.length || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const current = Math.max(0, elements.indexOf(doc.activeElement));
    const row = elements.findIndex((el) => el.offsetTop > elements[0].offsetTop);
    const cols = row > 0 ? row : Math.min(3, elements.length);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? elements.length - 1
      : (current + (e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : e.key === 'ArrowRight' ? 1 : -1) + elements.length) % elements.length;
    focus(elements, next);
  }

  function setActiveMode(id) {
    [...modeList.children].forEach((el) => {
      const c = /** @type {HTMLElement} */ (el);
      const on = c.dataset.modeId === id;
      setToggle(c, on, 'is-active');
    });
    syncModeFilterTabStops();
  }

  function setActiveTheme(id) {
    [...themeRow.children].forEach((el) => {
      const dot = /** @type {HTMLElement} */ (el);
      setToggle(dot, dot.dataset.theme === id, 'is-active');
      dot.tabIndex = dot.dataset.theme === id ? 0 : -1;
    });
    const current = doc.getElementById('theme-current');
    if (current) current.textContent = id === 'auto' ? 'From artwork' : themes.find((theme) => theme.id === id)?.name || '';
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
  modeList?.addEventListener('keydown', (e) => navigateGrid(e, getModeFilterCards(), focusModeAt));
  themeRow?.addEventListener('keydown', (e) => navigateGrid(e, [...themeRow.children], focusChoice));
  setActiveTheme(getThemeId());

  /** Add a card for a mode registered after boot (plugin API). */
  function addMode(m) {
    buildCard(m);
    applyModeFilter();
  }

  return { modeCatalog, setActiveMode, setActiveTheme, getModeFilterCards, applyModeFilter, focusModeFilterCard, syncModeFilterTabStops, addMode };
}
