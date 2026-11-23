// The native app ships this engine in its bundle. Keep the bridge narrow:
// only the trusted app origin can use it, and imported audio never leaves it.
export function installNativeBridge({ engine, setMode, loadFiles, playDemo, doc = document }) {
  const win = doc.defaultView;
  const handler = win?.webkit?.messageHandlers?.studio;
  if (!handler || win.location.protocol !== 'audiovisor-local:' || win.location.host !== 'app') return;
  doc.documentElement.classList.add('is-native');
  doc.getElementById('tab-look')?.click();
  const send = (type, extra = {}) => handler.postMessage({ type, ...extra });
  const state = () => send('state', { playing: !!engine.playing, title: engine.track?.name || '', hasTrack: !!engine.hasTrack });
  win.AudioVisorNative = Object.freeze({
    mode(id) { setMode(id); },
    async demo() { await playDemo(); },
    toggle() { engine.toggle(); },
    pause() { engine.pause(); },
    async open(tracks) {
      if (!Array.isArray(tracks) || !tracks.length || tracks.length > 30) throw new Error('Invalid track selection');
      const files = [];
      for (const track of tracks) {
        const url = new URL(track.url);
        if (url.protocol !== 'audiovisor-local:' || url.host !== 'app' || !/^\/imports\/[a-f0-9-]+\.[a-z0-9]+$/i.test(url.pathname)) throw new Error('Invalid import URL');
        const res = await win.fetch(url.href);
        if (!res.ok) throw new Error('Audio file is unavailable');
        files.push(new win.File([await res.blob()], String(track.name), { type: res.headers.get('Content-Type') || 'audio/mpeg' }));
      }
      if (engine.micActive) engine.disableMic();
      if (engine.playing) engine.pause();
      engine.clearQueue();
      await loadFiles(files);
      if (!engine.hasTrack) throw new Error('This audio format could not be decoded. Try MP3, M4A, WAV or FLAC.');
    },
  });
  const home = doc.createElement('button');
  home.className = 'native-home';
  home.type = 'button';
  home.textContent = '‹ Studio';
  home.setAttribute('aria-label', 'Return to studio');
  home.addEventListener('click', () => send('home'));
  doc.querySelector('.brand')?.replaceWith(home);
  // Use the native picker everywhere, including transport and queue actions.
  doc.addEventListener('click', (event) => {
    if (!event.target.closest('label[for="file-input"], #add-more-btn')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('import');
  }, true);
  doc.getElementById('file-input')?.addEventListener('click', (event) => {
    event.preventDefault();
    send('import');
  });
  engine.on('state', state);
  engine.on('source', state);
  const stage = doc.getElementById('stage');
  if (stage) new win.MutationObserver(() => send('look', { id: stage.dataset.mode })).observe(stage, { attributes: true, attributeFilter: ['data-mode'] });
  state();
  send('ready');
}
