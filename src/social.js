// Social Feed — localStorage mock of discover/follow/remix chain
const KEY = 'audiovisor.social.feed';
const FOLLOW_KEY = 'audiovisor.social.follows';

export function getFeed() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function postToFeed({ title, mode, theme, fx }) {
  const feed = getFeed();
  const entry = { id: Math.random().toString(36).slice(2,9), title: title || 'Untitled Mix', mode, theme, fx, likes: 0, at: Date.now(), user: 'You' };
  feed.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(feed.slice(0,50)));
  return entry;
}
export function likeFeed(id) {
  const feed = getFeed();
  const e = feed.find(x => x.id === id);
  if (e) e.likes++;
  localStorage.setItem(KEY, JSON.stringify(feed));
}
export function getFollows() {
  try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || '[]'); } catch { return []; }
}
export function toggleFollow(user) {
  const list = getFollows();
  const i = list.indexOf(user);
  if (i >= 0) list.splice(i,1); else list.push(user);
  localStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
  return list.includes(user);
}
export function seedFeed() {
  if (getFeed().length) return;
  const seeds = [
    { title: 'Brass Tape Slow', mode: 'bars', theme: 'brass', fx: { chop: true }, user: 'soulchef', likes: 12 },
    { title: 'Laser Drift', mode: 'void', theme: 'laser', fx: { echo: true }, user: 'neon___', likes: 34 },
    { title: 'Chopped & Screwed Vol.3', mode: 'fluid', theme: 'screwed', fx: { chop: true, reverb: true }, user: 'dj_screw_tribute', likes: 89 },
  ];
  localStorage.setItem(KEY, JSON.stringify(seeds));
}
