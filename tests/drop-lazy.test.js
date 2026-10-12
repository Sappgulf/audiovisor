/**
 * The folder walk lives in drop-folder.js and must be fetched only for a dropped
 * folder. The factory counts module loads and wraps the real walker, so the folder
 * case still runs the real code.
 */
import { describe, it, expect, vi } from 'vitest';

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/drop-folder.js', async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

const { collectDroppedFiles } = await import('../src/drop.js');

function fileEntry(name) {
  return { isFile: true, isDirectory: false, name, file(ok) { ok({ name }); } };
}
function dirEntry(name, children) {
  return {
    isFile: false, isDirectory: true, name,
    createReader() {
      let sent = false;
      return { readEntries(ok) { const batch = sent ? [] : children; sent = true; ok(batch); } };
    },
  };
}

describe('folder walk is loaded on demand', () => {
  it('a plain-file drop never requests drop-folder.js', async () => {
    const files = await collectDroppedFiles({
      files: [{ name: 'a.mp3' }],
      items: [{ kind: 'file', webkitGetAsEntry: () => fileEntry('a.mp3') }],
    });
    expect(files.map((f) => f.name)).toEqual(['a.mp3']);
    expect(loads.count).toBe(0);
  });

  it('a drop with no entry API never requests drop-folder.js', async () => {
    await collectDroppedFiles({ files: [{ name: 'b.wav' }], items: [] });
    expect(loads.count).toBe(0);
  });

  it('a dropped folder requests drop-folder.js once and walks it', async () => {
    const dir = dirEntry('Album', [fileEntry('x.flac'), fileEntry('cover.jpg')]);
    const files = await collectDroppedFiles({
      files: [],
      items: [{ kind: 'file', webkitGetAsEntry: () => dir }],
    });
    expect(files.map((f) => f.name)).toEqual(['x.flac']);
    expect(loads.count).toBe(1);
  });
});
