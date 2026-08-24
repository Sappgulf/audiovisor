/**
 * localStorage that cannot throw.
 *
 * Writes fail for reasons that have nothing to do with this app: Safari
 * private browsing rejects them outright, and any browser throws once the
 * origin's quota is full. Reads were already guarded in most places here;
 * writes mostly were not, and one of them ran at module scope during boot —
 * a rejected write from Social.seedFeed() propagated out of the top level of
 * main.js and stopped everything below it from wiring up, taking the
 * settings tabs, the raytrace toggle and the help panel with it.
 *
 * Nothing in this app needs persistence badly enough to fail without it.
 * Losing a preference is acceptable; losing the settings drawer is not.
 */

/** @returns {boolean} whether the value was actually stored */
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** @returns the parsed value, or `fallback` if missing, unreadable or corrupt */
export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** @returns {boolean} whether the write succeeded */
export function writeText(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readText(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
