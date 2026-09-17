// @ts-check
import { bindSheetDrag } from './sheet.js';

/**
 * Settings drawer.
 *
 * On phones the drawer is presented as a bottom sheet with a scrim and a
 * drag-to-dismiss handle; on wider layouts it is a side panel. Both share
 * one open flag in `state`, and the transport goes inert under the sheet so
 * it can't be tabbed into while the drawer covers it.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {Document} [deps.doc]
 */
export function createDrawer({ state, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  const win = doc.defaultView || window;
  const drawer = $('drawer');
  const sheetScrim = $('sheet-scrim');

  /** True while the drawer is presented as a bottom sheet rather than a panel. */
  const isSheet = () => win.matchMedia('(max-width: 640px)').matches;

  function syncDrawerA11y() {
    if (!state.drawerOpen && drawer.contains(doc.activeElement)) doc.activeElement.blur();
    $('nav-settings').setAttribute('aria-expanded', String(state.drawerOpen));
    $('drawer-toggle')?.setAttribute('aria-expanded', String(state.drawerOpen));
    drawer.setAttribute('aria-hidden', String(!state.drawerOpen));
    drawer.inert = !state.drawerOpen;
    $('shell').classList.toggle('drawer-open', state.drawerOpen);
    const transport = doc.querySelector('.transport');
    if (transport) transport.inert = state.drawerOpen && win.innerWidth <= 640;
  }

  function syncDrawer() {
    drawer.classList.toggle('is-closed', !state.drawerOpen);
    $('nav-settings').classList.toggle('is-active', state.drawerOpen);
    $('drawer-toggle')?.classList.toggle('is-on', state.drawerOpen);
    if (sheetScrim) {
      const show = state.drawerOpen && isSheet();
      sheetScrim.hidden = !show;
      // let the element exist for a frame before fading in, or the transition
      // has nothing to animate from
      if (show) requestAnimationFrame(() => sheetScrim.classList.add('is-visible'));
      else sheetScrim.classList.remove('is-visible');
    }
    syncDrawerA11y();
  }

  function setDrawerOpen(open) {
    if (state.drawerOpen === open) return;
    state.drawerOpen = open;
    syncDrawer();
  }
  function toggleDrawer() { setDrawerOpen(!state.drawerOpen); }

  $('nav-settings').addEventListener('click', toggleDrawer);
  $('drawer-toggle')?.addEventListener('click', toggleDrawer);
  // tapping the dimmed area behind a sheet closes it, as every sheet does
  sheetScrim?.addEventListener('click', () => setDrawerOpen(false));
  // drag the grabber down to dismiss
  bindSheetDrag(drawer, {
    handle: $('sheet-handle') || undefined,
    isOpen: () => state.drawerOpen && isSheet(),
    onDismiss: () => setDrawerOpen(false),
  });
  // a sheet dragged part-way and then rotated to a wide layout would keep a
  // stale inline transform
  win.addEventListener('resize', () => { if (!isSheet()) drawer.style.transform = ''; });
  syncDrawer();

  return { setDrawerOpen, toggleDrawer, syncDrawer, isSheet };
}
