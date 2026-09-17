// @ts-check
import { readJSON, writeJSON } from './storage.js';
import { esc } from './utils.js';

/**
 * Collab & share: the shareable look link, the party QR panel and the local
 * comment thread.
 *
 * The link and the party broadcast both encode the current mode/theme/FX,
 * and a `#share=` hash on load replays one. BroadcastChannel carries party
 * sync and comments between tabs on the same origin; everything is wrapped
 * because the API is absent in some privacy modes.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(id: string) => void} deps.setMode
 * @param {(id: string) => void} deps.setTheme
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {Document} [deps.doc]
 * @param {Location} [deps.location]
 */
export function createCollab({ state, toast, setMode, setTheme, setFx, doc = document, location = window.location }) {
  const COLLAB_KEY = 'audiovisor.collab';
  const COMMENTS_KEY = 'audiovisor.comments';

  doc.getElementById('share-btn')?.addEventListener('click', async () => {
    const data = btoa(JSON.stringify({ mode: state.modeId, theme: state.themeId, fx: state.fx }));
    const url = location.origin + location.pathname + '#share=' + data;
    try { await navigator.clipboard.writeText(url); toast('Link <b>copied</b>'); } catch { prompt('Copy link', url); }
    // store in local collab history
    const hist = readJSON(COLLAB_KEY, []);
    hist.unshift({ url, at: Date.now() });
    writeJSON(COLLAB_KEY, hist.slice(0, 20));
  });

  doc.getElementById('party-btn')?.addEventListener('click', () => {
    const qr = doc.getElementById('party-qr');
    const urlEl = doc.getElementById('qr-url');
    if (urlEl) urlEl.textContent = location.href;
    qr?.classList.toggle('is-hidden');
    toast('Party <b>QR</b> — others scan to join');
    // broadcast via BroadcastChannel for live sync
    try {
      const bc = new BroadcastChannel('audiovisor-party');
      bc.postMessage({ type: 'party', mode: state.modeId, theme: state.themeId });
    } catch {}
  });

  const commentInput = doc.getElementById('comment-input');
  const collabEl = doc.getElementById('collab-comments');

  function renderComments() {
    if (!collabEl) return;
    const list = readJSON(COMMENTS_KEY, []);
    collabEl.innerHTML = list.slice(-6).map(c => `<div style="font-size:11px; color:var(--text-60); padding:4px 6px; background:var(--glass); border-radius:6px"><b style="color:var(--accent)">${esc(c.user)}</b> ${esc(c.text)}</div>`).join('') || '<div style="font-size:10px; color:var(--text-20)">No comments yet</div>';
  }

  doc.getElementById('comment-send')?.addEventListener('click', () => {
    const text = commentInput?.value.trim();
    if (!text) return;
    const list = readJSON(COMMENTS_KEY, []);
    list.push({ user: 'You', text, at: Date.now() });
    writeJSON(COMMENTS_KEY, list);
    if (commentInput) commentInput.value = '';
    renderComments();
    toast('Comment <b>posted</b>');
    // broadcast
    try { new BroadcastChannel('audiovisor-party').postMessage({ type: 'comment', text }); } catch {}
  });
  renderComments();

  // party sync listener
  try {
    const bc = new BroadcastChannel('audiovisor-party');
    bc.onmessage = (e) => {
      if (e.data?.type === 'party') { setMode(e.data.mode); setTheme(e.data.theme); toast('Party <b>sync</b>'); }
      if (e.data?.type === 'comment') {
        const list = readJSON(COMMENTS_KEY, []);
        list.push({ user: 'Guest', text: e.data.text, at: Date.now() });
        writeJSON(COMMENTS_KEY, list);
        renderComments();
      }
    };
  } catch {}

  // handle share hash on load
  try {
    const h = location.hash;
    if (h.startsWith('#share=')) {
      const data = JSON.parse(atob(h.slice(7)));
      if (data.mode) setMode(data.mode);
      if (data.theme) setTheme(data.theme);
      if (data.fx) for (const [k, v] of Object.entries(data.fx)) setFx(k, v);
      toast('Shared <b>remix</b> loaded');
    }
  } catch {}

  return { renderComments };
}
