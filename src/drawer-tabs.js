// @ts-check
import { readText, writeText } from './storage.js';

/**
 * Drawer tab strip.
 *
 * Owns the tab/panel pairing, the sliding ink indicator and the persisted
 * selection. Opening the Source tab is reported through `onSourceTab` so the
 * lazy ConnectPanel can be fetched by main.js without this module knowing
 * anything about music providers.
 */

const TAB_KEY = 'audiovisor.drawerTab';

/**
 * @param {object} [opts]
 * @param {() => void} [opts.onSourceTab]
 * @param {Document} [opts.doc]
 */
export function createDrawerTabs({ onSourceTab, doc = document } = {}) {
  const tabs = /** @type {HTMLElement[]} */ ([...doc.querySelectorAll('.drawer-tab')]);
  const panels = [...doc.querySelectorAll('.drawer-panel')];
  const ink = doc.getElementById('drawer-tab-ink');
  const scroll = doc.querySelector('.drawer-scroll');

  function moveInk(btn) {
    if (!ink || !btn) return;
    ink.style.width = `${btn.offsetWidth}px`;
    ink.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  function selectedTab() {
    return tabs.find((b) => b.getAttribute('aria-selected') === 'true');
  }

  function setDrawerTab(id, { persist = true } = {}) {
    const btn = tabs.find((b) => b.dataset.tab === id) || tabs[0];
    if (!btn) return;
    tabs.forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === btn.dataset.tab));
    if (btn.dataset.tab === 'source') onSourceTab?.();
    if (scroll) scroll.scrollTop = 0;
    moveInk(btn);
    if (persist) writeText(TAB_KEY, btn.dataset.tab);
  }

  tabs.forEach((btn, i) => {
    btn.addEventListener('click', () => setDrawerTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      setDrawerTab(next.dataset.tab);
    });
  });

  setDrawerTab(readText(TAB_KEY) || 'look', { persist: false });
  // ink position depends on layout/fonts — re-measure once settled and on resize
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  win?.addEventListener('load', () => moveInk(selectedTab()));
  win?.addEventListener('resize', () => moveInk(selectedTab()));

  return { setDrawerTab };
}
