import { describe, it, expect } from 'vitest';
import { parsePlaylist, parsePlaylistInfo } from '../src/playlist.js';

describe('parsePlaylist (M3U)', () => {
  it('takes names from #EXTINF and urls from the lines that follow', () => {
    const text = '#EXTM3U\n#EXTINF:215,Night Circuit - Drive\nhttps://cdn.example.test/drive.mp3\n\n#EXTINF:-1,Second, with comma\nhttps://cdn.example.test/two.mp3\n';
    expect(parsePlaylist(text)).toEqual([
      { name: 'Night Circuit - Drive', url: 'https://cdn.example.test/drive.mp3' },
      { name: 'Second, with comma', url: 'https://cdn.example.test/two.mp3' },
    ]);
  });

  it('ignores blank lines and comment lines, and tolerates CRLF', () => {
    const text = '#EXTM3U\r\n\r\n# a plain comment\r\n#EXTVLCOPT:network-caching=1000\r\nhttps://x.test/a.mp3\r\n';
    expect(parsePlaylist(text)).toEqual([{ name: 'a.mp3', url: 'https://x.test/a.mp3' }]);
  });

  it('resolves relative links against the playlist location', () => {
    const text = '#EXTM3U\nsongs/one.mp3\n../two.m4a\n';
    expect(parsePlaylist(text, 'https://host.test/lists/main.m3u8')).toEqual([
      { name: 'one.mp3', url: 'https://host.test/lists/songs/one.mp3' },
      { name: 'two.m4a', url: 'https://host.test/two.m4a' },
    ]);
  });

  it('drops relative links when there is no base, as for a local playlist file', () => {
    expect(parsePlaylist('#EXTM3U\nsong.mp3\nhttps://x.test/ok.mp3\n')).toEqual([
      { name: 'ok.mp3', url: 'https://x.test/ok.mp3' },
    ]);
  });

  it('keeps an absolute link even when the base is not a usable URL', () => {
    expect(parsePlaylist('https://x.test/ok.mp3', 'not a url')).toEqual([{ name: 'ok.mp3', url: 'https://x.test/ok.mp3' }]);
  });

  it('accepts a leading byte-order mark', () => {
    expect(parsePlaylist('\uFEFF#EXTM3U\nhttps://x.test/a.mp3')).toHaveLength(1);
  });
});

describe('parsePlaylist (PLS)', () => {
  it('pairs FileN with TitleN and orders by N', () => {
    const text = '[playlist]\nNumberOfEntries=2\nFile2=https://x.test/second.mp3\nTitle2=Second\nFile1=https://x.test/first.mp3\nTitle1=First\nVersion=2\n';
    expect(parsePlaylist(text)).toEqual([
      { name: 'First', url: 'https://x.test/first.mp3' },
      { name: 'Second', url: 'https://x.test/second.mp3' },
    ]);
  });

  it('names an entry from its URL when it has no title', () => {
    expect(parsePlaylist('[playlist]\nFile1=https://x.test/my%20song.ogg\n')).toEqual([
      { name: 'my song.ogg', url: 'https://x.test/my%20song.ogg' },
    ]);
  });

  it('skips a File line with no value', () => {
    expect(parsePlaylist('[playlist]\nFile1=\nTitle1=Empty\nFile2=https://x.test/b.mp3\n')).toEqual([
      { name: 'b.mp3', url: 'https://x.test/b.mp3' },
    ]);
  });
});

describe('parsePlaylist safety', () => {
  it('drops javascript:, data:, file: and other non-web links', () => {
    const text = [
      '#EXTM3U',
      'javascript:alert(1)',
      'data:audio/mp3;base64,AAAA',
      'file:///Users/me/secret.mp3',
      'ftp://x.test/a.mp3',
      'C:\\Music\\a.mp3',
      'https://x.test/good.mp3',
    ].join('\n');
    expect(parsePlaylist(text)).toEqual([{ name: 'good.mp3', url: 'https://x.test/good.mp3' }]);
  });

  it('drops javascript: links even when a base is given', () => {
    expect(parsePlaylist('javascript:alert(1)\n', 'https://host.test/')).toEqual([]);
  });

  it('caps the result at 500 entries', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 700; i++) lines.push(`https://x.test/${i}.mp3`);
    const out = parsePlaylist(lines.join('\n'));
    expect(out).toHaveLength(500);
    expect(out[499].url).toBe('https://x.test/499.mp3');
  });

  it('reports how many playable links were past the limit', () => {
    // a 600-line playlist keeps its first 500 and says that 100 were left out
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 600; i++) lines.push(`#EXTINF:-1,Track ${i}`, `https://x.test/${i}.mp3`);
    const { entries, total } = parsePlaylistInfo(lines.join('\n'));
    expect(entries).toHaveLength(500);
    expect(total).toBe(600);
    expect(entries[0].name).toBe('Track 0');
  });

  it('counts only playable links in the total', () => {
    const text = '#EXTM3U\nfile:///etc/passwd\nhttps://ok.test/a.mp3\njavascript:x\nhttps://ok.test/b.mp3\n';
    expect(parsePlaylistInfo(text)).toEqual({
      entries: [
        { name: 'a.mp3', url: 'https://ok.test/a.mp3' },
        { name: 'b.mp3', url: 'https://ok.test/b.mp3' },
      ],
      total: 2,
    });
  });

  it('limits the length of a title', () => {
    const name = 'x'.repeat(1000);
    expect(parsePlaylist(`#EXTINF:1,${name}\nhttps://x.test/a.mp3`)[0].name).toHaveLength(200);
  });

  it('returns an empty list for malformed or non-string input, and never throws', () => {
    expect(parsePlaylist('')).toEqual([]);
    expect(parsePlaylist(undefined)).toEqual([]);
    expect(parsePlaylist(null)).toEqual([]);
    expect(parsePlaylist('#EXTINF:\n[playlist]\nFile=\u0000\u0000')).toEqual([]);
    expect(parsePlaylist({ toString() { throw new Error('boom'); } })).toEqual([]);
    expect(parsePlaylist('just some words\nand more words')).toEqual([]);
  });
});
