#!/usr/bin/env node
/**
 * Adds the default songs to try (public/songs/) from a folder of audio files.
 *
 *   node scripts/add-songs.mjs <folder>
 *
 * Each file becomes a 160 kbps AAC .m4a named after its title, and
 * public/songs/manifest.json lists them for the app's "Try a song" row. The
 * masters stay where they are: only the compressed copies go in the repo.
 * Uses ffmpeg when it is installed, otherwise macOS afconvert.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, basename, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(ROOT, 'public', 'songs');
const INPUT_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a']);

/** "Last_Seen_master.wav" → "Last Seen" */
export function songTitle(fileName) {
  const stem = basename(fileName, extname(fileName));
  return stem.replace(/_?master$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Last Seen" → "last-seen" */
export function songSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function hasCommand(cmd) {
  try {
    await run('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

/** @param {'ffmpeg' | 'afconvert'} tool */
async function transcode(input, output, tool) {
  if (tool === 'ffmpeg') {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '160k', output]);
  } else {
    await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '160000', input, output]);
  }
}

/**
 * Transcodes every audio file in `folder` into `outDir` and writes the manifest.
 * @param {string} folder
 * @param {string} outDir
 * @param {'ffmpeg' | 'afconvert'} tool
 * @returns {Promise<{ title: string, file: string }[]>}
 */
export async function addSongs(folder, outDir, tool) {
  const names = (await readdir(folder)).filter((f) => INPUT_EXT.has(extname(f).toLowerCase())).sort();
  await mkdir(outDir, { recursive: true });
  /** @type {{ title: string, file: string }[]} */
  const songs = [];
  for (const name of names) {
    const title = songTitle(name);
    const slug = songSlug(title);
    if (!slug) continue;
    await transcode(join(folder, name), join(outDir, `${slug}.m4a`), tool);
    songs.push({ title, file: `${slug}.m4a` });
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(songs, null, 2)}\n`);
  return songs;
}

async function main(argv) {
  const [folder] = argv;
  if (!folder) {
    console.error('usage: node scripts/add-songs.mjs <folder of audio files>');
    process.exit(2);
  }
  const tool = (await hasCommand('ffmpeg')) ? 'ffmpeg' : (await hasCommand('afconvert')) ? 'afconvert' : null;
  if (!tool) {
    console.error('Needs ffmpeg (brew install ffmpeg) or macOS afconvert.');
    process.exit(1);
  }
  const songs = await addSongs(resolve(folder), DEFAULT_OUT, tool);
  if (!songs.length) {
    console.error(`No audio files found in ${folder}`);
    process.exit(1);
  }
  for (const s of songs) console.log(`  ${s.title}  →  public/songs/${s.file}`);
  console.log(`${songs.length} songs written. Commit public/songs and push.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
