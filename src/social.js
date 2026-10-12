// Social Feed — localStorage mock of discover/follow/remix chain
import { readArray, writeJSON } from './storage.js';

const KEY = 'audiovisor.social.feed';
const FOLLOW_KEY = 'audiovisor.social.follows';
/* The follow list is stored and rendered; cap it so it cannot grow without bound. */
const FOLLOW_CAP = 200;

const newId = () => Math.random().toString(36).slice(2, 9);

export function getFeed() {
  const feed = readArray(KEY);
  // one null or non-object row would throw inside the renderer and blank the whole feed
  return Array.isArray(feed) ? feed.filter((e) => e && typeof e === 'object') : [];
}

export function postToFeed({ title, mode, theme, fx }) {
  const feed = getFeed();
  const entry = {
    id: newId(),
    title: String(title || 'Untitled Mix').slice(0, 120),
    mode, theme, fx,
    likes: 0,
    at: Date.now(),
    user: 'You',
  };
  feed.unshift(entry);
  writeJSON(KEY, feed.slice(0, 50));
  return entry;
}

export function likeFeed(id) {
  const feed = getFeed();
  const e = feed.find((x) => x.id === id);
  if (!e) return false;          // nothing matched; no reason to rewrite
  e.likes++;
  writeJSON(KEY, feed);
  return true;
}

export function getFollows() {
  return readArray(FOLLOW_KEY).filter((u) => typeof u === 'string').slice(-FOLLOW_CAP);
}

export function toggleFollow(user) {
  if (typeof user !== 'string' || !user) return false;
  const list = getFollows();
  const i = list.indexOf(user);
  if (i >= 0) list.splice(i, 1);
  else list.push(user);
  // the oldest follows drop off first once the cap is reached
  const capped = list.slice(-FOLLOW_CAP);
  writeJSON(FOLLOW_KEY, capped);
  return capped.includes(user);
}

/**
 * Backfill anything the older seeder wrote without an id.
 *
 * Fixing the seeder only helped people with an empty feed: seedFeed()
 * returns early when one already exists, so every returning visitor kept
 * the id-less rows and their like buttons stayed dead. Verified against a
 * real browser that had the old data.
 */
function healFeed(feed) {
  let changed = false;
  for (const e of feed) {
    if (typeof e.id !== 'string' || !e.id) { e.id = newId(); changed = true; }
    if (!Number.isFinite(e.at)) { e.at = Date.now(); changed = true; }
  }
  if (changed) writeJSON(KEY, feed);
  return changed;
}

export function seedFeed() {
  const existing = getFeed();
  if (existing.length) { healFeed(existing); return; }
  /* The seeds used to be written without an id or a timestamp, unlike every
     entry postToFeed creates. The feed renders a like button keyed on the
     id, so all three seeded rows rendered data-like="undefined" and their
     like buttons did nothing at all. */
  const seeds = [
    { title: 'Brass Tape Slow', mode: 'bars', theme: 'brass', fx: { chop: true }, user: 'soulchef', likes: 12 },
    { title: 'Laser Drift', mode: 'void', theme: 'laser', fx: { echo: true }, user: 'neon___', likes: 34 },
    { title: 'Chopped & Screwed Vol.3', mode: 'fluid', theme: 'screwed', fx: { chop: true, reverb: true }, user: 'dj_screw_tribute', likes: 89 },
  ].map((s, i) => ({ ...s, id: newId(), at: Date.now() - (i + 1) * 3600e3 }));
  writeJSON(KEY, seeds);
}
