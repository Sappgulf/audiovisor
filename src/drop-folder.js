/**
 * Folder walk for dropped directories. drop.js loads this module with a dynamic
 * import() only when a dropped item is a folder, so a plain-file drop never
 * fetches it.
 *
 * Takes the FileSystemEntry objects read synchronously from the drop event, and
 * returns the decodable files they contain.
 */
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, extOf } from './formats.js';

const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];
/* A folder walk stops at these bounds: deep enough for an album with discs
   and a "Various Artists" layer, shallow enough that dropping a home folder
   cannot queue thousands of decodes. */
const WALK_MAX_DEPTH = 4;
const WALK_MAX_FILES = 500;
const WALK_MAX_CHILDREN = 2000;

/**
 * @param {any[]} entries  FileSystemEntry objects from the drop
 * @returns {Promise<File[]>}
 */
export async function walkDroppedEntries(entries) {
  /** @type {File[]} */
  const out = [];
  for (const entry of entries) await walkEntry(entry, 0, out);
  return out;
}

/** Depth 0 is the dropped item itself; directories at WALK_MAX_DEPTH are not entered. */
async function walkEntry(entry, depth, out) {
  if (out.length >= WALK_MAX_FILES) return;
  if (entry.isFile) {
    if (!MEDIA_EXTENSIONS.includes(extOf(entry.name))) return;
    const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory || depth >= WALK_MAX_DEPTH) return;
  const children = await readDirectory(entry.createReader());
  children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) await walkEntry(child, depth + 1, out);
}

/** readEntries returns its children in batches and an empty batch at the end. */
function readDirectory(reader) {
  return new Promise((resolve) => {
    /** @type {any[]} */
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length || all.length >= WALK_MAX_CHILDREN) return resolve(all);
      all.push(...batch);
      next();
    }, () => resolve(all));
    next();
  });
}
