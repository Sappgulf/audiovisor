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
  let returnFocus = null;
  let scrimHideTimer = 0;

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
      clearTimeout(scrimHideTimer);
      if (show) {
        sheetScrim.hidden = false;
        // let the element exist for a frame before fading in, or the
        // transition has nothing to animate from
        requestAnimationFrame(() => {
          if (state.drawerOpen && isSheet()) sheetScrim.classList.add('is-visible');
        });
      } else {
        sheetScrim.classList.remove('is-visible');
        if (isSheet()) {
          // fade the scrim out with the sheet; a wide-layout resize hides it
          // immediately, because there is no phone sheet left to cover
          scrimHideTimer = win.setTimeout(() => {
            if (!sheetScrim.classList.contains('is-visible')) sheetScrim.hidden = true;
          }, 280);
        } else {
          sheetScrim.hidden = true;
        }
      }
    }
    syncDrawerA11y();
  }

  function setDrawerOpen(open) {
    if (state.drawerOpen === open) return;
    if (open && doc.activeElement instanceof HTMLElement) returnFocus = doc.activeElement;
    state.drawerOpen = open;
    syncDrawer();
    if (open && isSheet()) {
      // A phone sheet covers the page, so keyboard focus belongs in it. Give
      // an explicit focus target in the same frame a chance to win first
      // (stage-context opens Look and focuses its filter).
      const trigger = returnFocus;
      win.requestAnimationFrame(() => {
        if (!state.drawerOpen || !isSheet()) return;
        const active = doc.activeElement;
        if (active && drawer.contains(active)) return;
        if (active && active !== trigger && active !== doc.body) return;
        const selected = drawer.querySelector('.drawer-tab[aria-selected="true"]');
        (selected || $('drawer-close'))?.focus?.();
      });
    }
    if (!open) {
      const restore = returnFocus;
      const restoreFocus = () => {
        if (restore?.isConnected && !restore.hasAttribute('disabled')) restore.focus();
      };
      if (win.requestAnimationFrame) win.requestAnimationFrame(restoreFocus);
      else restoreFocus();
    }
  }
  function toggleDrawer() { setDrawerOpen(!state.drawerOpen); }

  $('nav-settings').addEventListener('click', toggleDrawer);
  $('drawer-toggle')?.addEventListener('click', toggleDrawer);
  $('drawer-close')?.addEventListener('click', () => setDrawerOpen(false));
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
  win.addEventListener('resize', () => {
    if (!isSheet()) drawer.style.transform = '';
    syncDrawer();
  });
  // Escape closes the sheet even when the close button is out of reach.
  // Other transient surfaces (palette, shortcuts, About, queue, library) get
  // the first Escape so this never closes two layers at once.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !state.drawerOpen) return;
    if (doc.getElementById('about-panel')?.classList.contains('is-open')) return;
    const palette = doc.getElementById('cmd-palette');
    if (palette && !palette.classList.contains('is-hidden')) return;
    const shortcuts = doc.getElementById('shortcuts-overlay');
    if (shortcuts && !shortcuts.classList.contains('is-hidden')) return;
    const queue = doc.querySelector('.queue-panel');
    if (queue && !queue.classList.contains('is-hidden')) return;
    const library = doc.querySelector('.library-panel');
    if (library && !library.classList.contains('is-hidden')) return;
    if (!isSheet() && !drawer.contains(doc.activeElement)) return;
    // Let a populated search field consume the first Escape to clear itself;
    // the next one closes the drawer.
    const active = doc.activeElement;
    if (active instanceof win.HTMLInputElement && active.type === 'search' && active.value) return;
    e.preventDefault();
    setDrawerOpen(false);
  });
  syncDrawer();

  return { setDrawerOpen, toggleDrawer, syncDrawer, isSheet };
}
