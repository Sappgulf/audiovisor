// @ts-check
/**
 * Lazy loader for the music-account connect panel.
 *
 * ConnectPanel pulls in the Spotify and Apple Music SDK clients, which a
 * guest playing local files never touches. Load it on demand: when the user
 * opens the Source tab, or immediately if we are returning from a provider
 * OAuth redirect and there is a code to exchange.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.onExternalTrack
 * @param {Document} [deps.doc]
 */
export function createConnectLoader({ engine, toast, onExternalTrack, doc = document }) {
  let connect = null;
  let load = null;

  function connectPending() {
    const q = new URLSearchParams((doc.defaultView || window).location.search);
    return q.has('code') || q.has('error');
  }

  function ensureConnect() {
    if (load) return load;
    load = import('./connect.js')
      .then(({ ConnectPanel }) => {
        connect = new ConnectPanel(doc.getElementById('connect-root'), {
          engine,
          toast,
          onExternalTrack: async () => { onExternalTrack(); },
        });
        return connect.boot().then(() => connect);
      })
      .catch((err) => {
        console.error('connect panel failed to load:', err);
        /* Only re-arm the retry if no panel was ever built. Clearing this
           unconditionally meant a failure *after* construction let a second
           ConnectPanel be created over the same root — two sets of engine
           subscribers, every toast fired twice. */
        if (!connect) load = null;
        toast('<b>Music accounts unavailable</b> — could not load the panel', { duration: 3600 });
        return null;
      });
    return load;
  }

  // an OAuth redirect carries a code that expires; exchange it without waiting
  // for the user to find the Source tab
  if (connectPending()) ensureConnect();

  return { ensureConnect, connectPending, getConnect: () => connect };
}
