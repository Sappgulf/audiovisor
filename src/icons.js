const svg = (inner, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  play: svg('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />'),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>'),
  'skip-back': svg('<polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="5" y2="5"/>'),
  'skip-fwd': svg('<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>'),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  music2: svg('<path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" fill="currentColor" stroke="none"/>'),
  volume: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  shuffle: svg('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.5-.6-3.3-1.7l-.8-1.2"/><path d="m18 14 4 4-4 4"/>'),
  maximize: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  zap: svg('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="currentColor" stroke="none"/>'),
  activity: svg('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'),
  sparkles: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" fill="currentColor" stroke="none"/><path d="M20 3v4"/><path d="M22 5h-4"/>'),
  snowflake: svg('<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>'),
  'circle-dot': svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>'),
  bars: svg('<line x1="5" y1="20" x2="5" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="14"/>'),
  orbit: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/>'),
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/>'),
  mountain: svg('<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>'),
  cloud: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
  galaxy: svg('<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 12m-6.5 0a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0" stroke-dasharray="3 3"/><path d="M20.5 8a10 10 0 0 0-14-4.6"/><circle cx="20" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.5" cy="16.5" r="1.4" fill="currentColor" stroke="none"/>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m9 10 2.2 2.2L15.5 8"/>'),
  spotify: svg('<circle cx="12" cy="12" r="10"/><path d="M8.2 10.1c2.6-.8 5.3-.5 7.6.8"/><path d="M8.6 13c2.1-.6 4.3-.3 6.1.7"/><path d="M9 15.6c1.6-.4 3.2-.2 4.6.6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><line x1="12" y1="1.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22.5" y2="12"/>'),
  layers: svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="9" y1="18" x2="15" y2="18"/>'),
  building: svg('<rect x="4" y="8" width="7" height="13" rx="0.5"/><rect x="11" y="3" width="9" height="18" rx="0.5"/><line x1="14.5" y1="7" x2="14.5" y2="7.01"/><line x1="17.5" y1="7" x2="17.5" y2="7.01"/><line x1="14.5" y1="11" x2="14.5" y2="11.01"/><line x1="17.5" y1="11" x2="17.5" y2="11.01"/><line x1="14.5" y1="15" x2="14.5" y2="15.01"/><line x1="17.5" y1="15" x2="17.5" y2="15.01"/><path d="M3 21h19"/>'),
  camera: svg('<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  record: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>'),
  list: svg('<line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="0.8" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="0.8" fill="currentColor" stroke="none"/>'),
};

export function setIcon(el, name) {
  if (!el) return;
  el.innerHTML = ICONS[name] || '';
}
