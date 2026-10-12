// @ts-check
/**
 * Playlist parsing: M3U / M3U8 and PLS, reduced to a list of stream links.
 *
 * A playlist is a list of places to fetch from, so only http(s) links survive;
 * javascript:, data: and file: entries are dropped. Relative links resolve
 * against baseUrl. A local playlist file has no base, so its relative links
 * are dropped rather than resolved against the app's own origin.
 *
 * Malformed input never throws. It yields [] or the entries that parsed.
 */

const MAX_ENTRIES = 500;
const MAX_NAME = 200;

/**
 * @param {string} text   playlist file contents
 * @param {string} [baseUrl]  where the playlist was served from, if known
 * @returns {{ name: string, url: string }[]}
 */
export function parsePlaylist(text, baseUrl) {
  return parsePlaylistInfo(text, baseUrl).entries;
}

/**
 * As parsePlaylist, and also the count of playable links before the limit,
 * so the caller can say how many were left out.
 * @returns {{ entries: { name: string, url: string }[], total: number }}
 */
export function parsePlaylistInfo(text, baseUrl) {
  try {
    let base;
    try { base = baseUrl ? new URL(baseUrl).href : undefined; } catch { base = undefined; }
    const lines = String(text ?? '').replace(/^\u{FEFF}/u, '').split(/\r?\n/).map((l) => l.trim());
    const first = lines.find((l) => l) || '';
    const raw = /^\[playlist\]$/i.test(first) ? parsePls(lines) : parseM3u(lines);
    /** @type {{ name: string, url: string }[]} */
    const entries = [];
    let total = 0;
    for (const item of raw) {
      const url = resolveHttp(item.url, base);
      if (!url) continue;
      total++;
      if (entries.length < MAX_ENTRIES) entries.push({ name: (item.name || nameFromUrl(url)).slice(0, MAX_NAME), url });
    }
    return { entries, total };
  } catch {
    return { entries: [], total: 0 };
  }
}

/** M3U: a #EXTINF line names the URL on the next non-comment line. */
function parseM3u(lines) {
  /** @type {{ name: string, url: string }[]} */
  const items = [];
  let title = '';
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      // #EXTINF:<seconds>,<title>. Only the first comma separates the title.
      const comma = line.indexOf(',');
      title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    items.push({ name: title, url: line });
    title = '';
  }
  return items;
}

/** PLS: FileN= and TitleN= pairs, grouped by N and kept in N order. */
function parsePls(lines) {
  /** @type {Map<number, { name: string, url: string }>} */
  const slots = new Map();
  for (const line of lines) {
    const m = /^(File|Title)(\d+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const n = Number(m[2]);
    const slot = slots.get(n) || { name: '', url: '' };
    if (m[1].toLowerCase() === 'file') slot.url = m[3];
    else slot.name = m[3];
    slots.set(n, slot);
  }
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s).filter((s) => s.url);
}

/** Absolute http(s) URL or '' for anything else, including unparseable input. */
function resolveHttp(raw, base) {
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Last path segment, for entries that carry no title. */
function nameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || url;
  } catch {
    return url;
  }
}
