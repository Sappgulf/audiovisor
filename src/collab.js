// @ts-check
import { readJSON, writeJSON } from './storage.js';
import { esc } from './utils.js';
import { loadCustomTheme } from './custom-theme.js';

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
 * @param {(colors: string[], opts?: object) => void} [deps.setCustomTheme]
 * @param {Document} [deps.doc]
 * @param {Location} [deps.location]
 */
export function createCollab({ state, toast, setMode, setTheme, setFx, setCustomTheme = () => {}, doc = document, location = window.location }) {
  const COLLAB_KEY = 'audiovisor.collab';
  const COMMENTS_KEY = 'audiovisor.comments';

  function lookUrl() {
    const custom = state.themeId === 'custom' ? loadCustomTheme()?.colors : undefined;
    const data = btoa(JSON.stringify({ mode: state.modeId, theme: state.themeId, fx: state.fx, custom }));
    return location.origin + location.pathname + '#share=' + data;
  }

  async function copyLookLink() {
    const url = lookUrl();
    try { await navigator.clipboard.writeText(url); toast('Link <b>copied</b>'); }
    catch { prompt('Copy link', url); }
    const hist = readJSON(COLLAB_KEY, []);
    hist.unshift({ url, at: Date.now() });
    writeJSON(COLLAB_KEY, hist.slice(0, 20));
    return url;
  }

  doc.getElementById('share-btn')?.addEventListener('click', () => { void copyLookLink(); });

  doc.getElementById('party-btn')?.addEventListener('click', async () => {
    const panel = doc.getElementById('party-qr');
    if (!panel) return;
    const opening = panel.classList.contains('is-hidden');
    panel.classList.toggle('is-hidden', !opening);
    if (!opening) return;

    const url = lookUrl();
    const urlEl = doc.getElementById('qr-url');
    if (urlEl) urlEl.textContent = url;
    const target = doc.getElementById('party-qr-code');
    if (target) target.innerHTML = '<span class="mono party-qr-loading">Rendering QR…</span>';
    try {
      const { default: qrcode } = await import('qrcode-generator');
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      if (target) target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      toast('Party <b>QR</b> — scan to open this look');
    } catch {
      if (target) target.innerHTML = '<span class="mono party-qr-loading">QR unavailable — copy the link below</span>';
    }
    /* Same-browser tabs still sync live over BroadcastChannel; the QR carries
       the look itself, which works across devices without a backend. */
    try {
      const bc = new BroadcastChannel('audiovisor-party');
      bc.postMessage({ type: 'party', mode: state.modeId, theme: state.themeId });
    } catch {}
  });

  doc.getElementById('party-copy')?.addEventListener('click', () => { void copyLookLink(); });

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
      if (Array.isArray(data.custom) && data.custom.length) setCustomTheme(data.custom);
      if (data.mode) setMode(data.mode);
      if (data.theme) setTheme(data.theme);
      if (data.fx) for (const [k, v] of Object.entries(data.fx)) setFx(k, v);
      toast('Shared <b>remix</b> loaded');
    }
  } catch {}

  return { renderComments };
}
