// @ts-check
/**
 * Overflow ("more") menu.
 *
 * Closes on outside click, Escape, and after any tool in it fires. The
 * "Add" item is exempt from the auto-close because the file picker opens
 * from its own handler.
 *
 * @param {object} deps
 * @param {Document} [deps.doc]
 */
export function createOverflowMenu({ doc = document } = {}) {
  const win = doc.defaultView || window;
  const moreMenu = doc.getElementById('more-menu');
  const moreBtn = doc.getElementById('more-btn');

  function closeMore() {
    moreMenu?.classList.add('is-hidden');
    moreBtn?.setAttribute('aria-expanded', 'false');
  }
  function toggleMore() {
    const open = moreMenu?.classList.toggle('is-hidden') === false;
    moreBtn?.setAttribute('aria-expanded', String(open));
  }

  moreBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleMore(); });
  doc.addEventListener('click', (e) => {
    if (!moreMenu || moreMenu.classList.contains('is-hidden')) return;
    if (e.target.closest('#more-menu') || e.target.closest('#more-btn')) return;
    closeMore();
  });
  win.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
  // every tool in the menu closes it after firing
  moreMenu?.querySelectorAll('.more-item').forEach((el) => {
    if (el.id !== 'add-more-btn') el.addEventListener('click', () => setTimeout(closeMore, 0));
  });

  return { closeMore, toggleMore };
}
