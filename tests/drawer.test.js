/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createDrawer } from '../src/drawer.js';

/* jsdom has no layout and no matchMedia, so the sheet breakpoint is a flag. */
let sheetWidth = true;

function setup({ sheet = true } = {}) {
  sheetWidth = sheet;
  window.matchMedia = (q) => ({ matches: sheetWidth && q.includes('640px'), addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = (fn) => { fn(); return 0; };
  /* same nesting as index.html: the drawer is a child of .workspace */
  document.body.innerHTML = `
    <div id="shell">
      <header class="topbar"><button id="nav-settings" aria-expanded="false"></button><button id="drawer-toggle"></button></header>
      <div class="workspace">
        <main class="stage"><button id="stage-btn"></button></main>
        <div class="sheet-scrim" id="sheet-scrim" hidden></div>
        <aside class="drawer is-closed" id="drawer" inert>
          <div id="sheet-handle"></div>
          <button id="drawer-close"></button>
          <input id="filter" />
        </aside>
      </div>
      <footer class="transport" id="transport"><button id="play"></button></footer>
    </div>`;
  const state = { drawerOpen: false };
  const drawer = createDrawer({ state, doc: document });
  return { state, drawer };
}

const escape = (target = document.body) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

describe('settings drawer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('closes on Escape and hands focus back to the control that opened it', () => {
    const { state, drawer } = setup();
    const nav = document.getElementById('nav-settings');
    nav.focus();
    drawer.setDrawerOpen(true);
    document.getElementById('filter').focus();
    escape(document.getElementById('filter'));
    // the field keeps its own Escape, so the drawer stays open
    expect(state.drawerOpen).toBe(true);
    escape(document.body);
    expect(state.drawerOpen).toBe(false);
    expect(document.activeElement).toBe(nav);
  });

  it('leaves Escape alone while another dialog is open', () => {
    const { state, drawer } = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-hidden', 'false');
    document.body.appendChild(dialog);
    drawer.setDrawerOpen(true);
    escape(document.body);
    expect(state.drawerOpen).toBe(true);
  });

  it('makes the topbar and stage inert behind a phone sheet until it closes', () => {
    const { drawer } = setup({ sheet: true });
    drawer.setDrawerOpen(true);
    for (const sel of ['.topbar', '.stage']) {
      expect(document.querySelector(sel).inert, sel).toBe(true);
    }
    drawer.setDrawerOpen(false);
    for (const sel of ['.topbar', '.stage']) {
      expect(document.querySelector(sel).inert, sel).toBe(false);
    }
  });

  it('keeps the open sheet and the transport reachable', () => {
    // an inert ancestor disables everything under it, so the sheet must have
    // no inert ancestor of its own, and the transport must stay live
    const { drawer } = setup({ sheet: true });
    drawer.setDrawerOpen(true);
    const sheet = document.getElementById('drawer');
    expect(sheet.parentElement.closest('[inert]')).toBeNull();
    expect(sheet.inert).toBeFalsy();
    expect(document.querySelector('.workspace').inert).toBeFalsy();
    expect(document.getElementById('transport').inert).toBeFalsy();
  });

  it('does not make the page inert for the wide side panel', () => {
    const { drawer } = setup({ sheet: false });
    drawer.setDrawerOpen(true);
    expect(document.querySelector('.stage').inert).toBeFalsy();
    expect(document.querySelector('.transport').inert).toBeFalsy();
  });

  it('publishes the transport height for the sheet offset', () => {
    setup({ sheet: true });
    // jsdom has no layout, so offsetHeight is 0; the margin still comes through
    expect(document.documentElement.style.getPropertyValue('--tp-h')).toMatch(/^\d+(\.\d+)?px$/);
  });

  it('shows the scrim when the sheet opens', () => {
    const { drawer } = setup({ sheet: true });
    const scrim = document.getElementById('sheet-scrim');
    drawer.setDrawerOpen(true);
    expect(scrim.hidden).toBe(false);
    drawer.setDrawerOpen(false);
    expect(scrim.hidden).toBe(true);
  });
});
