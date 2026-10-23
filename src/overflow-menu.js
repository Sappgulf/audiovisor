// @ts-check
/** The transport's tools share one focus path for mouse, touch and keyboard. */
export function createOverflowMenu({ doc = document } = {}) {
  const moreMenu = doc.getElementById('more-menu');
  const moreBtn = doc.getElementById('more-btn');
  const isOpen = () => moreMenu && !moreMenu.classList.contains('is-hidden');
  const items = () => /** @type {HTMLButtonElement[]} */ ([...moreMenu.querySelectorAll('button:enabled')]);

  function closeMore(restoreFocus = moreMenu?.contains(doc.activeElement)) {
    if (!isOpen()) return;
    moreMenu.classList.add('is-hidden');
    moreBtn?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) moreBtn?.focus({ preventScroll: true });
  }
  function openMore(last = false) {
    moreMenu?.classList.remove('is-hidden');
    moreBtn?.setAttribute('aria-expanded', 'true');
    const actions = items();
    actions.at(last ? -1 : 0)?.focus();
  }
  function toggleMore() {
    if (isOpen()) closeMore(); else openMore();
  }

  moreBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
  moreBtn?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); e.stopPropagation();
    openMore(e.key === 'ArrowUp');
  });
  moreMenu?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape' || e.shiftKey) e.preventDefault();
      closeMore(true); return;
    }
    const actions = items();
    if (!actions.length) return;
    const index = actions.indexOf(/** @type {HTMLButtonElement} */ (doc.activeElement));
    let next = -1;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = actions.length - 1;
    else if (e.key === 'ArrowDown') next = (index + 1) % actions.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + actions.length) % actions.length;

    if (next >= 0) {
      e.preventDefault(); actions[next]?.focus();
    }
  });
  moreMenu?.addEventListener('focusout', () => queueMicrotask(() => {
    if (!moreMenu.contains(doc.activeElement) && doc.activeElement !== moreBtn) closeMore(false);
  }));
  doc.addEventListener('click', (e) => {
    if (!isOpen() || e.target.closest('#more-menu, #more-btn')) return;
    closeMore(false);
  });
  moreMenu?.querySelectorAll('.more-item').forEach((el) => {
    el.tabIndex = -1;
    if (el.id !== 'add-more-btn') el.addEventListener('click', () => setTimeout(closeMore, 0));
  });

  return { closeMore, toggleMore };
}
