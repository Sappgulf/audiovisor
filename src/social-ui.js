// @ts-check
import * as Social from './social.js';
import { esc } from './utils.js';

/**
 * Social feed panel: a local, seeded list of looks with a like button and a
 * post box. Storage is the only backend; see src/social.js for the fallbacks.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createSocialFeed({ state, toast, doc = document }) {
  Social.seedFeed();

  function renderSocial() {
    const el = doc.getElementById('social-feed');
    if (!el) return;
    const feed = Social.getFeed();
    el.innerHTML = feed.slice(0, 8).map(e => `
    <div style="padding:8px 10px; background:var(--glass); border:1px solid var(--border-soft); border-radius:8px; display:flex; justify-content:space-between; align-items:center">
      <div style="min-width:0">
        <div style="font-size:11px; font-weight:600; color:var(--text)">${esc(e.title)}</div>
        <div style="font-size:10px; color:var(--text-40)">${esc(e.user)} · ${esc(e.mode)} · ${e.likes}♥</div>
      </div>
      <button class="ghost-btn" data-like="${e.id}" style="width:28px; height:28px; flex-shrink:0"><span class="ic ic-sm" data-icon="record"></span></button>
    </div>`).join('');
    el.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', () => { Social.likeFeed(b.dataset.like); renderSocial(); }));
  }

  doc.getElementById('social-post')?.addEventListener('click', () => {
    const inp = doc.getElementById('social-input');
    const title = inp?.value.trim();
    if (!title) return;
    Social.postToFeed({ title, mode: state.modeId, theme: state.themeId, fx: state.fx });
    if (inp) inp.value = '';
    renderSocial();
    toast('Posted to <b>feed</b>');
  });
  renderSocial();

  return { renderSocial };
}
